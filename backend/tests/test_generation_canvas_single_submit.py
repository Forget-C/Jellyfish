"""Single model admission through the public canvas HTTP interface."""
import pytest
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('kind,card_ids', [('target', []), ('selection', ['m']), ('single', ['m', 'other'])])
async def test_only_explicit_single_model_scope_can_be_prechecked(runtime, kind, card_ids):
    response = await runtime.client.post(runtime.url + '/precheck', json={
        'card_id': 'm', 'kind': kind, 'card_ids': card_ids})
    assert response.status_code == 422
    assert 'SINGLE_MODEL_ONLY' in response.text
