"""Evaluation harness — real Meta Model API calls on a small labelled set.

    uv run python -m eval.run_eval              # analysis + segmentation + duplicate pairs (~$0.20)
    uv run python -m eval.run_eval --only analysis

Writes eval/results/summary.json (served on the admin page) and eval/runs/<timestamp>.json
(raw model outputs, git-ignored). Every number in the summary is computed from this run's
responses; nothing is estimated or hand-entered. Sample sizes are small and reported with
each metric.

Labels: categories come from each photo's Wikimedia Commons description and a visual check.
Duplicate ground truth: the Namanve pair shares author and description ("flooded section of
Kampala Jinja highway at Namanve Industrial Park"); "Big hol" and "Better off than on" show the
same pothole (same edge crack and power line) from two angles; "More holes" is a different
pothole on the same road. The two Kamokya drainage photos are unlabelled (ground truth unknown)
and excluded from precision/recall.
"""

import argparse
import base64
import io
import json
import statistics
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageFilter
from pydantic import ValidationError

from app.core.config import get_settings
from app.db.models.enums import HAZARD_FAMILY, HazardCategory, ModelOperation
from app.schemas.analysis import DuplicateAssessment
from app.services import pricing
from app.services.analysis import AnalysisFailed, AnalysisInput, build_payload, parse_assessment
from app.services.duplicate_matching import DUPLICATE_INSTRUCTIONS, _assessment_schema
from app.services.meta_client import CallContext, ModelAPIError, get_meta_client, response_output_text
from app.services.segmentation import parse_sam_events

ROOT = Path(__file__).resolve().parent
IMAGES = ROOT.parent / "seed" / "images"
CATS = {c.value: c for c in HazardCategory}


@dataclass(frozen=True)
class Case:
    id: str
    image: str
    description: str
    expected_categories: tuple[str, ...]  # any of these counts as correct
    expected_hazard: bool
    kind: str  # clear | ambiguous | poor_quality | irrelevant | conflicting
    expect_conflict: bool = False
    degrade: bool = False
    sam_concept: str | None = None


CASES = [
    Case(
        "pothole-edge",
        "r36-pothole-a",
        "Big pothole at the edge of the tarmac.",
        ("pothole",),
        True,
        "clear",
        sam_concept="pothole",
    ),
    Case(
        "pothole-edge-2",
        "r36-pothole-b",
        "Pothole and broken road edge.",
        ("pothole",),
        True,
        "clear",
        sam_concept="pothole",
    ),
    Case(
        "potholes-water",
        "r36-potholes-other",
        "Several potholes, one with water.",
        ("pothole",),
        True,
        "clear",
        sam_concept="pothole",
    ),
    Case(
        "murram-puddles",
        "ghana-water-potholes",
        "Potholes full of rainwater on the murram road.",
        ("pothole", "road_surface_damage", "flooding"),
        True,
        "clear",
        sam_concept="puddle",
    ),
    Case(
        "broken-road",
        "nigeria-pothole-road",
        "The road surface is broken everywhere.",
        ("road_surface_damage", "pothole"),
        True,
        "clear",
        sam_concept="damaged road surface",
    ),
    Case(
        "truck-road",
        "truck-road-unclear",
        "Serious potholes on the main road.",
        ("pothole", "road_surface_damage", "unclear"),
        True,
        "ambiguous",
    ),
    Case(
        "kamokya-a",
        "kamokya-drain-a",
        "Drainage channel clogged, water stagnant.",
        ("blocked_drainage",),
        True,
        "clear",
        sam_concept="drainage channel",
    ),
    Case(
        "kamokya-b",
        "kamokya-drain-b",
        "Rubbish beside the channel, drain blocked.",
        ("blocked_drainage",),
        True,
        "clear",
        sam_concept="drainage channel",
    ),
    Case(
        "natete",
        "natete-drain",
        "Drain choked with plants and silt.",
        ("blocked_drainage",),
        True,
        "clear",
        sam_concept="drainage channel",
    ),
    Case(
        "kalerwe",
        "kalerwe-drain",
        "Garbage dumped in the drainage channel.",
        ("blocked_drainage", "flooding"),
        True,
        "ambiguous",
        sam_concept="drainage channel",
    ),
    Case(
        "namanve-a",
        "namanve-flood-a",
        "Highway flooded at Namanve.",
        ("flooding",),
        True,
        "clear",
        sam_concept="standing water",
    ),
    Case(
        "namanve-b",
        "namanve-flood-b",
        "Water covering the road, people wading.",
        ("flooding",),
        True,
        "clear",
        sam_concept="standing water",
    ),
    Case(
        "mukono", "mukono-flood", "Houses and path flooded.", ("flooding",), True, "clear", sam_concept="standing water"
    ),
    Case(
        "irrelevant-food", "chapati-irrelevant", "", ("not_applicable", "other_hazard", "unclear"), False, "irrelevant"
    ),
    Case(
        "conflict-food",
        "chapati-irrelevant",
        "Huge pothole on Bombo road near the roundabout.",
        ("not_applicable", "other_hazard", "unclear"),
        False,
        "conflicting",
        expect_conflict=True,
    ),
    Case(
        "conflict-flood-as-pothole",
        "namanve-flood-a",
        "There is a big pothole here, cars cannot pass.",
        ("flooding",),
        True,
        "conflicting",
        expect_conflict=True,
    ),
    Case(
        "blurred-pothole",
        "r36-pothole-a",
        "Pothole on the road.",
        ("pothole", "road_surface_damage", "unclear"),
        True,
        "poor_quality",
        degrade=True,
    ),
]

