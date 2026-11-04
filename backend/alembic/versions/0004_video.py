"""video reports

Revision ID: 9d2c7e4a1b6f
Revises: 3e8f1a2b4c5d
Create Date: 2026-11-04 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9d2c7e4a1b6f'
down_revision: Union[str, Sequence[str], None] = '3e8f1a2b4c5d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JOB_KINDS = ['analyze_report', 'segment_image', 'match_duplicates', 'verify_fix', 'redact_image']
OPERATIONS = ['analysis', 'segmentation', 'transcription', 'duplicate_assessment', 'fix_verification', 'redaction']
KINDS = ['image', 'audio']
VARIANTS = ['original', 'display', 'redacted', 'wav']


def _set_check(table: str, enum_name: str, column: str, values: list[str]) -> None:
    name = f'ck_{table}_{enum_name}'
    op.drop_constraint(op.f(name), table, type_='check')
    op.create_check_constraint(op.f(name), table, sa.column(column).in_(values))


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('video_tracks',
    sa.Column('report_id', sa.Uuid(), nullable=False),
    sa.Column('media_id', sa.Uuid(), nullable=True),
    sa.Column('concept', sa.String(length=64), nullable=True),
    sa.Column('status', sa.Enum('queued', 'running', 'completed', 'failed', name='video_status', native_enum=False, create_constraint=True, length=32), nullable=False),
    sa.Column('file_id', sa.String(length=64), nullable=True),
    sa.Column('frames', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('assessment', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('tracked_objects', sa.Integer(), nullable=True),
    sa.Column('model', sa.String(length=64), nullable=True),
    sa.Column('provenance', sa.Enum('live', 'cached', 'fixture', name='provenance', native_enum=False, create_constraint=True, length=32), nullable=True),
    sa.Column('error_code', sa.String(length=64), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('id', sa.Uuid(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['media_id'], ['media.id'], name=op.f('fk_video_tracks_media_id_media'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['report_id'], ['reports.id'], name=op.f('fk_video_tracks_report_id_reports'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_video_tracks')),
    sa.UniqueConstraint('report_id', name=op.f('uq_video_tracks_report_id'))
    )
    op.add_column('reports', sa.Column('video_media_id', sa.Uuid(), nullable=True))
    op.add_column('reports', sa.Column('video_display_media_id', sa.Uuid(), nullable=True))
    op.create_foreign_key(op.f('fk_reports_video_media_id_media'), 'reports', 'media', ['video_media_id'], ['id'], ondelete='SET NULL')
    op.create_foreign_key(op.f('fk_reports_video_display_media_id_media'), 'reports', 'media', ['video_display_media_id'], ['id'], ondelete='SET NULL')
    op.add_column('model_calls', sa.Column('video_frames', sa.Integer(), server_default='0', nullable=False))
    # Enums are VARCHAR + CHECK (see app/db/base.py), so new values mean replacing the check.
    _set_check('processing_jobs', 'job_kind', 'kind', JOB_KINDS + ['analyze_video'])
    _set_check('model_calls', 'model_operation', 'operation', OPERATIONS + ['file_upload', 'video_tracking', 'video_description'])
    _set_check('media', 'media_kind', 'kind', KINDS + ['video'])
    _set_check('media', 'media_variant', 'variant', VARIANTS + ['tracked_still'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('video_tracks')
    op.execute("DELETE FROM processing_jobs WHERE kind = 'analyze_video'")
    op.execute("DELETE FROM model_calls WHERE operation IN ('file_upload', 'video_tracking', 'video_description')")
    op.execute("DELETE FROM media WHERE kind = 'video' OR variant = 'tracked_still'")
    _set_check('processing_jobs', 'job_kind', 'kind', JOB_KINDS)
    _set_check('model_calls', 'model_operation', 'operation', OPERATIONS)
    _set_check('media', 'media_kind', 'kind', KINDS)
    _set_check('media', 'media_variant', 'variant', VARIANTS)
    op.drop_constraint(op.f('fk_reports_video_display_media_id_media'), 'reports', type_='foreignkey')
    op.drop_constraint(op.f('fk_reports_video_media_id_media'), 'reports', type_='foreignkey')
    op.drop_column('reports', 'video_display_media_id')
    op.drop_column('reports', 'video_media_id')
    op.drop_column('model_calls', 'video_frames')
