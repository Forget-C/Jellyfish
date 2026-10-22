"""身份主体通过真实版本 HTTP 保存，非法新输入整次拒绝。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_store import database
from tests.directing.test_scene_versions import sequence_path


async def version_with_identity(client):
    path = await sequence_path(client)
    version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '身份参考'})).json()['data']
    content = deepcopy(version['content'])
    content['design']['participants'] = [{'id': 'person', 'name': '人物'}]
    content['design']['direction']['shots'] = [{'id': 'shot', 'participant_ids': ['person'], 'event_ids': [], 'blocking_state_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
    content['units'] = [{'id': 'unit', 'ratio': '16:9', 'coverage': [{'id': 'coverage', 'shot_id': 'shot', 'action_scope': '交谈'}], 'references': [{'id': 'r1', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'identity', 'participant_ids': ['person'], 'ordinal': 0, 'subject_group_id': 'person-group', 'source': {'kind': 'human', 'reference': 'author', 'version': '1'}}]}]
    return path + '/versions/' + version['id'], content


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['empty', 'multiple', 'groups', 'missing', 'illegal-role'])
async def test_identity_save_rejects_invalid_groups_without_changing_record(tmp_path, invalid):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        bad = deepcopy(content)
        reference = bad['units'][0]['references'][0]
        if invalid == 'groups':
            extra = deepcopy(reference)
            extra.update(id='r2', ordinal=1, subject_group_id='other-group')
            bad['units'][0]['references'].append(extra)
        elif invalid == 'missing':
            reference['participant_ids'] = ['missing']
        elif invalid == 'illegal-role':
            reference['input_role'] = 'bogus'
        else:
            reference['participant_ids'] = [] if invalid == 'empty' else ['person', 'second']
            if invalid == 'multiple':
                bad['design']['participants'].append({'id': 'second', 'name': '第二人'})
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': bad})
        assert response.status_code == 422, response.text
        reread = (await client.get(detail)).json()['data']
        assert reread['revision'] == 2
        assert reread['content'] == saved.json()['data']['content']


@pytest.mark.asyncio
async def test_cleanup_classifies_original_groups_and_is_idempotent(tmp_path):
    from app.models.directing import SceneVersionRecord

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        legacy = deepcopy(saved.json()['data']['content'])
        refs = legacy['units'][0]['references']
        extra = deepcopy(refs[0]); extra.update(id='r2', ordinal=1)
        refs.append(extra)
        invalid = deepcopy(refs[0]); invalid.update(id='r0', ordinal=2, subject_group_id='bad', participant_ids=[])
        refs.append(invalid)
        independent = deepcopy(refs[0]); independent.update(id='r3', ordinal=3, subject_group_id='other')
        refs.append(independent)
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1])
            row.content = legacy
        request = {'expected_revision': 2, 'request_id': str(uuid4())}
        cleaned = await client.post(detail + '/identity-references/cleanup', json=request)
        assert cleaned.status_code == 200, cleaned.text
        data = cleaned.json()['data']
        assert [ref['id'] for ref in data['content']['units'][0]['references']] == ['r1']
        assert data['revision'] == 3
        repeated = await client.post(detail + '/identity-references/cleanup', json=request)
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()['data']['content'] == data['content']
        unchanged = await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 3, 'request_id': str(uuid4())})
        assert unchanged.status_code == 200
        assert unchanged.json()['data']['revision'] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize('grouped', [True, False])
@pytest.mark.parametrize('access', ['maintenance', 'detail', 'list'])
async def test_cleanup_preserves_compliant_multimedia_but_crops_original_ungrouped(tmp_path, grouped, access):
    from datetime import UTC, datetime
    from app.models.directing import SceneVersionRecord, SceneVideoExecution, SceneTakeRecord, DirectingRevision
    from app.models.task import Task, TaskOutput
    from sqlalchemy import Text, cast, select

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        legacy = deepcopy(saved.json()['data']['content'])
        refs = legacy['units'][0]['references']
        extra = deepcopy(refs[0]); extra.update(id='r2', ordinal=1, file_id='missing-file')
        refs.append(extra)
        if not grouped:
            for ref in refs:
                ref['subject_group_id'] = None
        # 合规缺失文件组必须完整保留；新规则不可重解释固定执行输入。
        frozen = {'legacy': deepcopy(legacy)}
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1]); row.content = legacy
            db.add(Task(id='fixed-task', kind='video', project_id='p1', status='succeeded', input_snapshot=frozen))
            await db.flush()
            db.add(TaskOutput(task_id='fixed-task', ordinal=0, file_id='video1'))
            db.add(SceneVideoExecution(id='frozen', version_id=row.id, unit_id='unit', request_id='frozen', request_hash='fixed', preparation=frozen, task_id='fixed-task'))
            db.add(DirectingRevision(id='fixed-revision', sequence_id=row.sequence_id, kind='plan', payload=frozen, confirmed_by='author', confirmed_at=datetime.now(UTC)))
            await db.flush()
            db.add(SceneTakeRecord(id='fixed-take', execution_id='frozen', task_id='fixed-task', output_ordinal=0, file_id='video1', annotation=frozen))
        async with sessions() as db:
            original_bytes = [await db.scalar(select(cast(field, Text))) for field in (
                SceneVideoExecution.preparation, Task.input_snapshot, SceneTakeRecord.annotation, DirectingRevision.payload)]
        response = await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 2, 'request_id': str(uuid4())}) if access == 'maintenance' else await client.get(detail if access == 'detail' else detail.rsplit('/', 1)[0])
        assert response.status_code == 200, response.text
        actual = response.json()['data'] if access != 'list' else response.json()['data'][0]
        assert [ref['id'] for ref in actual['content']['units'][0]['references']] == (['r1', 'r2'] if grouped else ['r1'])
        assert actual['revision'] == (2 if grouped else 3)
        async with sessions() as db:
            assert (await db.get(SceneVideoExecution, 'frozen')).preparation == frozen
            actual_bytes = [await db.scalar(select(cast(field, Text))) for field in (
                SceneVideoExecution.preparation, Task.input_snapshot, SceneTakeRecord.annotation, DirectingRevision.payload)]
            assert actual_bytes == original_bytes


@pytest.mark.asyncio
async def test_cleanup_stale_revision_and_retired_sequence_are_rejected(tmp_path):
    from app.models.directing import Sequence

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, _ = await version_with_identity(client)
        stale = await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 9, 'request_id': str(uuid4())})
        assert stale.status_code == 409
        async with sessions.begin() as db:
            row = await db.get(Sequence, detail.split('/sequences/')[1].split('/')[0]); row.is_current = False
        retired = await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 1, 'request_id': str(uuid4())})
        assert retired.status_code in (409, 422)


@pytest.mark.asyncio
@pytest.mark.parametrize('access', ['maintenance', 'detail', 'list'])
async def test_cleanup_database_failure_rolls_back_all_input_changes(tmp_path, access):
    from sqlalchemy import event
    from app.models.directing import SceneVersionRecord

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        legacy = deepcopy(saved.json()['data']['content'])
        legacy['units'][0]['references'][0]['participant_ids'] = []
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1]); row.content = legacy
        engine = sessions.kw['bind'].sync_engine
        def fail_after_update(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.startswith('UPDATE directing_scene_versions'):
                raise RuntimeError('simulated transaction failure')
        event.listen(engine, 'after_cursor_execute', fail_after_update)
        try:
            with pytest.raises(RuntimeError, match='simulated transaction failure'):
                if access == 'maintenance':
                    await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 2, 'request_id': str(uuid4())})
                else:
                    await client.get(detail if access == 'detail' else detail.rsplit('/', 1)[0])
        finally:
            event.remove(engine, 'after_cursor_execute', fail_after_update)
        async with sessions() as db:
            row = await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1])
            assert row.revision == 2
            assert row.content == legacy
        retried = (await client.get(detail)).json()['data']
        assert retried['revision'] == 3
        assert retried['content']['units'][0]['references'] == []


@pytest.mark.asyncio
@pytest.mark.parametrize('source', ['manual', 'asset', 'mixed-assets', 'asset-and-manual'])
async def test_identity_single_source_multimedia_and_conflicts(tmp_path, source):
    from app.models.studio import Character, CharacterImage

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add_all([Character(id=key, project_id='p1', name=key, style='真人都市') for key in ['a', 'b']])
            await db.flush()
            db.add_all([CharacterImage(id=index, character_id=key, file_id='image1') for index, key in [(800, 'a'), (801, 'b')]])
        detail, content = await version_with_identity(client)
        first = content['units'][0]['references'][0]
        if source != 'manual':
            first['asset_origin'] = {'kind': 'character', 'id': 'a', 'name': 'a'}
        extra = deepcopy(first); extra.update(id='r2', ordinal=1)
        if source == 'mixed-assets':
            extra['asset_origin'] = {'kind': 'character', 'id': 'b', 'name': 'b'}
        if source == 'asset-and-manual':
            extra.pop('asset_origin')
        content['units'][0]['references'].append(extra)
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == (422 if source.startswith('mixed') or source == 'asset-and-manual' else 200), response.text
        actual = (await client.get(detail)).json()['data']
        assert actual['revision'] == (1 if response.status_code == 422 else 2)
        if response.status_code == 200:
            assert [ref['id'] for ref in actual['content']['units'][0]['references']] == ['r1', 'r2']


@pytest.mark.asyncio
async def test_identity_frame_and_other_purposes_keep_existing_rules(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        first = content['units'][0]['references'][0]
        first.update(input_role='first_frame', subject_group_id=None, participant_ids=[])
        extra = deepcopy(first); extra.update(id='composition', ordinal=1, input_role='subject', purpose='composition')
        content['units'][0]['references'].append(extra)
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['first-missing', 'none-valid', 'invalid-original-group', 'source-deleted'])
async def test_cleanup_uses_original_classification_and_first_valid_survivor(tmp_path, case):
    from app.models.directing import SceneVersionRecord

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        legacy = deepcopy(saved.json()['data']['content'])
        refs = legacy['units'][0]['references']
        extra = deepcopy(refs[0]); extra.update(id='r2', ordinal=1, subject_group_id='second')
        refs.append(extra)
        if case in ('first-missing', 'none-valid'):
            refs[0]['file_id'] = 'missing'
        if case == 'none-valid':
            refs[1]['file_id'] = 'missing-too'
        if case == 'invalid-original-group':
            refs[1]['subject_group_id'] = refs[0]['subject_group_id']
            invalid = deepcopy(refs[0]); invalid.update(id='invalid', ordinal=2, subject_group_id='invalid', participant_ids=['person', 'second-person'])
            refs.append(invalid)
            legacy['design']['participants'].append({'id': 'second-person', 'name': '另一人'})
        if case == 'source-deleted':
            for ref in refs:
                ref['asset_origin'] = {'kind': 'character', 'id': 'deleted-asset', 'name': '删除前名字'}
        untouched = deepcopy(legacy['units'][0]); untouched.update(id='other-unit', references=[])
        legacy['units'].append(untouched)
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1]); row.content = legacy
        response = await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 2, 'request_id': str(uuid4())})
        assert response.status_code == 200, response.text
        actual = response.json()['data']['content']
        assert [ref['id'] for ref in actual['units'][0]['references']] == ([] if case == 'none-valid' else ['r2'] if case == 'first-missing' else ['r1'])
        assert actual['units'][1] == untouched


@pytest.mark.asyncio
async def test_cleanup_releases_only_its_unused_file_usage(tmp_path):
    from app.models.directing import SceneVersionRecord
    from app.models.studio import FileUsage
    from sqlalchemy import select

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        version_id = detail.rsplit('/', 1)[-1]
        legacy = deepcopy(saved.json()['data']['content'])
        legacy['units'][0]['references'][0]['participant_ids'] = []
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, version_id); row.content = legacy
            db.add(FileUsage(file_id='image1', project_id='p1', chapter_id='ch1', usage_kind='directing_reference', source_ref='fixed-task'))
        response = await client.post(detail + '/identity-references/cleanup', json={'expected_revision': 2, 'request_id': str(uuid4())})
        assert response.status_code == 200, response.text
        async with sessions() as db:
            refs = set(await db.scalars(select(FileUsage.source_ref).where(FileUsage.file_id == 'image1')))
        assert 'scene-version:' + version_id not in refs
        assert 'fixed-task' in refs


@pytest.mark.asyncio
async def test_asset_rename_does_not_split_a_subject_group(tmp_path):
    from app.models.studio import Character, CharacterImage

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        async with sessions.begin() as db:
            db.add(Character(id='a', project_id='p1', name='原名', style='真人都市'))
            await db.flush()
            db.add(CharacterImage(id=803, character_id='a', file_id='image1'))
        detail, content = await version_with_identity(client)
        content['units'][0]['references'][0]['asset_origin'] = {'kind': 'character', 'id': 'a', 'name': '原名'}
        first = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert first.status_code == 200, first.text
        async with sessions.begin() as db:
            (await db.get(Character, 'a')).name = '新名'
        extra = deepcopy(content['units'][0]['references'][0])
        extra.update(id='r2', ordinal=1, asset_origin={'kind': 'character', 'id': 'a', 'name': '新名'})
        content['units'][0]['references'].append(extra)
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': content})
        assert response.status_code == 200, response.text
        actual = response.json()['data']['content']['units'][0]['references']
        assert [ref['asset_origin']['name'] for ref in actual] == ['原名', '新名']
        assert {ref['subject_group_id'] for ref in actual} == {'person-group'}


@pytest.mark.asyncio
@pytest.mark.parametrize('access', ['detail', 'list'])
async def test_open_version_upgrades_saved_identity_groups_before_graph_projection(tmp_path, access):
    from app.models.directing import SceneVersionRecord

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        legacy = deepcopy(saved.json()['data']['content'])
        extra = deepcopy(legacy['units'][0]['references'][0])
        extra.update(id='r2', ordinal=1, subject_group_id='second')
        legacy['units'][0]['references'].append(extra)
        async with sessions.begin() as db:
            (await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1])).content = legacy
        opened = await client.get(detail if access == 'detail' else detail.rsplit('/', 1)[0])
        assert opened.status_code == 200, opened.text
        actual = opened.json()['data'] if access == 'detail' else opened.json()['data'][0]
        assert [ref['id'] for ref in actual['content']['units'][0]['references']] == ['r1']
        assert actual['revision'] == 3
        for key in ['relationship_graph', 'director_graph', 'unit_graph', 'instruction_graph', 'edit_graph']:
            assert actual[key]['revision'] == 3
        assert (await client.get(detail)).json()['data'] == actual
        actual['content']['design']['participants'][0]['name'] = '改名'
        renamed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 3, 'content': actual['content']})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()['data']['revision'] == 4


@pytest.mark.asyncio
@pytest.mark.parametrize('access', ['detail', 'list'])
async def test_open_retired_sequence_preserves_saved_legacy_references(tmp_path, access):
    from app.models.directing import SceneVersionRecord, Sequence

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        legacy = deepcopy(saved.json()['data']['content'])
        extra = deepcopy(legacy['units'][0]['references'][0])
        extra.update(id='r2', ordinal=1, subject_group_id='second')
        legacy['units'][0]['references'].append(extra)
        async with sessions.begin() as db:
            row = await db.get(SceneVersionRecord, detail.rsplit('/', 1)[-1])
            row.content = legacy
            (await db.get(Sequence, row.sequence_id)).is_current = False
        response = await client.get(detail if access == 'detail' else detail.rsplit('/', 1)[0])
        assert response.status_code == 200, response.text
        actual = response.json()['data'] if access == 'detail' else response.json()['data'][0]
        assert actual['revision'] == 2
        assert actual['content'] == legacy


@pytest.mark.asyncio
async def test_open_versions_during_saves_does_not_report_a_stale_cleanup_conflict(tmp_path):
    import asyncio

    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        saved = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})).json()['data']

        async def edit():
            current = saved
            for index in range(8):
                proposed = deepcopy(current['content'])
                proposed['design']['participants'][0]['name'] = f'并发编辑{index}'
                response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': proposed})
                assert response.status_code == 200, response.text
                current = response.json()['data']
            return current

        async def browse():
            for index in range(16):
                response = await client.get(detail if index % 2 else detail.rsplit('/', 1)[0])
                assert response.status_code == 200, response.text

        edited, _ = await asyncio.gather(edit(), browse())
        actual = (await client.get(detail)).json()['data']
        assert actual['revision'] == edited['revision']
        assert actual['content'] == edited['content']
