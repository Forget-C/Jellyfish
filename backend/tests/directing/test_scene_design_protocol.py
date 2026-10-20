"""回放 2026-10-20 的真实结构失败与空表演行输出；仅匿名化来源及资产身份。"""

from copy import deepcopy
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
import httpx

from app.core.contracts.directing.scene_version import EditableSceneDesign
from app.models.llm import Model, Provider
from app.services.directing.ai import DirectingOutputError, generate_directing_result
from app.task_worker import TaskWorker
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database
from tests.directing.samples import minimal_scoped_design_sample


@pytest.fixture
def captured_design():
    return json.loads((Path(__file__).parent / 'fixtures' / 'whole_design_invalid_applicability.json').read_text())


def generation_args(output):
    source = next(row for row in output['sources'] if row['kind'] == 'chapter')
    return {'scene_version_design': True, 'design_scope_version': 1, 'design_scope': None,
        'task_identity': 'captured-design-task', 'source': source,
        'previous_design': EditableSceneDesign(sources=[source]).model_dump(mode='json')}


def test_real_empty_performance_is_retained_as_incomplete_candidate():
    """15:00 的真实全空表演行保留给用户判断，不靠补对白或删行通过。"""
    output = json.loads((Path(__file__).parent / 'fixtures' / 'whole_design_empty_performance.json').read_text())
    args = {**generation_args(output), 'task_identity': 'captured-empty-task', 'design_candidate_version': 1}
    original = deepcopy(output)
    def invoke(messages):
        if len(messages) > 2:
            feedback = json.loads(messages[-1].content.split('\n', 1)[1])
            issue = feedback['design_issues'][0]
            assert issue['code'] == 'empty_row_scope'
            assert issue['has_design_text'] is False
            assert issue['existed_before'] is False
            assert issue['missing_scope_fields'] == ['delivery', 'exit_state', 'reaction_order']
            assert feedback['errors'][0]['loc'] == ['performance', 'beats', 0]
        return SimpleNamespace(content=json.dumps(output, ensure_ascii=False))
    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), args)
    assert result.attempt == 2
    assert [(issue.owner, issue.code) for issue in result.issues] == [
        ('performance:pb_zhangsan_establish', 'empty_row_scope')]
    assert result.design.performance.beats[0].id == 'pb_zhangsan_establish'
    assert result.design.performance.beats[0].delivery.text is None
    assert result.issues[0].missing_scope_fields == ['delivery', 'exit_state', 'reaction_order']
    assert output == original


@pytest.mark.parametrize('existing', [False, True])
def test_removing_empty_row_preserves_existing_none_reasons(existing):
    """模型可移除本次新增占位，但原设计 none 的理由也是应保留的内容。"""
    output = json.loads((Path(__file__).parent / 'fixtures' / 'whole_design_empty_performance.json').read_text())
    repaired = deepcopy(output)
    repaired['performance']['beats'] = [row for row in repaired['performance']['beats'] if row['id'] != 'pb_zhangsan_establish']
    repaired['applicability'] = [row for row in repaired['applicability'] if row['subject'].get('id') != 'pb_zhangsan_establish']
    args = {**generation_args(output), 'task_identity': 'captured-empty-task', 'design_candidate_version': 1}
    if existing:
        args['previous_design'] = output
    responses = iter([output, repaired])
    result = generate_directing_result('directing_design', SimpleNamespace(invoke=lambda _: SimpleNamespace(
        content=json.dumps(next(responses)))), args)
    assert result.attempt == (1 if existing else 2)
    assert any(row.id == 'pb_zhangsan_establish' for row in result.design.performance.beats) == existing
    assert bool(result.issues) == existing


