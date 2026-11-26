"""正式入口只保留场次生产；旧镜头旁路不能重新提交或修改采用。"""
import pytest
from pydantic import ValidationError
from app.core.contracts.generation import GenerationTarget
from app.main import app
from app.services.task_service import TASK_KINDS


@pytest.mark.parametrize('path', [
    '/api/v1/studio/shots', '/api/v1/studio/shot-details',
    '/api/v1/studio/shot-dialog-lines', '/api/v1/studio/shot-frame-images',
    '/api/v1/studio/shot-character-links', '/api/v1/studio/shot-links/actor',
    '/api/v1/script-processing/merge-entities', '/api/v1/script-processing/analyze-variants',
    '/api/v1/studio/generation-tasks/shots/old/video',
    '/api/v1/studio/generation-tasks/shots/old/frames/first',
    '/api/v1/studio/generation-prompts/shots/old/video/render',
    '/api/v1/studio/generation-prompts/shots/old/frames/first/render',
    '/api/v1/script-processing/divide', '/api/v1/script-processing/divide-async',
    '/api/v1/script-processing/extract', '/api/v1/script-processing/extract-async',
])
def test_retired_routes_cannot_mutate(client, path):
    """真实路由匹配拒绝旧地址，测试不会连接数据库或模型。"""
    assert client.post(path, json={}).status_code == 404


@pytest.mark.parametrize('kind', ['shot_video', 'shot_frame_slot', 'shot_detail'])
def test_retired_targets_rejected(kind):
    """移除提交目标，避免未来 Binder 意外恢复镜头旁路。"""
    with pytest.raises(ValidationError):
        GenerationTarget(kind=kind, entity_id='old')


def test_public_contract_and_task_registry_keep_new_flow():
    """新场次、资产和实验室接口仍在，旧拆镜任务不可再创建。"""
    paths = app.openapi()['paths']
    assert not any('/shots' in path or '/shot-details' in path for path in paths)
    assert any('/directing/' in path or '/sequences/' in path for path in paths)
    assert 'post' in paths['/api/v1/studio/chat/sessions/{session_id}/turns']
    assert not any('/generation-tasks/labs/' in path for path in paths)
    assert any('/generation-prompts/assets/' in path for path in paths)
    assert not {'script_divide', 'script_extract', 'script_merge', 'script_variant'} & TASK_KINDS


@pytest.mark.parametrize('operation', ['divide', 'extract', 'merge-entities', 'analyze-variants'])
def test_retired_text_operations_rejected(operation):
    """通用文本提交契约不能重新打开旧分镜流程。"""
    from app.core.contracts.text_generation import ScriptOperationInput
    with pytest.raises(ValidationError):
        ScriptOperationInput(operation=operation, source_text='旧流程')
