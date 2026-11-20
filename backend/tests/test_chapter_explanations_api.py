"""章节解释从公开保存接口验证依据有效性。"""
from hashlib import sha256
from app.dependencies import get_db
from app.main import app
from tests.test_studio_api_responses import _FakeStudioDB, _override_db, _seed_chapter, _seed_project


def test_explanations_survive_edit_but_require_review(client):
    db = _FakeStudioDB()
    _seed_project(db)
    _seed_chapter(db)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        item = {'kind': 'explanation', 'id': 'alias', 'excerpt': '原文', 'text': '这里的李哥指李四',
                'source_version': sha256('原文'.encode()).hexdigest()}
        response = client.patch('/api/v1/studio/chapters/ch-1', json={'source_explanations': [item]})
        assert response.status_code == 200, response.text
        assert response.json()['data']['source_explanations'] == [item]
        changed = client.patch('/api/v1/studio/chapters/ch-1', json={'raw_text': '新原文'})
        assert changed.status_code == 200, changed.text
        assert changed.json()['data']['source_explanations'] == [item]
        assert changed.json()['data']['source_explanations'][0]['source_version'] != sha256('新原文'.encode()).hexdigest()
    finally:
        app.dependency_overrides.clear()


def test_explanation_rejects_duplicate_identity_and_wrong_excerpt(client):
    db = _FakeStudioDB()
    _seed_project(db)
    _seed_chapter(db)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        item = {'kind': 'explanation', 'id': 'alias', 'excerpt': '不存在', 'text': '解释',
                'source_version': sha256('原文'.encode()).hexdigest()}
        assert client.patch('/api/v1/studio/chapters/ch-1', json={'source_explanations': [item]}).status_code == 422
        item['excerpt'] = '原文'
        assert client.patch('/api/v1/studio/chapters/ch-1', json={'source_explanations': [item, item]}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_unconfirmed_explanation_can_be_saved_without_adoption(client):
    db = _FakeStudioDB()
    _seed_project(db)
    _seed_chapter(db)
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch('/api/v1/studio/chapters/ch-1', json={'source_explanations': [
            {'id': 'draft', 'text': '待确认的解释', 'source_version': ''}]})
        assert response.status_code == 200, response.text
        assert response.json()['data']['source_explanations'][0]['source_version'] == ''
    finally:
        app.dependency_overrides.clear()


def test_repeated_excerpt_accepts_explicit_unicode_span(client):
    db = _FakeStudioDB()
    _seed_project(db)
    chapter = _seed_chapter(db)
    chapter.raw_text = '😀李哥来了。李哥走了。'
    app.dependency_overrides[get_db] = _override_db(db)
    try:
        response = client.patch('/api/v1/studio/chapters/ch-1', json={'source_explanations': [
            {'id': 'second', 'excerpt': '李哥', 'start': 6, 'end': 8, 'text': '第二处指李四',
             'source_version': sha256(chapter.raw_text.encode()).hexdigest()}]})
        assert response.status_code == 200, response.text
        assert response.json()['data']['source_explanations'][0]['start'] == 6
    finally:
        app.dependency_overrides.clear()


async def test_concurrent_explanation_save_rejects_old_basis(tmp_path):
    from tests.directing.test_api import client_for
    from tests.directing.test_store import database
    async with database(tmp_path) as sessions, client_for(sessions) as api:
        chapter = (await api.get('/api/v1/studio/chapters/ch1')).json()['data']
        first = await api.patch('/api/v1/studio/chapters/ch1', json={
            'expected_basis_version': chapter['basis_version'], 'source_explanations': [
                {'id': 'one', 'text': '这是一处正常留白', 'source_version': ''}]})
        assert first.status_code == 200, first.text
        stale = await api.patch('/api/v1/studio/chapters/ch1', json={
            'expected_basis_version': chapter['basis_version'], 'source_explanations': []})
        assert stale.status_code == 409
        current = (await api.get('/api/v1/studio/chapters/ch1')).json()['data']
        assert current['source_explanations'][0]['id'] == 'one'


async def test_legacy_explanations_are_retained_but_not_adopted_until_policy_review(tmp_path):
    from tests.directing.test_api import client_for
    from tests.directing.test_store import database
    async with database(tmp_path) as sessions, client_for(sessions) as api:
        chapter = (await api.get('/api/v1/studio/chapters/ch1')).json()['data']
        item = {'id': 'legacy', 'excerpt': '兄弟', 'text': '这里是同学间的称呼',
                'source_version': sha256(chapter['raw_text'].encode()).hexdigest()}
        saved = await api.patch('/api/v1/studio/chapters/ch1', json={'source_explanations': [item]})
        assert saved.status_code == 200, saved.text
        base = '/api/v1/studio/projects/p1/directing/chapters/ch1'
        source = (await api.get(base)).json()['data']
        scene = (await api.post(base + '/sequences', json={'title': '测试', 'position': 0,
            'source_version': source['source_version'], 'span': {'start': 0, 'end': 7}})).json()['data']
        canvas_path = base + '/sequences/' + scene['id'] + '/canvases'
        old = (await api.post(canvas_path, json={'name': '复核前'})).json()['data']
        assert old['document']['fixed_source'].get('source_explanations', []) == []
        item['policy_version'] = 2
        saved = await api.patch('/api/v1/studio/chapters/ch1', json={'source_explanations': [item]})
        assert saved.status_code == 200, saved.text
        new = (await api.post(canvas_path, json={'name': '复核后'})).json()['data']
        assert new['document']['fixed_source']['source_explanations'][0]['policy_version'] == 2
        assert old['document']['fixed_source'].get('source_explanations', []) == []
