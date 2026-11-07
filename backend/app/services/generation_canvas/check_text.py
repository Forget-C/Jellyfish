"""Dispatch frozen text checks by their explicit business category."""
from app.services.generation_canvas.check_adoption import ADOPTION_CATEGORY, ADOPTION_INSTRUCTIONS, parse_observation
from app.services.generation_canvas.check_requirement_quality import (
    CONSISTENCY_CATEGORY, CONSISTENCY_INSTRUCTIONS, REVIEWABILITY_CATEGORY, REVIEWABILITY_INSTRUCTIONS,
    parse_consistency, parse_reviewability,
)

from app.services.generation_canvas.check_sound_capability import (
    SOUND_CAPABILITY_CATEGORY, SOUND_CAPABILITY_INSTRUCTIONS, parse_sound_capability,
)

TEXT_CHECKS = {
    ADOPTION_CATEGORY: (ADOPTION_INSTRUCTIONS, parse_observation),
    CONSISTENCY_CATEGORY: (CONSISTENCY_INSTRUCTIONS, parse_consistency),
    REVIEWABILITY_CATEGORY: (REVIEWABILITY_INSTRUCTIONS, parse_reviewability),
    SOUND_CAPABILITY_CATEGORY: (SOUND_CAPABILITY_INSTRUCTIONS, parse_sound_capability),
}
