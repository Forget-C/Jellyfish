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