@pytest.mark.parametrize('broken', ['invalid_reference', 'non_text', 'removes_content', 'none_replaces_content', 'request_failed'])
def test_failed_repair_keeps_previous_candidate_and_its_own_issues(captured_design, broken):
    """纠错引用损坏、返回非文本或删除正文时，不能丢掉前一合法候选。"""
    output = corrected_design(captured_design)
    output['applicability'] = [row for row in output['applicability']
        if row['subject']['field'] != 'physical_action']
    damaged = deepcopy(output)
    if broken == 'invalid_reference':
        damaged['direction']['shots'][0]['beat_ids'] = ['missing-beat']
    elif broken == 'removes_content':
        damaged['performance']['beats'][0]['physical_action'] = {}
    elif broken == 'none_replaces_content':
        damaged['performance']['beats'][0]['physical_action'] = {'state': 'none', 'reason': '无此动作'}
    responses = iter([json.dumps(output), [] if broken == 'non_text' else json.dumps(damaged)])
    def invoke(messages):
        if broken == 'request_failed' and len(messages) > 2:
            raise httpx.ReadTimeout('private provider address must not appear')
        return SimpleNamespace(content=next(responses))
    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke),
        {**generation_args(output), 'design_candidate_version': 1})
    assert result.attempt == 1
    assert result.design.performance.beats[0].physical_action.text == output['performance']['beats'][0]['physical_action']['text']
    assert [(issue.owner, issue.field) for issue in result.issues] == [('performance:pb_zhangsan_wait', 'physical_action')]
    assert result.diagnostics.issues
    assert 'private provider address' not in json.dumps(result.model_dump(mode='json'))


def test_whole_design_explains_phase_field_and_identity_rules_to_model(captured_design):
    """模型初次生成前即可知道普通设计阶段为空、合法字段及各行 ID 来源。"""
    def invoke(messages):
        protocol = json.loads(messages[1].content)['design_protocol']
        assert protocol['purposes']['design']['phases'] == [None]
        assert protocol['purposes']['background']['phases'] == [None]
        assert protocol['purposes']['constraint']['phases'] == ['video', 'sound', 'postproduction']
        subjects = protocol['subjects']
        assert subjects['beat']['path'] == ['direction', 'beats']
        assert 'must_show' in subjects['beat']['fields']
        assert 'must_show' not in subjects['direction']['fields']
        assert subjects['performance_beat']['path'] == ['performance', 'beats']
        assert 'physical_action' in subjects['performance_beat']['fields']
        assert subjects['camera']['path'] == ['cinematography']
        assert subjects['camera']['id_required'] is True
        assert subjects['immutable_fact']['fields'] == ['text']
        assert 'sources' not in subjects['sound']['constraint_fields']
        return SimpleNamespace(content=json.dumps(captured_design, ensure_ascii=False))

    original = deepcopy(captured_design)
    with pytest.raises(DirectingOutputError, match='普通设计不能声明规则阶段或条件'):
        generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), generation_args(captured_design))
    assert captured_design == original


def corrected_design(output):
    """固定的人工修正答案：保留原设计正文，摄影补 ID，已有归属继承，局部字段明确范围。"""
    result = deepcopy(output)
    result['cinematography'][0]['id'] = 'camera-establish'
    result['cinematography'][1]['id'] = 'camera-zhangsan'
    result['applicability'] = []

    def bind(kind, identity, fields, purpose, shots):
        for field in fields:
            result['applicability'].append({'subject': {'kind': kind, 'id': identity, 'field': field},
                'purpose': purpose, 'scope': 'shots', 'shot_ids': shots,
                'phase': 'video' if purpose == 'constraint' else None})

    shots = ['shot2_zhangsan_full']
    bind('performance_beat', 'pb_zhangsan_wait',
         ['objective', 'obstacle', 'subtext', 'attention', 'internal_adjustment'], 'background', shots)
    bind('performance_beat', 'pb_zhangsan_wait',
         ['physical_action', 'exit_state', 'gaze', 'breath', 'weight', 'hands'], 'design', shots)
    bind('performance_beat', 'pb_zhangsan_wait', ['avoid'], 'constraint', shots)
    bind('staging_activity', 'sa_zhangsan_stand', ['depth', 'intensity'], 'constraint', shots)
    bind('staging_activity', 'sa_zhangsan_stand', ['ongoing_task', 'end_state'], 'design', shots)
    bind('staging_activity', 'sa_zhangsan_stand', ['attention', 'narrative_support'], 'background', shots)
    bind('continuity', 'cs_weather', ['after', 'following_constraint'], 'constraint',
         ['shot1_establish', 'shot2_zhangsan_full'])
    for identity in ('cs_zhangsan_appearance', 'cs_baton_prop'):
        bind('continuity', identity, ['after', 'following_constraint'], 'constraint', shots)
    return result


