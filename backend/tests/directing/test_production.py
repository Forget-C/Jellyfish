"""固定输入、六岗覆盖、幂等提交与候选交付的离线业务验证。"""

import pytest
from sqlalchemy import func, select

from app.core.contracts.directing.common import ROLES
from app.core.contracts.directing.workspace import ReviewRequest
from app.models.directing import Take, DirectingAction, DirectingRevision, CutTakeReference
from app.models.llm import Model, Provider
from app.models.task import Task, TaskInput
from app.services.directing.production import ProductionService
from app.services.generation.media_execution import deliver_media
from app.services.task_service import TaskService
from tests.directing.samples import design_sample, plan_sample
from tests.directing.test_store import database, frozen


async def prepare(db, design_payload=None, reference_origin=None):
    """明确拆为单镜试拍，供应商配置只供离线提交验证。"""
    db.add(Provider(id="provider1", name="OpenAI", base_url="https://example.invalid/v1", api_key="test-only", status="active"))
    await db.flush()
    db.add(Model(id="model1", name="sora-test", category="video", provider_id="provider1", params={}))
    await db.flush()
    service = ProductionService(db, "p1")
    sequence = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
    design = await frozen(service, sequence.id, "design", design_payload or design_sample())
    data = plan_sample(design.id)
    data["units"][0]["coverage"] = data["units"][0]["coverage"][:1]
    data["units"][0]["references"] = [{"id": "r1", "file_id": "image1", "purpose": "composition", "media_kind": "image",
                                       "participant_ids": [], "ordinal": 0, "input_role": "first_frame",
                                       "source": {"kind": "human", "reference": "author", "version": "1"}}]
    if reference_origin:
        data['units'][0]['references'][0]['asset_origin'] = reference_origin
    plan = await frozen(service, sequence.id, "plan", data)
    prompt = await service.compile_unit(sequence.id, plan.id, "u1")
    packet = {"mode": "formal", "roles": list(ROLES), "context": {},
              "occurrences": [{"id": "o1", "prompt_revision_id": prompt.id, "plan_revision_id": plan.id,
                               "unit_id": "u1", "coverage_item_id": "c1", "shot_id": "s1", "local_number": 1}],
              "rows": [{"role": role, "occurrence_id": "o1", "verdict": "pass", "rationale": "离线用例检查通过", "findings": []} for role in ROLES]}
    review = await frozen(service, sequence.id, "review", packet)
    return service, sequence.id, plan.id, prompt.id, review.id


@pytest.mark.asyncio
async def test_apply_review_retries_return_original_revision_and_keep_decisions(tmp_path):
    """提交已成功但客户端未收到响应时，跨事务重试仍定位原任务版本；人工裁决另行派生。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, _, _, review_id = await prepare(db)
            packet = (await service.read_revision(review_id)).content.model_dump(mode="json")
            packet["rows"][0]["verdict"] = "revise"
            db.add(Task(id="check1", kind="directing_review", status="succeeded", project_id="p1",
                        target_type="directing_sequence", target_id=sequence_id,
                        input_snapshot={"run_args": {"packet": packet}}, result=packet))
            await db.flush()
            applied = await service.apply_review(sequence_id, "check1")
            applied_id = applied.id
            assert applied.confirmed_at and applied.payload["rows"][0]["verdict"] == "revise"
            assert (await service.apply_review(sequence_id, "check1")).id == applied_id
            resolved = await service.resolve_review(sequence_id, applied_id, role="direction", occurrence_id="o1", reason="有意的停顿")
            assert resolved.id != applied_id and resolved.source_task_id is None
        async with sessions.begin() as db:
            service = ProductionService(db, "p1")
            assert (await service.apply_review(sequence_id, "check1")).id == applied_id
            assert (await service.read_revision(applied_id)).source_task_id == "check1"
            assert next(row for row in (await service.workspace(sequence_id)).reviews if row.id == applied_id).source_task_id == "check1"
            assert await db.scalar(select(func.count()).select_from(DirectingRevision).where(DirectingRevision.source_task_id == "check1")) == 1
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.kind == "video_generation")) == 0
            with pytest.raises(ValueError):
                await ProductionService(db, "p2").apply_review(sequence_id, "check1")


@pytest.mark.asyncio
async def test_apply_review_rolls_back_failed_confirmation_and_rejects_wrong_scope(tmp_path, monkeypatch):
    """失败确认不留下占用任务身份的半成品；任务范围和项目仍须匹配。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, _, _, review_id = await prepare(db)
            packet = (await service.read_revision(review_id)).content.model_dump(mode="json")
            db.add(Task(id="check1", kind="directing_review", status="succeeded", project_id="p1", target_id=sequence_id,
                        input_snapshot={"run_args": {"packet": packet}}, result=packet))
            await db.flush()
            confirm = service.confirm_revision

            async def reject(*args, **kwargs):
                raise ValueError("模拟确认失败")

            monkeypatch.setattr(service, "confirm_revision", reject)
            with pytest.raises(ValueError, match="模拟确认失败"):
                await service.apply_review(sequence_id, "check1")
            assert await db.scalar(select(func.count()).select_from(DirectingRevision).where(DirectingRevision.source_task_id == "check1")) == 0
            monkeypatch.setattr(service, "confirm_revision", confirm)
            assert (await service.apply_review(sequence_id, "check1")).confirmed_at
            other = await service.create_sequence(chapter_id="ch1", title="另一场", position=1)
            with pytest.raises(ValueError, match="尚无可保存结果"):
                await service.apply_review(other.id, "check1")


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


