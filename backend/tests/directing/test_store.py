"""真实数据库事务验证阶段一关系，不使用模型输出模拟持久化。"""

from contextlib import asynccontextmanager
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.directing import DirectingRevision, Take, CutTakeReference
from app.models.studio import Project, Chapter, FileItem, FileUsage
from app.models.task import Task, TaskOutput
from app.services.directing.store import DirectingStore, RevisionConflict
from app.services.studio.files import delete_file
from tests.directing.samples import SOURCE, design_sample, plan_sample
from tests.directing.test_contracts import review_sample


@asynccontextmanager
async def database(tmp_path):
    """每例使用独立数据库并启用 SQLite 外键，不触及应用数据库。"""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'directing.sqlite'}")

    @event.listens_for(engine.sync_engine, "connect")
    def foreign_keys(connection, record):
        """SQLite 默认关闭外键，验收时显式启用。"""
        connection.execute("PRAGMA foreign_keys=ON")

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with sessions.begin() as db:
            db.add_all([Project(id="p1", name="film", style="真人都市"), Project(id="p2", name="other", style="真人都市")])
            await db.flush()
            db.add_all([Chapter(id="ch1", project_id="p1", index=1, title="借钱", raw_text="兄弟在店中交谈"),
                        Chapter(id="ch2", project_id="p2", index=1, title="另一项目")])
            db.add_all([FileItem(id="image1", type="image", name="空间图", storage_key="files/space.png"),
                        FileItem(id="video1", type="video", name="试拍", storage_key="files/take.mp4", duration_ms=9000),
                        FileItem(id="video2", type="video", name="再试拍", storage_key="files/take2.mp4", duration_ms=9000)])
        yield sessions
    finally:
        await engine.dispose()


async def frozen(store, sequence_id, kind, payload):
    """通过服务的人工作用域确认版本，保持依赖不可变。"""
    row = await store.save_revision(sequence_id, kind=kind, payload=payload)
    return await store.confirm_revision(row.id, expected_version=row.version, actor_id="author")


async def setup_story(db, story="dialogue"):
    """建立同场次设计、两单元计划和两个提示词，参考只绑定本次需要的图。"""
    store = DirectingStore(db, "p1")
    sequence = await store.create_sequence(chapter_id="ch1", title="店内", position=0)
    design = await frozen(store, sequence.id, "design", design_sample(story))
    plan_data = plan_sample(design.id)
    plan_data["units"][0]["references"] = [{"id": "r1", "file_id": "image1", "media_kind": "image", "purpose": "space",
                                          "participant_ids": [], "ordinal": 0, "source": SOURCE}]
    plan = await frozen(store, sequence.id, "plan", plan_data)
    prompts = []
    for unit_id in ("u1", "u2"):
        prompts.append(await frozen(store, sequence.id, "prompt", {
            "plan_revision_id": plan.id, "unit_id": unit_id, "format_version": "fixture-1", "text": "纸张保持在桌上。弟弟先停手再看门。",
            "sources": [SOURCE], "decisions": [{"section_path": "/direction/viewpoint", "disposition": "text",
                                                 "explanation": "保留观察视点", "text_excerpt": "弟弟先停手再看门"}],
        }))
    return store, sequence.id, design.id, plan.id, [r.id for r in prompts]


async def output(db, prompt_id, task_id="task1", file_id="video1"):
    """以明确提示词版本创建已完成任务输出；不调用供应商。"""
    db.add(Task(id=task_id, kind="video", project_id="p1", status="succeeded", input_snapshot={"prompt_revision_id": prompt_id}))
    await db.flush()
    db.add(TaskOutput(task_id=task_id, ordinal=0, file_id=file_id))
    await db.flush()


