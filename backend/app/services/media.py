"""Validation and normalisation of uploaded evidence.

File types are decided from the bytes, never from the client-supplied MIME type or name.
"""

import base64
import hashlib
import io
import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import PayloadTooLarge, ValidationFailed
from app.db.models import Media
from app.db.models.enums import MediaKind, MediaVariant
from app.services.media_storage import get_storage, new_storage_key

_IMAGE_FORMATS = {"JPEG": ("jpg", "image/jpeg"), "PNG": ("png", "image/png"), "WEBP": ("webp", "image/webp")}


@dataclass(frozen=True)
class StoredImage:
    original: Media
    display: Media


@dataclass(frozen=True)
class StoredAudio:
    original: Media
    wav: Media


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def store_image(db: Session, data: bytes, *, fingerprint: str | None, is_sample: bool = False) -> StoredImage:
    settings = get_settings()
    if len(data) > settings.max_image_bytes:
        raise PayloadTooLarge(f"Photos must be under {settings.max_image_bytes // (1024 * 1024)} MB.")
    if len(data) < 100:
        raise ValidationFailed("The photo file is empty or truncated.", code="invalid_image")

    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt = probe.format or ""
            probe.verify()
        if fmt not in _IMAGE_FORMATS:
            raise ValidationFailed("Please upload a JPEG, PNG or WebP photo.", code="unsupported_image_type")
        with Image.open(io.BytesIO(data)) as img:
            img.load()
            upright = ImageOps.exif_transpose(img)
    except Image.DecompressionBombError as exc:
        raise ValidationFailed("That photo has too many pixels to process.", code="image_too_large") from exc
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValidationFailed("We couldn't read that file as a photo.", code="invalid_image") from exc

    if min(upright.size) < 64:
        raise ValidationFailed("That photo is too small to be useful as evidence.", code="image_too_small")

    ext, content_type = _IMAGE_FORMATS[fmt]
    storage = get_storage()
    original_key = new_storage_key("image", ext)
    storage.put(original_key, data)
    original = Media(
        kind=MediaKind.image,
        variant=MediaVariant.original,
        storage_key=original_key,
        content_type=content_type,
        size_bytes=len(data),
        sha256=_sha256(data),
        width=upright.width,
        height=upright.height,
        uploader_fingerprint=fingerprint,
        is_sample=is_sample,
    )
    db.add(original)
    db.flush()

    # Display/analysis variant: upright, bounded, re-encoded without EXIF (strips GPS/device metadata).
    display_img = upright.convert("RGB")
    display_img.thumbnail((settings.display_image_max_edge, settings.display_image_max_edge), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    display_img.save(buf, format="JPEG", quality=86, optimize=True)
    display_bytes = buf.getvalue()
    display_key = new_storage_key("image", "jpg")
    storage.put(display_key, display_bytes)
    display = Media(
        kind=MediaKind.image,
        variant=MediaVariant.display,
        parent_id=original.id,
        storage_key=display_key,
        content_type="image/jpeg",
        size_bytes=len(display_bytes),
        sha256=_sha256(display_bytes),
        width=display_img.width,
        height=display_img.height,
        uploader_fingerprint=fingerprint,
        is_sample=is_sample,
    )
    db.add(display)
    db.flush()
    return StoredImage(original=original, display=display)


def image_data_url(media: Media, max_edge: int) -> tuple[str, int, int]:
    """JPEG data URL of a stored image, downscaled for model input. Returns (url, width, height)."""
    raw = get_storage().get(media.storage_key)
    with Image.open(io.BytesIO(raw)) as img:
        rgb = img.convert("RGB")
    if max(rgb.size) > max_edge:
        rgb.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    rgb.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode(), rgb.width, rgb.height


def _sniff_audio(data: bytes) -> str | None:
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "wav"
    if data[:4] == b"\x1a\x45\xdf\xa3":
        return "webm"
    if data[:4] == b"OggS":
        return "ogg"
    if data[4:8] == b"ftyp":
        return "m4a"
    if data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0):
        return "mp3"
    return None


