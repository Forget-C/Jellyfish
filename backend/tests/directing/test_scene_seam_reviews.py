"""当前场次版本独立保存采用片段，不改变素材事实或自动紧排。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, editable_design_sample, plan_sample
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database, frozen, output


@pytest.mark.asyncio
async def test_seam_reviews_only_depend_on_the_original_adjacent_media_pair(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, path.rsplit('/', 1)[1], 'design', design_sample())
            plan = await frozen(store, design.sequence_id, 'plan', plan_sample(design.id))
            prompt = await frozen(store, design.sequence_id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '旧素材', 'sources': [SOURCE], 'decisions': []})
            await output(db, prompt.id)
            take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
            take_id = take.id
            await output(db, prompt.id, task_id='task2')
            other_take = await store.register_take(prompt_revision_id=prompt.id, task_id='task2', output_ordinal=0)
            other_take_id = other_take.id
        original = (await client.get(path)).json()['data']['takes']
        created = await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '独立采用'})
        version = created.json()['data']
        assert version['content']['timeline'] == {'items': []}
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design'] = editable_design_sample()
        content['timeline']['items'] = [{'kind': 'media', 'id': clip_id, 'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
            'media_range': {'source_in_ms': 0, 'source_out_ms': 1000}, 'timeline_start_ms': position}
            for clip_id, position in [('left', 0), ('right', 1000), ('unrelated', 3000)]]
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        seams = [node for node in saved['edit_graph']['nodes'] if node['kind'] == 'edit_seam']
        assert len(seams) == 1
        assert (seams[0]['left_clip_id'], seams[0]['right_clip_id']) == ('left', 'right')
        assert seams[0]['review_status'] == 'unreviewed'
        review_path = detail + '/seam-reviews'
        request = {'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'left_clip_id': 'left', 'right_clip_id': 'right',
            'decision': {'verdict': 'pass', 'observation': '落幅与入幅方向连续', 'established': '动作接续成立', 'issues': ''}}
        response = await client.post(review_path, json=request)
        assert response.status_code == 200, response.text
        review = response.json()['data']
        refreshed = (await client.get(detail)).json()['data']
        assert refreshed['revision'] == saved['revision']
        seam = next(node for node in refreshed['edit_graph']['nodes'] if node['kind'] == 'edit_seam')
        assert seam['review_status'] == 'applicable'
        assert seam['review']['id'] == review['id']
        assert seam['review']['observation'] == '落幅与入幅方向连续'
        assert 'content' not in seam['review']
        assert review['matches_current'] is True
        assert review['content'] == saved['content']
        assert (await client.post(review_path, json=request)).json()['data'] == review
        assert len((await client.get(review_path)).json()['data']) == 1
        current = saved
        for change, expected_match in [('unrelated', True), ('source', False), ('restore_source', True), ('crop', False), ('restore', True), ('ratio', False), ('restore_ratio', True), ('range', False), ('restore_range', True), ('move_pair', True), ('gap', False), ('placeholder', False)]:
            edited = deepcopy(current['content'])
            items = edited['timeline']['items']
            if change == 'unrelated':
                items[2]['fit'] = 'cover'
            elif change in ('source', 'restore_source'):
                items[0]['take_id'] = other_take_id if change == 'source' else take_id
            elif change == 'crop':
                items[0]['fit'] = 'cover'
            elif change == 'restore':
                items[0]['fit'] = 'contain'
            elif change == 'ratio':
                edited['output_aspect_ratio'] = '9:16'
            elif change == 'restore_ratio':
                edited['output_aspect_ratio'] = '16:9'
            elif change in ('range', 'restore_range'):
                items[0]['media_range']['source_out_ms'] = 900 if change == 'range' else 1000
                items[1]['timeline_start_ms'] = items[0]['media_range']['source_out_ms']
            elif change == 'move_pair':
                items[0]['timeline_start_ms'] = 500
                items[1]['timeline_start_ms'] = 1500
            elif change == 'gap':
                items[1]['timeline_start_ms'] = 1600
            else:
                items[1] = {'kind': 'planned', 'id': 'right', 'shot_id': 's1', 'estimated_duration_ms': 1000, 'timeline_start_ms': 1500}
            response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': edited})
            assert response.status_code == 200, response.text
            current = response.json()['data']
            seams = [node for node in current['edit_graph']['nodes'] if node['kind'] == 'edit_seam' and node['left_clip_id'] == 'left']
            if change in ('gap', 'placeholder'):
                assert seams == []
            else:
                assert len(seams) == 1
                assert seams[0]['review_status'] == ('applicable' if expected_match else 'needs_review')
                assert seams[0]['review']['id'] == review['id']
            rows = (await client.get(review_path)).json()['data']
            assert rows == [{**review, 'matches_current': expected_match}]
            assert (await client.post(review_path, json=request)).json()['data'] == rows[0]
            if change in ('gap', 'placeholder'):
                rejected = await client.post(review_path, json={**request, 'request_id': str(uuid4()), 'expected_revision': current['revision']})
                assert rejected.status_code == 422, rejected.text
        # 较新记录属于另一组构图依据，恢复原剪辑后仍使用原来适用的结论。
        restore = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': saved['content']})
        current = restore.json()['data']
        crop = deepcopy(current['content'])
        crop['timeline']['items'][0]['fit'] = 'cover'
        changed = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': crop})
        current = changed.json()['data']
        newer = await client.post(review_path, json={**request, 'request_id': str(uuid4()), 'expected_revision': current['revision'],
            'decision': {**request['decision'], 'observation': '新的构图单独审查'}})
        assert newer.status_code == 200, newer.text
        restored = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': saved['content']})
        assert restored.status_code == 200, restored.text
        seam = next(node for node in restored.json()['data']['edit_graph']['nodes'] if node['kind'] == 'edit_seam')
        assert seam['review_status'] == 'applicable'
        assert seam['review']['id'] == review['id']
        changed_request = deepcopy(request)
        changed_request['decision']['observation'] = '不得重用原身份改写结论'
        assert (await client.post(review_path, json=changed_request)).status_code == 409
        assert (await client.post(review_path, json={**request, 'request_id': str(uuid4())})).status_code == 409
        assert (await client.get(path)).json()['data']['takes'] == original


@pytest.mark.asyncio
async def test_distinct_seams_keep_independent_addresses_when_clip_ids_contain_colons(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, path.rsplit('/', 1)[1], 'design', design_sample())
            plan = await frozen(store, design.sequence_id, 'plan', plan_sample(design.id))
            prompt = await frozen(store, design.sequence_id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '独立片段身份', 'sources': [SOURCE], 'decisions': []})
            await output(db, prompt.id)
            take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
            take_id = take.id
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '接缝身份'})).json()['data']
        content = deepcopy(version['content'])
        content['timeline']['items'] = [{'kind': 'media', 'id': clip_id, 'take_kind': 'production_plan',
            'take_id': take_id, 'file_id': 'video1', 'media_range': {'source_in_ms': 0, 'source_out_ms': 1000},
            'timeline_start_ms': position} for clip_id, position in [('a:b', 0), ('c', 1000), ('a', 3000), ('b:c', 4000)]]
        response = await client.put(path + '/versions/' + version['id'], json={
            'request_id': str(uuid4()), 'expected_revision': version['revision'], 'content': content})
        assert response.status_code == 200, response.text
        seams = [node for node in response.json()['data']['edit_graph']['nodes'] if node['kind'] == 'edit_seam']
        assert [(node['left_clip_id'], node['right_clip_id']) for node in seams] == [('a:b', 'c'), ('a', 'b:c')]
        assert len({node['id'] for node in seams}) == 2
        assert len({node['object']['id'] for node in seams}) == 2


@pytest.mark.asyncio
async def test_seam_summaries_restore_old_basis_without_loading_history_timelines(tmp_path):
    from sqlalchemy import event
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            design = await frozen(store, path.rsplit('/', 1)[1], 'design', design_sample())
            plan = await frozen(store, design.sequence_id, 'plan', plan_sample(design.id))
            prompt = await frozen(store, design.sequence_id, 'prompt', {'plan_revision_id': plan.id, 'unit_id': 'u1',
                'format_version': 'fixture', 'text': '固定接缝', 'sources': [SOURCE], 'decisions': []})
            await output(db, prompt.id)
            take = await store.register_take(prompt_revision_id=prompt.id, task_id='task1', output_ordinal=0)
            take_id = take.id
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '接缝摘要'})).json()['data']
        detail = path + '/versions/' + version['id']
        original = deepcopy(version['content'])
        original['timeline']['items'] = [{'kind': 'media', 'id': clip_id, 'take_kind': 'production_plan', 'take_id': take_id,
            'file_id': 'video1', 'media_range': {'source_in_ms': 0, 'source_out_ms': 1000},
            'timeline_start_ms': position} for clip_id, position in [('left', 0), ('right', 1000)]]
        current = version
        first_id = latest_id = None
        for index in range(36):
            content = deepcopy(original)
            content['timeline']['items'][0]['media_range']['source_out_ms'] += index
            content['timeline']['items'][1]['timeline_start_ms'] += index
            response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': content})
            assert response.status_code == 200, response.text
            current = response.json()['data']
            response = await client.post(detail + '/seam-reviews', json={'request_id': str(uuid4()), 'expected_revision': current['revision'],
                'left_clip_id': 'left', 'right_clip_id': 'right', 'decision': {'verdict': 'pass', 'observation': f'固定观察 {index}', 'established': '连续'}})
            assert response.status_code == 200, response.text
            latest_id = response.json()['data']['id']
            first_id = first_id or latest_id
        unmatched = deepcopy(original)
        unmatched['output_aspect_ratio'] = '9:16'
        current = (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': unmatched})).json()['data']
        seam = next(node for node in current['edit_graph']['nodes'] if node['kind'] == 'edit_seam')
        assert seam['review_status'] == 'needs_review' and seam['review']['id'] == latest_id
        statements = []
        def observe(_connection, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)
        engine = sessions.kw['bind'].sync_engine
        event.listen(engine, 'before_cursor_execute', observe)
        try:
            restored = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': current['revision'], 'content': original})
            assert restored.status_code == 200, restored.text
            for projected in [restored.json()['data'], (await client.get(detail)).json()['data'], (await client.get(path + '/versions')).json()['data'][0]]:
                seam = next(node for node in projected['edit_graph']['nodes'] if node['kind'] == 'edit_seam')
                assert seam['review_status'] == 'applicable' and seam['review']['id'] == first_id
        finally:
            event.remove(engine, 'before_cursor_execute', observe)
        # 既有 SQL 读取预算约定：普通快照摘要不得展开接缝固定历史时间线。
        assert not any('directing_scene_seam_reviews.content' in sql for sql in statements)
        history = (await client.get(detail + '/seam-reviews')).json()['data']
        assert len(history) == 36
        assert history[0]['content']['timeline']['items'][0]['media_range']['source_out_ms'] == 1000
        original_version = restored.json()['data']
        copied_response = await client.post(detail + '/copy', json={'request_id': str(uuid4()),
            'expected_revision': original_version['revision'], 'title': '固定继承接缝', 'content': original_version['content']})
        assert copied_response.status_code == 200, copied_response.text
        copied = copied_response.json()['data']
        newer = await client.post(detail + '/seam-reviews', json={'request_id': str(uuid4()), 'expected_revision': original_version['revision'],
            'left_clip_id': 'left', 'right_clip_id': 'right', 'decision': {'verdict': 'pass', 'observation': '来源后来追加', 'established': '新结论'}})
        assert newer.status_code == 200, newer.text
        for projected in [copied, (await client.get(path + '/versions/' + copied['id'])).json()['data']]:
            seam = next(node for node in projected['edit_graph']['nodes'] if node['kind'] == 'edit_seam')
            assert seam['review']['id'] == first_id and seam['review_status'] == 'applicable'