@pytest.mark.asyncio
@pytest.mark.parametrize("story", ["dialogue", "handover", "crowd"])
async def test_persist_full_story_and_partial_cut(tmp_path, story):
    """三故事完成读写、同单元多 Take、局部采用和未采用素材并存。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, design_id, plan_id, prompts = await setup_story(db, story)
            await output(db, prompts[0])
            first = await store.register_take(prompt_revision_id=prompts[0], task_id="task1", output_ordinal=0)
            again = await store.register_take(prompt_revision_id=prompts[0], task_id="task1", output_ordinal=0)
            assert first.id == again.id
            await output(db, prompts[0], "task2", "video2")
            second = await store.register_take(prompt_revision_id=prompts[0], task_id="task2", output_ordinal=0)
            assert first.unit_id == second.unit_id == "u1" and first.id != second.id
            annotation = {"coverage": [{"id": "observed", "coverage_item_id": "c2", "media_range": {"source_in_ms": 4000, "source_out_ms": 7000},
                                         "observation": "弟弟停手成立，末尾纸张丢失", "source": {"kind": "file", "reference": first.id, "version": "1", "file_id": first.file_id,
                                                                                                   "media_range": {"source_in_ms": 4000, "source_out_ms": 7000}}}],
                          "review_status": "reviewed", "verdict": "retain", "rationale": {"state": "proposal", "text": "保留中段", "sources": [SOURCE]},
                          "retained_ranges": [{"source_in_ms": 4000, "source_out_ms": 7000}]}
            await store.annotate_take(first.id, expected_version=1, annotation=annotation)
            cut = await frozen(store, sequence_id, "cut", {"items": [
                {"kind": "planned", "id": "preview", "design_revision_id": design_id, "shot_id": "s1", "estimated_duration_ms": 4000, "timeline_start_ms": 0},
                {"kind": "media", "id": "clip", "take_id": first.id, "media_range": {"source_in_ms": 4000, "source_out_ms": 7000}, "timeline_start_ms": 4000}]})
            assert await db.scalar(select(func.count()).select_from(CutTakeReference)) == 1
            assert await db.scalar(select(func.count()).select_from(Take)) == 2
            cut_id, first_id = cut.id, first.id
        async with sessions() as db:
            store = DirectingStore(db, "p1")
            design = await store.revision(design_id)
            assert design.payload["performance"]["beats"][0]["physical_action"]["text"] == design_sample(story)["performance"]["beats"][0]["physical_action"]["text"]
            assert (await store.revision(cut_id)).payload["items"][1]["media_range"]["source_in_ms"] == 4000
            assert (await store.take(first_id)).annotation["verdict"] == "retain"
            assert await db.scalar(select(func.count()).select_from(FileUsage).where(FileUsage.file_id == "image1")) >= 2
            for file_id in ("image1", "video1", "video2"):
                with pytest.raises(HTTPException) as error:
                    await delete_file(db, file_id=file_id)
                assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_draft_cas_freeze_fork_and_project_isolation(tmp_path):
    """独立会话的过期版本失败，冻结版本不改写，派生保留旧真值。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store = DirectingStore(db, "p1")
            sequence = await store.create_sequence(chapter_id="ch1", title="场次", position=0)
            sequence_id = sequence.id
            draft = await store.save_revision(sequence_id, kind="design", payload=design_sample())
            draft_id = draft.id
        async with sessions.begin() as db:
            store = DirectingStore(db, "p1")
            await store.save_revision(sequence_id, kind="design", payload=design_sample("handover"), revision_id=draft_id, expected_version=1)
        async with sessions.begin() as db:
            store = DirectingStore(db, "p1")
            with pytest.raises(RevisionConflict):
                await store.save_revision(sequence_id, kind="design", payload=design_sample("crowd"), revision_id=draft_id, expected_version=1)
            confirmed = await store.confirm_revision(draft_id, expected_version=2, actor_id="author")
            assert confirmed.confirmed_by == "author"
            with pytest.raises(RevisionConflict):
                await store.save_revision(sequence_id, kind="design", payload=design_sample(), revision_id=draft_id, expected_version=3)
            fork = await store.save_revision(sequence_id, kind="design", payload=design_sample("crowd"), parent_id=draft_id)
            assert fork.id != draft_id and fork.parent_id == draft_id and fork.confirmed_at is None
            assert (await store.revision(draft_id)).payload["direction"]["information_change"]["text"] == "哥哥交出借条，弟弟不接"
            other = DirectingStore(db, "p2")
            with pytest.raises(ValueError, match="project"):
                await other.revision(draft_id)
            with pytest.raises(ValueError, match="project"):
                await other.create_sequence(chapter_id="ch1", title="跨项目", position=1)
            with pytest.raises(RevisionConflict):
                await store.update_sequence(sequence_id, expected_version=99, title="迟到", position=0)
            await store.update_sequence(sequence_id, expected_version=1, title="新标题", position=0)
            assert (await store.sequence(sequence_id)).title == "新标题"


