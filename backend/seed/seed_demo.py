"""Seed clearly labelled sample reports for demos.

    uv run python -m seed.seed_demo                 # create sample reports; the worker analyses them
    uv run python -m seed.seed_demo --reset         # delete existing sample data first
    uv run python -m seed.seed_demo --confirm-incidents   # also confirm selected samples as incidents

Every record created here has is_sample=true and is badged "Sample data" in the UI. Photos are
openly licensed Wikimedia Commons images (see seed/images/ATTRIBUTION.md). Ugandan photos use
locations derived from their Commons descriptions (approximate); photos taken elsewhere are
placed at *illustrative* Kampala locations and say so in their landmark note.

Two images are held back for the live demo (submitted by the presenter as "second reports"):
namanve-flood-b.jpg and r36-pothole-b.jpg.
"""

import argparse
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select, update

from app.cli import create_user
from app.core.security import new_token
from app.db.models import AuditEvent, Incident, Media, ProcessingJob, Report, User
from app.db.models.enums import HazardCategory, LocationSource, ReportStatus, UserRole
from app.db.session import session_scope
from app.services.reports import NewReport, create_report
from app.services.review import create_incident_from

IMAGES = Path(__file__).resolve().parent / "images"
SEEDER_EMAIL = "sample-seeder@mtaasense.invalid"
ILLUSTRATIVE = "Illustrative location — sample photo taken in {where}"


@dataclass(frozen=True)
class Sample:
    slug: str
    description: str
    category: HazardCategory | None
    lat: float | None
    lon: float | None
    note: str | None
    days_ago: float
    confirm: bool = False


SAMPLES = [
    Sample(
        "namanve-flood-a",
        "The Kampala–Jinja highway at Namanve is flooded again after the rain. People and boda bodas "
        "are wading through brown water next to the industrial park wall.",
        HazardCategory.flooding,
        0.35760,
        32.69520,
        "Kampala–Jinja highway, Namanve Industrial Park (approx.)",
        2.0,
    ),
    Sample(
        "wetland-road-flood",
        "Road next to the wetland is under water, cars are driving through slowly.",
        HazardCategory.flooding,
        None,
        None,
        None,
        5.0,
    ),
    Sample(
        "mukono-flood",
        "Houses and the footpath are flooded, children standing in the water outside.",
        HazardCategory.flooding,
        0.35330,
        32.75530,
        "Mukono Division (approx.)",
        9.0,
        confirm=True,
    ),
    Sample(
        "kamokya-drain-a",
        "The drainage channel between the houses is clogged. The water is stagnant and smells bad.",
        HazardCategory.blocked_drainage,
        0.33970,
        32.58680,
        "Kamokya, between the houses (approx.)",
        12.0,
        confirm=True,
    ),
    Sample(
        "kamokya-drain-b",
        "Rubbish heaped beside the channel along the footpath, the drain is blocked.",
        HazardCategory.blocked_drainage,
        0.33984,
        32.58668,
        "Kamokya, footpath by the rubbish heap (approx.)",
        1.5,
    ),
    Sample(
        "natete-drain",
        "Drain choked with plants and silt, water not flowing.",
        None,
        0.29670,
        32.54280,
        "Natete (approx.)",
        7.0,
    ),
    Sample(
        "kalerwe-drain",
        "People are dumping garbage into the drainage channel along Kalerwe–Bwaise road.",
        HazardCategory.blocked_drainage,
        0.35800,
        32.56600,
        "Kalerwe–Bwaise road (approx.)",
        4.0,
        confirm=True,
    ),
    Sample(
        "r36-pothole-a",
        "Big pothole at the edge of the tarmac, the road edge is breaking off too. Cars swerve "
        "into the middle of the road to avoid it.",
        HazardCategory.pothole,
        0.35400,
        32.61200,
        ILLUSTRATIVE.format(where="Mpumalanga, South Africa"),
        3.0,
    ),
    Sample(
        "r36-potholes-other",
        "Several potholes on this stretch, one is filled with water.",
        HazardCategory.pothole,
        0.35470,
        32.61250,
        ILLUSTRATIVE.format(where="Mpumalanga, South Africa"),
        6.0,
    ),
    Sample(
        "ghana-water-potholes",
        "Murram road full of potholes filled with rainwater, hard to pass.",
        HazardCategory.pothole,
        0.38000,
        32.56000,
        ILLUSTRATIVE.format(where="Northern Ghana"),
        10.0,
        confirm=True,
    ),
    Sample(
        "nigeria-pothole-road",
        "The whole road surface is broken with holes, very bad for vehicles.",
        HazardCategory.road_surface_damage,
        0.32000,
        32.62000,
        ILLUSTRATIVE.format(where="Nigeria"),
        14.0,
    ),
    Sample(
        "truck-road-unclear",
        "Serious potholes on the main road, trucks are struggling.",
        HazardCategory.pothole,
        0.29000,
        32.60000,
        ILLUSTRATIVE.format(where="southern Africa"),
        8.0,
    ),
    Sample(
        "chapati-irrelevant",
        "Huge pothole on Bombo road near the roundabout.",
        HazardCategory.pothole,
        0.33500,
        32.57000,
        "Bombo road (sample with a mismatched photo)",
        1.0,
    ),
]

