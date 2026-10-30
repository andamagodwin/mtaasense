"""Record live results for seeded sample images as labelled demo fixtures (fallback mode).

    uv run python -m seed.export_fixtures

Run after the worker has analysed the samples with a real MODEL_API_KEY. Writes
seed/fixtures/<sha256 of original image>.json. With DEMO_FIXTURES_ENABLED=true, sample reports
(and only sample reports) fall back to these when the live API is unavailable; the UI then
labels the result "Demo fixture", never "Live model call".
"""

import json
from pathlib import Path
from typing import Any

from sqlalchemy import select

from app.db.models import Report, Segmentation
from app.db.models.enums import AnalysisStatus, Provenance, SegmentationStatus
from app.db.session import session_scope

OUT = Path(__file__).resolve().parent / "fixtures"


def main() -> None:
    OUT.mkdir(exist_ok=True)
    written = 0
    with session_scope() as db:
        reports = db.scalars(
            select(Report).where(
                Report.is_sample.is_(True),
                Report.analysis_status == AnalysisStatus.completed,
                Report.analysis_provenance == Provenance.live,
            )
        ).all()
        for report in reports:
            assert report.analysis is not None
            meta = report.analysis["meta"]
            fixture: dict[str, Any] = {
                "image": report.idempotency_key,
                "analysis": {
                    "result": report.analysis["result"],
                    "note": f"Recorded from a live {meta['model']} call on {meta['created_at'][:10]} "
                    f"(response {meta.get('response_id')}).",
                },
            }
            segs = db.scalars(
                select(Segmentation).where(
                    Segmentation.report_id == report.id,
                    Segmentation.status == SegmentationStatus.completed,
                    Segmentation.provenance == Provenance.live,
                )
            ).all()
            for seg in segs:
                fixture[f"segmentation:{seg.prompt}"] = {
                    "regions": seg.regions,
                    "image_width": seg.image_width,
                    "image_height": seg.image_height,
                    "note": f"Recorded from a live {seg.model} call.",
                }
            (OUT / f"{report.image.sha256}.json").write_text(json.dumps(fixture, indent=1) + "\n")
            written += 1
    print(f"wrote {written} fixtures to {OUT}")


if __name__ == "__main__":
    main()