@pytest.mark.asyncio
async def test_partial_cut_and_reshoot_replace_preserves_other_clip(tmp_path):
    """补拍通过同一单元任务交付，人工局部替换保留另一好片段且旧剪辑不可变。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, prompt_id, review_id = await prepare(db)
            tasks = TaskService(db)
            first = await service.shoot(sequence_id, prompt_id=prompt_id, review_id=review_id, request_id="first")
            await tasks.claim(first.id, worker_id="worker")
            await tasks.add_output(first.id, ordinal=0, file_id="video1")
            await tasks.finish(first.id, deliver=deliver_media)
            take = (await service.workspace(sequence_id)).takes[0]
            items = [{"kind": "media", "id": "good", "take_id": take.id, "media_range": {"source_in_ms": 0, "source_out_ms": 2000}, "timeline_start_ms": 0},
                     {"kind": "media", "id": "replace", "take_id": take.id, "media_range": {"source_in_ms": 5000, "source_out_ms": 8000}, "timeline_start_ms": 2000}]
            cut = await frozen(service, sequence_id, "cut", {"items": items})
            second = await service.shoot(sequence_id, prompt_id=prompt_id, review_id=review_id, request_id="reshoot")
            await tasks.claim(second.id, worker_id="worker")
            await tasks.add_output(second.id, ordinal=0, file_id="video1")
            await tasks.finish(second.id, deliver=deliver_media)
            next_take = next(t for t in (await service.workspace(sequence_id)).takes if t.task_id == second.id)
            assert (await service.read_revision(cut.id)).content.items[1].take_id == take.id
            items[1] = {**items[1], "take_id": next_take.id, "media_range": {"source_in_ms": 1000, "source_out_ms": 4000}}
            replacement = await service.save_revision(sequence_id, kind="cut", payload={"items": items}, parent_id=cut.id)
            assert replacement.payload["items"][0] == cut.payload["items"][0]
            assert replacement.payload["items"][1]["take_id"] == next_take.id
            from app.services.directing.store import RevisionConflict
            await service.save_revision(sequence_id, kind="cut", payload={"items": items}, revision_id=replacement.id, expected_version=1)
            with pytest.raises(RevisionConflict):
                await service.save_revision(sequence_id, kind="cut", payload={"items": items}, revision_id=replacement.id, expected_version=1)


@pytest.mark.asyncio
async def test_old_source_blocks_execution_and_sound_source_is_compiled(tmp_path):
    """原文范围改变后旧已审输入也不能执行；声源不是溯源元数据，必须入提示词。"""
    from app.core.contracts.directing.workspace import SequenceUpdate, SourceSpan
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, prompt_id, review_id = await prepare(db)
            plan = await service.revision(plan_id)
            design = await service.revision(plan.payload["design_revision_id"])
            sound = design.payload["sound"]["sources"]
            assert sound["text"] in (await service.revision(prompt_id)).payload["text"]
            sequence = await service.read_sequence(sequence_id)
            await service.write_sequence(sequence.chapter_id, SequenceUpdate(title=sequence.title, position=sequence.position,
                source_version=sequence.source.version, span=SourceSpan(start=1, end=4), expected_version=sequence.version), sequence_id)
            with pytest.raises(ValueError, match="范围"):
                await service.shoot(sequence_id, prompt_id=prompt_id, review_id=review_id, request_id="old-source")


@pytest.mark.asyncio
async def test_compiler_preserves_causal_ids_and_explicit_delay(tmp_path):
    """关联与数值都进入固定文本及来源映射，不因它们不是 Note 而丢失。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            design = design_sample()
            design["staging"]["activities"][0]["delay_ms"] = 320
            service, _, _, prompt_id, _ = await prepare(db, design)
            prompt = (await service.read_revision(prompt_id)).content
            mapping = {decision.section_path: decision.text_excerpt for decision in prompt.decisions}
            assert mapping["/direction/shots/0/event_ids/0"] == "event_ids[1]：request"
            assert mapping["/direction/blocking_states/0/anchor_ids/0"] == "anchor_ids[1]：table"
            assert mapping["/staging/activities/0/trigger_event_id"] == "trigger_event_id：reaction"
            assert mapping["/staging/activities/0/delay_ms"] == "delay_ms：320毫秒"
            assert mapping["/continuity/0/domain"] == "domain：hands_props"
            assert all(text in prompt.text for text in mapping.values())
            assert not any("/sources/" in path for path in mapping)
            assert prompt.format_version == "jellyfish-scene-v4"


