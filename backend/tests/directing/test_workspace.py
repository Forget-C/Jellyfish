"""阶段二场次范围与 AI 建议采用的服务验收。"""

import pytest

from app.core.contracts.directing.workspace import SequenceCreate, SequenceUpdate, SourceSpan
from app.models.task import Task
from app.services.directing.ai import DirectingAIService, generate_directing_result
from app.services.directing.store import RevisionConflict
from tests.directing.samples import design_sample
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_sequence_excerpt_and_changed_source(tmp_path):
    """场次保留选定摘录，章节修改后显示待核对而不自动改写。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, "p1")
            chapter = await service.list_sequences("ch1")
            body = SequenceCreate(title="店内交谈", position=0, source_version=chapter.source_version, span=SourceSpan(start=0, end=4))
            sequence = await service.write_sequence("ch1", body)
            assert sequence.source_text == "兄弟在店" and not sequence.source_changed
            chapter_row = await service.chapter("ch1")
            chapter_row.raw_text += "，有人经过"
            await db.flush()
            assert (await service.read_sequence(sequence.id)).source_changed
            with pytest.raises(RevisionConflict):
                await service.write_sequence("ch1", SequenceUpdate(**body.model_dump(), expected_version=1), sequence.id)
            workspace = await service.workspace(sequence.id)
            assert workspace.designs == [] and workspace.takes == []


@pytest.mark.asyncio
async def test_late_ai_suggestion_does_not_overwrite_manual_edit(tmp_path):
    """任务身份保留起始版本；采用迟到建议只新增独立草稿。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, "p1")
            sequence = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            sequence_id = sequence.id
            draft = await service.save_revision(sequence_id, kind="design", payload=design_sample())
            draft_id = draft.id
            created_at = (await service.read_revision(draft_id)).created_at
            assert created_at == draft.created_at
            assert created_at is not None
            db.add(Task(id="ai1", kind="directing_design", status="succeeded", project_id="p1", target_type="directing_sequence", target_id=sequence_id,
                        input_snapshot={"run_args": {"starting_revision_id": draft_id, "starting_version": 1, "source": sequence.source, "sequence_version": sequence.version}},
                        result=design_sample("crowd")))
            await db.flush()
            await service.save_revision(sequence_id, kind="design", payload=design_sample("handover"), revision_id=draft_id, expected_version=1)
            assert (await service.read_revision(draft_id)).created_at == created_at
            adopted = await service.apply_design(sequence_id, "ai1")
            assert adopted.id != draft_id
            assert (await service.read_revision(draft_id)).content.direction.information_change.text == "哥哥交出借条，弟弟不接"
            assert len((await service.workspace(sequence_id)).designs) == 2


def test_ai_division_requires_exact_ordered_excerpts():
    """模型改写原文被拒绝，用户仍可使用手动划场入口。"""
    class Response:
        """只用于验证 JSON 处理的模型响应替身。"""
        content = '{"scenes":[{"title":"场次","excerpt":"改写了的原文","purpose":"交谈"}]}'

    class Model:
        """返回固定错误建议，不连接外部模型。"""
        def invoke(self, messages):
            """提供错误摘录供业务验证。"""
            return Response()

    with pytest.raises(ValueError, match="摘录"):
        generate_directing_result("directing_divide", Model(), {"script_text": "兄弟在店中交谈"})


