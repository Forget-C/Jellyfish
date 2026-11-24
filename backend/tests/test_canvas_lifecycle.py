"""普通后端调用方在真实事务中管理画布。"""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.core.contracts.directing.scene_canvas import SceneCanvasCreate
from app.core.contracts.directing.workspace import SequenceCreate
from app.models.llm import Model, Provider
from app.schemas.generation_canvas import CanvasCreate
from app.services.directing.workspace import WorkspaceService
from app.services.generation_canvas.lifecycle import canvas_lifecycle, free_canvas_lifecycle, scene_canvas_lifecycle
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_free_canvas_lifecycle_without_assistant(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            free = free_canvas_lifecycle(db)
            assert (await free.read_free_draft(str(uuid4()))).revision == -1
            created = await free.create_free(CanvasCreate(name='夜景'))
            renamed = await free.rename(created.id, '门外夜景', created.revision)
            assert renamed.document.name == '门外夜景'

        async with sessions.begin() as db:
            free = free_canvas_lifecycle(db)
            reopened = await free.read(created.id)
            assert reopened.document.name == '门外夜景'
            summaries, total = await free.summaries(q='夜景', page=1, page_size=10)
            assert total == 1
            assert [item.id for item in summaries] == [created.id]
            catalog = await free.catalog(created.id)
            assert 'model.video' in {card.type for card in catalog.cards}
            assert not any(card.type.startswith('direction.') for card in catalog.cards)
            await free.delete(created.id, expected_revision=reopened.revision)

        async with sessions() as db:
            with pytest.raises(HTTPException) as missing:
                await free_canvas_lifecycle(db).read(created.id)
            assert missing.value.status_code == 404


@pytest.mark.asyncio
async def test_scene_canvas_lifecycle_uses_actual_scene_and_project(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            workspace = WorkspaceService(db, 'p1')
            chapter = await workspace.list_sequences('ch1')
            scene = await workspace.write_sequence('ch1', SequenceCreate(
                title='店内', position=0, source_version=chapter.source_version, span={'start': 0, 'end': 3}))
            db.add(Provider(id='provider', provider_key='openai', name='OpenAI', base_url='https://example.test'))
            await db.flush()
            db.add(Model(id='text-model', name='LLM', category='text', provider_id='provider'))
            preparation = scene_canvas_lifecycle(db, 'p1')
            command = SceneCanvasCreate(name='固定原文分镜', request_id='create-scene')
            created = await preparation.create_canvas('ch1', scene.id, command)
            assert (await preparation.create_canvas('ch1', scene.id, command)).id == created.id

        async with sessions.begin() as db:
            scene_canvases = scene_canvas_lifecycle(db, 'p1')
            listing = await scene_canvases.read_canvases('ch1', scene.id)
            assert [canvas.id for canvas in listing.canvases] == [created.id]
            canvas = canvas_lifecycle(db, 'p1')
            current = await canvas.read(created.id)
            assert current.scene.sequence_id == scene.id
            assert current.document.cards[0].text == '兄弟在'
            assert 'direction.shot' in {card.type for card in (await canvas.catalog(created.id)).cards}
            model = await canvas.model_capability(created.id, 'text-model')
            assert model.modality == 'text' and model.input_ports == ['text']

            with pytest.raises(HTTPException) as wrong_project:
                await canvas_lifecycle(db, 'p2').catalog(created.id)
            assert wrong_project.value.status_code == 404
            with pytest.raises(HTTPException) as wrong_chapter:
                await scene_canvas_lifecycle(db, 'p2').read_canvases('ch2', scene.id)
            assert wrong_chapter.value.status_code == 404
            with pytest.raises(HTTPException) as outside_free:
                await free_canvas_lifecycle(db).read(created.id)
            assert outside_free.value.status_code == 404

            await canvas.delete(created.id, expected_revision=current.revision)
            assert not (await scene_canvases.read_canvases('ch1', scene.id)).canvases
