"""可编辑场次版本的 HTTP 行为；真实事务，不调用外部模型。"""

from uuid import uuid4
from copy import deepcopy

import pytest

from app.models.studio import Chapter, FileUsage
from app.models.directing import Sequence
from tests.directing.test_api import client_for
from tests.directing.test_store import database


async def sequence_path(client):
    """通过已有原文入口建立场次，不创建方案或历史执行。"""
    base = '/api/v1/studio/projects/p1/directing'
    chapter = (await client.get(base + '/chapters/ch1')).json()['data']
    response = await client.post(base + '/chapters/ch1/sequences', json={
        'title': '店内', 'position': 0, 'source_version': chapter['source_version'],
        'span': {'start': 0, 'end': 4},
    })
    assert response.status_code == 200
    return base + '/sequences/' + response.json()['data']['id']


@pytest.mark.asyncio
async def test_manual_shot_can_save_before_beat_assignment_but_cannot_leave_dangling_links(tmp_path):
    """人工起稿可先写镜头；解除关联后才可删除节拍，不能靠保存生成假节拍。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '人工起稿',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{
            'id': 'manual-shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': None, 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {},
        }]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = (await client.get(detail)).json()['data']
        assert saved['content']['design']['direction']['beats'] == []
        assert saved['content']['design']['direction']['shots'][0]['beat_ids'] == []
        content['design']['direction']['beats'] = [{
            'id': 'beat', 'event_ids': ['event'], 'objective': {}, 'obstacle': {},
            'expected_change': {}, 'must_show': {},
        }]
        content['design']['events'] = [{'id': 'event', 'description': {}}]
        content['design']['direction']['shots'][0]['beat_ids'] = ['beat']
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert response.status_code == 200, response.text
        graph = response.json()['data']['relationship_graph']
        assert graph['revision'] == 3
        assert {'owner': 'shot:manual-shot', 'field': 'beat_ids',
                'target': 'beat:beat', 'target_id': 'beat'} in graph['edges']
        assert not any(edge['target'] == 'missing:beat' for edge in graph['edges'])
        assert any(path['source'] == 'shot:manual-shot' and path['target'] == 'event:event'
                   and [(step['owner'], step['field']) for step in path['steps']] == [
                       ('shot:manual-shot', 'beat_ids'), ('beat:beat', 'event_ids')]
                   for path in graph['paths'])
        content['design']['direction']['beats'] = []
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': content})
        assert response.status_code == 422
        assert (await client.get(detail)).json()['data']['revision'] == 3
        content['design']['direction']['shots'][0]['beat_ids'] = []
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': content})
        assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_design_row_ids_survive_edit_reorder_and_reject_duplicates(tmp_path):
    """独立表演与镜内活动经版本接口回读仍保留身份；重复身份不部分写入。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '稳定设计行',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['participants'] = [{'id': 'person1', 'name': '妹妹'},
                                             {'id': 'person2', 'name': '哥哥'}]
        unidentified = deepcopy(content)
        unidentified['design']['staging']['activities'] = [{
            'participant_id': 'person1', 'depth': {}, 'ongoing_task': {},
            'path': {}, 'attention': {}, 'reaction_delay': {}, 'intensity': {},
            'entrances_exits': {}, 'narrative_support': {}, 'end_state': {},
        }]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': unidentified})
        assert response.status_code == 422
        assert (await client.get(detail)).json()['data']['revision'] == 1
        content['design']['direction']['beats'] = [{
            'id': beat_id, 'event_ids': [], 'objective': {}, 'obstacle': {},
            'expected_change': {}, 'must_show': {},
        } for beat_id in ('beat1', 'beat2')]
        action = {'beat_id': 'beat1', 'participant_id': 'person1', 'received_event_ids': [],
                  'objective': {}, 'obstacle': {}, 'subtext': {}, 'attention': {},
                  'internal_adjustment': {}, 'physical_action': {}, 'dialogue_ids': [],
                  'delivery': {}, 'reaction_order': {}, 'exit_state': {}, 'avoid': {},
                  'criterion_ids': []}
        activity = {'participant_id': 'person1', 'depth': {}, 'ongoing_task': {},
                    'path': {}, 'attention': {}, 'reaction_delay': {}, 'intensity': {},
                    'entrances_exits': {}, 'narrative_support': {}, 'end_state': {}}
        content['design']['performance']['beats'] = [dict(action, id='action-a'),
                                                     dict(action, id='action-b', beat_id='beat2')]
        content['design']['staging']['activities'] = [dict(activity, id='activity-a'),
                                                     dict(activity, id='activity-b')]
        content['design']['direction']['immutable_facts'] = [
            {'id': 'rule-1', 'state': 'proposal', 'text': '门保持关闭',
             'sources': [{'kind': 'human', 'reference': 'local-user', 'version': 'manual-1'}]},
        ]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = response.json()['data']['content']
        saved['design']['performance']['beats'].reverse()
        saved['design']['staging']['activities'].reverse()
        saved['design']['performance']['beats'][0]['participant_id'] = 'person2'
        saved['design']['staging']['activities'][0]['ongoing_task'] = {
            'state': 'proposal', 'text': '守住门口',
            'sources': [{'kind': 'human', 'reference': 'local-user', 'version': 'manual-1'}],
        }
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': saved})
        assert response.status_code == 200, response.text
        reread = (await client.get(detail)).json()['data']
        assert [row['id'] for row in reread['content']['design']['performance']['beats']] == ['action-b', 'action-a']
        assert reread['content']['design']['performance']['beats'][0]['participant_id'] == 'person2'
        assert [row['id'] for row in reread['content']['design']['staging']['activities']] == ['activity-b', 'activity-a']
        assert reread['content']['design']['staging']['activities'][0]['ongoing_task']['text'] == '守住门口'
        assert reread['content']['design']['direction']['immutable_facts'][0]['id'] == 'rule-1'
        duplicate = deepcopy(reread['content'])
        duplicate['design']['staging']['activities'][1]['id'] = 'activity-b'
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': duplicate})
        assert response.status_code == 422
        assert (await client.get(detail)).json()['data']['revision'] == 3
        duplicate = deepcopy(reread['content'])
        duplicate['design']['direction']['immutable_facts'] = [
            {'id': 'rule-1'}, {'id': 'rule-1'},
        ]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': duplicate})
        assert response.status_code == 422
        duplicate['design']['direction']['immutable_facts'][1]['id'] = 'invalid rule'
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': duplicate})
        assert response.status_code == 422
        assert (await client.get(detail)).json()['data']['revision'] == 3


