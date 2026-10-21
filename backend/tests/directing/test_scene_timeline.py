"""当前场次版本独立保存采用片段，不改变素材事实或自动紧排。"""
from copy import deepcopy
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.core.contracts.directing.canvas_graph import EditCanvasGraph

from app.services.directing.store import DirectingStore
from tests.directing.samples import SOURCE, design_sample, editable_design_sample, plan_sample
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database, frozen, output


@pytest.mark.asyncio
async def test_scene_timeline_preserves_clip_identity_positions_and_real_ranges(tmp_path):
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
        original = (await client.get(path)).json()['data']['takes']
        created = await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '独立采用'})
        version = created.json()['data']
        assert version['content']['timeline'] == {'items': []}
        assert version['edit_graph']['kind'] == 'edit'
        library_graph = version['edit_graph']
        source = next(node for node in library_graph['nodes'] if node['kind'] == 'edit_take')
        library_view = next(view for view in library_graph['views'] if view['title'] == '同场次素材')
        assert [member['node_id'] for member in library_view['members']] == [source['id']]
        assert source['take_id'] == take_id
        assert next(view for view in library_graph['views'] if view['parent_id'] is None)['members'] == []
        detail = path + '/versions/' + version['id']
        content = deepcopy(version['content'])
        content['design'] = editable_design_sample()
        content['timeline']['items'] = [
            {'kind': 'media', 'id': 'clip-a', 'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
                'media_range': {'source_in_ms': 0, 'source_out_ms': 1000}, 'timeline_start_ms': 1000},
            {'kind': 'planned', 'id': 'placeholder', 'shot_id': 's1', 'estimated_duration_ms': 1000, 'timeline_start_ms': 2500},
            {'kind': 'media', 'id': 'clip-b', 'take_kind': 'production_plan', 'take_id': take_id, 'file_id': 'video1',
                'media_range': {'source_in_ms': 1000, 'source_out_ms': 2000}, 'timeline_start_ms': 5000},
        ]
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        saved = saved.json()['data']
        assert saved['content']['timeline']['items'][0]['fit'] == 'contain'
        assert saved['content']['timeline']['items'][2]['fit'] == 'contain'
        for item in content['timeline']['items']:
            if item['kind'] == 'media':
                item['fit'] = 'contain'
        assert saved['content']['timeline'] == content['timeline']
        graph = saved['edit_graph']
        assert graph['version_id'] == saved['id'] and graph['revision'] == saved['revision']
        root = next(view for view in graph['views'] if view['parent_id'] is None)
        nodes = {node['id']: node for node in graph['nodes']}
        assert [nodes[member['node_id']]['clip_id'] for member in root['members']
                if nodes[member['node_id']]['kind'] in ('edit_clip', 'edit_planned')] == ['clip-a', 'placeholder', 'clip-b']
        clips = [node for node in graph['nodes'] if node['kind'] == 'edit_clip']
        assert [node['media_range'] for node in clips] == [
            {'source_in_ms': 0, 'source_out_ms': 1000}, {'source_in_ms': 1000, 'source_out_ms': 2000}]
        source = next(node for node in graph['nodes'] if node['kind'] == 'edit_take')
        assert (source['take_kind'], source['take_id'], source['origin_id']) == ('production_plan', take_id, plan.id)
        assert source['available'] is True
        assert len(graph['nodes']) == 4 and len(graph['edges']) == 2
        assert all(edge['source'] == source['id'] and edge['sources'] for edge in graph['edges'])
        for mutation in ('object', 'edit_field', 'source_identity'):
            malformed = deepcopy(graph)
            clip = next(node for node in malformed['nodes'] if node['kind'] == 'edit_clip')
            if mutation == 'object':
                clip['clip_id'] = 'different-adoption'
            elif mutation == 'edit_field':
                clip['edit_target']['field'] = 'instruction'
            else:
                clip['take_id'] = 'different-take'
            with pytest.raises(ValidationError):
                EditCanvasGraph.model_validate(malformed)
        assert (await client.get(detail)).json()['data'] == saved
        for bad in ['overlap', 'outside', 'file', 'identity', 'shot', 'fit']:
            invalid = deepcopy(saved['content'])
            items = invalid['timeline']['items']
            if bad == 'overlap':
                items[2]['timeline_start_ms'] = 1500
            elif bad == 'outside':
                items[2]['media_range']['source_out_ms'] = 9001
            elif bad == 'file':
                items[2]['file_id'] = 'video2'
            elif bad == 'identity':
                items[2]['id'] = 'clip-a'
            elif bad == 'fit':
                items[0]['fit'] = 'stretch'
            else:
                items[1]['shot_id'] = 'missing-shot'
            rejected = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': invalid})
            assert rejected.status_code == 422, rejected.text
            assert (await client.get(detail)).json()['data'] == saved
        framed = deepcopy(saved['content'])
        framed['output_aspect_ratio'] = '9:16'
        framed['timeline']['items'][0]['fit'] = 'cover'
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': framed})
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        assert saved['content'] == framed
        assert saved['content']['timeline']['items'][2]['fit'] == 'contain'
        assert (await client.get(detail)).json()['data'] == saved
        cropped = deepcopy(saved['content'])
        cropped['timeline']['items'][0]['media_range']['source_out_ms'] = 500
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': cropped})
        assert response.status_code == 200, response.text
        saved = response.json()['data']
        assert [item['timeline_start_ms'] for item in saved['content']['timeline']['items']] == [1000, 2500, 5000]
        removed = deepcopy(saved['content'])
        removed['timeline']['items'] = removed['timeline']['items'][1:]
        response = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': saved['revision'], 'content': removed})
        assert response.status_code == 200, response.text
        assert response.json()['data']['content']['timeline']['items'] == content['timeline']['items'][1:]
        assert (await client.get(path)).json()['data']['takes'] == original
        last_saved = response.json()['data']
        from datetime import UTC, datetime
        from app.models.studio import FileItem
        async with sessions.begin() as db:
            file = await db.get(FileItem, 'video1')
            file.delete_requested_at = datetime.now(UTC).replace(tzinfo=None)
        reread = (await client.get(detail)).json()['data']
        assert reread['revision'] == last_saved['revision']
        assert reread['content'] == last_saved['content']
        source = next(node for node in reread['edit_graph']['nodes'] if node['kind'] == 'edit_take')
        assert source['take_id'] == take_id and source['available'] is False
        assert source['issues'][0]['code'] == 'take-unavailable'