@pytest.mark.asyncio
async def test_scene_reorder_preserves_design_but_source_change_invalidates(tmp_path):
    """顺序互换不改变设计依据；同章节内改摘录使旧设计不可确认。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, "p1")
            chapter = await service.list_sequences("ch1")
            body = SequenceCreate(title="店内", position=0, source_version=chapter.source_version, span=SourceSpan(start=0, end=4))
            first = await service.write_sequence("ch1", body)
            second = await service.write_sequence("ch1", body.model_copy(update={"position": 1, "span": SourceSpan(start=5, end=7)}))
            draft = await service.save_revision(first.id, kind="design", payload=design_sample())
            moved = await service.write_sequence("ch1", SequenceUpdate(**{**body.model_dump(), "position": 1}, expected_version=first.version), first.id)
            assert (await service.read_sequence(second.id)).position == 0
            assert (await service.read_revision(draft.id)).source_current
            await service.write_sequence("ch1", SequenceUpdate(**{**body.model_dump(), "position": 1, "span": SourceSpan(start=1, end=5)}, expected_version=moved.version), first.id)
            assert not (await service.read_revision(draft.id)).source_current
            with pytest.raises(RevisionConflict, match="范围"):
                await service.confirm_revision(draft.id, expected_version=1, actor_id="author")


@pytest.mark.asyncio
async def test_old_workspace_cannot_relabel_design_with_new_source(tmp_path):
    """旧页面不可以把旧设计重新登记为最新范围，必须刷新后明确核对。"""
    from app.core.contracts.directing.workspace import RevisionWrite, DesignWrite
    from app.core.contracts.directing.design import SceneDesign
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, "p1")
            scene = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            await service.update_sequence(scene.id, expected_version=1, title="新标题", position=0)
            with pytest.raises(RevisionConflict, match="变化"):
                await service.save_workspace_revision(scene.id, RevisionWrite(sequence_version=1,
                    document=DesignWrite(kind="design", content=SceneDesign.model_validate(design_sample()))))


def test_ai_repairs_semantic_schema_error_once():
    """JSON Schema 外的 Note 状态规则反馈给模型，修正后仍严格校验。"""
    import copy
    import json
    from types import SimpleNamespace

    valid = design_sample()
    invalid = copy.deepcopy(valid)
    invalid['direction']['viewpoint']['state'] = 'unknown'
    calls = []

    class Model:
        """先返回不合法状态，再返回符合契约的完整设计。"""

        def invoke(self, messages):
            """记录第二次请求包含校验反馈，而非默默删除内容。"""
            calls.append(list(messages))
            return SimpleNamespace(content=json.dumps(invalid if len(calls) == 1 else valid))

    result = generate_directing_result('directing_design', Model(), {'script_text': '兄弟在店中交谈'})
    assert result.direction.viewpoint.state == valid['direction']['viewpoint']['state']
    assert len(calls) == 2
    assert 'non-content state cannot carry text' in calls[1][-1].content
    assert '"input"' not in calls[1][-1].content


def test_ai_structure_repair_is_bounded_and_error_omits_body():
    """持续错误最多调用两次，用户错误不包含模型原始正文。"""
    from types import SimpleNamespace
    from app.services.directing.errors import DirectingOutputError

    calls = []

    class Model:
        """持续返回无法解析的正文。"""

        def invoke(self, messages):
            """模拟不可恢复的格式错误。"""
            calls.append(messages)
            return SimpleNamespace(content='private response body')

    with pytest.raises(DirectingOutputError, match='结构校验失败') as error:
        generate_directing_result('directing_design', Model(), {})
    assert len(calls) == 2
    assert 'private response body' not in str(error.value)


def test_design_reports_all_dangling_references_together():
    """一次给出各部门的关联错误，模型纠错无需多轮逐个发现。"""
    from pydantic import ValidationError
    from app.core.contracts.directing.design import SceneDesign

    payload = design_sample()
    payload['direction']['shots'][0]['beat_ids'] = ['missing_beat']
    payload['cinematography'][0]['shot_id'] = 'missing_shot'
    with pytest.raises(ValidationError) as error:
        SceneDesign.model_validate(payload)
    assert 'missing_beat' in str(error.value)
    assert 'missing_shot' in str(error.value)


@pytest.mark.asyncio
async def test_chapter_overview_empty_and_project_isolation(tmp_path):
    """空章节保留身份，其他项目不能读取其概览。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, 'p1')
            overview = await service.chapter_overview('ch1')
            assert overview.chapter_id == 'ch1' and overview.title == '借钱'
            assert overview.sequences == []
            with pytest.raises(ValueError, match='章节'):
                await DirectingAIService(db, 'p2').chapter_overview('ch1')


