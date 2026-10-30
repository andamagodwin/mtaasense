from typing import Any, Literal, get_args

from pydantic import BaseModel, ConfigDict, Field

AiCategory = Literal[
    "pothole", "road_surface_damage", "blocked_drainage", "flooding", "other_hazard", "not_applicable", "unclear"
]
# Concrete visible nouns work best with SAM 3.1 (measured: "blocked drain" found nothing on the drainage
# samples where "drainage channel" did; "puddle" finds water-filled potholes).
SegmentationConcept = Literal["pothole", "damaged road surface", "drainage channel", "standing water", "puddle", "none"]


class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=400)
    source: Literal["image", "description", "image_and_description"]


class HazardAssessment(BaseModel):
    """Structured Muse Spark output. Mirrors ASSESSMENT_JSON_SCHEMA; validated on every response."""

    model_config = ConfigDict(extra="forbid")

    is_infrastructure_hazard: bool
    hazard_category: AiCategory
    summary: str = Field(min_length=1, max_length=600)
    observations: list[Observation] = Field(max_length=12)
    severity: Literal["low", "moderate", "high", "critical", "undetermined"]
    severity_rationale: str = Field(max_length=800)
    confidence: Literal["low", "medium", "high"]
    uncertainties: list[str] = Field(max_length=10)
    missing_information: list[str] = Field(max_length=10)
    suggested_review_priority: Literal["routine", "elevated", "urgent"]
    description_consistency: Literal["consistent", "partially_consistent", "inconsistent", "no_description"]
    consistency_note: str = Field(max_length=600)
    image_quality: Literal["good", "fair", "poor", "unusable"]
    segmentation_concept: SegmentationConcept


def _strings(description: str) -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}, "description": description}


ASSESSMENT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": list(HazardAssessment.model_fields.keys()),
    "properties": {
        "is_infrastructure_hazard": {
            "type": "boolean",
            "description": "True only if the photo plausibly shows road damage or a drainage/flooding problem.",
        },
        "hazard_category": {"type": "string", "enum": list(get_args(AiCategory))},
        "summary": {"type": "string", "description": "One or two neutral sentences for a reviewer (max ~240 chars)."},
        "observations": {
            "type": "array",
            "description": "Concrete conditions, each tagged with where the evidence comes from.",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "source"],
                "properties": {
                    "text": {"type": "string"},
                    "source": {"type": "string", "enum": ["image", "description", "image_and_description"]},
                },
            },
        },
        "severity": {"type": "string", "enum": ["low", "moderate", "high", "critical", "undetermined"]},
        "severity_rationale": {"type": "string"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
        "uncertainties": _strings("What cannot be determined from the evidence."),
        "missing_information": _strings("Information a reviewer would need that the report lacks."),
        "suggested_review_priority": {"type": "string", "enum": ["routine", "elevated", "urgent"]},
        "description_consistency": {
            "type": "string",
            "enum": ["consistent", "partially_consistent", "inconsistent", "no_description"],
        },
        "consistency_note": {"type": "string"},
        "image_quality": {"type": "string", "enum": ["good", "fair", "poor", "unusable"]},
        "segmentation_concept": {
            "type": "string",
            "enum": list(get_args(SegmentationConcept)),
            "description": (
                "Noun phrase for an image-segmentation model naming the main visible hazard region: "
                "drainage channel for drains, puddle for water-filled potholes, standing water for flooding; or none."
            ),
        },
    },
}


class ModelComparison(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidate: str
    verdict: Literal["likely_same", "possibly_same", "likely_different", "insufficient_evidence"]
    visual_comparison: str = Field(max_length=600)
    reasoning: str = Field(max_length=800)


class DuplicateAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    comparisons: list[ModelComparison] = Field(max_length=10)