@pytest.mark.asyncio
async def test_design_applicability_saves_explicit_scope_and_rejects_invalid_targets(tmp_path):
    """适用性与真实字段引用同版保存；非法目标及冲突范围不部分写入。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '关联范围',
        })).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['participants'] = [{'id': 'person1', 'name': '妹妹'}]
        content['design']['direction']['beats'] = [{
            'id': 'beat1', 'event_ids': [], 'objective': {}, 'obstacle': {},
            'expected_change': {}, 'must_show': {},
        }]
        content['design']['direction']['shots'] = [{
            'id': 'shot1', 'beat_ids': ['beat1'], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': ['person1'], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {},
        }, {
            'id': 'shot2', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [],
            'participant_ids': [], 'criterion_ids': [],
            'narrative_function': {}, 'visible_result': {},
        }]
        content['design']['staging']['activities'] = [{
            'id': 'activity1', 'participant_id': 'person1', 'depth': {}, 'ongoing_task': {},
            'path': {}, 'attention': {}, 'reaction_delay': {}, 'intensity': {},
            'entrances_exits': {}, 'narrative_support': {}, 'end_state': {},
        }]
        content['design']['direction']['immutable_facts'] = [{
            'id': 'rule1', 'state': 'proposal', 'text': '角色出现时服装保持一致',
            'sources': [{'kind': 'human', 'reference': 'local-user', 'version': 'manual-1'}],
        }]
        content['units'] = [{
            'id': 'unit1', 'ratio': '16:9',
            'coverage': [{'id': 'cover1', 'shot_id': 'shot1', 'beat_ids': ['beat1'],
                          'event_ids': [], 'action_scope': '人物动作'}],
        }]
        content['design']['applicability'] = [
            {'subject': {'kind': 'staging_activity', 'id': 'activity1', 'field': 'ongoing_task'},
             'purpose': 'design', 'scope': 'shots', 'shot_ids': ['shot1']},
            {'subject': {'kind': 'immutable_fact', 'id': 'rule1', 'field': 'text'},
             'purpose': 'constraint', 'scope': 'scene_rule', 'phase': 'video',
             'condition': '角色出现时'},
            {'subject': {'kind': 'direction', 'field': 'axis'}, 'purpose': 'constraint',
             'scope': 'occurrences', 'phase': 'video',
             'occurrences': [{'unit_id': 'unit1', 'coverage_item_id': 'cover1'}]},
        ]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = (await client.get(detail)).json()['data']
        assert saved['content']['design']['applicability'] == response.json()['data']['content']['design']['applicability']
        assert saved['content']['design']['staging']['activities'][0]['participant_id'] == 'person1'
        for mutate in (
            lambda body: body['design']['applicability'][0].update(shot_ids=['foreign-shot']),
            lambda body: body['design']['applicability'][0]['subject'].update(id='foreign-activity'),
            lambda body: body['design']['applicability'][1].update(shot_ids=['shot1']),
            lambda body: body['design']['applicability'][1].update(phase=None),
            lambda body: body['design']['applicability'][2]['occurrences'][0].update(coverage_item_id='foreign-cover'),
            lambda body: body['design']['applicability'].append(deepcopy(body['design']['applicability'][0])),
            lambda body: body['design']['applicability'].append({
                'subject': {'kind': 'beat', 'id': 'beat1', 'field': 'must_show'},
                'purpose': 'design', 'scope': 'shots', 'shot_ids': ['shot2']}),
            lambda body: body['design']['staging'].update(activities=[]),
        ):
            invalid = deepcopy(saved['content'])
            mutate(invalid)
            response = await client.put(detail, json={
                'request_id': str(uuid4()), 'expected_revision': 2, 'content': invalid})
            assert response.status_code == 422, response.text
        assert (await client.get(detail)).json()['data'] == saved
        rebound = deepcopy(saved['content'])
        rebound['design']['applicability'][0]['shot_ids'] = ['shot2']
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': rebound})
        assert response.status_code == 200, response.text
        assert (await client.get(detail)).json()['data']['content']['design']['applicability'][0]['shot_ids'] == ['shot2']
        rebound['design']['applicability'] = rebound['design']['applicability'][1:]
        response = await client.put(detail, json={
            'request_id': str(uuid4()), 'expected_revision': 3, 'content': rebound})
        assert response.status_code == 200, response.text
        assert len((await client.get(detail)).json()['data']['content']['design']['applicability']) == 2


@pytest.mark.asyncio
async def test_scene_versions_choose_source_independently_and_can_undo_basis_change(tmp_path):
    """更新 B 的明确原文不改 A；原依据可随会话撤销恢复，旧字段来源不被伪造重绑。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        a = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'A'})).json()['data']
        b = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'B'})).json()['data']
        async with sessions.begin() as db:
            (await db.get(Chapter, 'ch1')).raw_text = '妹妹在店外等候。'
        chapter = (await client.get('/api/v1/studio/projects/p1/directing/chapters/ch1')).json()['data']
        content = deepcopy(b['content'])
        content['basis'] = {'source': {'kind': 'chapter', 'reference': 'ch1', 'version': chapter['source_version']},
                            'start': 0, 'end': 4, 'text': '妹妹在店'}
        response = await client.put(path + '/versions/' + b['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        changed = response.json()['data']
        assert changed['source']['text'] == '妹妹在店'
        assert changed['content']['design']['sources'] == b['content']['design']['sources']
        assert (await client.get(path + '/versions/' + a['id'])).json()['data']['source']['text'] == '兄弟在店'
        undo = await client.put(path + '/versions/' + b['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 2, 'content': b['content']})
        assert undo.status_code == 200, undo.text
        assert undo.json()['data']['source']['text'] == '兄弟在店'


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['foreign_chapter', 'invented_text', 'outside_range', 'unknown_revision'])
async def test_scene_source_rejects_unverified_excerpt_without_changing_version(tmp_path, change):
    """选择原文仍须核实章节、修订和真实范围，不能用任意 JSON 伪造依据。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'A'})).json()['data']
        content = deepcopy(version['content'])
        basis = content['basis']
        if change == 'foreign_chapter':
            basis['source']['reference'] = 'ch2'
        elif change == 'invented_text':
            basis['text'] = '从未写过'
        elif change == 'outside_range':
            basis.update(start=100, end=104)
        else:
            basis['source']['version'] = 'unverified'
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == (409 if change == 'unknown_revision' else 422)
        assert (await client.get(path + '/versions/' + version['id'])).json()['data'] == version


@pytest.mark.asyncio
async def test_historical_sequence_scene_versions_remain_read_only(tmp_path):
    """退出当前划分的身份保留可读内容，不允许保存或创建方案。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'A'})).json()['data']
        async with sessions.begin() as db:
            (await db.get(Sequence, version['sequence_id'])).is_current = False
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': version['content']})
        assert response.status_code == 409
        assert (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'B'})).status_code == 409
        assert (await client.get(path + '/versions/' + version['id'])).json()['data'] == version


