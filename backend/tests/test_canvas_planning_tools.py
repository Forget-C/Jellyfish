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
async def test_shot_preview_uses_one_description_and_separate_duration(tmp_path):
    from app.services.generation_canvas.generation_inputs import canvas_generation_inputs
    from app.services.generation_canvas.planning_tools import CanvasPlanningTools

    description = '孙悟空腾空跃起，金箍棒向下猛砸。仰拍上摇，落点前定格半帧。'
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='分镜'))
        scope = CanvasAssistantReadContext(revision=canvas.revision, scope='canvas', target_card_ids=[], cards=[])
        tools = CanvasPlanningTools(sessions, None, canvas.id, scope, CanvasAssistantEditDraft(scope, canvas.document))
        source = {'kind': 'add_card', 'reference': 'description',
                  'card': {'kind': 'add_text_card', 'text': description}}
        video = {'kind': 'add_card', 'reference': 'video',
                 'card': {'kind': 'add_model_card', 'modality': 'video', 'prompt': ''}}
        duration = {'kind': 'edit_field', 'change': {'card_id': 'video',
                    'target': {'kind': 'video_duration'}, 'text': '10'}}
        use = {'kind': 'use_video_text', 'source_card': 'description', 'target_card': 'video'}
        candidate = {'kind': 'connect_cards', 'source_card': 'description', 'source_port': 'text',
                     'target_card': 'video', 'target_port': 'text'}
        changes = [source, video, duration, candidate]

        async def preview():
            return await tools.preview([{'title': 'S04 · 金箍棒落点', 'changes': changes}])

        rejected = await preview()
        assert not rejected.plan and any('@引用' in issue.message for issue in rejected.issues)
        changes[-1] = use
        source['card']['text'] = 'S04 / 10 秒。' + description
        rejected = await preview()
        assert not rejected.plan and rejected.issues
        source['card']['text'] = description
        video['card']['prompt'] = '镜头随后拉远，10 秒'
        changes[-1] = {**use, 'before_segment_id': 'video'}
        rejected = await preview()
        assert not rejected.plan and any('整镜秒数' in issue.message for issue in rejected.issues)
        changes[-1] = use
        video['card']['prompt'] = '孙悟空跳起挥棒下砸，镜头跟随上摇，砸落前短暂停格。'
        rejected = await preview()
        assert not rejected.plan and rejected.issues
        video['card']['prompt'] = ''
        accepted = await preview()
        assert accepted.plan, accepted.issues
        assert accepted.proposal.groups[0].title.startswith('S04')
        ids = {edit.origin_reference: edit.card_id for edit in accepted.proposal.groups[0].edits if edit.origin_reference}
        video_id = ids['video']
        assert (await tools.inspect_inputs(video_id, group_id='1')).text == description
        async with sessions.begin() as db:
            await canvas_edits(db, None).submit(accepted.plan, request_id='s04')
            document = (await free_canvas_lifecycle(db).read(canvas.id)).document
            saved_video = next(card for card in document.cards if card.id == video_id)
            assert saved_video.config.seconds == 10
            assert [segment.kind for segment in saved_video.prompt.segments] == ['reference']
            updated = description.replace('仰拍上摇', '低机位固定')
            edits = canvas_edits(db, None)
            revised = await edits.preview(canvas.id, [CanvasEditGroup(id='source', cards=[
                TextContentCard(id=ids['description'], text=updated),
            ])])
            await edits.submit(revised, request_id='change-s04-source')
            compiled = await canvas_generation_inputs(db, None).compile_input(canvas.id, video_id)
            assert compiled.text == updated
            reopened = (await free_canvas_lifecycle(db).read(canvas.id)).document
            assert next(card for card in reopened.cards if card.id == video_id).config.seconds == 10
            legacy = await edits.preview(canvas.id, [CanvasEditGroup(id='legacy', cards=[
                TextContentCard(id='old-source', text='S04 / 10 秒。' + description),
                VideoModelCard(id='old-video', prompt=video_prompt('孙悟空跳起挥棒下砸，上摇跟随，落点定格，10 秒')),
            ])])
            await edits.submit(legacy, request_id='legacy-s04')
            current = await free_canvas_lifecycle(db).read(canvas.id)

        scope = CanvasAssistantReadContext(revision=current.revision, scope='selection',
            target_card_ids=['old-source', 'old-video'],
            cards=[card.model_dump(mode='json') for card in current.document.cards if card.id.startswith('old-')])
        repair = CanvasPlanningTools(sessions, None, canvas.id, scope, CanvasAssistantEditDraft(scope, current.document))
        repaired = await repair.preview([{'title': '修复 S04', 'changes': [
            {'kind': 'edit_field', 'change': {'card_id': 'old-source', 'target': {'kind': 'card_text'}, 'text': description}},
            *group('对齐旧片段', 'old-video', description)['changes'],
            {**use, 'source_card': 'old-source', 'target_card': 'old-video', 'replace_segment_id': 'body'},
            {**duration, 'change': {**duration['change'], 'card_id': 'old-video'}},
        ]}])
        assert repaired.plan, repaired.issues
        assert len(repaired.plan.groups) == 1
        async with sessions.begin() as db:
            await canvas_edits(db, None).submit(repaired.plan, request_id='repair-s04')
            compiled = await canvas_generation_inputs(db, None).compile_input(canvas.id, 'old-video')
            assert compiled.text == description


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
    from app.schemas.canvas_edit_intents import CanvasEditIntent
    from app.services.generation_canvas.edits import project_canvas_edit_group
    from app.services.generation_canvas.generation_inputs import canvas_generation_inputs

    async with canvas_client.canvas_sessions() as db:
        group = preview.proposal.groups[0]
        intents = [
            CanvasEditIntent(edit.card_id, edit.target, edit.before, edit.after, edit.copy_of, edit.impact_fingerprint)
            for edit in group.edits
        ]
        direct = await canvas_edits(db, project).preview_visible_group(
            visible, group.id, intents, expected_revision=None if draft else canvas['revision'],
        )
        document_with_refs = project_canvas_edit_group(visible, direct)
        compiled = await canvas_generation_inputs(db, project).compile_document(
            document_with_refs, 'video', draft=draft, expected_revision=None if draft else canvas['revision'],
        )
        assert compiled.can_run and compiled.text.count('雨夜推镜') == 1
        assert [item.file_id for item in compiled.video_media.subjects[0].media] == [file_id]
    for card_id, group_id, text in [('video', '1', '雨夜推镜'), ('direct', '2', '日出拉远')]:
        result = await tools.inspect_inputs(card_id, group_id=group_id, preview_id=preview.preview_id)
        assert result.can_run and result.text.count(text) == 1
        assert [item.file_id for item in result.video_media.subjects[0].media] == [file_id]
    if draft:
        assert (await canvas_client.get(path)).status_code == 404
    else:
        assert (await canvas_client.get(path, params=params)).json()['data']['revision'] == canvas['revision']
        assert (await canvas_client.get(path + '/runtime', params=params)).json()['data']['runs'] == []