@pytest.mark.asyncio
async def test_chapter_overview_counts_order_source_and_active_cut(tmp_path):
    """整场统计不受计划选择影响，采用指针不被最新草稿代替。"""
    from tests.directing.samples import plan_sample
    from tests.directing.test_store import setup_story, output, frozen

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, scene_id, design_id, _, prompts = await setup_story(db)
            service = DirectingAIService(db, 'p1')
            await store.save_revision(scene_id, kind='design', payload=design_sample())
            plan = await frozen(store, scene_id, 'plan', plan_sample(design_id))
            await store.save_revision(scene_id, kind='plan', payload=plan_sample(design_id))
            prompt = await frozen(store, scene_id, 'prompt', dict((await store.revision(prompts[0])).payload, plan_revision_id=plan.id))
            for index, prompt_id in enumerate([prompts[0], prompt.id]):
                await output(db, prompt_id, task_id=f'overview{index}')
                take = await store.register_take(prompt_revision_id=prompt_id, task_id=f'overview{index}', output_ordinal=0)
            await store.annotate_take(take.id, expected_version=1, annotation=dict(take.annotation, review_status='reviewed', verdict='discard'))
            cut = await frozen(store, scene_id, 'cut', {'items': []})
            await store.save_revision(scene_id, kind='cut', payload={'items': []})
            chapter = await service.chapter('ch1')
            chapter.raw_text = '新原文' * 100
            await db.flush()
            last = await service.create_sequence(chapter_id='ch1', title='后场', position=2)
            middle = await service.create_sequence(chapter_id='ch1', title='中场', position=1)
            overview = await service.chapter_overview('ch1')
            assert [row.id for row in overview.sequences] == [scene_id, middle.id, last.id]
            first = overview.sequences[0]
            assert first.source_excerpt == '兄弟在店中交谈' and first.source_changed
            assert not overview.sequences[-1].source_changed
            assert len(overview.sequences[-1].source_excerpt) == 160
            assert (first.design_count, first.confirmed_design_count) == (2, 1)
            assert (first.plan_count, first.confirmed_plan_count) == (3, 2)
            assert (first.take_count, first.unreviewed_take_count) == (2, 1)
            assert first.active_cut_revision_id == cut.id
            assert overview.sequences[-1].active_cut_revision_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize('invalid', ['draft', 'kind', 'owner', 'payload'])
async def test_chapter_overview_rejects_invalid_active_cut(tmp_path, invalid):
    """损坏的采用指针必须报错，不能显示为空。"""
    from datetime import datetime
    from app.models.directing import ActiveCut, DirectingRevision

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, 'p1')
            scene = await service.create_sequence(chapter_id='ch1', title='一', position=0)
            other = await service.create_sequence(chapter_id='ch1', title='二', position=1)
            revision = DirectingRevision(id='bad-cut', sequence_id=other.id if invalid == 'owner' else scene.id,
                kind='design' if invalid == 'kind' else 'cut', payload={} if invalid == 'payload' else {'items': []},
                confirmed_at=None if invalid == 'draft' else datetime.now(), confirmed_by=None if invalid == 'draft' else 'author')
            db.add(revision)
            await db.flush()
            db.add(ActiveCut(sequence_id=scene.id, revision_id=revision.id))
            await db.flush()
            with pytest.raises(ValueError):
                await service.chapter_overview('ch1')


