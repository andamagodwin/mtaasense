"""Official Meta Model API pay-as-you-go prices.

Source: https://dev.meta.ai/docs/pricing-rate-limits (retrieved 2026-10-29). Update this table
if the price list changes; estimates are only as good as these numbers.
"""

from dataclasses import dataclass
from decimal import Decimal

PRICES_RETRIEVED = "2026-10-29"
PRICES_SOURCE = "https://dev.meta.ai/docs/pricing-rate-limits"

_PER_MILLION = Decimal(1_000_000)


@dataclass(frozen=True)
class TokenPrice:
    input: Decimal
    cached_input: Decimal
    output: Decimal


_SPARK_STANDARD = TokenPrice(Decimal("1.25"), Decimal("0.15"), Decimal("4.25"))
_SPARK_CONTRIBUTOR = TokenPrice(Decimal("0.10"), Decimal("0.002"), Decimal("0.20"))

TOKEN_PRICES: dict[str, TokenPrice] = {
    "muse-spark-1.3": _SPARK_STANDARD,
    "muse-spark-1.2": _SPARK_STANDARD,
    "muse-spark-1.1": _SPARK_STANDARD,
    "muse-spark-1.3-contributor": _SPARK_CONTRIBUTOR,
    "muse-spark-1.2-contributor": _SPARK_CONTRIBUTOR,
    "muse-wonder-1.0": TokenPrice(Decimal("4.00"), Decimal("0.20"), Decimal("20.00")),
}

SAM_PRICE_PER_IMAGE = Decimal("2.50") / Decimal(1000)
TRANSCRIBE_PRICE_PER_HOUR = Decimal("0.18")


def token_cost(model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> Decimal | None:
    """Estimated cost. `output_tokens` already includes reasoning tokens (they are billed as output)."""
    price = TOKEN_PRICES.get(model)
    if price is None:
        return None
    uncached = max(input_tokens - cached_tokens, 0)
    total = uncached * price.input + cached_tokens * price.cached_input + output_tokens * price.output
    return (total / _PER_MILLION).quantize(Decimal("0.000001"))


def sam_image_cost(images: int) -> Decimal:
    return (SAM_PRICE_PER_IMAGE * images).quantize(Decimal("0.000001"))


def transcription_cost(audio_ms: int) -> Decimal:
    # Metered in whole seconds, rounded down.
    seconds = audio_ms // 1000
    return (TRANSCRIBE_PRICE_PER_HOUR * seconds / Decimal(3600)).quantize(Decimal("0.000001"))