# (image A, image B, label) — label True = same incident, False = different, None = unknown.
PAIRS = [
    ("namanve-flood-a", "namanve-flood-b", True),
    ("r36-pothole-a", "r36-pothole-b", True),
    ("r36-pothole-b", "r36-potholes-other", False),
    ("namanve-flood-a", "wetland-road-flood", False),
    ("kamokya-drain-a", "kamokya-drain-b", None),
]


def data_url(slug: str, max_edge: int, degrade: bool = False) -> tuple[str, int, int]:
    with Image.open(IMAGES / f"{slug}.jpg") as img:
        rgb = img.convert("RGB")
    rgb.thumbnail((max_edge, max_edge))
    if degrade:  # synthetic poor-quality variant: heavy blur + underexposure
        rgb = ImageEnhance.Brightness(rgb.filter(ImageFilter.GaussianBlur(radius=9))).enhance(0.35)
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), rgb.width, rgb.height


def pct(n: int, d: int) -> float | None:
    return round(n / d, 3) if d else None


def run_analysis_cases(raw: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    client = get_meta_client()
    rows = []
    for case in CASES:
        url, _, _ = data_url(case.image, settings.analysis_image_max_edge, case.degrade)
        inp = AnalysisInput(
            report_id=None,
            is_sample=True,
            description=case.description,
            voice_transcript=None,  # type: ignore[arg-type]
            reporter_category=None,
            has_location=False,
            image_sha256="eval",
            display_media_id=None,
        )  # type: ignore[arg-type]
        started = time.monotonic()
        try:
            result = client.create_response(
                CallContext(ModelOperation.analysis), build_payload(inp, url), image_count=1
            )
            usage = result.body.get("usage") or {}
            a = parse_assessment(result.body)
            row = {
                "id": case.id,
                "kind": case.kind,
                "valid": True,
                "latency_ms": result.latency_ms,
                "cost": float(
                    pricing.token_cost(
                        settings.analysis_model, usage.get("input_tokens", 0), usage.get("output_tokens", 0)
                    )
                    or 0
                ),
                "category": a.hazard_category,
                "is_hazard": a.is_infrastructure_hazard,
                "consistency": a.description_consistency,
                "image_quality": a.image_quality,
                "confidence": a.confidence,
                "severity": a.severity,
                "category_ok": a.hazard_category in case.expected_categories,
                "family_ok": _family_ok(a.hazard_category, case.expected_categories),
                "hazard_ok": a.is_infrastructure_hazard == case.expected_hazard,
                "conflict_flagged": a.description_consistency in ("inconsistent", "partially_consistent"),
            }
            raw[f"analysis:{case.id}"] = a.model_dump()
        except (AnalysisFailed, ModelAPIError) as exc:
            code = getattr(exc, "code", "error")
            row = {
                "id": case.id,
                "kind": case.kind,
                "valid": False,
                "error": code,
                "latency_ms": int((time.monotonic() - started) * 1000),
                "cost": 0.0,
            }
        rows.append(row)
        print(
            f"  analysis {case.id:26} {row.get('category', row.get('error'))!s:20} "
            f"hazard={row.get('is_hazard')} consistency={row.get('consistency')} {row['latency_ms']}ms"
        )

    valid = [r for r in rows if r["valid"]]
    hazards = [r for r, c in zip(rows, CASES, strict=True) if r["valid"] and c.expected_hazard]
    non_hazards = [r for r, c in zip(rows, CASES, strict=True) if r["valid"] and not c.expected_hazard]
    conflicts = [r for r, c in zip(rows, CASES, strict=True) if r["valid"] and c.expect_conflict]
    latencies = sorted(r["latency_ms"] for r in valid)
    return {
        "n_cases": len(CASES),
        "schema_valid_rate": pct(len(valid), len(rows)),
        "category_accuracy": pct(sum(r["category_ok"] for r in valid), len(valid)),
        "category_family_accuracy": pct(sum(r["family_ok"] for r in valid), len(valid)),
        "hazard_detection": {
            "hazard_recall": pct(sum(r["is_hazard"] for r in hazards), len(hazards)),
            "n_hazard": len(hazards),
            "non_hazard_rejection": pct(sum(not r["is_hazard"] for r in non_hazards), len(non_hazards)),
            "n_non_hazard": len(non_hazards),
        },
        "conflict_detection_rate": pct(sum(r["conflict_flagged"] for r in conflicts), len(conflicts)),
        "n_conflict_cases": len(conflicts),
        "poor_quality_case": next(
            (
                {"image_quality": r.get("image_quality"), "confidence": r.get("confidence")}
                for r in rows
                if r["id"] == "blurred-pothole" and r["valid"]
            ),
            None,
        ),
        "latency_ms": {
            "p50": statistics.median(latencies) if latencies else None,
            "max": latencies[-1] if latencies else None,
        },
        "estimated_cost_usd": round(sum(r["cost"] for r in rows), 4),
        "cases": rows,
    }


def _family_ok(predicted: str, expected: tuple[str, ...]) -> bool:
    if predicted in expected:
        return True
    pred = CATS.get(predicted)
    return pred is not None and any(CATS.get(e) and HAZARD_FAMILY[CATS[e]] == HAZARD_FAMILY[pred] for e in expected)


def run_segmentation_cases(raw: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    client = get_meta_client()
    rows = []
    for case in [c for c in CASES if c.sam_concept]:
        url, w, h = data_url(case.image, settings.display_image_max_edge)
        payload = {
            "model": settings.segmentation_model,
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": case.sam_concept},
                        {"type": "input_image", "image_url": url},
                    ],
                }
            ],
            "metadata": {"include_confidence": "true"},
            "store": False,
        }
        try:
            events, ms = client.stream_response(
                CallContext(ModelOperation.segmentation), payload, image_count=1, cost=pricing.sam_image_cost(1)
            )
            regions, frame = parse_sam_events(events)
            row = {
                "id": case.id,
                "concept": case.sam_concept,
                "ok": True,
                "regions": len(regions),
                "frame_matches_input": frame == (w, h) if frame else None,
                "latency_ms": ms,
                "max_confidence": max((r["confidence"] or 0 for r in regions), default=None),
            }
        except Exception as exc:  # noqa: BLE001 — record any failure as a data point
            row = {
                "id": case.id,
                "concept": case.sam_concept,
                "ok": False,
                "error": getattr(exc, "code", type(exc).__name__),
            }
        rows.append(row)
        print(
            f"  sam {case.id:20} {case.sam_concept!r:24} regions={row.get('regions')} conf={row.get('max_confidence')}"
        )
    ok = [r for r in rows if r["ok"]]
    return {
        "n_images": len(rows),
        "request_success_rate": pct(len(ok), len(rows)),
        "found_region_rate": pct(sum(r["regions"] > 0 for r in ok), len(rows)),
        "frame_size_matches_input_rate": pct(sum(bool(r.get("frame_matches_input")) for r in ok), len(ok)),
        "estimated_cost_usd": float(pricing.sam_image_cost(len(rows))),
        "cases": rows,
    }


