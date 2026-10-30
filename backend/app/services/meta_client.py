"""The only place that talks to the Meta Model API.

Owns authentication, timeouts, retry policy, concurrency limits, budget checks, usage
capture and error classification. Feature services (analysis, segmentation,
transcription, duplicate assessment) build payloads and interpret results.
"""

import json
import logging
import random
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import httpx

from app.core.config import get_settings
from app.core.logging import log_event
from app.db.models.enums import ModelOperation
from app.services import pricing
from app.services.usage_tracking import BudgetExhausted, CallRecord, ensure_budget, record_call

logger = logging.getLogger(__name__)

# Bound concurrent model requests per process (protects budget and rate limits).
_CONCURRENCY = threading.BoundedSemaphore(4)
_RETRYABLE_STATUS = {429, 500, 503}
_MAX_RETRY_AFTER_S = 20.0


class ModelAPIError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        http_status: int | None = None,
        retryable: bool = False,
        retry_after: float | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.retryable = retryable
        self.retry_after = retry_after


@dataclass(frozen=True)
class CallContext:
    operation: ModelOperation
    report_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None


@dataclass(frozen=True)
class ModelResult:
    body: dict[str, Any]
    latency_ms: int
    response_id: str | None


def _classify(status: int, body: dict[str, Any] | None) -> tuple[str, bool]:
    err = (body or {}).get("error") or {}
    code = err.get("code") if isinstance(err, dict) else None
    if status == 400:
        return ("content_policy_violation" if code == "content_policy_violation" else "bad_request"), False
    if status == 401:
        return "auth_failed", False
    if status == 402:
        return "billing_not_configured", False
    if status == 403:
        return "forbidden", False
    if status == 404:
        return "model_not_found" if code == "model_not_found" else "not_found", False
    if status == 413:
        return "payload_too_large", False
    if status == 429:
        return "rate_limited", True
    if status == 504:
        # Docs: a timed-out request will likely time out again unchanged.
        return "gateway_timeout", False
    if status >= 500:
        return "provider_unavailable", True
    return f"http_{status}", False


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return min(float(value), _MAX_RETRY_AFTER_S)
    except ValueError:
        return None


def _request_id(response: httpx.Response) -> str | None:
    for header in ("x-request-id", "request-id", "x-fb-trace-id"):
        if header in response.headers:
            return response.headers[header][:128]
    return None


def _usage(body: dict[str, Any]) -> tuple[int | None, int | None, int | None, int | None]:
    usage = body.get("usage") or {}
    if not isinstance(usage, dict):
        return None, None, None, None
    cached = (usage.get("input_tokens_details") or {}).get("cached_tokens")
    reasoning = (usage.get("output_tokens_details") or {}).get("reasoning_tokens")
    return usage.get("input_tokens"), usage.get("output_tokens"), cached, reasoning