@pytest.mark.asyncio
async def test_invalid_plan_media_and_version_links_rollback(tmp_path):
    """错版、错类型和未知镜头不产生部分写入或文件使用残留。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, design_id, plan_id, prompts = await setup_story(db)
            original_count = await db.scalar(select(func.count()).select_from(DirectingRevision))
            original_usages = await db.scalar(select(func.count()).select_from(FileUsage))
            plan = deepcopy((await store.revision(plan_id)).payload)
            plan["units"][0]["coverage"][0]["shot_id"] = "other-version"
            with pytest.raises(ValueError, match="shot"):
                await store.save_revision(sequence_id, kind="plan", payload=plan)
            plan = deepcopy((await store.revision(plan_id)).payload)
            plan["units"][0]["references"][0]["file_id"] = "video1"
            with pytest.raises(HTTPException) as error:
                await store.save_revision(sequence_id, kind="plan", payload=plan)
            assert error.value.status_code == 422
            other_sequence = await store.create_sequence(chapter_id="ch1", title="其他场", position=1)
            with pytest.raises(ValueError, match="another sequence"):
                await store.save_revision(other_sequence.id, kind="plan", payload=plan_sample(design_id))
            assert await db.scalar(select(func.count()).select_from(DirectingRevision)) == original_count
            assert await db.scalar(select(func.count()).select_from(FileUsage)) == original_usages


@pytest.mark.asyncio
async def test_review_versions_and_actual_duration(tmp_path):
    """持久化审稿严格对应冻结提示词；真实素材越界或错证据不可保存。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, design_id, plan_id, prompts = await setup_story(db)
            packet = review_sample()
            for occurrence in packet["occurrences"]:
                occurrence["prompt_revision_id"] = prompts[0] if occurrence["prompt_revision_id"] == "p1" else prompts[1]
                occurrence["plan_revision_id"] = plan_id
            review = await frozen(store, sequence_id, "review", packet)
            assert len((await store.revision(review.id)).payload["rows"]) == 18
            bad = deepcopy(packet)
            bad["occurrences"][2]["prompt_revision_id"] = prompts[0]
            with pytest.raises(ValueError):
                await store.save_revision(sequence_id, kind="review", payload=bad)
            await output(db, prompts[0])
            take = await store.register_take(prompt_revision_id=prompts[0], task_id="task1", output_ordinal=0)
            take_id = take.id
            with pytest.raises(ValueError, match="duration"):
                await store.save_revision(sequence_id, kind="cut", payload={"items": [{"kind": "media", "id": "x", "take_id": take_id,
                    "media_range": {"source_in_ms": 8000, "source_out_ms": 9500}, "timeline_start_ms": 0}]})
            wrong = {"coverage": [{"id": "c", "coverage_item_id": "c1", "media_range": {"source_in_ms": 0, "source_out_ms": 1000}, "observation": "可用", "source": SOURCE}],
                     "review_status": "reviewed", "verdict": "pass", "rationale": {}, "retained_ranges": []}
            with pytest.raises(ValueError, match="matching Take"):
                await store.annotate_take(take_id, expected_version=1, annotation=wrong)
            assert (await store.take(take_id)).version == 1
            with pytest.raises(ValueError, match="prompt revision"):
                await store.register_take(prompt_revision_id=prompts[1], task_id="task1", output_ordinal=0)


@pytest.mark.asyncio
async def test_unconfirmed_sources_and_deleted_files_are_not_dependencies(tmp_path):
    """人工事实无需提取任务，但错原文版本、未确认设计和已删媒体被拒绝。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store = DirectingStore(db, "p1")
            sequence = await store.create_sequence(chapter_id="ch1", title="场次", position=0)
            sequence_id = sequence.id
            draft = await store.save_revision(sequence_id, kind="design", payload=design_sample())
            draft_id = draft.id
            with pytest.raises(ValueError, match="confirmed"):
                await store.save_revision(sequence_id, kind="plan", payload=plan_sample(draft_id))
            data = design_sample()
            data["sources"] = [{"kind": "chapter", "reference": "ch1", "version": "wrong"}]
            with pytest.raises(ValueError, match="source version"):
                await store.save_revision(sequence_id, kind="design", payload=data)
            await store.confirm_revision(draft_id, expected_version=1, actor_id="author")
            await delete_file(db, file_id="image1")
            plan = plan_sample(draft_id)
            plan["units"][0]["references"] = [{"id": "r", "file_id": "image1", "media_kind": "image", "purpose": "space", "participant_ids": [], "ordinal": 0, "source": SOURCE}]
            with pytest.raises(HTTPException) as error:
                await store.save_revision(sequence_id, kind="plan", payload=plan)
            assert error.value.status_code == 410


@pytest.mark.asyncio
async def test_draft_reference_replacement_and_annotation_conflict(tmp_path):
    """只释放被修改草稿的引用；旧冻结参考和 Take 仍受保护。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, design_id, plan_id, prompts = await setup_story(db)
            data = deepcopy((await store.revision(plan_id)).payload)
            draft = await store.save_revision(sequence_id, kind="plan", payload=data, parent_id=plan_id)
            draft_id = draft.id
            assert await db.scalar(select(func.count()).select_from(FileUsage).where(FileUsage.source_ref == draft_id)) == 1
            data["units"][0]["references"] = []
            await store.save_revision(sequence_id, kind="plan", payload=data, revision_id=draft_id, expected_version=1)
            assert await db.scalar(select(func.count()).select_from(FileUsage).where(FileUsage.source_ref == draft_id)) == 0
            assert await db.scalar(select(func.count()).select_from(FileUsage).where(FileUsage.source_ref == plan_id)) == 1
            await output(db, prompts[0])
            take = await store.register_take(prompt_revision_id=prompts[0], task_id="task1", output_ordinal=0)
            take_id = take.id
            data = deepcopy(take.annotation)
            data["review_status"], data["verdict"] = "reviewed", "repair"
            await store.annotate_take(take_id, expected_version=1, annotation=data)
            with pytest.raises(RevisionConflict):
                await store.annotate_take(take_id, expected_version=1, annotation=data)
            assert (await store.read_take(take_id)).annotation.verdict == "repair"
            assert await db.scalar(select(func.count()).select_from(CutTakeReference)) == 0