def test_captured_output_retry_supplies_field_choices_and_actual_row_identities(captured_design):
    """一次纠错同时看到原始错误、各字段合法类别及本轮缺失的摄影身份。"""
    def invoke(messages):
        if len(messages) == 2:
            return SimpleNamespace(content=json.dumps(captured_design, ensure_ascii=False))
        feedback = json.loads(messages[-1].content.split('\n', 1)[1])
        assert feedback['errors'][0]['loc'] == ['applicability', 3]
        context = feedback['design_context']
        rows = {tuple(row['path']): row for row in context['applicability']}
        assert rows[('applicability', 3)]['field_kinds'] == ['beat']
        assert rows[('applicability', 3)]['allowed_phases'] == [None]
        assert rows[('applicability', 9)]['field_kinds'] == ['performance_beat']
        assert rows[('applicability', 14)]['allowed_purposes'] == ['design', 'background']
        assert 'scene_rule' not in rows[('applicability', 11)]['allowed_scopes']
        assert context['subjects']['camera']['missing_id_paths'] == [['cinematography', 0], ['cinematography', 1]]
        assert context['subjects']['performance_beat']['ids'] == ['pb_zhangsan_wait']
        assert context['subjects']['immutable_fact']['ids'][0] == 'if_night_storm'
        return SimpleNamespace(content=json.dumps(corrected_design(captured_design), ensure_ascii=False))

    result = generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), generation_args(captured_design))
    assert result.performance.beats[0].physical_action.text == captured_design['performance']['beats'][0]['physical_action']['text']
    assert [row.id for row in result.cinematography] == ['camera-establish', 'camera-zhangsan']


def test_phase_only_repair_still_rejects_invalid_subjects(captured_design):
    """清掉阶段不代表工作单正确；后续关联校验仍拒绝未修正的字段。"""
    partially_repaired = deepcopy(captured_design)
    for row in partially_repaired['applicability']:
        if row['purpose'] != 'constraint':
            row['phase'] = None
    responses = iter([captured_design, partially_repaired])
    llm = SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(next(responses), ensure_ascii=False)))
    with pytest.raises(DirectingOutputError, match='direction.immutable_facts') as caught:
        generate_directing_result('directing_design', llm, generation_args(captured_design))
    assert json.loads(caught.value.diagnostics.output) == partially_repaired


@pytest.mark.parametrize('output', [
    'not JSON', '[]', '{"direction": []}', '{"applicability": "invalid"}',
    '{"applicability": [null, {}, {"subject": {"kind": [], "field": []}, "purpose": []}]}',
    '{"cinematography": [null, {"id": []}], "applicability": []}',
])
def test_malformed_output_keeps_original_validation_diagnostics(captured_design, output):
    """纠错上下文读取不应因坏 JSON 或类型错误掩盖原始校验失败。"""
    def invoke(messages):
        if len(messages) > 2:
            assert json.loads(messages[-1].content.split('\n', 1)[1])['errors']
        return SimpleNamespace(content=output)

    with pytest.raises(DirectingOutputError) as caught:
        generate_directing_result('directing_design', SimpleNamespace(invoke=invoke), generation_args(captured_design))
    assert caught.value.diagnostics.output == output
    assert caught.value.diagnostics.issues


@pytest.mark.asyncio
async def test_captured_failure_remains_readable_and_cannot_be_applied(tmp_path, monkeypatch, captured_design):
    """真实 Worker 与 HTTP 历史入口保留失败正文，不发布为可应用建议。"""
    output = json.dumps(captured_design, ensure_ascii=False)
    monkeypatch.setattr('app.task_worker.ChatOpenAI',
        lambda **_: SimpleNamespace(invoke=lambda _: SimpleNamespace(content=output)))
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='captured-provider', name='openai', api_key='fixture', base_url='https://provider.invalid'))
            await db.flush()
            db.add(Model(id='captured-model', name='captured-test', category='text', provider_id='captured-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '真实失败回放'})).json()['data']
        detail = path + '/versions/' + version['id']
        response = await client.post(detail + '/design-suggestions', json={
            'request_id': str(uuid4()), 'expected_revision': version['revision'],
            'content': version['content'], 'model_id': 'captured-model'})
        assert response.status_code == 200, response.text
        task_id = response.json()['data']['task_id']
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*list(worker.jobs.values()))
        finally:
            worker.text_pool.shutdown(wait=True)
        records = (await client.get(detail + '/design-suggestions')).json()['data']
        result = next(row for row in records if row['task_id'] == task_id)
        assert result['status'] == 'failed'
        assert result['design'] is None
        assert result['diagnostics']['output'] == output
        assert len(result['diagnostics']['issues']) == 8
        assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview',
            json={'content': version['content']})).status_code == 422
        assert (await client.get(detail)).json()['data'] == version


