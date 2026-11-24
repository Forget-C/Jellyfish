"""编辑协议的实际画布读写及回执。"""

import asyncio

import pytest
from fastapi import HTTPException

from app.core.contracts.directing.scene_canvas import SceneCanvasCreate
from app.core.contracts.directing.workspace import SequenceCreate
from app.schemas.generation_canvas import (
    CanvasCreate, CanvasSave, GenerationCanvasEdge, GenerationCanvasGroup, ShotDesignCard, TextContentCard, TextModelCard,
)
from app.services.directing.workspace import WorkspaceService
from app.services.generation_canvas.edits import CanvasEditGroup, CanvasLayoutPoint, canvas_edits
from app.services.generation_canvas.lifecycle import canvas_lifecycle, free_canvas_lifecycle, scene_canvas_lifecycle
from tests.directing.test_store import database
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_preview_is_read_only_and_applied_receipt_survives_reopen(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            free = free_canvas_lifecycle(db)
            canvas = await free.create_free(CanvasCreate(name='雨夜'))
            edits = canvas_edits(db, None)
            plan = await edits.preview(canvas.id, [CanvasEditGroup(
                id='first-shot', cards=[TextContentCard(id='caption', text='街灯倒映在雨水中')],
            )])
            assert (await free.read(canvas.id)).document.cards == []
            assert plan.groups[0].differences[0].path == ('cards', 'caption')
            receipt = await edits.submit(plan, request_id='approved-first')
            assert receipt.groups[0].state == 'applied'
            assert receipt.revision == canvas.revision + 1

        async with sessions.begin() as db:
            edits = canvas_edits(db, None)
            reopened = await free_canvas_lifecycle(db).read(canvas.id)
            assert [(card.id, card.text) for card in reopened.document.cards] == [('caption', '街灯倒映在雨水中')]
            assert await edits.read_receipt(canvas.id, 'approved-first') == receipt
            assert await edits.submit(plan, request_id='approved-first') == receipt
            replay = await edits.submit(plan, request_id='different-decision')
            assert replay.groups[0].state == 'no_change'
            assert replay.revision == receipt.revision


@pytest.mark.asyncio
async def test_preview_resolves_groups_against_dependencies_and_removes_incident_structure(tmp_path):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        free = free_canvas_lifecycle(db)
        canvas = await free.create_free(CanvasCreate(name='街景'))
        edits = canvas_edits(db, None)
        plan = await edits.preview(canvas.id, [
            CanvasEditGroup(id='source', cards=[TextContentCard(id='caption', text='下雨')]),
            CanvasEditGroup(id='target', depends_on=('source',), cards=[TextModelCard(id='model')],
                            edges=[GenerationCanvasEdge(id='line', source_card='caption', source_port='text',
                                                        target_card='model', target_port='text')],
                            groups=[GenerationCanvasGroup(id='shot', name='镜头', card_ids=['caption', 'model'])]),
        ])
        blocked = await edits.submit(plan, request_id='only-dependent', group_ids=('target',))
        assert blocked.groups[0].blocked_by == ('source',)
        assert (await free.read(canvas.id)).document.cards == []
        applied = await edits.submit(plan, request_id='both')
        assert [group.state for group in applied.groups] == ['applied', 'applied']
        stored = await free.read(canvas.id)
        assert [edge.id for edge in stored.document.edges] == ['line']
        assert stored.document.groups[0].card_ids == ['caption', 'model']
        replay = await edits.submit(plan, request_id='replay-both')
        assert [group.state for group in replay.groups] == ['no_change', 'no_change']
        removal = await edits.preview(canvas.id, [CanvasEditGroup(id='remove-source', remove_cards={'caption'})])
        assert {change.path[:2] for change in removal.groups[0].differences} >= {
            ('cards', 'caption'), ('edges', 'line'), ('groups', 'shot'),
        }
        await edits.submit(removal, request_id='remove')
        document = (await free.read(canvas.id)).document
        assert document.edges == []
        assert document.groups[0].card_ids == ['model']


@pytest.mark.asyncio
@pytest.mark.parametrize('project_id', [None, 'p1'])
async def test_editor_save_and_protocol_share_validation_and_field_conflict(tmp_path, project_id):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        if project_id:
            workspace = WorkspaceService(db, project_id)
            chapter = await workspace.list_sequences('ch1')
            scene = await workspace.write_sequence('ch1', SequenceCreate(
                title='店内', position=0, source_version=chapter.source_version, span={'start': 0, 'end': 3}))
            canvas = await scene_canvas_lifecycle(db, project_id).create_canvas(
                'ch1', scene.id, SceneCanvasCreate(name='雨夜', request_id='scene'),
            )
        else:
            canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='雨夜'))
        lifecycle = canvas_lifecycle(db, project_id)
        edits = canvas_edits(db, project_id)
        design = ShotDesignCard(id='shot')
        if project_id:
            proposed = await edits.preview(canvas.id, [CanvasEditGroup(id='design', cards=[design])])
            await edits.submit(proposed, request_id='add-design')
            stored_design = (await lifecycle.read(canvas.id)).document.cards[-1]
            assert stored_design.id == 'shot'
            updated = await edits.preview(canvas.id, [CanvasEditGroup(id='edit-design', cards=[
                stored_design.model_copy(update={'name': '雨夜远景'}),
            ])])
            await edits.submit(updated, request_id='edit-design')
            assert (await lifecycle.read(canvas.id)).document.cards[-1].name == '雨夜远景'
            current = await lifecycle.read(canvas.id)
            edge = GenerationCanvasEdge(id='design-input', source_card='shot', source_port='text',
                                        target_card='model', target_port='text')
            model = TextModelCard(id='model')
            link = await edits.preview(canvas.id, [CanvasEditGroup(id='use-design', cards=[model], edges=[edge])])
            manual_link = current.document.model_copy(update={
                'cards': [*current.document.cards, model],
                'edges': [edge], 'input_order': {'model': {'text': [edge.id]}},
            })
            await edits.save(canvas.id, CanvasSave(request_id='save-design-link', expected_revision=current.revision,
                                                    document=manual_link.model_dump(mode='json')))
            link_replay = await edits.submit(link, request_id='existing-design-link')
            assert link_replay.groups[0].state == 'no_change'
            linked = (await lifecycle.read(canvas.id)).document.cards[-1]
            assert [(binding.id, binding.source.card_id) for binding in linked.input_bindings] == [
                ('design:design-input', 'shot'),
            ]
        else:
            with pytest.raises(HTTPException) as preview_error:
                await edits.preview(canvas.id, [CanvasEditGroup(id='design', cards=[design])])
            with pytest.raises(HTTPException) as editor_error:
                await edits.save(canvas.id, CanvasSave(request_id='save-design', expected_revision=canvas.revision,
                                                       document=canvas.document.model_copy(
                                                           update={'cards': [design]}).model_dump(mode='json')))
            assert preview_error.value.detail == editor_error.value.detail

        initial = await edits.preview(canvas.id, [CanvasEditGroup(
            id='caption', cards=[TextContentCard(id='caption', text='原稿')],
        )])
        await edits.submit(initial, request_id='add-caption')
        plan = await edits.preview(canvas.id, [CanvasEditGroup(
            id='caption', cards=[TextContentCard(id='caption', text='助手改稿')],
        )])
        current = await lifecycle.read(canvas.id)
        manual = current.document.model_copy(deep=True)
        manual.cards[-1].text = '用户改稿'
        saved = await edits.save(canvas.id, CanvasSave(request_id='editor', expected_revision=current.revision,
                                                        document=manual.model_dump(mode='json')))
        conflict = await edits.submit(plan, request_id='old-plan')
        assert conflict.revision == saved['revision']
        assert conflict.groups[0].state == 'conflict'
        values = conflict.groups[0].conflicts[0]
        assert values.difference.before.value == '原稿'
        assert values.current.value == '用户改稿'
        assert values.difference.after.value == '助手改稿'
        assert (await lifecycle.read(canvas.id)).document.cards[-1].text == '用户改稿'


