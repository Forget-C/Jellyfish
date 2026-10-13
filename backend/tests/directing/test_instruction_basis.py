"""独立依据确认经真实 HTTP 验证，不把保存当成重新确认。"""
from copy import deepcopy
from uuid import uuid4

import pytest

from app.models.studio import FileItem
from tests.directing.test_api import client_for
from tests.directing.test_scene_versions import sequence_path
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_basis_receipt_is_explicit_immutable_and_unit_owned(tmp_path):
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        version = (await client.post(path + '/versions', json={'request_id': str(uuid4()), 'title': '依据确认'})).json()['data']
        content = deepcopy(version['content'])
        content['design']['direction']['shots'] = [{'id': 'shot-one', 'beat_ids': [], 'event_ids': [], 'blocking_state_ids': [], 'participant_ids': [], 'criterion_ids': [], 'narrative_function': {}, 'visible_result': {}}]
        content['units'] = [{'id': key, 'ratio': '16:9', 'instruction': '递出信封', 'coverage': [{'id': 'coverage', 'shot_id': 'shot-one', 'action_scope': '递出信封'}]} for key in ['unit-one', 'unit-two']]
        detail = path + '/versions/' + version['id']
        url = detail + '/units/unit-one/instruction-basis'
        initial = await client.post(url, json={'content': content})
        assert initial.status_code == 200, initial.text
        assert initial.json()['data']['status'] == 'unbound'
        request = {'request_id': str(uuid4()), 'expected_revision': 1, 'content': content}
        confirmed = await client.post(url + '/confirm', json=request)
        assert confirmed.status_code == 200, confirmed.text
        basis_id = confirmed.json()['data']['basis_id']
        assert (await client.post(url + '/confirm', json=request)).json()['data']['basis_id'] == basis_id
        assert (await client.get(detail)).json()['data'] == version
        bound = deepcopy(content)
        bound['units'][0]['instruction_basis_id'] = basis_id
        assert (await client.post(url, json={'content': bound})).json()['data']['status'] == 'current'
        changed = deepcopy(bound)
        changed['units'][0]['coverage'][0]['action_scope'] = '收下信封'
        state = (await client.post(url, json={'content': changed})).json()['data']
        assert state['status'] == 'changed'
        assert state['previous']['unit']['coverage'][0]['action_scope'] == '递出信封'
        assert state['current']['unit']['coverage'][0]['action_scope'] == '收下信封'
        saved = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 1, 'content': changed})
        assert saved.status_code == 200, saved.text
        assert (await client.post(url, json={'content': saved.json()['data']['content']})).json()['data']['status'] == 'changed'
        assert (await client.post(url + '/confirm', json=request)).json()['data']['basis_id'] == basis_id
        assert (await client.post(url + '/confirm', json={**request, 'content': changed})).status_code == 409
        other = deepcopy(bound)
        other['units'][1]['coverage'][0]['action_scope'] = '无关单元新动作'
        assert (await client.post(url, json={'content': other})).json()['data']['status'] == 'current'
        forged = deepcopy(changed)
        forged['units'][1]['instruction_basis_id'] = basis_id
        assert (await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': forged})).status_code == 422

        empty = deepcopy(changed)
        empty['units'][0]['instruction'] = ''
        assert (await client.post(url + '/confirm', json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': empty})).status_code == 422
        assert (await client.post(url + '/confirm', json={**request, 'request_id': str(uuid4())})).status_code == 409
        renewed = await client.post(url + '/confirm', json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': changed})
        assert renewed.status_code == 200, renewed.text
        assert renewed.json()['data']['basis_id'] != basis_id
        # 未应用新回执时仍引用旧依据，确认接口不会替换正在编辑的内容。
        assert (await client.post(url, json={'content': changed})).json()['data']['status'] == 'changed'
        # 首帧实际文件身份也属于依据；保存更换不能更新原回执。
        async with sessions.begin() as db:
            db.add(FileItem(id='replacement-frame', type='image', name='新首帧', storage_key='files/new-frame.png'))
        framed = deepcopy(changed)
        framed['units'][0]['references'] = [{'id': 'frame', 'file_id': 'image1', 'media_kind': 'image', 'purpose': 'space', 'input_role': 'first_frame', 'participant_ids': [], 'ordinal': 0,
            'source': {'kind': 'file', 'reference': 'image1', 'file_id': 'image1', 'version': '1'}}]
        frame_receipt = await client.post(url + '/confirm', json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': framed})
        assert frame_receipt.status_code == 200, frame_receipt.text
        framed['units'][0]['instruction_basis_id'] = frame_receipt.json()['data']['basis_id']
        framed['units'][0]['references'][0]['file_id'] = 'replacement-frame'
        framed['units'][0]['references'][0]['source'] = {'kind': 'file', 'reference': 'replacement-frame', 'file_id': 'replacement-frame', 'version': '1'}
        saved_frame = await client.put(detail, json={'request_id': str(uuid4()), 'expected_revision': 2, 'content': framed})
        assert saved_frame.status_code == 200, saved_frame.text
        state = (await client.post(url, json={'content': saved_frame.json()['data']['content']})).json()['data']
        assert state['status'] == 'changed'
        assert state['previous']['unit']['references'][0]['file_id'] == 'image1'
        assert state['current']['unit']['references'][0]['file_id'] == 'replacement-frame'
        assert saved_frame.json()['data']['content']['units'][0]['instruction'] == '递出信封'
