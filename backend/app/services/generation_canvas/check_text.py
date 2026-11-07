"""Dispatch frozen text checks by their explicit business category."""
from app.services.generation_canvas.check_adoption import ADOPTION_CATEGORY, ADOPTION_INSTRUCTIONS, parse_observation
from app.services.generation_canvas.check_requirement_quality import (
    CONSISTENCY_CATEGORY, CONSISTENCY_INSTRUCTIONS, REVIEWABILITY_CATEGORY, REVIEWABILITY_INSTRUCTIONS,
    parse_consistency, parse_reviewability,
)

TEXT_CHECKS = {
    ADOPTION_CATEGORY: (ADOPTION_INSTRUCTIONS, parse_observation),
    CONSISTENCY_CATEGORY: (CONSISTENCY_INSTRUCTIONS, parse_consistency),
    REVIEWABILITY_CATEGORY: (REVIEWABILITY_INSTRUCTIONS, parse_reviewability),
}
