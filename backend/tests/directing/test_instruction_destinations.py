"""检查去向必须对应固定视频要求、真实正文和实际绑定参考。"""
from copy import deepcopy

import pytest

from app.core.contracts.directing.unit_scope import UnitScopeProjection, UnitScopeUse
from app.core.contracts.directing.instruction_check import InstructionCheckResult
from app.core.contracts.directing.production import ReferenceBinding


def test_instruction_destinations_reject_missing_or_unbound_evidence():
    scope = UnitScopeProjection(execution=[UnitScopeUse(owner='coverage:c1', field='action_scope',
        text='递出信封', sources=[], reason='选中', coverage_item_ids=['c1'], phase='video')],
        constraints=[UnitScopeUse(owner='space', field='axis', text='保持左侧轴线', sources=[],
            reason='适用于本单元', coverage_item_ids=['c1'], phase='video')],
        background=[], unresolved=[])
    rows = [{'role': role, 'occurrence_id': 'c1', 'verdict': 'pass', 'rationale': '已核对', 'findings': []}
            for role in ('direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt')]
    action = {'owner': 'coverage:c1', 'field': 'action_scope', 'coverage_item_ids': ['c1'],
              'destination': 'instruction', 'instruction_excerpt': '递出信封', 'rationale': '正文'}
    axis = {'owner': 'space', 'field': 'axis', 'coverage_item_ids': ['c1'],
            'destination': 'instruction', 'instruction_excerpt': '保持左侧轴线', 'rationale': '正文'}

    def validate(destinations, *, instruction='递出信封，保持左侧轴线。', references=()):
        return InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
            'destinations': destinations}).validate_scope('u1', ['c1'], scope=scope,
                instruction=instruction, references=references, require_destinations=True)

    assert validate([action, axis]).destinations[0].owner == 'coverage:c1'
    assert InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows}).validate_scope(
        'u1', ['c1'], scope=scope).destinations is None
    with pytest.raises(ValueError, match='缺少视频要求'):
        validate(None)
    with pytest.raises(ValueError, match='遗漏'):
        validate([action])
    with pytest.raises(ValueError, match='正文去向'):
        validate([action, axis], instruction='保持左侧轴线。')
    reference_axis = {**axis, 'destination': 'reference', 'instruction_excerpt': None,
                      'reference_id': 'frame-1'}
    with pytest.raises(ValueError, match='实际绑定'):
        validate([action, reference_axis])
    binding = ReferenceBinding.model_validate({'id': 'frame-1', 'file_id': 'file-1',
        'media_kind': 'image', 'purpose': 'space', 'participant_ids': [], 'ordinal': 0,
        'source': {'kind': 'file', 'reference': 'file-1', 'version': '1', 'file_id': 'file-1'}})
    assert validate([action, reference_axis], instruction='递出信封。', references=[binding])
    action_reference = {**deepcopy(action), 'destination': 'reference', 'instruction_excerpt': None,
                        'reference_id': 'frame-1'}
    with pytest.raises(ValueError, match='动作须由正文'):
        validate([action_reference, reference_axis], references=[binding])
    prompt = UnitScopeUse(owner='prompt', field='prohibitions', text='不得出现文字',
                          sources=[], reason='全场', coverage_item_ids=['c1'], phase='video')
    prompt_scope = scope.model_copy(update={'constraints': [*scope.constraints, prompt]})
    claimed_reference = {**reference_axis, 'owner': 'prompt', 'field': 'prohibitions'}
    with pytest.raises(ValueError, match='用途匹配'):
        InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
            'destinations': [action, axis, claimed_reference]}).validate_scope(
                'u1', ['c1'], scope=prompt_scope, instruction='递出信封，保持左侧轴线。',
                references=[binding], require_destinations=True)
    identity = UnitScopeUse(owner='participant:reader', field='identity', text='读信者',
                            sources=[], reason='当前镜头参与对象', coverage_item_ids=['c1'], phase='video')
    identity_scope = scope.model_copy(update={'constraints': [*scope.constraints, identity]})
    identity_binding = ReferenceBinding.model_validate({**binding.model_dump(mode='json'),
        'id': 'portrait', 'purpose': 'identity', 'participant_ids': ['reader']})
    identity_destination = {'owner': 'participant:reader', 'field': 'identity',
        'coverage_item_ids': ['c1'], 'destination': 'reference', 'reference_id': 'portrait',
        'rationale': '实际绑定的人物参考'}
    assert InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
        'destinations': [action, axis, identity_destination]}).validate_scope(
            'u1', ['c1'], scope=identity_scope, instruction='递出信封，保持左侧轴线。',
            references=[identity_binding], require_destinations=True)
    with pytest.raises(ValueError, match='用途匹配'):
        InstructionCheckResult.model_validate({'unit_id': 'u1', 'rows': rows,
            'destinations': [action, axis, identity_destination]}).validate_scope(
                'u1', ['c1'], scope=identity_scope, instruction='递出信封，保持左侧轴线。',
                references=[binding], require_destinations=True)
