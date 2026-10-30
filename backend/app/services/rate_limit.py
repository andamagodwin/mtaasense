from datetime import UTC, datetime, timedelta

from sqlalchemy import case, literal
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import RateLimited
from app.db.models import RateLimitBucket


def hit(db: Session, key: str, limit: int, window: timedelta) -> None:
    """Fixed-window counter shared across processes. Raises RateLimited when exceeded."""
    now = datetime.now(UTC)
    expired = RateLimitBucket.window_start < literal(now - window)
    stmt = (
        insert(RateLimitBucket)
        .values(key=key, window_start=now, count=1)
        .on_conflict_do_update(
            index_elements=[RateLimitBucket.key],
            set_={
                "count": case((expired, 1), else_=RateLimitBucket.count + 1),
                "window_start": case((expired, now), else_=RateLimitBucket.window_start),
            },
        )
        .returning(RateLimitBucket.count)
    )
    count = db.execute(stmt).scalar_one()
    db.commit()
    if count > limit:
        raise RateLimited("Too many requests. Please wait a little and try again.")
