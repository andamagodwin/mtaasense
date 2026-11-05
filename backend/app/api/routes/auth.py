import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request, Response, status
from sqlalchemy import func, select

from app.api.dependencies import DB, Fingerprint, OptionalUser, Reviewer
from app.core.config import get_settings
from app.core.errors import NotFound, Unauthorized, ValidationFailed
from app.core.security import hash_password, hash_token, new_token, verify_password
from app.db.models import AuditEvent, AuthSession, Incident, Report, User
from app.schemas.api import (
    ActivityItem,
    LoginRequest,
    PasswordChange,
    ProfileActivity,
    ProfileUpdate,
    RecordRef,
    SessionInfo,
    SessionView,
    UserView,
)
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


# --------------------------------------------------------------------------- the signed-in reviewer's own account

# Audit actions that are about the account, not review decisions.
_ACCOUNT_ACTIONS = ("login", "profile_updated", "password_changed", "sessions_revoked")


def _current_token_hash(request: Request) -> str | None:
    token = request.cookies.get(get_settings().session_cookie_name)
    return hash_token(token) if token else None


@router.patch("/me", response_model=UserView)
def update_me(body: ProfileUpdate, db: DB, user: Reviewer) -> UserView:
    name = body.display_name.strip()
    if len(name) < 2:
        raise ValidationFailed("Enter a name of at least 2 characters.", code="invalid_name")
    if name != user.display_name:
        db.add(
            AuditEvent(
                actor_user_id=user.id,
                actor_label=name,
                action="profile_updated",
                data={"display_name": {"from": user.display_name, "to": name}},
            )
        )
        user.display_name = name
        db.commit()
    return UserView.model_validate(user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, request: Request, db: DB, user: Reviewer) -> None:
    """Change the password and sign out every other session."""
    rate_limit.hit(db, f"password:{user.id}", get_settings().login_rate_limit_per_15min, timedelta(minutes=15))
    if not verify_password(body.current_password, user.password_hash):
        raise ValidationFailed("Your current password is incorrect.", code="wrong_password")
    if body.new_password == body.current_password:
        raise ValidationFailed("Choose a password you haven't used here.", code="same_password")
    user.password_hash = hash_password(body.new_password)
    _revoke_others(db, user, _current_token_hash(request))
    db.add(AuditEvent(actor_user_id=user.id, actor_label=user.display_name, action="password_changed"))
    db.commit()


def _active_sessions(db: DB, user: User) -> list[AuthSession]:
    return list(
        db.scalars(
            select(AuthSession)
            .where(
                AuthSession.user_id == user.id,
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > datetime.now(UTC),
            )
            .order_by(AuthSession.created_at.desc())
        )
    )


def _revoke_others(db: DB, user: User, keep_hash: str | None) -> int:
    revoked = 0
    for session in _active_sessions(db, user):
        if session.token_hash != keep_hash:
            session.revoked_at = datetime.now(UTC)
            revoked += 1
    return revoked


@router.get("/sessions", response_model=list[SessionInfo])
def list_sessions(request: Request, db: DB, user: Reviewer) -> list[SessionInfo]:
    current = _current_token_hash(request)
    return [
        SessionInfo(
            id=s.id,
            created_at=s.created_at,
            expires_at=s.expires_at,
            user_agent=s.user_agent,
            current=s.token_hash == current,
        )
        for s in _active_sessions(db, user)
    ]


@router.post("/sessions/{session_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: uuid.UUID, db: DB, user: Reviewer) -> None:
    session = db.get(AuthSession, session_id)
    if session is None or session.user_id != user.id:
        raise NotFound("Session not found.")
    if session.revoked_at is None:
        session.revoked_at = datetime.now(UTC)
        db.add(
            AuditEvent(
                actor_user_id=user.id, actor_label=user.display_name, action="sessions_revoked", data={"count": 1}
            )
        )
        db.commit()


@router.post("/sessions/revoke-others")
def revoke_other_sessions(request: Request, db: DB, user: Reviewer) -> dict[str, int]:
    revoked = _revoke_others(db, user, _current_token_hash(request))
    if revoked:
        db.add(
            AuditEvent(
                actor_user_id=user.id, actor_label=user.display_name, action="sessions_revoked", data={"count": revoked}
            )
        )
    db.commit()
    return {"revoked": revoked}


@router.get("/me/activity", response_model=ProfileActivity)
def my_activity(db: DB, user: Reviewer) -> ProfileActivity:
    mine = (AuditEvent.actor_user_id == user.id, AuditEvent.action.not_in(_ACCOUNT_ACTIONS))
    counts = dict(db.execute(select(AuditEvent.action, func.count()).where(*mine).group_by(AuditEvent.action)).all())
    events = db.scalars(select(AuditEvent).where(*mine).order_by(AuditEvent.created_at.desc()).limit(20)).all()
    report_ids = {e.report_id for e in events if e.report_id}
    incident_ids = {e.incident_id for e in events if e.incident_id}
    reports = (
        dict(db.execute(select(Report.id, Report.reference).where(Report.id.in_(report_ids))).all())
        if report_ids
        else {}
    )
    incidents = (
        dict(db.execute(select(Incident.id, Incident.reference).where(Incident.id.in_(incident_ids))).all())
        if incident_ids
        else {}
    )
    return ProfileActivity(
        counts=counts,
        recent=[
            ActivityItem(
                id=e.id,
                created_at=e.created_at,
                action=e.action,
                note=e.note,
                report=RecordRef(id=e.report_id, reference=reports[e.report_id]) if e.report_id in reports else None,
                incident=RecordRef(id=e.incident_id, reference=incidents[e.incident_id])
                if e.incident_id in incidents
                else None,
            )
            for e in events
        ],
    )