HELD_BACK = ["namanve-flood-b.jpg", "r36-pothole-b.jpg"]


def reset_samples() -> int:
    with session_scope() as db:
        ids = list(db.scalars(select(Report.id).where(Report.is_sample.is_(True))))
        db.execute(update(Incident).where(Incident.is_sample.is_(True)).values(primary_report_id=None))
        db.execute(update(Report).where(Report.is_sample.is_(True)).values(incident_id=None))
        db.execute(delete(Incident).where(Incident.is_sample.is_(True)))
        db.execute(delete(AuditEvent).where(AuditEvent.report_id.in_(ids)))
        db.execute(delete(ProcessingJob).where(ProcessingJob.report_id.in_(ids)))
        db.execute(delete(Report).where(Report.id.in_(ids)))
        db.execute(delete(Media).where(Media.is_sample.is_(True)))
    return len(ids)


def seed() -> list[uuid.UUID]:
    sources = json.loads((IMAGES / "sources.json").read_text())
    created: list[uuid.UUID] = []
    for sample in SAMPLES:
        image = (IMAGES / f"{sample.slug}.jpg").read_bytes()
        located = sample.lat is not None
        new = NewReport(
            image=image,
            description=sample.description,
            voice_transcript=None,
            reporter_category=sample.category,
            lat=sample.lat,
            lon=sample.lon,
            location_source=LocationSource.map_pin if located else LocationSource.none,
            location_accuracy_m=None,
            location_note=sample.note,
            audio_id=None,
            audio_claim_token=None,
            idempotency_key=f"sample-{sample.slug}",
            fingerprint="sample-seed",
            is_sample=True,
        )
        with session_scope() as db:
            if db.scalar(select(Report.id).where(Report.idempotency_key == new.idempotency_key)):
                print(f"skip   {sample.slug} (already seeded)")
                continue
            report, _, job = create_report(db, new)
            when = datetime.now(UTC) - timedelta(days=sample.days_ago)
            report.created_at = when
            job.run_after = datetime.now(UTC) + timedelta(seconds=len(created) * 2)  # gentle on rate limits
            created.append(report.id)
            print(f"seeded {report.reference} {sample.slug} — {sources[sample.slug]['license']}")
    return created


def confirm_incidents() -> None:
    """Confirm selected samples as incidents, attributed to a non-login 'sample seeder' account."""
    with session_scope() as db:
        seeder = db.scalar(select(User).where(User.email == SEEDER_EMAIL))
    if seeder is None:
        create_user(SEEDER_EMAIL, "Sample data seeder", UserRole.reviewer, new_token())
    with session_scope() as db:
        seeder = db.scalar(select(User).where(User.email == SEEDER_EMAIL))
        assert seeder is not None
        seeder.is_active = False  # exists only to attribute seeded decisions in the audit log
        for sample in [s for s in SAMPLES if s.confirm]:
            report = db.scalar(select(Report).where(Report.idempotency_key == f"sample-{sample.slug}"))
            if report is None or report.incident_id is not None:
                continue
            if report.status not in (ReportStatus.under_review, ReportStatus.processing_failed):
                print(f"wait   {sample.slug}: status {report.status.value} (run the worker first)")
                continue
            incident = create_incident_from(db, report, seeder)
            print(f"incident {incident.reference} from {report.reference}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="delete existing sample data first")
    parser.add_argument(
        "--confirm-incidents",
        action="store_true",
        help="confirm selected samples as incidents (after the worker has analysed them)",
    )
    args = parser.parse_args()
    if args.reset:
        print(f"removed {reset_samples()} sample reports")
    if args.confirm_incidents:
        confirm_incidents()
        return
    seed()
    print(f"Held back for the live demo: {', '.join(HELD_BACK)} (in seed/images/)")


if __name__ == "__main__":
    main()