@pytest.mark.asyncio
async def test_scene_context_is_not_emitted_as_current_unit_actions(tmp_path):
    """整场调度可能含前后镜头动作，必须与本次执行范围分区并保留来源。"""
    payload = design_sample()
    payload['staging']['activities'][0]['path']['text'] = '上一镜推纸，后续镜头才抬眼。'
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, _, prompt_id, _ = await prepare(db, payload)
            prompt = (await service.read_revision(prompt_id)).content
            assert '【本次执行动作】' in prompt.text
            context, execution = prompt.text.split('【本次执行动作】', 1)
            assert '上一镜推纸，后续镜头才抬眼。' in context
            assert '上一镜推纸，后续镜头才抬眼。' not in execution
            assert '【shots[1]' in execution
            decision = next(d for d in prompt.decisions if d.section_path == '/staging/activities/0/path')
            assert '背景' in decision.explanation


@pytest.mark.asyncio
async def test_compile_request_recovers_original_and_rejects_scope_changes(tmp_path):
    """响应丢失后跨事务恢复精确版本，明确的新请求才编译新版本。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, _, _ = await prepare(db)
            original = await service.compile_unit(sequence_id, plan_id, "u1", request_id="compile-retry")
            original_id = original.id
        async with sessions.begin() as db:
            service = ProductionService(db, "p1")
            recovered = await service.compile_unit(sequence_id, plan_id, "u1", request_id="compile-retry")
            assert recovered.id == original_id
            assert await db.scalar(select(func.count()).select_from(DirectingAction).where(DirectingAction.request_id == "compile-retry")) == 1
            for changed_plan, changed_unit in (("another-plan", "u1"), (plan_id, "another-unit")):
                with pytest.raises(ValueError, match="请求身份"):
                    await service.compile_unit(sequence_id, changed_plan, changed_unit, request_id="compile-retry")
            with pytest.raises(ValueError):
                await ProductionService(db, "other-project").compile_unit(sequence_id, plan_id, "u1", request_id="compile-retry")
            another = await service.compile_unit(sequence_id, plan_id, "u1", request_id="compile-new")
            assert another.id != original_id


@pytest.mark.asyncio
async def test_review_request_recovers_task_and_rejects_changed_inputs(tmp_path):
    """受理响应丢失后返回原任务，即使已完成也不能悄悄重新检查。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, prompt_id, _ = await prepare(db)
            db.add(Model(id="text-review", name="qwen-test", category="text", provider_id="provider1"))
            await db.flush()
            body = ReviewRequest(model_id="text-review", request_id="review-retry")
            original = await service.submit_review(sequence_id, prompt_id, body)
            task_id = original.id
        async with sessions.begin() as db:
            service = ProductionService(db, "p1")
            recovered = await service.submit_review(sequence_id, prompt_id, body)
            assert recovered.id == task_id
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.kind == "directing_review")) == 1
            with pytest.raises(ValueError, match="请求身份"):
                await service.submit_review(sequence_id, prompt_id, body.model_copy(update={"instruction": "新的要求"}))
            another_prompt = await service.compile_unit(sequence_id, plan_id, "u1")
            with pytest.raises(ValueError, match="请求身份"):
                await service.submit_review(sequence_id, another_prompt.id, body)
            with pytest.raises(ValueError):
                await ProductionService(db, "other-project").submit_review(sequence_id, prompt_id, body)
            recovered.status = "cancelled"
        async with sessions.begin() as db:
            service = ProductionService(db, "p1")
            assert (await service.submit_review(sequence_id, prompt_id, body)).id == task_id
            fresh = await service.submit_review(sequence_id, prompt_id, body.model_copy(update={"request_id": "review-new"}))
            assert fresh.id != task_id


