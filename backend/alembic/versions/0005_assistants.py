"""assistant model operations

Revision ID: c5a1f7d3e9b2
Revises: 9d2c7e4a1b6f
Create Date: 2026-11-05 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c5a1f7d3e9b2'
down_revision: Union[str, Sequence[str], None] = '9d2c7e4a1b6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPERATIONS = [
    'analysis', 'segmentation', 'transcription', 'duplicate_assessment', 'fix_verification', 'redaction',
    'file_upload', 'video_tracking', 'video_description',
]
ADDED = ['review_assistant', 'map_assistant']


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
    op.execute("DELETE FROM model_calls WHERE operation IN ('review_assistant', 'map_assistant')")
    _set_check(OPERATIONS)
