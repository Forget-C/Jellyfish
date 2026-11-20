"""Precheck diagnostics and optional model metadata through HTTP."""
import pytest
from app.models.llm import Provider
from tests.test_generation_canvas_runs import runtime  # noqa: F401


@pytest.mark.asyncio
@pytest.mark.parametrize('unavailable', [False, True])
async def test_precheck_keeps_model_metadata_and_diagnostic_order_on_incomplete_configuration(runtime, unavailable):
    runtime.document['cards'][0]['prompt']['segments'] = []
    if unavailable:
        async with runtime.sessions.begin() as db:
            provider = await db.get(Provider, runtime.provider_id)
            provider.status = 'disabled'
    else:
        runtime.document['cards'][0]['model_id'] = None
    response = await runtime.client.put(runtime.url, json={'request_id': 'incomplete', 'expected_revision': 1, 'document': runtime.document})
    assert response.status_code == 200, response.text
    preview = (await runtime.client.post(runtime.url + '/precheck', json={'card_id': 'm'})).json()['data']
    assert not preview['can_run'] and preview['preview_token'] is None
    assert preview['model'] == ({'id': runtime.model_id, 'name': 'frozen-model',
        'params': {'temperature': .3, 'default_headers': {}}} if unavailable else {})
    assert preview['diagnostics'] == [
        {'code': 'MODEL_UNAVAILABLE' if unavailable else 'MODEL_REQUIRED', 'severity': 'error',
         'message': '所选模型或供应商不可用' if unavailable else '请选择模型',
         'target': {'card_id': 'm', 'path': ['model_id']}, 'blocks': ['run']},
        {'code': 'TEXT_REQUIRED', 'severity': 'error', 'message': '请提供非空文本输入',
         'target': {'card_id': 'm', 'path': ['prompt']}, 'blocks': ['run']},
    ]
