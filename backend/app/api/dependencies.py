from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Forbidden, Unauthorized
from app.core.security import fingerprint, hash_token
from app.db.models import AuthSession, User
from app.db.models.enums import UserRole
from app.db.session import SessionLocal


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DB = Annotated[Session, Depends(get_db)]


def client_ip(request: Request) -> str:
    """Client IP, honouring X-Forwarded-For only for the configured number of trusted proxies."""
    hops = get_settings().trusted_proxy_hops
    if hops > 0:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(forwarded) >= hops:
            return forwarded[-hops]
    return request.client.host if request.client else "unknown"


def client_fingerprint(request: Request) -> str:
    return fingerprint(client_ip(request))


Fingerprint = Annotated[str, Depends(client_fingerprint)]


def optional_user(request: Request, db: DB) -> User | None:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if session is None or session.revoked_at is not None or session.expires_at <= datetime.now(UTC):
        return None
    if not session.user.is_active:
        return None
    return session.user


OptionalUser = Annotated[User | None, Depends(optional_user)]


def require_reviewer(user: OptionalUser) -> User:
    if user is None:
        raise Unauthorized("Sign in as a reviewer to continue.")
    if user.role not in (UserRole.reviewer, UserRole.admin):
        raise Forbidden("Reviewer access is required.")
    return user


def require_admin(user: OptionalUser) -> User:
    if user is None:
        raise Unauthorized("Sign in as an administrator to continue.")
    if user.role != UserRole.admin:
        raise Forbidden("Administrator access is required.")
    return user


Reviewer = Annotated[User, Depends(require_reviewer)]
Admin = Annotated[User, Depends(require_admin)]
