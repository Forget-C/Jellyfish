"""章节重划分对存量场次版本的影响。"""

from uuid import uuid4

import pytest
from sqlalchemy import select

from app.core.contracts.directing.scene_version import EditableSceneDesign, SceneVersionContent, SceneVersionSource
from app.models.directing import SceneVersionRecord
from tests.directing.test_api import client_for
from tests.directing.test_store import database


async def create_sequence(client):
    """通过已有原文入口建立场次，不创建方案或历史执行。"""
    base = '/api/v1/studio/projects/p1/directing'
    chapter = (await client.get(base + '/chapters/ch1')).json()['data']
    response = await client.post(base + '/chapters/ch1/sequences', json={
        'title': '店内', 'position': 0, 'source_version': chapter['source_version'],
        'span': {'start': 0, 'end': 4},
    })
    assert response.status_code == 200
    return response.json()['data']['id']


@pytest.mark.asyncio
async def test_redivision_preserves_explicit_version_basis_and_new_identity_starts_empty(tmp_path):
    """保留身份只改划分；同名新身份不复制历史方案。"""
    async with database(tmp_path) as sessions, client_for(sessions) as client:
        sequence_id = await create_sequence(client)
        chapter_path = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        chapter = (await client.get(chapter_path)).json()['data']
        sequence = chapter['sequences'][0]
        basis = SceneVersionSource(source=sequence['source'], start=0, end=4, text='兄弟在店')
        source_bases = [basis.model_dump(mode='json')]
        content = SceneVersionContent(basis=basis, design=EditableSceneDesign(sources=[basis.source])).model_dump(mode='json')
        version_id = str(uuid4())
        async with sessions.begin() as db:
            db.add(SceneVersionRecord(id=version_id, sequence_id=sequence_id, title='A', revision=1,
                source_bases=source_bases, content=content, create_request_id=str(uuid4())))
        draft = {'source_version': chapter['source_version'],
                 'baseline': [{'sequence_id': sequence['id'], 'version': sequence['version']}],
                 'members': [{'key': 'retained', 'sequence_id': sequence['id'], 'title': sequence['title'], 'span': {'start': 0, 'end': 5}}],
                 'exited_sequence_ids': [], 'lineage': [{'sequence_id': sequence['id'], 'target_keys': ['retained']}]}
        preview = (await client.post(chapter_path + '/division/preview', json=draft)).json()['data']
        result = await client.put(chapter_path + '/division', json={'request_id': str(uuid4()), 'draft': draft,
            'preview_token': preview['preview_token'], 'identity_changes_confirmed': True})
        assert result.status_code == 200, result.text
        retained = result.json()['data']['chapter']['sequences'][0]
        assert retained['id'] == sequence_id
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
        assert replacement['id'] != sequence_id
        assert replacement['title'] == sequence['title']
        async with sessions.begin() as db:
            stored = await db.get(SceneVersionRecord, version_id)
            assert stored is not None
            assert (stored.sequence_id, stored.title, stored.revision) == (sequence_id, 'A', 1)
            assert stored.content == content
            assert stored.source_bases == source_bases
            assert await db.scalar(select(SceneVersionRecord.id).where(
                SceneVersionRecord.sequence_id == replacement['id'])) is None