@pytest.mark.asyncio
@pytest.mark.parametrize('failed_repair', [False, True])
async def test_incomplete_worker_candidate_can_be_previewed_and_saved_without_clearing_issues(tmp_path, monkeypatch, failed_repair):
    """真实 Worker 完成任务，HTTP 应用保留缺项；候选不能覆盖期间的人工编辑。"""
    def invoke(messages):
        args = json.loads(messages[1].content)
        output = deepcopy(args['previous_design'])
        activity = {name: {} for name in ('depth', 'ongoing_task', 'path', 'attention', 'reaction_delay',
            'intensity', 'entrances_exits', 'narrative_support', 'end_state')}
        activity.update(id='activity-unscoped', participant_id='brother', ongoing_task={
            'state': 'proposal', 'text': '在门口等待', 'sources': [
                {'kind': 'model', 'reference': args['task_identity'], 'version': '1'}]})
        output['staging']['activities'].append(activity)
        if failed_repair and len(messages) > 2:
            activity['participant_id'] = 'missing-participant'
        return SimpleNamespace(content=json.dumps(output))

    monkeypatch.setattr('app.task_worker.ChatOpenAI', lambda **_: SimpleNamespace(invoke=invoke))
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Provider(id='candidate-provider', name='openai', api_key='fixture', base_url='https://provider.invalid'))
            await db.flush()
            db.add(Model(id='candidate-model', name='test', category='text', provider_id='candidate-provider', params={}))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '待完善候选'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design'] = minimal_scoped_design_sample()
        version = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1,
            'content': content})).json()['data']
        submitted = await client.post(detail + '/design-suggestions', json={
            'request_id': str(uuid4()), 'expected_revision': version['revision'],
            'content': version['content'], 'model_id': 'candidate-model'})
        task_id = submitted.json()['data']['task_id']
        worker = TaskWorker(sessions)
        try:
            await worker.tick()
            await asyncio.gather(*list(worker.jobs.values()))
        finally:
            worker.text_pool.shutdown(wait=True)
        result = (await client.get(detail + '/design-suggestions')).json()['data'][0]
        assert result['status'] == 'succeeded'
        assert result['candidate_attempt'] == (1 if failed_repair else 2)
        assert [(issue['owner'], issue['field']) for issue in result['issues']] == [
            ('activity:activity-unscoped', 'ongoing_task')]
        assert bool(result['diagnostics']) == failed_repair
        task_detail = await client.get('/api/v1/studio/projects/p1/directing/tasks/' + task_id)
        assert task_detail.status_code == 200, task_detail.text
        assert task_detail.json()['data']['scene_design'] == result['design']
        assert (await client.get(detail)).json()['data'] == version
        changed = deepcopy(version['content'])
        changed['design']['direction']['viewpoint'] = {}
        assert (await client.post(detail + '/design-suggestions/' + task_id + '/preview',
            json={'content': changed})).status_code == 409
        preview = await client.post(detail + '/design-suggestions/' + task_id + '/preview',
            json={'content': version['content']})
        assert preview.status_code == 200, preview.text
        assert preview.json()['data']['issues'] == result['issues']
        applied = {**version['content'], 'design': preview.json()['data']['design']}
        saved = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': version['revision'], 'content': applied})
        assert saved.status_code == 200, saved.text
        graph = saved.json()['data']['relationship_graph']
        assert graph['complete'] is False
        assert graph['issues'][0]['owner'] == 'activity:activity-unscoped'
        prepared = saved.json()['data']['content']
        prepared['units'] = [{'id': 'unit', 'ratio': '16:9', 'coverage': [{
            'id': 'coverage', 'shot_id': prepared['design']['direction']['shots'][0]['id'],
            'action_scope': '拍摄原镜头'}]}]
        unrelated = await client.post(detail + '/units/unit/instruction-basis', json={'content': prepared})
        assert unrelated.status_code == 200, unrelated.text
        assert not any('activity-unscoped' in issue for issue in unrelated.json()['data']['current']['scope']['unresolved'])
        prepared['units'][0]['coverage'][0]['staging_activity_ids'] = ['activity-unscoped']
        affected = await client.post(detail + '/units/unit/instruction-basis', json={'content': prepared})
        assert affected.status_code == 422, affected.text
        assert '尚未声明适用范围' in affected.text
