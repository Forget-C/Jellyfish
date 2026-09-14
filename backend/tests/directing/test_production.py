"""固定输入、六岗覆盖、幂等提交与候选交付的离线业务验证。"""

import pytest
from sqlalchemy import func, select

from app.core.contracts.directing.common import ROLES
from app.models.directing import Take, DirectingAction, CutTakeReference
from app.models.llm import Model, Provider
from app.models.task import TaskInput
from app.services.directing.production import ProductionService
from app.services.generation.media_execution import deliver_media
from app.services.task_service import TaskService
from tests.directing.samples import design_sample, plan_sample
from tests.directing.test_store import database, frozen


async def prepare(db):
    """明确拆为单镜试拍，供应商配置只供离线提交验证。"""
    db.add(Provider(id="provider1", name="OpenAI", base_url="https://example.invalid/v1", api_key="test-only", status="active"))
    await db.flush()
    db.add(Model(id="model1", name="sora-test", category="video", provider_id="provider1", params={}))
    await db.flush()
    service = ProductionService(db, "p1")
    sequence = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
    design = await frozen(service, sequence.id, "design", design_sample())
    data = plan_sample(design.id)
    data["units"][0]["coverage"] = data["units"][0]["coverage"][:1]
    data["units"][0]["references"] = [{"id": "r1", "file_id": "image1", "purpose": "composition", "media_kind": "image",
                                       "participant_ids": [], "ordinal": 0, "input_role": "first_frame",
                                       "source": {"kind": "human", "reference": "author", "version": "1"}}]
    plan = await frozen(service, sequence.id, "plan", data)
    prompt = await service.compile_unit(sequence.id, plan.id, "u1")
    packet = {"mode": "formal", "roles": list(ROLES), "context": {},
              "occurrences": [{"id": "o1", "prompt_revision_id": prompt.id, "plan_revision_id": plan.id,
                               "unit_id": "u1", "coverage_item_id": "c1", "shot_id": "s1", "local_number": 1}],
              "rows": [{"role": role, "occurrence_id": "o1", "verdict": "pass", "rationale": "离线用例检查通过", "findings": []} for role in ROLES]}
    review = await frozen(service, sequence.id, "review", packet)
    return service, sequence.id, plan.id, prompt.id, review.id


@pytest.mark.asyncio
async def test_frozen_submission_and_candidate_delivery(tmp_path):
    """提交完全固定的文本和媒体；重复请求/终态不重复 Take、不自动剪辑。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, prompt_id, review_id = await prepare(db)
            task = await service.shoot(sequence_id, prompt_id=prompt_id, review_id=review_id, request_id="request1")
            task_id = task.id
            assert task.project_id == "p1" and task.target_type == "directing_unit"
            assert task.input_snapshot["prompt_revision_id"] == prompt_id
            assert task.input_snapshot["execution_prompt"] == (await service.revision(prompt_id)).payload["text"]
            assert (await service.shoot(sequence_id, prompt_id=prompt_id, review_id=review_id, request_id="request1")).id == task_id
            inputs = list(await db.scalars(select(TaskInput).where(TaskInput.task_id == task_id)))
            assert [(r.role_path, r.file_id) for r in inputs] == [("frames.first", "image1")]
            tasks = TaskService(db)
            await tasks.claim(task_id, worker_id="worker")
            await tasks.add_output(task_id, ordinal=0, file_id="video1")
            await tasks.finish(task_id, deliver=deliver_media)
            await tasks.finish(task_id, deliver=deliver_media)
            assert await db.scalar(select(func.count()).select_from(Take)) == 1
            assert await db.scalar(select(func.count()).select_from(CutTakeReference)) == 0
            assert await db.scalar(select(func.count()).select_from(DirectingAction).where(DirectingAction.action == "execute")) == 1
            assert task_id in (await service.workspace(sequence_id)).task_ids


@pytest.mark.asyncio
async def test_review_changes_and_cancel_do_not_publish(tmp_path):
    """未决审稿禁止提交，取消后不会产生候选素材。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, prompt_id, review_id = await prepare(db)
            packet = (await service.read_revision(review_id)).content.model_dump(mode="json")
            packet["rows"][0]["verdict"] = "revise"
            pending = await frozen(service, sequence_id, "review", packet)
            with pytest.raises(ValueError, match="未处理"):
                await service.shoot(sequence_id, prompt_id=prompt_id, review_id=pending.id, request_id="rejected")
            resolved = await service.resolve_review(sequence_id, pending.id, role="direction", occurrence_id="o1", reason="此处停顿是有意的")
            assert (await service.read_revision(pending.id)).content.rows[0].verdict == "revise"
            task = await service.shoot(sequence_id, prompt_id=prompt_id, review_id=resolved.id, request_id="accepted")
            tasks = TaskService(db)
            await tasks.claim(task.id, worker_id="worker")
            await tasks.request_cancel(task.id, reason="取消试拍")
            await tasks.add_output(task.id, ordinal=0, file_id="video1")
            await tasks.finish(task.id, deliver=deliver_media)
            assert await db.scalar(select(func.count()).select_from(Take)) == 0