@pytest.mark.asyncio
async def test_edit_protocol_previews_visible_intents_without_saving(tmp_path):
    from app.schemas.canvas_edit_intents import CanvasEditIntent, CardTextEdit

    async with database(tmp_path) as sessions, sessions.begin() as db:
        canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='镜头'))
        edits = canvas_edits(db, None)
        seed = await edits.preview(canvas.id, [CanvasEditGroup(id='seed', cards=[
            TextContentCard(id='target', text='初稿'),
            TextContentCard(id='unrelated', text='已保存'),
        ])])
        await edits.submit(seed, request_id='seed')
        saved = await free_canvas_lifecycle(db).read(canvas.id)
        visible = saved.document.model_copy(deep=True)
        next(card for card in visible.cards if card.id == 'unrelated').text = '本地草稿'
        plan = await edits.preview_visible_group(visible, 'text', [
            CanvasEditIntent(card_id='target', target=CardTextEdit(kind='card_text'), before='初稿', after='修订'),
        ], expected_revision=saved.revision)
        assert [(item.path, item.before.value, item.after.value) for item in plan.differences] == [
            (('cards', 'target', 'text'), '初稿', '修订'),
        ]
        assert await free_canvas_lifecycle(db).read(canvas.id) == saved


@pytest.mark.asyncio
async def test_draft_intents_reject_invalid_values_and_previews_after_first_save(tmp_path):
    from app.schemas.canvas_assistant_draft import CanvasDraftSave
    from app.schemas.canvas_assistant_structure import AddCanvasCardTarget, AddCatalogCard, ConnectCardsTarget
    from app.schemas.canvas_edit_intents import CanvasEditIntent, VideoDurationEdit
    from app.services.generation_canvas.edits import free_canvas_edits
    from app.services.generation_canvas.errors import CanvasDomainError

    visible = CanvasDocument(id=str(uuid4()), name='自由草稿', cards=[
        TextContentCard(id='description', text='雨夜'),
        VideoModelCard(id='shot', config={'seconds': 5}, prompt=video_prompt('推镜')),
    ])
    async with database(tmp_path) as sessions, sessions.begin() as db:
        edits = free_canvas_edits(db)
        for intent in (
            CanvasEditIntent('shot', VideoDurationEdit(kind='video_duration'), '5', 'invalid'),
            CanvasEditIntent('unknown', AddCanvasCardTarget(kind='add_canvas_card',
                card=AddCatalogCard(kind='add_catalog_card', card_type='unknown')), '', ''),
        ):
            with pytest.raises(CanvasDomainError) as error:
                await edits.preview_visible_group(visible, 'invalid', [intent], expected_revision=None)
            assert error.value.detail['code'] == 'INVALID_EDIT_VALUE'
        link = CanvasEditIntent('shot', ConnectCardsTarget(kind='connect_cards', connection_id='edge',
            source_card='description', source_port='text', target_card='shot', target_port='text'), '', '')
        preview = await edits.preview_visible_group(visible, 'connect', [link], expected_revision=None)
        assert ('edges', 'edge') in {item.path for item in preview.differences}
        assert (await free_canvas_lifecycle(db).read_free_draft(visible.id)).revision == -1
        await edits.save_free_draft(visible.id, CanvasDraftSave(expected_revision=0, request_id='first', document=visible))
        with pytest.raises(CanvasDomainError) as error:
            await edits.preview_visible_group(visible, 'connect', [link], expected_revision=None)
        assert error.value.detail['code'] == 'REVISION_CONFLICT'
