"""site assistant model operation

Revision ID: e3f9a5c7b2d4
Revises: d8e2b4c6a1f3
Create Date: 2026-11-05 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e3f9a5c7b2d4'
down_revision: Union[str, Sequence[str], None] = 'd8e2b4c6a1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPERATIONS = [
    'analysis', 'segmentation', 'transcription', 'duplicate_assessment', 'fix_verification', 'redaction',
    'file_upload', 'video_tracking', 'video_description', 'review_assistant', 'map_assistant', 'voice_assistant',
]
ADDED = ['site_assistant']


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
    op.execute("DELETE FROM model_calls WHERE operation = 'site_assistant'")
    _set_check(OPERATIONS)
