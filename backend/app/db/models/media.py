import uuid

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, Timestamps, UUIDPk, str_enum
from app.db.models.enums import MediaKind, MediaVariant


class Media(UUIDPk, Timestamps, Base):
    """Metadata for a stored file. Bytes live in media storage, never in the database."""

    __tablename__ = "media"

    kind: Mapped[MediaKind] = mapped_column(str_enum(MediaKind, "media_kind"))
    variant: Mapped[MediaVariant] = mapped_column(str_enum(MediaVariant, "media_variant"))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"))
    report_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("reports.id", ondelete="CASCADE", use_alter=True), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    width: Mapped[int | None]
    height: Mapped[int | None]
    duration_ms: Mapped[int | None]
    # Draft uploads (e.g. a voice note recorded before the report is submitted) are
    # claimed with this token; only its hash is stored.
    claim_token_hash: Mapped[str | None] = mapped_column(String(64))
    uploader_fingerprint: Mapped[str | None] = mapped_column(String(64), index=True)
    # Muse Voice Transcribe output for audio, kept server-side so clients cannot forge it.
    machine_transcript: Mapped[str | None] = mapped_column(Text)
    is_sample: Mapped[bool] = mapped_column(default=False)

    __table_args__ = (CheckConstraint("size_bytes >= 0", name="size_nonnegative"),)
