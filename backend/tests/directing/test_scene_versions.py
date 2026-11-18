"""章节重划分对存量场次版本的影响。"""

from uuid import uuid4

import pytest

from app.core.contracts.directing.scene_version import SceneVersionCreate
from app.services.directing.store import DirectingStore
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
async def test_redivision_preserves_explicit_version_basis_and_new_identity_starts_empty(tmp_path):
    """保留身份只改划分；同名新身份不复制历史方案。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        path = await sequence_path(client)
        sequence_id = path.rsplit('/', 1)[1]
        async with sessions.begin() as db:
            version = await DirectingStore(db, 'p1').create_scene_version(
                sequence_id, SceneVersionCreate(request_id=str(uuid4()), title='A'))
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
        async with sessions.begin() as db:
            store = DirectingStore(db, 'p1')
            assert await store.open_scene_versions(replacement['id']) == []
            stored = await store.read_scene_version(sequence_id, version.id)
            assert stored.source.text == '兄弟在店'
            assert stored == version