@pytest.mark.asyncio
async def test_redivision_preserves_explicit_version_basis_and_new_identity_starts_empty(tmp_path):
    """保留身份只改划分；同名新身份不复制方案，退出身份只读。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'A'})).json()['data']
        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(chapter_path)).json()['data']
        sequence = chapter['sequences'][0]
        draft = {'source_version': chapter['source_version'],
                 'baseline': [{'sequence_id': sequence['id'], 'version': sequence['version']}],
                 'members': [{'key': 'retained', 'sequence_id': sequence['id'], 'title': sequence['title'], 'span': {'start': 0, 'end': 5}}],
                 'exited_sequence_ids': [], 'lineage': [{'sequence_id': sequence['id'], 'target_keys': ['retained']}]}
        preview = (await client.post(chapter_path + '/division/preview', json=draft)).json()['data']
        result = await client.put(chapter_path + '/division', json={'request_id': str(uuid4()), 'draft': draft,
            'preview_token': preview['preview_token'], 'identity_changes_confirmed': True})
        assert result.status_code == 200, result.text
        retained = result.json()['data']['chapter']['sequences'][0]
        assert retained['source_text'] == '兄弟在店中'
        assert (await client.get(path + '/versions/' + version['id'])).json()['data']['source']['text'] == '兄弟在店'
        draft['baseline'][0]['version'] = retained['version']
        draft['members'][0].update(key='new', sequence_id=None)
        draft['exited_sequence_ids'] = [sequence['id']]
        draft['lineage'][0]['target_keys'] = ['new']
        preview = (await client.post(chapter_path + '/division/preview', json=draft)).json()['data']
        result = await client.put(chapter_path + '/division', json={'request_id': str(uuid4()), 'draft': draft,
            'preview_token': preview['preview_token'], 'identity_changes_confirmed': True})
        assert result.status_code == 200, result.text
        replacement = result.json()['data']['chapter']['sequences'][0]
        assert replacement['id'] != sequence['id']
        new_path = path.rsplit('/', 1)[0] + '/' + replacement['id']
        assert (await client.get(new_path + '/versions')).json()['data'] == []
        assert (await client.get(path + '/versions/' + version['id'])).json()['data'] == version
        assert (await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': 1, 'content': version['content']})).status_code == 409


@pytest.mark.asyncio
async def test_explicit_scene_version_can_save_incomplete_design_and_reload(tmp_path):
    """浏览不创建，空方案可保存人工内容，回读保持同一版本身份。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        listing = await client.get(path + '/versions')
        assert listing.status_code == 200
        assert listing.json()['data'] == []

        response = await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '初稿',
        })
        assert response.status_code == 200, response.text
        created = response.json()['data']
        assert created['relationship_graph']['version_id'] == created['id']
        assert created['relationship_graph']['revision'] == created['revision']
        assert created['source']['text'] == '兄弟在店'
        assert created['content']['design']['direction']['shots'] == []
        content = created['content']
        content['design']['direction']['viewpoint'] = {
            'state': 'proposal', 'text': '从弟弟的视点展开',
            'sources': [{'kind': 'human', 'reference': 'local-user', 'version': '1'}],
        }
        saved = await client.put(path + '/versions/' + created['id'], json={
            'expected_revision': created['revision'], 'request_id': str(uuid4()),
            'content': content,
        })
        assert saved.status_code == 200, saved.text
        fresh = (await client.get(path + '/versions/' + created['id'])).json()['data']
        assert fresh['id'] == created['id']
        assert fresh['revision'] == 2
        assert saved.json()['data']['relationship_graph'] == fresh['relationship_graph']
        assert fresh['relationship_graph']['revision'] == 2
        assert fresh['content']['design']['direction']['viewpoint']['text'] == '从弟弟的视点展开'
        assert fresh['content']['design']['direction']['shots'] == []
        assert len((await client.get(path + '/versions')).json()['data']) == 1
        assert (await client.get(path)).json()['data']['designs'] == []


