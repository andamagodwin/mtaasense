import hashlib
import hmac
import secrets
import time
import uuid

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from app.core.config import get_settings

_password_hash = PasswordHash((Argon2Hasher(),))
# Used to equalise timing when a login email does not exist.
_DUMMY_HASH = _password_hash.hash("not-a-real-password")


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _password_hash.verify(password, _DUMMY_HASH)
        return False
    return _password_hash.verify(password, password_hash)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _key(purpose: str) -> bytes:
    secret = get_settings().secret_key.get_secret_value().encode()
    return hmac.new(secret, purpose.encode(), hashlib.sha256).digest()


def fingerprint(value: str) -> str:
    """Keyed hash of a client identifier (IP) — lets us rate-limit without storing IPs."""
    return hmac.new(_key("fingerprint"), value.encode(), hashlib.sha256).hexdigest()


def derive_token(purpose: str, message: str) -> str:
    """Deterministic secret derived from the server key (e.g. receipts for idempotent retries)."""
    return hmac.new(_key(purpose), message.encode(), hashlib.sha256).hexdigest()


def sign_media(media_id: uuid.UUID, ttl_seconds: int | None = None) -> tuple[int, str]:
    ttl = ttl_seconds if ttl_seconds is not None else get_settings().media_url_ttl_seconds
    # Round up to 5-minute buckets so repeated responses reuse the same URL (and browser cache).
    expires = (int(time.time()) + ttl) // 300 * 300 + 300
    sig = hmac.new(_key("media"), f"{media_id}:{expires}".encode(), hashlib.sha256).hexdigest()[:40]
    return expires, sig


def verify_media_signature(media_id: uuid.UUID, expires: int, sig: str) -> bool:
    if expires < int(time.time()):
        return False
    expected = hmac.new(_key("media"), f"{media_id}:{expires}".encode(), hashlib.sha256).hexdigest()[:40]
    return hmac.compare_digest(expected, sig)


_REFERENCE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"  # no 0/O/1/I/L


def new_reference(prefix: str) -> str:
    return prefix + "-" + "".join(secrets.choice(_REFERENCE_ALPHABET) for _ in range(6))
