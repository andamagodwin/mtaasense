from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import func, select

from app.api.dependencies import DB, Fingerprint, OptionalUser
from app.core.config import get_settings
from app.core.errors import Unauthorized
from app.core.security import hash_token, new_token, verify_password
from app.db.models import AuditEvent, AuthSession, User
from app.schemas.api import LoginRequest, SessionView, UserView
from app.services import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_cookie(response: Response, token: str, max_age: int) -> None:
    s = get_settings()
    response.set_cookie(
        s.session_cookie_name, token, max_age=max_age, httponly=True, secure=s.cookie_secure, samesite="lax", path="/"
    )


@router.post("/login", response_model=UserView)
def login(body: LoginRequest, request: Request, response: Response, db: DB, fp: Fingerprint) -> UserView:
    s = get_settings()
    rate_limit.hit(db, f"login:{fp}", s.login_rate_limit_per_15min, timedelta(minutes=15))
    user = db.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if not verify_password(body.password, user.password_hash if user else None) or user is None or not user.is_active:
        raise Unauthorized("Email or password is incorrect.", code="invalid_credentials")
    token = new_token()
    ttl = timedelta(hours=s.session_ttl_hours)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=datetime.now(UTC) + ttl,
            user_agent=(request.headers.get("user-agent") or "")[:200],
        )
    )
    user.last_login_at = datetime.now(UTC)
    db.add(AuditEvent(actor_user_id=user.id, actor_label=user.display_name, action="login"))
    db.commit()
    _set_cookie(response, token, int(ttl.total_seconds()))
    return UserView.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: DB) -> None:
    s = get_settings()
    token = request.cookies.get(s.session_cookie_name)
    if token:
        session = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
        if session is not None and session.revoked_at is None:
            session.revoked_at = datetime.now(UTC)
            db.commit()
    response.delete_cookie(s.session_cookie_name, path="/", secure=s.cookie_secure, httponly=True, samesite="lax")


@router.get("/me", response_model=UserView)
def me(user: OptionalUser) -> UserView:
    if user is None:
        raise Unauthorized("Not signed in.")
    return UserView.model_validate(user)


@router.get("/session", response_model=SessionView)
def session(user: OptionalUser) -> SessionView:
    """Current session for the UI; anonymous visitors get `user: null` (not an error)."""
    return SessionView(user=UserView.model_validate(user) if user else None)
