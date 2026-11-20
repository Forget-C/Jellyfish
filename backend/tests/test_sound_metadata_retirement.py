"""Retired sound metadata is removed only from editable data, never execution evidence."""
import pytest
from app.schemas.generation_canvas import DialogueCard, SoundArrangementCard


@pytest.mark.parametrize('model,fields', [(DialogueCard, {'dialogue_id': 'line', 'version': 3}), (SoundArrangementCard, {'production': 'postproduction'})])
def test_current_contract_rejects_retired_sound_fields(model, fields):
    """New edits cannot silently restore retired semantics."""
    with pytest.raises(ValueError):
        model(id='card', **fields)