@pytest.mark.asyncio
async def test_planned_card_image_and_dialogue_keep_frozen_dependencies(tmp_path):
    """预演图必须属于项目，落点引用镜头对白，派生修改不改变旧版。"""
    from app.services.studio.file_usages import upsert_file_usage

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, design_id, _, _ = await setup_story(db)
            item = {'kind': 'planned', 'id': 'card1', 'design_revision_id': design_id, 'shot_id': 's2',
                    'estimated_duration_ms': 4000, 'timeline_start_ms': 0, 'preview_file_id': 'image1',
                    'dialogue_cues': [{'dialogue_id': 'd1', 'offset_ms': 1000}]}
            row = await frozen(store, sequence_id, 'cut', {'items': [item]})
            changed = deepcopy(item)
            changed['estimated_duration_ms'] = 5000
            derived = await store.save_revision(sequence_id, kind='cut', payload={'items': [changed]}, parent_id=row.id)
            assert (await store.revision(row.id)).payload['items'][0]['estimated_duration_ms'] == 4000
            assert derived.parent_id == row.id
            for updates, error in [({'shot_id': 's1'}, 'planned dialogue'),
                                   ({'dialogue_cues': [{'dialogue_id': 'd1', 'offset_ms': 4000}]}, 'inside planned'),
                                   ({'preview_file_id': 'video1'}, 'image')]:
                with pytest.raises((ValueError, HTTPException), match=error):
                    await store.save_revision(sequence_id, kind='cut', payload={'items': [{**item, **updates}]})
            db.add(FileItem(id='foreign-image', type='image', name='other', storage_key='other.png'))
            await db.flush()
            await upsert_file_usage(db, file_id='foreign-image', project_id='p2', chapter_id='ch2', usage_kind='upload')
            with pytest.raises(ValueError, match='not linked'):
                await store.save_revision(sequence_id, kind='cut', payload={'items': [{**item, 'preview_file_id': 'foreign-image'}]})


@pytest.mark.asyncio
async def test_scoped_display_numbers_survive_reordering_and_retries(tmp_path):
    """编号按单元分配且持久保存；读顺序、正文相同和重试不改变原身份。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, sequence_id, _, _, prompts = await setup_story(db)
            first = await store.read_revision(prompts[0])
            other = await store.read_revision(prompts[1])
            assert first.display_number == other.display_number == 1
            second = await frozen(store, sequence_id, "prompt", first.content.model_dump(mode="json"))
            assert second.display_number == 2
            assert (await store.read_revision(first.id)).display_number == 1
            await output(db, first.id)
            take = await store.register_take(prompt_revision_id=first.id, task_id="task1", output_ordinal=0)
            retry = await store.register_take(prompt_revision_id=first.id, task_id="task1", output_ordinal=0)
            assert take.id == retry.id and take.display_number == retry.display_number == 1
            await output(db, second.id, "task2", "video2")
            next_take = await store.register_take(prompt_revision_id=second.id, task_id="task2", output_ordinal=0)
            assert next_take.display_number == 2
            first_id, second_id, take_id = first.id, second.id, take.id
        async with sessions.begin() as db:
            restored = DirectingStore(db, "p1")
            assert (await restored.read_revision(second_id)).display_number == 2
            assert (await restored.read_revision(first_id)).display_number == 1
            assert (await restored.read_take(take_id)).display_number == 1