_AUDIO_TYPES = {"wav": "audio/wav", "webm": "audio/webm", "ogg": "audio/ogg", "m4a": "audio/mp4", "mp3": "audio/mpeg"}


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(cmd, capture_output=True, timeout=timeout, check=False)  # noqa: S603


def store_audio(db: Session, data: bytes, *, fingerprint: str | None) -> StoredAudio:
    """Validate a voice note and convert it to 16 kHz mono PCM WAV (the transcriber's input format)."""
    settings = get_settings()
    if len(data) > settings.max_audio_bytes:
        raise PayloadTooLarge(f"Voice notes must be under {settings.max_audio_bytes // (1024 * 1024)} MB.")
    ext = _sniff_audio(data)
    if ext is None:
        raise ValidationFailed("Unsupported audio format. Use WAV, WebM, Ogg, M4A or MP3.", code="unsupported_audio")

    ffmpeg = settings.ffmpeg_binary
    ffprobe = str(Path(ffmpeg).with_name("ffprobe")) if "/" in ffmpeg else "ffprobe"
    with tempfile.TemporaryDirectory(prefix="mtaa-audio-") as tmp:
        src = Path(tmp) / f"in.{ext}"
        dst = Path(tmp) / "out.wav"
        src.write_bytes(data)
        try:
            # Decode the whole stream to get a reliable duration (WebM from MediaRecorder has none in its header).
            conv = _run(
                [
                    ffmpeg,
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-protocol_whitelist",
                    "file",
                    "-i",
                    str(src),
                    "-t",
                    str(settings.max_audio_seconds + 1),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-sample_fmt",
                    "s16",
                    "-f",
                    "wav",
                    str(dst),
                ],
                timeout=60,
            )
        except subprocess.TimeoutExpired as exc:
            raise ValidationFailed("That recording took too long to process.", code="audio_timeout") from exc
        if conv.returncode != 0 or not dst.exists():
            raise ValidationFailed("We couldn't decode that recording.", code="invalid_audio")
        probe = _run([ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "json", str(dst)], timeout=15)
        try:
            duration_s = float(json.loads(probe.stdout)["format"]["duration"])
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            raise ValidationFailed("We couldn't read the recording length.", code="invalid_audio") from exc
        wav_bytes = dst.read_bytes()

    if duration_s < 0.5:
        raise ValidationFailed("The recording is empty or too short.", code="audio_too_short")
    if duration_s > settings.max_audio_seconds:
        raise ValidationFailed(
            f"Voice notes can be at most {settings.max_audio_seconds} seconds.", code="audio_too_long"
        )

    storage = get_storage()
    original_key = new_storage_key("audio", ext)
    storage.put(original_key, data)
    original = Media(
        kind=MediaKind.audio,
        variant=MediaVariant.original,
        storage_key=original_key,
        content_type=_AUDIO_TYPES[ext],
        size_bytes=len(data),
        sha256=_sha256(data),
        duration_ms=int(duration_s * 1000),
        uploader_fingerprint=fingerprint,
    )
    db.add(original)
    db.flush()
    wav_key = new_storage_key("audio", "wav")
    storage.put(wav_key, wav_bytes)
    wav = Media(
        kind=MediaKind.audio,
        variant=MediaVariant.wav,
        parent_id=original.id,
        storage_key=wav_key,
        content_type="audio/wav",
        size_bytes=len(wav_bytes),
        sha256=_sha256(wav_bytes),
        duration_ms=int(duration_s * 1000),
        uploader_fingerprint=fingerprint,
    )
    db.add(wav)
    db.flush()
    return StoredAudio(original=original, wav=wav)


def wav_for(db: Session, audio: Media) -> Media | None:
    return db.query(Media).filter(Media.parent_id == audio.id, Media.variant == MediaVariant.wav).one_or_none()