def run_duplicate_pairs(raw: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    client = get_meta_client()
    rows = []
    for a, b, label in PAIRS:
        url_a = data_url(a, 1024)[0]
        url_b = data_url(b, 1024)[0]
        content = [
            {
                "type": "input_text",
                "text": "Source report S — category and description withheld for this evaluation. Photo of S:",
            },
            {"type": "input_image", "image_url": url_a},
            {"type": "input_text", "text": "Candidate C1 — distance unknown. Photo of C1:"},
            {"type": "input_image", "image_url": url_b},
        ]
        payload = {
            "model": settings.analysis_model,
            "instructions": DUPLICATE_INSTRUCTIONS,
            "input": [{"type": "message", "role": "user", "content": content}],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "duplicate_assessment",
                    "schema": _assessment_schema(["C1"]),
                    "strict": True,
                }
            },
            "reasoning": {"effort": settings.analysis_reasoning_effort},
            "max_output_tokens": settings.analysis_max_output_tokens,
            "store": False,
        }
        try:
            result = client.create_response(CallContext(ModelOperation.duplicate_assessment), payload, image_count=2)
            text, _ = response_output_text(result.body)
            parsed = DuplicateAssessment.model_validate_json(text or "")
            verdict = next(c.verdict for c in parsed.comparisons if c.candidate == "C1")
            raw[f"pair:{a}:{b}"] = parsed.model_dump()
            row = {"a": a, "b": b, "label": label, "verdict": verdict, "latency_ms": result.latency_ms}
        except (ModelAPIError, ValidationError, StopIteration) as exc:
            row = {"a": a, "b": b, "label": label, "verdict": None, "error": type(exc).__name__}
        rows.append(row)
        print(f"  pair {a} vs {b}: label={label} verdict={row['verdict']}")
    labelled = [r for r in rows if r["label"] is not None and r["verdict"] is not None]
    predicted_same = [r for r in labelled if r["verdict"] in ("likely_same", "possibly_same")]
    actual_same = [r for r in labelled if r["label"]]
    tp = sum(1 for r in predicted_same if r["label"])
    return {
        "n_labelled_pairs": len(labelled),
        "precision_same": pct(tp, len(predicted_same)),
        "recall_same": pct(tp, len(actual_same)),
        "note": "Model visual comparison only (descriptions and distances withheld). Tiny sample; indicative only.",
        "cases": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["analysis", "segmentation", "duplicates"])
    args = parser.parse_args()
    if not get_meta_client().configured:
        raise SystemExit("MODEL_API_KEY is not configured — evaluation needs live model access.")
    started = datetime.now(UTC)
    raw: dict[str, Any] = {}
    summary: dict[str, Any] = {
        "run_at": started.isoformat(),
        "models": {"analysis": get_settings().analysis_model, "segmentation": get_settings().segmentation_model},
        "reasoning_effort": get_settings().analysis_reasoning_effort,
    }
    if args.only in (None, "analysis"):
        print("analysis:")
        summary["analysis"] = run_analysis_cases(raw)
    if args.only in (None, "segmentation"):
        print("segmentation:")
        summary["segmentation"] = run_segmentation_cases(raw)
    if args.only in (None, "duplicates"):
        print("duplicate pairs:")
        summary["duplicates"] = run_duplicate_pairs(raw)
    summary["not_evaluated"] = [
        "Transcription accuracy on real Ugandan speakers or Luganda (only one synthetic English clip tested)",
        "Deterministic duplicate retrieval at scale (covered by unit tests, not a labelled dataset)",
        "Segmentation mask quality (IoU) — no ground-truth masks; only 'found a region' is measured",
    ]
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "runs").mkdir(exist_ok=True)
    (ROOT / "results" / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    (ROOT / "runs" / f"{started:%Y%m%dT%H%M%SZ}.json").write_text(json.dumps(raw, indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "not_evaluated"}, indent=1, default=str)[:3000])


if __name__ == "__main__":
    main()
