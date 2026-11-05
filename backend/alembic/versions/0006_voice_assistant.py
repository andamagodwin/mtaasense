"""voice assistant model operation

Revision ID: d8e2b4c6a1f3
Revises: c5a1f7d3e9b2
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd8e2b4c6a1f3'
down_revision: Union[str, Sequence[str], None] = 'c5a1f7d3e9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPERATIONS = [
    'analysis', 'segmentation', 'transcription', 'duplicate_assessment', 'fix_verification', 'redaction',
    'file_upload', 'video_tracking', 'video_description', 'review_assistant', 'map_assistant',
]
ADDED = ['voice_assistant']


def _set_check(values: list[str]) -> None:
    # Enums are VARCHAR + CHECK (see app/db/base.py), so new values mean replacing the check.
    name = 'ck_model_calls_model_operation'
    op.drop_constraint(op.f(name), 'model_calls', type_='check')
    op.create_check_constraint(op.f(name), 'model_calls', sa.column('operation').in_(values))


def upgrade() -> None:
    """Upgrade schema."""
    _set_check(OPERATIONS + ADDED)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM model_calls WHERE operation = 'voice_assistant'")
    _set_check(OPERATIONS)
