import logging
import re
import uuid
from collections.abc import Awaitable, Callable

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy import text

from app.api.routes import admin, auth, duplicates, incidents, media, overview, reports
from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import configure_logging, log_event, request_id_var
from app.db.session import engine
from app.services.media_storage import get_storage

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger("app")

app = FastAPI(
    title="MtaaSense API",
    version="0.1.0",
    description="Multimodal community infrastructure intelligence: evidence-backed incident records from "
    "resident reports, using Meta Muse Spark, SAM 3.1 and Muse Voice Transcribe.",
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    openapi_url="/openapi.json",
)

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def _error(status: int, code: str, message: str, details: dict[str, object] | None = None) -> JSONResponse:
    body: dict[str, object] = {"code": code, "message": message, "request_id": request_id_var.get()}
    if details:
        body["details"] = details
    return JSONResponse(status_code=status, content={"error": body})


@app.middleware("http")
async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    incoming = request.headers.get("x-request-id", "")
    request_id = incoming if _REQUEST_ID.match(incoming) else uuid.uuid4().hex
    token = request_id_var.set(request_id)
    try:
        # Cookie-authenticated writes must come from an allowed origin (CSRF defence in depth
        # on top of SameSite=Lax). Requests without cookies (public submissions) are unaffected.
        if request.method not in _SAFE_METHODS and settings.session_cookie_name in request.cookies:
            origin = request.headers.get("origin")
            if origin is not None and origin not in settings.cors_origins:
                return _error(403, "origin_not_allowed", "Request origin is not allowed.")
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Idempotency-Key", "X-Report-Token", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return _error(exc.status_code, exc.code, exc.message, exc.details or None)


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    return _error(422, "invalid_request", "Some fields are missing or invalid.", {"fields": fields})


@app.exception_handler(Exception)
async def unhandled_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled_error", extra={"fields": {"exc_type": type(exc).__name__}})
    return _error(500, "internal_error", "Something went wrong on our side. Please try again.")


for module in (reports, duplicates, incidents, overview, auth, media, admin):
    app.include_router(module.router, prefix="/api/v1")


@app.get("/health", tags=["operations"])
def health() -> dict[str, str]:
    """Liveness: the process is up."""
    return {"status": "ok"}


def _migration_head() -> str | None:
    cfg = Config("alembic.ini")
    return ScriptDirectory.from_config(cfg).get_current_head()


@app.get("/ready", tags=["operations"])
def ready() -> JSONResponse:
    """Readiness: database reachable and migrated, media storage writable."""
    checks: dict[str, str] = {}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        checks["database"] = "ok"
        checks["migrations"] = "ok" if current == _migration_head() else "pending"
    except Exception:  # noqa: BLE001
        checks["database"] = "unavailable"
    checks["media_storage"] = "ok" if get_storage().healthy() else "unavailable"
    checks["model_api"] = "configured" if settings.model_api_configured else "not_configured"
    ok = all(checks.get(k) == "ok" for k in ("database", "migrations", "media_storage"))
    if not ok:
        log_event(logger, "not_ready", logging.WARNING, **checks)
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ready" if ok else "not_ready", **checks})
