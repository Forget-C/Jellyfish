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
            db.add(Task(id="ai1", kind="directing_design", status="succeeded", project_id="p1", target_type="directing_sequence", target_id=sequence_id,
                        input_snapshot={"run_args": {"starting_revision_id": draft_id, "starting_version": 1, "source": sequence.source, "sequence_version": sequence.version}},
                        result=design_sample("crowd")))
            await db.flush()
            await service.save_revision(sequence_id, kind="design", payload=design_sample("handover"), revision_id=draft_id, expected_version=1)
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
            second = await service.write_sequence("ch1", body.model_copy(update={"position": 1}))
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
    from app.services.directing.ai import DirectingOutputError

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