@pytest.mark.asyncio
async def test_scene_version_rejects_other_project_file_without_overwriting_content(tmp_path):
    """自由编辑也不能把另一项目独占的来源文件变成当前项目引用。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            db.add(FileUsage(file_id='image1', project_id='p2', usage_kind='upload', source_ref='foreign'))
        async with client_for(sessions) as client:
            path = await sequence_path(client)
            created = (await client.post(path + '/versions', json={
                'request_id': str(uuid4()), 'title': '初稿',
            })).json()['data']
            content = created['content']
            content['design']['direction']['viewpoint'] = {
                'state': 'proposal', 'text': '别的项目参考',
                'sources': [{'kind': 'file', 'reference': 'foreign', 'version': '1', 'file_id': 'image1'}],
            }
            response = await client.put(path + '/versions/' + created['id'], json={
                'expected_revision': 1, 'request_id': str(uuid4()), 'content': content,
            })
            assert response.status_code == 422
            fresh = (await client.get(path + '/versions/' + created['id'])).json()['data']
            assert fresh['revision'] == 1
            assert fresh['content']['design']['direction']['viewpoint']['state'] == 'unset'


@pytest.mark.asyncio
async def test_scene_version_create_retry_keeps_identity_and_rejects_changed_request(tmp_path):
    """响应丢失后重放同一创建不增加版本，复用请求身份改内容报冲突。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        body = {'request_id': str(uuid4()), 'title': '初稿'}
        first = await client.post(path + '/versions', json=body)
        retry = await client.post(path + '/versions', json=body)
        assert retry.status_code == 200, retry.text
        assert retry.json()['data']['id'] == first.json()['data']['id']
        conflict = await client.post(path + '/versions', json={**body, 'title': '另一方案'})
        assert conflict.status_code == 409
        assert len((await client.get(path + '/versions')).json()['data']) == 1


