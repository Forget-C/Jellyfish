"""指令本次输入保留单聚合卡及单元画布的准确编辑地址。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from tests.directing.test_api import client_for
from tests.directing.test_identity_reference_groups import version_with_identity
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_instruction_input_card_links_each_frame_and_group_without_guessing(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        detail, content = await version_with_identity(client)
        references = content['units'][0]['references']
        references.extend([
            {**deepcopy(references[0]), 'id': 'second', 'ordinal': 1},
            *[{**deepcopy(references[0]), 'id': role, 'input_role': role,
               'subject_group_id': None, 'ordinal': ordinal}
              for ordinal, role in [(2, 'first_frame'), (3, 'last_frame')]],
        ])
        saved = await client.put(detail, json={'request_id': str(uuid4()),
            'expected_revision': 1, 'content': content})
        assert saved.status_code == 200, saved.text
        value = saved.json()['data']
        cards = [node for node in value['instruction_graph']['nodes'] if node['kind'] == 'unit_references']
        assert len(cards) == 1
        card = cards[0]
        assert card['title'] == '本次输入'
        assert card['edit_target'] is None
        assert [ref['id'] for ref in card['bindings']] == ['r1', 'second', 'first_frame', 'last_frame']
        assert [preview['binding_id'] for preview in card['previews']] == ['r1', 'second', 'first_frame', 'last_frame']
        targets = [node['edit_target'] for node in value['unit_graph']['nodes'] if node['kind'] == 'unit_references']
        assert card['sources'] == [{**target, 'external': True} for target in targets]
        assert {target['node_id'] for target in card['sources']} == {
            'unit:unit:first-frame', 'unit:unit:last-frame',
            'unit:unit:reference-group:person-group', 'unit:unit:references:add'}
        edge = next(edge for edge in value['instruction_graph']['edges'] if edge['source'] == card['id'])
        assert edge['target'] == 'instruction:unit' and edge['category'] == 'input'
        assert edge['label'] == '本次媒体输入'
