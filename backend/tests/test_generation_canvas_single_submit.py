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


@pytest.mark.asyncio
async def test_prompt_source_requires_explicit_input_binding(runtime):
    from copy import deepcopy
    document = deepcopy(runtime.document)
    document['cards'].insert(0, {'id': 'source', 'type': 'content.text', 'text': '直接上游'})
    document['cards'][1]['prompt']['segments'] = [
        {'id': 'ref', 'kind': 'reference', 'source': {
            'canvas_id': runtime.canvas_id, 'card_id': 'source', 'port_id': 'text', 'position': 0}},
    ]
    document['edges'] = [
        {'id': 'edge', 'source_card': 'source', 'source_port': 'text', 'target_card': 'm', 'target_port': 'text'},
    ]
    document['input_order'] = {'m': {'text': ['edge']}}
    response = await runtime.client.put(runtime.url, json={
        'request_id': 'source-only', 'expected_revision': 1, 'document': document,
    })
    assert response.status_code == 422, response.text
    assert response.json()['detail']['code'] == 'INVALID_DOCUMENT'