@pytest.mark.asyncio
async def test_save_retry_is_idempotent_and_stale_writer_cannot_overwrite(tmp_path):
    """保存重试能核实已成功请求，其他旧基准写入保留服务器当前内容。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        created = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '初稿',
        })).json()['data']
        detail = path + '/versions/' + created['id']
        body = {'expected_revision': 1, 'request_id': str(uuid4()), 'content': created['content']}
        first = await client.put(detail, json=body)
        assert first.status_code == 200
        repeated = await client.put(detail, json=body)
        assert repeated.status_code == 200
        assert repeated.json()['data']['revision'] == 2
        assert repeated.json()['data']['last_save_request_id'] == body['request_id']
        stale = await client.put(detail, json={**body, 'request_id': str(uuid4())})
        assert stale.status_code == 409
        body['content']['output_aspect_ratio'] = '9:16'
        reused = await client.put(detail, json=body)
        assert reused.status_code == 409
        fresh = (await client.get(detail)).json()['data']
        assert fresh['revision'] == 2
        assert fresh['content']['output_aspect_ratio'] == '16:9'


@pytest.mark.asyncio
@pytest.mark.parametrize('field,value', [
    ('participants', [{'id': 'p', 'name': '人物', 'character_id': 'missing-character'}]),
    ('participants', [{'id': 'p', 'name': '甲'}, {'id': 'p', 'name': '乙'}]),
    ('direction', {'location_asset_id': 'foreign-place'}),
    ('direction', {'beats': [{'id': 'b', 'event_ids': ['missing-event'],
                            'objective': {}, 'obstacle': {}, 'expected_change': {}, 'must_show': {}}]}),
])
async def test_incomplete_scene_design_still_validates_filled_references(tmp_path, field, value):
    """缺项允许保存，不代表允许未知资产、重复身份或悬空局部引用。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        created = (await client.post(path + '/versions', json={
            'request_id': str(uuid4()), 'title': '初稿',
        })).json()['data']
        content = created['content']
        content['design'][field] = value
        detail = path + '/versions/' + created['id']
        response = await client.put(detail, json={
            'expected_revision': 1, 'request_id': str(uuid4()), 'content': content,
        })
        assert response.status_code == 422
        assert (await client.get(detail)).json()['data']['revision'] == 1


