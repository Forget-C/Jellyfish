"""验收创作工具与普通画布接口预演相同操作的结果。"""

from uuid import uuid4

import pytest

from app.models.llm import Model, Provider
from app.schemas.canvas_assistant import CanvasAssistantReadContext
from app.schemas.generation_canvas import CanvasCreate, CanvasDocument, TextContentCard, VideoModelCard
from app.services.generation_canvas.assistant_edits import CanvasAssistantEditDraft
from app.services.generation_canvas.edits import CanvasEditGroup, canvas_edits
from app.services.generation_canvas.lifecycle import free_canvas_lifecycle
from app.services.generation_canvas.runs import canvas_runs
from tests.directing.test_store import database
from tests.canvas_urls import seed_scene_canvas
from tests.generation_canvas_reference_fixtures import reference_image_sources
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


def video_prompt(text):
    return {'segments': [{'id': 'body', 'kind': 'text', 'text': text}]}


def group(title, card_id, text):
    return {'title': title, 'changes': [{'kind': 'edit_field', 'change': {'card_id': card_id,
        'target': {'kind': 'video_prompt_segment', 'segment_id': 'body'}, 'text': text}}]}


@pytest.mark.asyncio
async def test_tool_preview_matches_protocol_and_keeps_valid_independent_group(tmp_path):
    from app.services.generation_canvas.planning_tools import CanvasPlanningTools

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            free = free_canvas_lifecycle(db)
            canvas = await free.create_free(CanvasCreate(name='镜头'))
            edits = canvas_edits(db, None)
            base = await edits.preview(canvas.id, [CanvasEditGroup(id='seed', cards=[
                VideoModelCard(id='shot', prompt=video_prompt('雨夜推镜')),
                TextContentCard(id='unselected', text='仅供其他工作使用'),
            ])])
            await edits.submit(base, request_id='seed')
            canvas = await free.read(canvas.id)
            [video] = [card for card in canvas.document.cards if card.id == 'shot']
            scope = CanvasAssistantReadContext(revision=canvas.revision, scope='selection',
                target_card_ids=['shot'], cards=[video.model_dump(mode='json')])
            direct = await edits.preview(canvas.id, [CanvasEditGroup(id='1', cards=[
                VideoModelCard(id='shot', prompt=video_prompt('晨光拉远')),
            ])])
        tools = CanvasPlanningTools(sessions, None, canvas.id, scope, CanvasAssistantEditDraft(scope, canvas.document))
        page = await tools.read()
        assert [card['id'] for card in page['cards']] == ['shot']
        preview = await tools.preview([group('新运镜', 'shot', '晨光拉远'), group('隐藏卡', 'unselected', '修改')])
        assert preview.plan == direct
        assert preview.issues and preview.issues[0].group == 2
        assert (await tools.inspect_inputs('shot', group_id='1')).text == '晨光拉远'
        no_change = await tools.preview([group('原运镜', 'shot', '雨夜推镜')])
        assert no_change.plan is None and not no_change.issues
        async with sessions.begin() as db:
            assert (await free_canvas_lifecycle(db).read(canvas.id)).revision == canvas.revision
            assert (await canvas_runs(db, None).snapshot(canvas.id)).runs == []
            await canvas_edits(db, None).submit(direct, request_id='another-editor')
        conflict = await tools.preview([group('过期运镜', 'shot', '侧面摇镜')])
        assert conflict.plan is None and any('已变化' in issue.message for issue in conflict.issues)


@pytest.mark.asyncio
@pytest.mark.parametrize('draft', [False, True])
async def test_video_preview_checks_actual_adopted_description_and_image(canvas_client, draft):
    from app.services.generation_canvas.planning_tools import CanvasPlanningTools

    async with canvas_client.canvas_sessions.begin() as db:
        provider = await db.get(Provider, 'canvas-provider')
        provider.provider_key = 'vidu'
        (await db.get(Model, 'canvas-video')).name = 'viduq2-pro'
    project = None if draft else 'p'
    params = {'project_id': project} if project else {}
    created = (await canvas_client.get(f'/canvases/drafts/{uuid4()}') if draft
               else await seed_scene_canvas(canvas_client, '/canvases/p', json={'name': '镜头'}))
    canvas = created.json()['data']
    canvas_id = canvas['id']
    path = f'/canvases/{canvas_id}'
    uploaded = await canvas_client.post('/files/upload',
        data={'usage_kind': 'canvas_upload', 'source_ref': canvas_id, **params},
        files={'file': ('actual.png', b'role-image', 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    file_id = uploaded.json()['data']['id']
    document = canvas['document']
    document['cards'] = [
        {'type': 'content.text', 'id': 'description', 'text': '雨夜推镜'},
        {'type': 'reference.character', 'id': 'character', 'name': '小雪', 'image_binding': {'file_id': file_id}},
        {'type': 'model.video', 'id': 'video', 'model_id': 'canvas-video',
         'config': {'ratio': '16:9', 'seconds': 5}, 'prompt': video_prompt('雨夜推镜')},
        {'type': 'model.video', 'id': 'direct', 'model_id': 'canvas-video',
         'config': {'ratio': '16:9', 'seconds': 5}, 'prompt': video_prompt('日出拉远')},
    ]
    reference_image_sources(document)
    if not draft:
        saved = await canvas_client.put(path, params=params, json={
            'expected_revision': canvas['revision'], 'request_id': 'save', 'document': document,
        })
        assert saved.status_code == 200, saved.text
        canvas = (await canvas_client.get(path, params=params)).json()['data']
        document = canvas['document']
    visible = CanvasDocument.model_validate(document)
    scope = CanvasAssistantReadContext(revision=canvas['revision'], scope='selection',
        target_card_ids=['description', 'video', 'direct'], cards=document['cards'])
    planner = CanvasAssistantEditDraft(
        scope, CanvasDocument(id=canvas_id, name=visible.name) if draft else visible, visible_document=visible,
    )
    tools = CanvasPlanningTools(canvas_client.canvas_sessions, project, canvas_id, scope, planner, draft=draft)
    assert {'character', 'character-picture'} <= {card['id'] for card in (await tools.read())['cards']}
    preview = await tools.preview([
        {'title': '引用源正文和角色图', 'changes': [
            {'kind': 'use_video_text', 'source_card': 'description', 'target_card': 'video'},
            {'kind': 'use_video_character', 'source_card': 'character', 'target_card': 'video', 'subject_name': '小雪'},
        ]},
        {'title': '另一束光', 'changes': [
            {'kind': 'use_video_character', 'source_card': 'character', 'target_card': 'direct', 'subject_name': '小雪'},
        ]},
    ])
    assert preview.plan, preview.issues
    assert len(preview.plan.groups) == 2
    assert {guard.path[1] for guard in preview.plan.groups[0].source_guards} == {
        'description', 'character', 'character-picture', 'video',
    }
    for card_id, group_id, text in [('video', '1', '雨夜推镜'), ('direct', '2', '日出拉远')]:
        result = await tools.inspect_inputs(card_id, group_id=group_id, preview_id=preview.preview_id)
        assert result.can_run and result.text.count(text) == 1
        assert [item.file_id for item in result.video_media.subjects[0].media] == [file_id]
    if draft:
        assert (await canvas_client.get(path)).status_code == 404
    else:
        assert (await canvas_client.get(path, params=params)).json()['data']['revision'] == canvas['revision']
        assert (await canvas_client.get(path + '/runtime', params=params)).json()['data']['runs'] == []
