"""Storage abstraction for uploaded evidence.

Keys are generated server-side (`<kind>/<yyyy>/<mm>/<uuid>.<ext>`); user filenames never
influence paths. The local backend writes to a persistent volume outside any web root.
An object-storage backend only needs to implement `MediaStorage`.
"""

import os
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

_KEY_PATTERN = re.compile(r"^(image|audio)/\d{4}/\d{2}/[0-9a-f-]{36}\.(jpg|png|webp|wav|webm|ogg|m4a|mp3)$")


class MediaStorage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def path_for(self, key: str) -> Path: ...
    def delete(self, key: str) -> None: ...
    def healthy(self) -> bool: ...


def new_storage_key(kind: str, extension: str) -> str:
    now = datetime.now(UTC)
    key = f"{kind}/{now:%Y}/{now:%m}/{uuid.uuid4()}.{extension}"
    if not _KEY_PATTERN.match(key):
        raise ValueError("generated storage key failed validation")
    return key


class LocalMediaStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def path_for(self, key: str) -> Path:
        if not _KEY_PATTERN.match(key):
            raise ValueError("invalid storage key")
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("storage key escapes media root")
        return path

    def put(self, key: str, data: bytes) -> None:
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        with open(tmp, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o640)

    def get(self, key: str) -> bytes:
        return self.path_for(key).read_bytes()

    def delete(self, key: str) -> None:
        self.path_for(key).unlink(missing_ok=True)

    def healthy(self) -> bool:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            probe = self.root / ".healthcheck"
            probe.write_text("ok")
            probe.unlink()
            return True
        except OSError:
            return False


_storage: MediaStorage | None = None


def get_storage() -> MediaStorage:
    global _storage
    if _storage is None:
        _storage = LocalMediaStorage(get_settings().media_storage_path)
    return _storage