@pytest.mark.asyncio
async def test_chapter_overview_rejects_invalid_take_annotation(tmp_path):
    """未审计数使用类型契约，不能容忍审查状态和结论矛盾。"""
    from tests.directing.test_store import setup_story, output

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            store, _, _, _, prompts = await setup_story(db)
            await output(db, prompts[0])
            take = await store.register_take(prompt_revision_id=prompts[0], task_id='task1', output_ordinal=0)
            take.annotation = dict(take.annotation, review_status='reviewed')
            await db.flush()
            with pytest.raises(ValueError, match='review status and verdict disagree'):
                await DirectingAIService(db, 'p1').chapter_overview('ch1')


@pytest.mark.asyncio
async def test_chapter_overview_query_count_is_constant(tmp_path):
    """一场和三十场均批量读取，不逐场获取工作区或版本正文。"""
    from sqlalchemy import event

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, 'p1')
            await service.create_sequence(chapter_id='ch1', title='一', position=0)
            queries = []
            def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
                queries.append(statement)
            event.listen(db.bind.sync_engine, 'before_cursor_execute', capture)
            try:
                await service.chapter_overview('ch1')
                first_count = len(queries)
                for position in range(1, 30):
                    await service.create_sequence(chapter_id='ch1', title=str(position), position=position)
                queries.clear()
                overview = await service.chapter_overview('ch1')
                assert len(overview.sequences) == 30
                assert len(queries) == first_count == 5
                assert 'payload' not in queries[2]
            finally:
                event.remove(db.bind.sync_engine, 'before_cursor_execute', capture)


@pytest.mark.asyncio
async def test_range_conflicts_unicode_adjacency_and_metadata(tmp_path):
    """连续范围互斥且可相邻，纯改名保留旧来源；历史冲突不会阻止无关更新。"""
    from sqlalchemy import update
    from app.models.directing import Sequence
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = DirectingAIService(db, 'p1')
            chapter_row = await service.chapter('ch1')
            chapter_row.raw_text = '她😀推门。\n她😀推门。  '
            await db.flush()
            chapter = await service.list_sequences('ch1')
            def body(start, end, position):
                return SequenceCreate(title=f'场次{position}', position=position, source_version=chapter.source_version,
                                      span=SourceSpan(start=start, end=end))
            first = await service.write_sequence('ch1', body(0, 5, 0))
            assert first.source_text == '她😀推门。'
            with pytest.raises(RevisionConflict, match='重叠'):
                await service.write_sequence('ch1', body(4, 7, 1))
            second = await service.write_sequence('ch1', body(5, 11, 1))
            assert second.source_text == '\n她😀推门。'
            for start, end, error in [(11, 13, '正文'), (12, 14, '超出')]:
                with pytest.raises(ValueError, match=error):
                    await service.write_sequence('ch1', body(start, end, 2))
            with pytest.raises(RevisionConflict, match='重叠'):
                await service.write_sequence('ch1', SequenceUpdate(**body(4, 11, 1).model_dump(), expected_version=1), second.id)
            # 模拟既有重叠数据，只改名称不能被迫承担历史修复。
            await db.execute(update(Sequence).where(Sequence.id == second.id).values(source_start=4))
            renamed = await service.write_sequence('ch1', SequenceUpdate(title='改名', position=0,
                source_version=chapter.source_version, expected_version=1), first.id)
            assert renamed.span == first.span and renamed.source == first.source
            chapter_row.raw_text = '新增前缀' + chapter_row.raw_text
            await db.flush()
            chapter = await service.list_sequences('ch1')
            renamed = await service.write_sequence('ch1', SequenceUpdate(title='再次改名', position=0,
                source_version=chapter.source_version, expected_version=renamed.version, span=None), first.id)
            assert renamed.source_changed and renamed.source_text == first.source_text and renamed.span == first.span
            # 旧偏移不参与新版本重叠判断；重新核对时仍受当前范围约束。
            third = await service.write_sequence('ch1', body(0, 4, 2))
            with pytest.raises(RevisionConflict, match='重叠'):
                await service.write_sequence('ch1', SequenceUpdate(**body(0, 5, 0).model_dump(), expected_version=renamed.version), first.id)
            assert third.source_text == '新增前缀'
