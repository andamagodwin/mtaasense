"""privacy blur redactions

Revision ID: 3e8f1a2b4c5d
Revises: 7fa7c9b05a51
Create Date: 2026-11-04 10:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "3e8f1a2b4c5d"
down_revision: Union[str, Sequence[str], None] = "7fa7c9b05a51"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JOB_KINDS = ["analyze_report", "segment_image", "match_duplicates", "verify_fix"]
OPERATIONS = ["analysis", "segmentation", "transcription", "duplicate_assessment", "fix_verification"]
VARIANTS = ["original", "display", "wav"]


def _set_check(table: str, enum_name: str, column: str, values: list[str]) -> None:
    name = f"ck_{table}_{enum_name}"
    op.drop_constraint(op.f(name), table, type_="check")
    op.create_check_constraint(op.f(name), table, sa.column(column).in_(values))


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "redactions",
        sa.Column("media_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "queued",
                "running",
                "completed",
                "failed",
                name="redaction_status",
                native_enum=False,
                create_constraint=True,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("regions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("redacted_media_id", sa.Uuid(), nullable=True),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column(
            "provenance",
            sa.Enum(
                "live", "cached", "fixture", name="provenance", native_enum=False, create_constraint=True, length=32
            ),
            nullable=True,
        ),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["media_id"], ["media.id"], name=op.f("fk_redactions_media_id_media"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["redacted_media_id"], ["media.id"], name=op.f("fk_redactions_redacted_media_id_media"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_redactions")),
        sa.UniqueConstraint("media_id", name=op.f("uq_redactions_media_id")),
    )
    # Enums are VARCHAR + CHECK (see app/db/base.py), so new values mean replacing the check.
    _set_check("processing_jobs", "job_kind", "kind", JOB_KINDS + ["redact_image"])
    _set_check("model_calls", "model_operation", "operation", OPERATIONS + ["redaction"])
    _set_check("media", "media_variant", "variant", VARIANTS + ["redacted"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("redactions")
    op.execute("DELETE FROM processing_jobs WHERE kind = 'redact_image'")
    op.execute("DELETE FROM model_calls WHERE operation = 'redaction'")
    op.execute("DELETE FROM media WHERE variant = 'redacted'")
    _set_check("processing_jobs", "job_kind", "kind", JOB_KINDS)
    _set_check("model_calls", "model_operation", "operation", OPERATIONS)
    _set_check("media", "media_variant", "variant", VARIANTS)