@pytest.mark.asyncio
async def test_scene_version_cannot_cross_project_or_rewrite_frozen_design(tmp_path):
    """新方案与已确认设计并存，读取／保存必须处于其真实项目及场次。"""
    from app.services.directing.store import DirectingStore
    from tests.directing.samples import design_sample
    from tests.directing.test_store import frozen

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            sequence = await store.create_sequence(chapter_id='ch1', title='店内', position=0)
            await frozen(store, sequence.id, 'design', design_sample())
        async with client_for(sessions) as client:
            path = '/api/v1/studio/projects/p1/directing/sequences/' + sequence.id
            before = (await client.get(path)).json()['data']['designs']
            created = (await client.post(path + '/versions', json={
                'request_id': str(uuid4()), 'title': '新方案',
            })).json()['data']
            detail = path + '/versions/' + created['id']
            body = {'expected_revision': 1, 'request_id': str(uuid4()), 'content': created['content']}
            assert (await client.get(detail.replace('/p1/', '/p2/'))).status_code == 422
            assert (await client.put(detail.replace('/p1/', '/p2/'), json=body)).status_code == 422
            assert (await client.put(detail, json=body)).status_code == 200
            assert (await client.get(path)).json()['data']['designs'] == before


@pytest.mark.asyncio
async def test_saved_asset_origin_survives_rename_but_new_binding_is_checked(tmp_path):
    """历史参考保持原名称；新来源和脱离当前设计的旧来源仍拒绝保存。"""
    from app.models.studio import Scene, SceneImage, ProjectSceneLink

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Scene(id='location', name='原场所', style='真人都市'))
            await db.flush()
            db.add(ProjectSceneLink(project_id='p1', scene_id='location'))
            db.add(SceneImage(id=777, scene_id='location', file_id='image1'))
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': 'A'})).json()['data']
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design']['direction']['location_asset_id'] = 'location'
        content['design']['direction']['shots'] = [{'id': 'shot', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': 'unit', 'ratio': '16:9', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '交谈'}], 'references': [{
            'id': 'reference', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space', 'participant_ids': [], 'ordinal': 0,
            'source': {'kind': 'human', 'reference': 'author', 'version': '1'},
            'asset_origin': {'kind': 'scene', 'id': 'location', 'name': '原场所'},
        }]}]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        async with sessions.begin() as db:
            (await db.get(Scene, 'location')).name = '新场所'
            (await db.get(SceneImage, 777)).file_id = None
        content['output_aspect_ratio'] = '9:16'
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert saved.status_code == 200, saved.text
        for change in ('origin', 'design'):
            invalid = deepcopy(content)
            if change == 'origin':
                invalid['units'][0]['references'][0]['asset_origin']['name'] = '新场所'
            else:
                invalid['design']['direction']['location_asset_id'] = None
            rejected = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 3, 'content': invalid})
            assert rejected.status_code == 422, rejected.text
        assert (await client.get(detail)).json()['data']['revision'] == 3
