"""参考组从场次 HTTP 读写与当前编辑预览保持同一身份和输入关系。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_identity_reference_groups import version_with_identity
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_reference_group_cards_preserve_multiple_images_and_edit_targets(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        references = content['units'][0]['references']
        references.extend([
            {**deepcopy(references[0]), 'id': 'r2', 'ordinal': 1},
            {**deepcopy(references[0]), 'id': 'composition', 'ordinal': 2,
             'purpose': 'composition', 'participant_ids': [], 'subject_group_id': 'composition-group'},
            {**deepcopy(references[0]), 'id': 'first', 'ordinal': 3,
             'input_role': 'first_frame', 'subject_group_id': None},
        ])
        preview = await client.post(detail + '/unit-canvas/preview', json={
            'expected_revision': 1, 'content': content})
        assert preview.status_code == 200, preview.text
        graph = preview.json()['data']
        groups = [node for node in graph['nodes'] if node.get('input_role') == 'subject']
        assert {node['subject_group_id'] for node in groups} == {'person-group', 'composition-group', None}
        identity = next(node for node in groups if node['subject_group_id'] == 'person-group')
        assert identity['id'] == 'unit:unit:reference-group:person-group'
        assert identity['title'] == '人物 · 身份参考'
        assert identity['binding_count'] == 2
        assert [row['id'] for row in identity['bindings']] == ['r1', 'r2']
        assert [row['binding_id'] for row in identity['previews']] == ['r1', 'r2']
        assert identity['edit_target']['node_id'] == identity['id']
        assert identity['edit_target']['object']['path'] == ['units', 0, 'references']
        assert {row['field']: row['text'] for row in identity['summary']} == {
            'participants': '人物', 'purpose': '人物／物件身份', 'bindings': '2 张图片', 'source': '人工素材'}
        empty = next(node for node in groups if node['subject_group_id'] is None)
        assert empty['title'] == '添加参考组' and empty['binding_count'] == 0
        inputs = [edge for edge in graph['edges'] if edge.get('category') == 'input']
        assert any(edge['source'] == identity['id'] and edge['target'] == 'unit:unit'
                   and edge['label'] == '人物／物件身份' for edge in inputs)
        assert not any(edge['source'] == empty['id'] for edge in inputs)
        saved = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        current = (await client.get(detail)).json()['data']
        persisted = next(node for node in current['unit_graph']['nodes'] if node['id'] == identity['id'])
        assert persisted['bindings'] == identity['bindings']
        assert persisted['subject_group_id'] == 'person-group'
        assert current['content']['units'][0]['references'] == saved.json()['data']['content']['units'][0]['references']
