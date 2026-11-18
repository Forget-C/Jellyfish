"""场次方案 AI 建议的真实 HTTP、事务和任务生命周期边界。"""
import json
from types import SimpleNamespace
from copy import deepcopy

import pytest

from app.services.directing.ai import DirectingOutputError, generate_directing_result


@pytest.mark.parametrize('source', [
    {'kind': 'human', 'reference': 'author', 'version': '1'},
    {'kind': 'model', 'reference': 'old-task', 'version': '1'},
    {'kind': 'model', 'reference': 'current-task', 'version': '2'},
])
@pytest.mark.parametrize('scope', [None, ['/direction/information_change']])
def test_generation_retries_invalid_task_sources_before_returning_success(source, scope):
    """结构合法的错误来源必须在完成前纠错；保留原人工内容不应触发误判。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign

    original = EditableSceneDesign(sources=[{'kind': 'chapter', 'reference': 'chapter', 'version': '1'}]).model_dump(mode='json')
    original['direction']['viewpoint'] = {'state': 'proposal', 'text': '保留人工视点',
        'sources': [{'kind': 'human', 'reference': 'author', 'version': '1'}]}
    invalid = deepcopy(original)
    invalid['direction']['information_change'] = {'state': 'proposal', 'text': '读信后产生迟疑', 'sources': [source]}
    corrected = deepcopy(invalid)
    corrected['direction']['information_change']['sources'] = [{'kind': 'model', 'reference': 'current-task', 'version': '1'}]
    args = {'scene_version_design': True, 'task_identity': 'current-task', 'previous_design': original,
        'design_scope': scope}
    messages_seen = []

    def invoke(messages):
        messages_seen.append(list(messages))
        return SimpleNamespace(content=json.dumps(invalid if len(messages_seen) == 1 else corrected))

    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)
    assert len(messages_seen) == 2
    assert result.direction.information_change.sources[0].reference == 'current-task'
    assert result.direction.viewpoint == EditableSceneDesign.model_validate(original).direction.viewpoint
    assert '来源' in messages_seen[1][-1].content
    with pytest.raises(DirectingOutputError, match='来源'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), args)


@pytest.mark.parametrize('scope', [None, ['/direction/information_change']])
def test_generation_records_task_provenance_for_chapter_facts(scope):
    """真实模型会只给原文事实标章节来源，生成服务应补记实际执行来源。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign
    from app.services.directing.scene_design_sources import validate_model_sources

    source = {'kind': 'chapter', 'reference': 'chapter', 'version': '1'}
    original = EditableSceneDesign(sources=[source]).model_dump(mode='json')
    original['direction']['viewpoint'] = {'state': 'fact', 'text': '保留已有事实', 'sources': [source]}
    output = deepcopy(original)
    output['direction']['information_change'] = {'state': 'fact', 'text': '读信后产生迟疑', 'sources': [source]}
    calls = []
    def invoke(messages):
        calls.append(messages)
        return SimpleNamespace(content=json.dumps(output))
    args = {'scene_version_design': True, 'task_identity': 'current-task', 'previous_design': original,
        'design_scope': scope, 'source': source}
    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)
    assert len(calls) == 1
    note = result.direction.information_change
    assert [(item.kind, item.reference) for item in note.sources] == [('chapter', 'chapter'), ('model', 'current-task')]
    assert result.direction.viewpoint == EditableSceneDesign.model_validate(original).direction.viewpoint
    validate_model_sources(EditableSceneDesign.model_validate(original), result, 'current-task')
    assert output['direction']['information_change']['sources'] == [source]
    args['source'] = {**source, 'version': 'other-version'}
    with pytest.raises(DirectingOutputError, match='来源'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)


def test_generation_retries_invalid_occurrence_scope_against_frozen_version():
    """设计结构本身合法但引用了不存在的单元时，在 Worker 完成前纠错一次。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign, SceneVersionContent

    source = {'kind': 'chapter', 'reference': 'chapter', 'version': '1'}
    original = EditableSceneDesign(sources=[source]).model_dump(mode='json')
    frozen = SceneVersionContent.model_validate({'basis': {'source': source, 'text': '读信'},
                                                  'design': original}).model_dump(mode='json')
    invalid = deepcopy(original)
    invalid['applicability'] = [{'subject': {'kind': 'direction', 'field': 'axis'},
        'purpose': 'constraint', 'scope': 'occurrences', 'phase': 'video',
        'occurrences': [{'unit_id': 'missing-unit', 'coverage_item_id': 'missing-cover'}]}]
    corrected = deepcopy(invalid)
    corrected['applicability'][0].update(scope='scene_rule', occurrences=[])
    args = {'scene_version_design': True, 'task_identity': 'current-task',
            'previous_design': original, 'scene_version_content': frozen}
    calls = []

    def invoke(messages):
        calls.append(messages)
        return SimpleNamespace(content=json.dumps(invalid if len(calls) == 1 else corrected))

    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)
    assert len(calls) == 2
    assert result.applicability[0].scope == 'scene_rule'
    assert '不存在的单元出现项' in calls[1][-1].content
    with pytest.raises(DirectingOutputError, match='不存在的单元出现项'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), args)


def test_generation_retries_foreign_asset_before_finishing_task():
    """模型凭空编造的项目资产 ID 经过一次纠错，仍错则任务失败。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign

    original = EditableSceneDesign(sources=[{'kind': 'chapter', 'reference': 'chapter', 'version': '1'}]).model_dump(mode='json')
    invalid = deepcopy(original)
    invalid['participants'] = [{'id': 'person1', 'name': '读信者', 'character_id': 'foreign-character'}]
    corrected = deepcopy(invalid)
    corrected['participants'][0]['character_id'] = None
    args = {'scene_version_design': True, 'task_identity': 'current-task',
            'previous_design': original, 'existing_assets': []}
    calls = []

    def invoke(messages):
        calls.append(messages)
        return SimpleNamespace(content=json.dumps(invalid if len(calls) == 1 else corrected))

    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)
    assert len(calls) == 2
    assert result.participants[0].character_id is None
    assert '不存在的角色资产' in calls[1][-1].content
    with pytest.raises(DirectingOutputError, match='不存在的角色资产'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), args)


def test_ai_preserves_unchanged_stale_defaults_but_cannot_move_them_to_new_objects():
    """已有失效偏好可原样保留；不能当成新资产授权复制到另一身份。"""
    from app.core.contracts.directing.scene_version import EditableSceneDesign

    original = EditableSceneDesign(sources=[{'kind': 'chapter', 'reference': 'chapter', 'version': '1'}]).model_dump(mode='json')
    original['participants'] = [{'id': 'person', 'name': '人物', 'character_id': 'stale'}]
    original['direction']['location_asset_id'] = 'stale-place'
    args = {'scene_version_design': True, 'task_identity': 'current-task',
            'previous_design': original, 'existing_assets': []}
    llm = SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(original)))
    result = generate_directing_result('directing_design', llm, args)
    assert result.participants[0].character_id == 'stale'
    assert result.direction.location_asset_id == 'stale-place'
    invalid = deepcopy(original)
    invalid['participants'].append({'id': 'new-person', 'name': '新人物', 'character_id': 'stale'})
    with pytest.raises(DirectingOutputError, match='不存在的角色资产'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), args)