@pytest.mark.asyncio
async def test_explicit_layout_uses_browser_projection_and_conflicts_on_moved_card(tmp_path):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        free = free_canvas_lifecycle(db)
        canvas = await free.create_free(CanvasCreate(name='雨夜'))
        edits = canvas_edits(db, None)
        content = await edits.preview(canvas.id, [CanvasEditGroup(id='caption', cards=[TextContentCard(id='caption')])])
        saved = await edits.submit(content, request_id='caption')
        original = {'caption': CanvasLayoutPoint(x=1, y=2)}
        requested = {'caption': CanvasLayoutPoint(x=5, y=6)}
        plan = await edits.preview_layout(canvas.id, original, requested)
        projected = await edits.project_layout(plan, original)
        assert projected.state == 'projected'
        assert projected.positions == requested
        assert (await edits.project_layout(plan, requested)).state == 'no_change'
        conflict = await edits.project_layout(plan, {'caption': CanvasLayoutPoint(x=10, y=2)})
        assert conflict.state == 'conflict' and conflict.conflicts == ('caption',)
        assert (await free.read(canvas.id)).revision == saved.revision


@pytest.mark.asyncio
async def test_new_incident_edge_conflicts_without_blocking_independent_group(tmp_path):
    async with database(tmp_path) as sessions, sessions.begin() as db:
        free = free_canvas_lifecycle(db)
        canvas = await free.create_free(CanvasCreate(name='雨夜'))
        edits = canvas_edits(db, None)
        base = await edits.preview(canvas.id, [CanvasEditGroup(
            id='base', cards=[TextContentCard(id='caption'), TextModelCard(id='model')],
        )])
        await edits.submit(base, request_id='base')
        plan = await edits.preview(canvas.id, [
            CanvasEditGroup(id='remove', remove_cards={'caption'}),
            CanvasEditGroup(id='third', cards=[TextContentCard(id='third', text='独立改动')]),
        ])
        stored = await free.read(canvas.id)
        new_edge = GenerationCanvasEdge(id='line', source_card='caption', source_port='text',
                                        target_card='model', target_port='text')
        changed = stored.document.model_copy(update={'edges': [new_edge], 'input_order': {'model': {'text': ['line']}}})
        await edits.save(canvas.id, CanvasSave(request_id='manual-edge', expected_revision=stored.revision,
                                               document=changed.model_dump(mode='json')))
        receipt = await edits.submit(plan, request_id='apply-after-link')
        assert [group.state for group in receipt.groups] == ['conflict', 'applied']
        assert receipt.groups[0].diagnostic.code == 'INVALID_ENDPOINT'
        current = (await free.read(canvas.id)).document
        assert [card.id for card in current.cards] == ['caption', 'model', 'third']
        assert current.edges == [new_edge]


@pytest.mark.asyncio
@pytest.mark.parametrize('canvas_client', ['mysql'], indirect=True)
async def test_concurrent_edit_submission_returns_one_original_receipt(canvas_client):
    sessions = canvas_client.canvas_sessions
    async with sessions.begin() as db:
        canvas = await free_canvas_lifecycle(db).create_free(CanvasCreate(name='夜景'))
        plan = await canvas_edits(db, None).preview(canvas.id, [CanvasEditGroup(
            id='first', cards=[TextContentCard(id='caption', text='新镜头')],
        )])

    async def send():
        async with sessions.begin() as db:
            return await canvas_edits(db, None).submit(plan, request_id='same-decision')

    first, retry = await asyncio.gather(send(), send())
    assert first == retry
    async with sessions() as db:
        stored = await free_canvas_lifecycle(db).read(canvas.id)
        assert stored.revision == canvas.revision + 1
        assert [card.id for card in stored.document.cards] == ['caption']