@pytest.mark.asyncio
async def test_grouped_references_reach_provider_and_keep_history(tmp_path, monkeypatch):
    """两图一主体贯穿编译、固定输入和真实媒体转换；旧输入不自动合组。"""
    from app.core import storage
    from app.models.studio import FileItem
    from app.core.contracts.generation import ResolvedGenerationSnapshot
    from app.services.generation.media_execution import build_media_input

    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence, original_plan, original_prompt, _ = await prepare(db)
            (await db.get(Provider, "provider1")).name = "Vidu"
            (await db.get(Model, "model1")).name = "viduq2"
            db.add(FileItem(id="image2", type="image", name="侧面", storage_key="files/side.png"))
            await db.flush()
            original = await service.revision(original_plan)
            data = dict(original.payload)
            data["units"] = [dict(data["units"][0])]
            reference = {**data["units"][0]["references"][0], "input_role": "subject", "subject_group_id": "brother-ref", "purpose": "identity", "participant_ids": ["brother"]}
            data["units"][0]["references"] = [{**reference, "id": "r2", "file_id": "image2", "ordinal": 1}, reference]
            plan = await frozen(service, sequence, "plan", data)
            prompt = await service.compile_unit(sequence, plan.id, "u1")
            _, _, media = await service.validate_unit(sequence, plan.id, "u1")
            assert [(s.name, [r.file_id for r in s.media]) for s in media.subjects] == [("brother-ref", ["image1", "image2"])]
            assert "参考 @brother-ref" in prompt.payload["text"]
            assert "参考 @r2" not in prompt.payload["text"]
            assert (await service.revision(original_prompt)).payload["text"].count("参考 @r1") == 1
            _, _, old_media = await service.validate_unit(sequence, original_plan, "u1")
            assert old_media.frames.first.file_id == "image1"
            legacy = {**data, "units": [{**data["units"][0], "references": [{**ref, "subject_group_id": None} for ref in data["units"][0]["references"]]}]}
            legacy_plan = await frozen(service, sequence, "plan", legacy)
            _, _, legacy_media = await service.validate_unit(sequence, legacy_plan.id, "u1")
            assert [subject.name for subject in legacy_media.subjects] == ["r1", "r2"]
            files = {key: await db.get(FileItem, key) for key in ("image1", "image2")}
            snapshot = ResolvedGenerationSnapshot.model_validate({
                "canonical_target": {"kind": "directing_unit", "entity_id": prompt.id},
                "model_id": "model1", "execution_prompt": prompt.payload["text"],
                "operation_input": {"kind": "video_generation", "ratio": "16:9", "seconds": 9}, "media": media.model_dump()})
        async def download(*, key):
            return key.encode()
        monkeypatch.setattr(storage, "download_file", download)
        from app.models.task import TaskInput
        from app.services.generation.task_snapshot import split_snapshot, restore_snapshot
        parameters, target_type, target_id, inputs = split_snapshot(snapshot)
        task = Task(kind="video_generation", target_type=target_type, target_id=target_id, input_snapshot={**parameters, "model_name": "viduq2"})
        restored = restore_snapshot(task, [(TaskInput(role_path=role, ordinal=ordinal, file_id=file_id), files[file_id]) for role, ordinal, file_id in reversed(inputs)])
        result = await build_media_input(task, restored, files)
        assert len(result.subject_references) == 1
        assert len(result.subject_references[0].images) == 2
        assert result.subject_references[0].images[0] != result.subject_references[0].images[1]
        from app.core.integrations.vidu.video_payload import build_create_video_request
        endpoint, body = build_create_video_request(result)
        assert endpoint == "/ent/v2/reference2video"
        assert body["subjects"][0]["name"] == "brother-ref"
        assert body["subjects"][0]["images"] == result.subject_references[0].images


@pytest.mark.asyncio
async def test_frame_inputs_are_rejected_before_adapter_can_drop_them(tmp_path):
    """帧数量与位置限制必须在编译前报错，不能显示两图却实际只发送一图。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence, original, _, _ = await prepare(db)
            row = await service.revision(original)
            data = dict(row.payload)
            data["units"] = [dict(data["units"][0])]
            first = data["units"][0]["references"][0]
            data["units"][0]["references"] = [first, {**first, "id": "second", "ordinal": 1, "input_role": "first_frame"}]
            plan = await frozen(service, sequence, "plan", data)
            with pytest.raises(ValueError, match="最多发送 1 张"):
                await service.compile_unit(sequence, plan.id, "u1")
            (await db.get(Provider, "provider1")).name = "Kling"
            (await db.get(Model, "model1")).name = "kling-3.0-turbo"
            await db.flush()
            with pytest.raises(ValueError, match="不支持所选帧位置"):
                await service.validate_unit(sequence, plan.id, "u1")