class MetaClient:
    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        settings = get_settings()
        self._settings = settings
        timeout = httpx.Timeout(settings.model_timeout_seconds, connect=settings.model_connect_timeout_seconds)
        headers = {"User-Agent": "MtaaSense/0.1"}
        if settings.model_api_key is not None:
            headers["Authorization"] = f"Bearer {settings.model_api_key.get_secret_value()}"
        self._http = httpx.Client(
            base_url=settings.model_api_base_url.rstrip("/"), timeout=timeout, headers=headers, transport=transport
        )

    @property
    def configured(self) -> bool:
        return self._settings.model_api_configured

    def _preflight(self) -> None:
        if not self.configured:
            raise ModelAPIError("not_configured", "MODEL_API_KEY is not configured on the server.")
        try:
            ensure_budget()
        except BudgetExhausted as exc:
            raise ModelAPIError("budget_exhausted", exc.message) from exc

    def _send(
        self,
        ctx: CallContext,
        model: str,
        endpoint: str,
        build: Any,
        *,
        image_count: int = 0,
        audio_ms: int | None = None,
        stream: bool = False,
    ) -> tuple[httpx.Response, int, CallRecord]:
        """Send with bounded retries. `build` returns a fresh httpx.Request per attempt."""
        self._preflight()
        attempts = 0
        while True:
            attempts += 1
            record = CallRecord(
                operation=ctx.operation,
                model=model,
                endpoint=endpoint,
                image_count=image_count,
                audio_ms=audio_ms,
                report_id=ctx.report_id,
                job_id=ctx.job_id,
            )
            started = time.monotonic()
            try:
                with _CONCURRENCY:
                    response = self._http.send(build(), stream=stream)
            except httpx.TimeoutException as exc:
                record.latency_ms = int((time.monotonic() - started) * 1000)
                record.error_code = "timeout"
                record_call(record)
                # Never auto-retry a read timeout: the provider may still be doing (billable) work.
                retryable = isinstance(exc, httpx.ConnectTimeout)
                if retryable and attempts <= self._settings.model_max_retries:
                    time.sleep(1.0 * attempts)
                    continue
                raise ModelAPIError("timeout", "The model request timed out.", retryable=retryable) from exc
            except httpx.TransportError as exc:
                record.latency_ms = int((time.monotonic() - started) * 1000)
                record.error_code = "network_error"
                record_call(record)
                if attempts <= self._settings.model_max_retries:
                    time.sleep(1.0 * attempts + random.random())
                    continue
                raise ModelAPIError("network_error", "Could not reach the model provider.", retryable=True) from exc

            record.http_status = response.status_code
            record.provider_response_id = _request_id(response)
            if response.status_code < 400:
                return response, attempts, record

            if stream:
                response.read()
            record.latency_ms = int((time.monotonic() - started) * 1000)
            try:
                err_body = response.json()
            except (json.JSONDecodeError, UnicodeDecodeError):
                err_body = None
            code, retryable = _classify(response.status_code, err_body)
            record.error_code = code
            record_call(record)
            log_event(
                logger,
                "model_api_error",
                logging.WARNING,
                model=model,
                endpoint=endpoint,
                status=response.status_code,
                code=code,
                attempt=attempts,
            )
            retry_after = _retry_after(response)
            if retryable and attempts <= self._settings.model_max_retries:
                time.sleep(retry_after if retry_after is not None else (0.75 * 2 ** (attempts - 1) + random.random()))
                continue
            message = "The model provider rejected the request." if not retryable else "The model provider is busy."
            raise ModelAPIError(
                code, message, http_status=response.status_code, retryable=retryable, retry_after=retry_after
            )

    def create_response(self, ctx: CallContext, payload: dict[str, Any], *, image_count: int = 0) -> ModelResult:
        """POST /v1/responses (non-streaming)."""
        model = str(payload["model"])
        started = time.monotonic()
        response, _, record = self._send(
            ctx,
            model,
            "responses",
            lambda: self._http.build_request("POST", "/responses", json=payload),
            image_count=image_count,
        )
        latency = int((time.monotonic() - started) * 1000)
        try:
            body = response.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            record.latency_ms = latency
            record.error_code = "malformed_response"
            record_call(record)
            raise ModelAPIError("malformed_response", "The provider returned an unreadable response.") from exc
        input_tokens, output_tokens, cached, reasoning = _usage(body)
        record.latency_ms = latency
        record.input_tokens, record.output_tokens = input_tokens, output_tokens
        record.cached_tokens, record.reasoning_tokens = cached, reasoning
        record.provider_response_id = body.get("id") or record.provider_response_id
        record.estimated_cost_usd = pricing.token_cost(
            model, input_tokens or 0, output_tokens or 0, cached or 0
        ) or Decimal("0")
        record.success = body.get("status") in (None, "completed")
        if not record.success:
            record.error_code = f"status_{body.get('status')}"
        record_call(record)
        log_event(
            logger,
            "model_call",
            model=model,
            op=ctx.operation.value,
            latency_ms=latency,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost=str(record.estimated_cost_usd),
        )
        return ModelResult(body=body, latency_ms=latency, response_id=body.get("id"))

    def stream_response(
        self, ctx: CallContext, payload: dict[str, Any], *, image_count: int = 0, cost: Decimal = Decimal("0")
    ) -> tuple[list[dict[str, Any]], int]:
        """POST /v1/responses with stream=true; returns every SSE event as a dict."""
        model = str(payload["model"])
        body = {**payload, "stream": True}
        started = time.monotonic()
        response, _, record = self._send(
            ctx,
            model,
            "responses:stream",
            lambda: self._http.build_request("POST", "/responses", json=body, headers={"Accept": "text/event-stream"}),
            image_count=image_count,
            stream=True,
        )
        events: list[dict[str, Any]] = []
        try:
            for data in _iter_sse(response.iter_lines()):
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                if isinstance(event, dict):
                    events.append(event)
        except httpx.HTTPError as exc:
            record.latency_ms = int((time.monotonic() - started) * 1000)
            record.error_code = "stream_interrupted"
            record_call(record)
            raise ModelAPIError("stream_interrupted", "The model stream was interrupted.", retryable=True) from exc
        finally:
            response.close()
        latency = int((time.monotonic() - started) * 1000)
        record.latency_ms = latency
        terminal = next((e for e in reversed(events) if str(e.get("type", "")).startswith("response.")), None)
        failed = next((e for e in events if e.get("type") in ("response.failed", "error")), None)
        record.success = failed is None and terminal is not None and terminal.get("type") == "response.completed"
        if failed is not None:
            record.error_code = "stream_failed"
        elif not record.success:
            record.error_code = "stream_incomplete"
        completed = next((e for e in events if e.get("type") == "response.completed"), None)
        if completed and isinstance(completed.get("response"), dict):
            record.provider_response_id = completed["response"].get("id") or record.provider_response_id
        record.estimated_cost_usd = cost if record.success else Decimal("0")
        record_call(record)
        log_event(
            logger,
            "model_call",
            model=model,
            op=ctx.operation.value,
            latency_ms=latency,
            events=len(events),
            success=record.success,
        )
        return events, latency

    def transcribe(
        self, ctx: CallContext, wav: bytes, *, model: str, audio_ms: int, language_bias: list[str] | None = None
    ) -> tuple[dict[str, Any], int]:
        """POST /v1/asr/transcribe (multipart: `request` JSON + `audio` WAV)."""
        request_json: dict[str, Any] = {"model": model, "audioEncoding": "WAV", "mode": "PUSH_TO_TALK"}
        if language_bias:
            request_json["languageBias"] = language_bias
        files: dict[str, tuple[str | None, bytes | str, str]] = {
            "request": (None, json.dumps(request_json), "application/json"),
            "audio": ("audio.wav", wav, "audio/wav"),
        }
        started = time.monotonic()
        response, _, record = self._send(
            ctx,
            model,
            "asr/transcribe",
            lambda: self._http.build_request(
                "POST", "/asr/transcribe", files=files, headers={"Accept": "application/json"}
            ),
            audio_ms=audio_ms,
        )
        latency = int((time.monotonic() - started) * 1000)
        record.latency_ms = latency
        try:
            body = response.json()
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            record.error_code = "malformed_response"
            record_call(record)
            raise ModelAPIError("malformed_response", "The transcriber returned an unreadable response.") from exc
        billed_ms = body.get("audioDurationMs") if isinstance(body.get("audioDurationMs"), int) else audio_ms
        record.audio_ms = billed_ms
        record.estimated_cost_usd = pricing.transcription_cost(billed_ms)
        record.provider_response_id = str(body.get("sessionId"))[:128] if body.get("sessionId") else None
        record.success = isinstance(body.get("transcript"), str)
        record_call(record)
        return body, latency


def _iter_sse(lines: Iterator[str]) -> Iterator[str]:
    """Yield the `data:` payload of each server-sent event."""
    buffer: list[str] = []
    for line in lines:
        if line == "":
            if buffer:
                yield "\n".join(buffer)
                buffer = []
            continue
        if line.startswith("data:"):
            buffer.append(line[5:].lstrip())
    if buffer:
        yield "\n".join(buffer)


_client: MetaClient | None = None
_client_lock = threading.Lock()


def get_meta_client() -> MetaClient:
    global _client
    with _client_lock:
        if _client is None:
            _client = MetaClient()
        return _client


def response_output_text(body: dict[str, Any]) -> tuple[str | None, str | None]:
    """Concatenate `output_text` parts of a Responses API body. Returns (text, refusal)."""
    texts: list[str] = []
    refusal: str | None = None
    for item in body.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for part in item.get("content") or []:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                texts.append(part["text"])
            elif part.get("type") == "refusal":
                refusal = str(part.get("refusal") or "refused")
    return ("".join(texts) if texts else None), refusal
