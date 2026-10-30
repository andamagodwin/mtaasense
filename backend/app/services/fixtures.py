"""Labeled demo fixtures (fallback mode).

Fixtures are keyed by the SHA-256 of a seeded sample image and are only ever applied to
reports flagged `is_sample` while DEMO_FIXTURES_ENABLED=true. Every result produced from a
fixture is stored and displayed with provenance "fixture"; it is never presented as live.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.core.config import get_settings

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "seed" / "fixtures"


@lru_cache(maxsize=64)
def _load(sha256: str) -> dict[str, Any] | None:
    path = FIXTURE_DIR / f"{sha256}.json"
    if not path.is_file():
        return None
    data = json.loads(path.read_text())
    return data if isinstance(data, dict) else None


def fixture_for(sha256: str, *, is_sample: bool, section: str) -> dict[str, Any] | None:
    if not (get_settings().demo_fixtures_enabled and is_sample):
        return None
    data = _load(sha256)
    if data is None:
        return None
    value = data.get(section)
    return value if isinstance(value, dict) else None
