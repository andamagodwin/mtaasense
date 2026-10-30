import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from app.api.dependencies import DB
from app.core.errors import NotFound
from app.core.security import verify_media_signature
from app.db.models import Media
from app.services.media_storage import get_storage

router = APIRouter(tags=["media"])


@router.get("/media/{media_id}", response_class=FileResponse)
def get_media(
    db: DB, media_id: uuid.UUID, exp: Annotated[int, Query()], sig: Annotated[str, Query(max_length=64)]
) -> FileResponse:
    """Serve private evidence. URLs are short-lived HMAC signatures minted for authorised viewers."""
    if not verify_media_signature(media_id, exp, sig):
        raise NotFound("Media not found.")
    media = db.get(Media, media_id)
    if media is None:
        raise NotFound("Media not found.")
    path = get_storage().path_for(media.storage_key)
    if not path.is_file():
        raise NotFound("Media not found.")
    return FileResponse(
        path,
        media_type=media.content_type,
        headers={
            "Cache-Control": "private, max-age=600",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )
