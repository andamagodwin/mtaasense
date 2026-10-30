from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every value comes from the environment (or backend/.env)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://mtaasense:mtaasense_dev_only@localhost:5433/mtaasense"

    # Meta Model API — server-side only.
    model_api_key: SecretStr | None = None
    model_api_base_url: str = "https://api.meta.ai/v1"
    model_timeout_seconds: float = 90.0
    model_connect_timeout_seconds: float = 10.0
    model_max_retries: int = 2
    analysis_model: str = "muse-spark-1.3"
    analysis_reasoning_effort: Literal["none", "minimal", "low", "medium", "high"] = "low"
    analysis_max_output_tokens: int = 4000
    analysis_image_max_edge: int = 1280
    segmentation_model: str = "sam-3.1"
    transcription_model: str = "muse-voice-transcribe-1.0"
    duplicate_model_assist: bool = True
    # One SAM call (~$0.0025) per analysed hazard photo, using the concept Muse Spark suggests.
    auto_segment_after_analysis: bool = True
    duplicate_model_max_candidates: int = 3

    # Budget guard. Estimated from provider usage metadata × the official price list.
    model_daily_budget_usd: float = 5.0
    model_total_budget_usd: float = 100.0

    # Labeled fixture results for demos when live APIs are unavailable. Never silent.
    demo_fixtures_enabled: bool = False

    # Media
    media_storage_path: Path = Path("./media")
    max_image_bytes: int = 15 * 1024 * 1024
    max_image_pixels: int = 40_000_000
    display_image_max_edge: int = 2048
    max_audio_bytes: int = 12 * 1024 * 1024
    max_audio_seconds: int = 120
    ffmpeg_binary: str = "ffmpeg"
    media_url_ttl_seconds: int = 900

    # Security
    secret_key: SecretStr = SecretStr("dev-only-change-me-dev-only-change-me")
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    session_ttl_hours: int = 8
    cookie_secure: bool = False
    session_cookie_name: str = "mtaa_session"
    trusted_proxy_hops: int = 0
    report_rate_limit_per_hour: int = 12
    # Backstop that holds even if forwarded-for headers are spoofed to evade the per-client limit.
    public_global_rate_limit_per_hour: int = 300
    transcription_rate_limit_per_hour: int = 20
    login_rate_limit_per_15min: int = 10

    # Duplicate matching
    duplicate_radius_m: float = 150.0
    duplicate_window_days: int = 45
    duplicate_max_candidates: int = 8

    # Worker
    worker_poll_seconds: float = 1.5
    worker_job_timeout_seconds: int = 600

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def model_api_configured(self) -> bool:
        return self.model_api_key is not None and bool(self.model_api_key.get_secret_value().strip())


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production:
        if settings.secret_key.get_secret_value().startswith("dev-only"):
            raise RuntimeError("SECRET_KEY must be set in production")
        if not settings.cookie_secure:
            raise RuntimeError("COOKIE_SECURE must be true in production")
    return settings
