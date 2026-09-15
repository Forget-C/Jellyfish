"""从确认工作单编译明确单元、审稿并提交统一生成任务。"""

from uuid import uuid4

from sqlalchemy import select

from app.core.contracts.directing.common import Note, ROLES, Source
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.production import CompilationDecision, ProductionPlan, Prompt, ReviewPacket, ReviewOccurrence, ReviewRow
from app.core.contracts.directing.workspace import AIRequest, VisualRequest, RegroupRequest
from app.core.contracts.generation import (
    ImageGenerationOperationInput, GenerationCommand, GenerationDelivery, GenerationModality, GenerationOperation, GenerationSubmitRequest,
    GenerationTarget, GenerationTargetKind, VideoGenerationOperationInput,
)
from app.core.contracts.media import ImageMediaInput, MediaReference, VideoFrameMediaReferences, VideoMediaInput, VideoSubjectMediaReference
from app.core.contracts.video_generation import VideoGenerationInput, VideoFrameReferences, VideoSubjectReference
from app.core.integrations.video_capabilities import validate_video_options
from app.core.integrations.openai.video_capabilities import validate_openai_video_options
from app.core.integrations.vidu.video_capabilities import validate_vidu_video_options
from app.core.integrations.kling.video_capabilities import validate_kling_video_options
from app.core.integrations.volcengine.video_capabilities import validate_volcengine_video_options
from app.models.directing import DirectingAction, Sequence
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task
from app.models.studio import FileUsage
from app.services.studio.files import require_available_file
from app.services.directing.ai import DirectingAIService
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission.submitter import GenerationSubmitter
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category


class ProductionService(DirectingAIService):
    """冻结输入后执行；不复用旧镜头槽位，不静默拆镜或丢失参考。"""

    async def regroup_units(self, sequence_id: str, body: RegroupRequest):
        """用户明确重组固定计划；保留其他单元和历史证据依赖，不改提示词、任务或剪辑。"""
        row = await self.revision(body.plan_revision_id, kind="plan", sequence_id=sequence_id, confirmed=True)
        plan = ProductionPlan.model_validate(row.payload)
        selected_ids = set(body.unit_ids)
        if len(selected_ids) != len(body.unit_ids):
            raise ValueError("重组单元不能重复")
        selected = [unit for unit in plan.units if unit.id in selected_ids]
        if len(selected) != len(selected_ids):
            raise ValueError("所选单元不属于该计划")
        replacements = {}
        if body.operation == "merge":
            if len(selected) < 2:
                raise ValueError("至少选择两个单元才能组合")
            first = selected[0]
            # 不替用户选择冲突的模型、参考或控制参数，避免无声丢失拍摄意图。
            for unit in selected[1:]:
                if any(getattr(unit, key) != getattr(first, key) for key in ("model_id", "ratio", "parameters", "references", "capability", "dependencies")):
                    raise ValueError("组合前请统一所选单元的模型、画幅、参数、参考、依赖与能力依据")
            merged = first.model_copy(deep=True)
            merged.id = uuid4().hex
            merged.duration_ms = sum(unit.duration_ms for unit in selected)
            merged.coverage = [coverage.model_copy(update={"id": uuid4().hex}) for unit in selected for coverage in unit.coverage]
            replacements = {unit.id: [merged] for unit in selected}
        else:
            if all(len(unit.coverage) == 1 for unit in selected):
                raise ValueError("所选单元已是单镜范围，无需拆分")
            design = SceneDesign.model_validate((await self.revision(plan.design_revision_id)).payload)
            shots = {shot.id: shot for shot in design.direction.shots}
            for unit in selected:
                replacements[unit.id] = []
                for coverage in unit.coverage:
                    part = unit.model_copy(deep=True)
                    part.id = uuid4().hex
                    part.coverage = [coverage.model_copy(deep=True)]
                    part.duration_ms = shots[coverage.shot_id].estimated_duration_ms or unit.duration_ms
                    replacements[unit.id].append(part)
        units, seen = [], set()
        for unit in plan.units:
            for replacement in replacements.get(unit.id, [unit]):
                if replacement.id not in seen:
                    seen.add(replacement.id)
                    units.append(replacement)
        content = ProductionPlan.model_validate({"design_revision_id": plan.design_revision_id,
            "units": [unit.model_dump(mode="json") for unit in units]})
        return await self.save_revision(sequence_id, kind="plan", payload=content.model_dump(mode="json"), parent_id=row.id)

    async def generate_visual(self, sequence_id: str, body: VisualRequest):
        """复用统一图片生成管线，只交付候选文件，不修改设计、资产默认图或参考。"""
        row = await self.revision(body.design_revision_id, kind="design", sequence_id=sequence_id, confirmed=True)
        sequence = await self.sequence(sequence_id)
        if row.source_key != self.source_key(sequence):
            raise ValueError("场次来源已变化，请确认新设计后生成验证图")
        for file_id in body.reference_file_ids:
            await require_available_file(self.db, file_id=file_id, expected_type="image")
            if not await self.db.scalar(select(FileUsage.file_id).where(FileUsage.file_id == file_id, FileUsage.project_id == self.project_id)):
                raise ValueError("参考图不属于当前项目")
        model = await get_model_by_category(self.db, ModelCategoryKey.image, model_or_id=body.model_id)
        text = f"验证目的：{body.purpose}\n{body.prompt}"
        design = SceneDesign.model_validate(row.payload)
        for rule in await self.applicable_style(design.style_revision_id, sequence_id, model.name):
            text += f"\n项目风格 [{rule.role}]：{rule.requirement}；例外：{rule.exceptions.text or rule.exceptions.reason or '未注明'}"
        accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(self.db, GenerationCommand(
            modality=GenerationModality.image, operation=GenerationOperation.image_generation,
            delivery=GenerationDelivery.async_polling,
            target=GenerationTarget(kind=GenerationTargetKind.directing_image, entity_id=row.id),
            request=GenerationSubmitRequest(model_id=model.id, execution_prompt=text,
                operation_input=ImageGenerationOperationInput(target_ratio=body.ratio, count=1, save_as_candidate=True),
                media=ImageMediaInput(references=[MediaReference(file_id=file_id, media_kind="image", ordinal=index)
                    for index, file_id in enumerate(body.reference_file_ids)])),
        ))
        return await self.db.get(Task, accepted.task_id)

    async def validate_unit(self, sequence_id: str, plan_id: str, unit_id: str, text: str = "准备检查"):
        """用已接入供应商规则核对媒体、时长和参数；艺术多镜能力保持未验证。"""
        plan_row = await self.revision(plan_id, kind="plan", sequence_id=sequence_id, confirmed=True)
        plan = ProductionPlan.model_validate(plan_row.payload)
        await self._validate(await self.sequence(sequence_id), plan)
        design = await self.revision(plan.design_revision_id, kind="design", sequence_id=sequence_id)
        if design.source_key != self.source_key(await self.sequence(sequence_id)) or (await self.read_sequence(sequence_id)).source_changed:
            raise ValueError("设计依据的原文或场次范围已变化，请核对设计并确认新计划")
        unit = self._unit(plan, unit_id)
        if len(unit.coverage) > 1:
            raise ValueError("当前模型尚未验证精确多镜生成，请在计划中明确拆成单镜试拍单元后再编译")
        dependency_errors = await self.continuity_errors(sequence_id, unit)
        if dependency_errors:
            raise ValueError("；".join(dependency_errors))
        if unit.duration_ms % 1000:
            raise ValueError("当前模型时长按整秒提交，请调整单元预计时长")
        unsupported = set(unit.parameters) - {"seed"}
        if unsupported:
            raise ValueError(f"当前执行器不支持参数：{', '.join(sorted(unsupported))}")
        model = await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=unit.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.video)
        frames, subjects = {}, []
        for binding in sorted(unit.references, key=lambda r: r.ordinal):
            if binding.media_kind == "audio":
                raise ValueError("当前执行器不支持声音参考，请保留声音设计并安排后期")
            ref = MediaReference(file_id=binding.file_id, media_kind=binding.media_kind, ordinal=binding.ordinal)
            if binding.input_role == "subject":
                subjects.append(VideoSubjectMediaReference(name=binding.id, media=[ref]))
            elif binding.input_role == "key_frame":
                frames.setdefault("keys", []).append(ref)
            else:
                key = "first" if binding.input_role == "first_frame" else "last"
                if key in frames:
                    raise ValueError("首帧或尾帧只能选择一份图片")
                frames[key] = ref
        media = VideoMediaInput(frames=VideoFrameMediaReferences(**frames), subjects=subjects)
        options = VideoGenerationInput(prompt=text, model=model.name, ratio=unit.ratio,
            seconds=unit.duration_ms // 1000, seed=unit.parameters.get("seed"),
            frame_references=VideoFrameReferences(first_frame=media.frames.first, last_frame=media.frames.last, key_frames=media.frames.keys),
            subject_references=[VideoSubjectReference(name=s.name, media=s.media) for s in subjects])
        validate_video_options(provider=config.provider_key, model=model.name, input_=options)
        validators = {"openai": validate_openai_video_options, "vidu": validate_vidu_video_options,
                      "kling": validate_kling_video_options, "volcengine": validate_volcengine_video_options}
        validators[config.provider_key](options)
        return plan, unit, media

    async def compile_unit(self, sequence_id: str, plan_id: str, unit_id: str):
        """将适用工作单字段编译为有版本的文本及逐项去向，不截断关键语义。"""
        plan, unit, media = await self.validate_unit(sequence_id, plan_id, unit_id)
        design_row = await self.revision(plan.design_revision_id, kind="design", sequence_id=sequence_id, confirmed=True)
        design = SceneDesign.model_validate(design_row.payload)
        shots = {item.shot_id for item in unit.coverage}
        beats = {beat for item in unit.coverage for beat in item.beat_ids}
        blocking = {state for shot in design.direction.shots if shot.id in shots for state in shot.blocking_state_ids}
        if not shots <= {row.shot_id for row in design.cinematography}:
            raise ValueError("镜头缺少摄影工作单")
        required = [design.direction.viewpoint, design.direction.information_change]
        required += [s.visible_result for s in design.direction.shots if s.id in shots]
        required += [b.must_show for b in design.direction.beats if b.id in beats]
        if any(note.state not in ("fact", "proposal") for note in required):
            raise ValueError("视点、信息变化或镜头可见结果仍未确定，请先完善导演方案")
        lines = ["【场次试拍 v4】", f"时长 {unit.duration_ms // 1000} 秒，画幅 {unit.ratio}。"]
        for binding in unit.references:
            names = [p.name for p in design.participants if p.id in binding.participant_ids]
            lines.append(f"参考 @{binding.id}：用途 {binding.purpose}，主体 {'、'.join(names) or '空间/构图'}，输入位置 {binding.input_role}。")
        lines.append("人物：" + "；".join(f"{p.id}={p.name}" for p in design.participants))
        lines.append("声音安排：" + {"postproduction": "对白和声音待后期处理", "generated": "同期生成", "unknown": "待确定，不视为已完成"}[design.sound.execution])
        decisions = []
        background = True

        def emit(value, path, label):
            """逐项保留文本来源路径，忽略溯源元数据但不丢失已知创作内容。"""
            if isinstance(value, dict) and "state" in value and "sources" in value:
                note = Note.model_validate(value)
                if note.state in ("fact", "proposal"):
                    line = f"{label}：{note.text}"
                elif note.state in ("none", "not_applicable"):
                    line = f"{label}：{note.reason}"
                else:
                    return
                lines.append(line)
                decisions.append(CompilationDecision(section_path=path, disposition="text", explanation="保留场次背景，不能据此追加本次动作" if background else "按当前单元覆盖编入执行文本", text_excerpt=line))
            elif isinstance(value, dict):
                identity = ", ".join(f"{key}={value[key]}" for key in ("id", "participant_id", "beat_id", "shot_id") if value.get(key) is not None)
                if identity:
                    lines.append(f"【{label}: {identity}】")
                for key, child in value.items():
                    if key not in ("style_revision_id", "id", "participant_id", "beat_id", "shot_id") and (key != "sources" or path == "/sound"):
                        emit(child, path + "/" + key, key)
            elif isinstance(value, list):
                for index, child in enumerate(value):
                    if isinstance(child, dict):
                        if path == "/direction/shots" and child["id"] not in shots:
                            continue
                        if path == "/direction/beats" and child["id"] not in beats:
                            continue
                        if path == "/direction/blocking_states" and child["id"] not in blocking:
                            continue
                        if path == "/performance/beats" and child["beat_id"] not in beats:
                            continue
                        if path == "/cinematography" and child["shot_id"] not in shots:
                            continue
                    emit(child, path + "/" + str(index), label + f"[{index + 1}]")
            elif value is not None:
                # Keep causal ID references and explicit timings; these are not Note objects.
                unit_label = "毫秒" if label in ("delay_ms", "estimated_duration_ms") else ""
                field_label = "原设计预计时长（非本次单元时长）" if label == "estimated_duration_ms" else label
                line = f"{field_label}：{value}{unit_label}"
                lines.append(line)
                decisions.append(CompilationDecision(section_path=path, disposition="text",
                    explanation="保留关联身份或明确数值，避免丢失因果与时序", text_excerpt=line))
        document = design.model_dump(mode="json")
        lines.append("【场次背景】以下含前后镜头信息，仅供理解人物、空间及连续性；不得把背景中的动作追加到本次拍摄。")
        for key in ("participants", "events", "criteria"):
            emit(document[key], "/" + key, key)
        emit({key: value for key, value in document["direction"].items() if key not in ("beats", "blocking_states", "shots")}, "/direction", "总导演背景")
        emit({key: value for key, value in document["performance"].items() if key != "beats"}, "/performance", "表演背景")
        for key in ("staging", "continuity", "sound", "prompt"):
            emit(document[key], "/" + key, key)
        background = False
        lines.append("【本次执行动作】")
        lines.append("只执行以下单元范围；背景中未被本单元覆盖的动作不拍摄。")
        for index, coverage in enumerate(unit.coverage, 1):
            lines.append(f"镜头 {index} [{coverage.shot_id}]：{coverage.action_scope}")
        for key in ("beats", "blocking_states", "shots"):
            emit(document["direction"][key], "/direction/" + key, key)
        emit(document["performance"]["beats"], "/performance/beats", "beats")
        emit(document["cinematography"], "/cinematography", "cinematography")
        model = await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=unit.model_id)
        for rule in await self.applicable_style(design.style_revision_id, sequence_id, model.name):
            line = f"项目风格 [{rule.role}/{rule.id}]：{rule.requirement}"
            if rule.exceptions.text or rule.exceptions.reason:
                line += f"；例外：{rule.exceptions.text or rule.exceptions.reason}"
            lines.append(line)
            decisions.append(CompilationDecision(section_path="/style_revision_id", disposition="text",
                explanation=f"固定项目风格 {design.style_revision_id} 的适用规则 {rule.id}", text_excerpt=line))
        text = "\n".join(lines)
        if len("".join(text.split())) > 5000:
            raise ValueError("执行文本超过 5000 非空白字符，请简化重复工作单内容或缩小单元范围；系统不会截断")
        prompt = Prompt(plan_revision_id=plan_id, unit_id=unit_id, format_version="jellyfish-scene-v4", text=text,
                        decisions=decisions, sources=[Source(kind="revision", reference=design_row.id, version=str(design_row.version))])
        async with self.db.begin_nested():
            row = await self.save_revision(sequence_id, kind="prompt", payload=prompt.model_dump(mode="json"))
            row = await self.confirm_revision(row.id, expected_version=row.version, actor_id="local-user")
            self.db.add(DirectingAction(id=uuid4().hex, sequence_id=sequence_id, revision_id=row.id,
                                       action="compile", actor_id="local-user", displayed_label="编译本次试拍", unit_id=unit_id))
            await self.db.flush()
        return row

    async def submit_review(self, sequence_id: str, prompt_id: str, body: AIRequest):
        """固定提示词及逐镜出现项，让六岗在共同场次上下文审查。"""
        row = await self.revision(prompt_id, kind="prompt", sequence_id=sequence_id, confirmed=True)
        prompt = Prompt.model_validate(row.payload)
        plan, unit, _ = await self.validate_unit(sequence_id, prompt.plan_revision_id, prompt.unit_id, prompt.text)
        occurrences = [ReviewOccurrence(id=f"occurrence-{index}", prompt_revision_id=row.id,
                        plan_revision_id=prompt.plan_revision_id, unit_id=unit.id, coverage_item_id=item.id,
                        shot_id=item.shot_id, local_number=index) for index, item in enumerate(unit.coverage, 1)]
        packet = ReviewPacket(mode="formal", roles=list(ROLES), occurrences=occurrences,
                    rows=[ReviewRow(role=role, occurrence_id=o.id, verdict="pending", rationale="待审查", findings=[]) for role in ROLES for o in occurrences], context=Note())
        design = await self.revision(plan.design_revision_id)
        return await self.submit_ai(kind="directing_review", body=body, sequence_id=sequence_id,
                                   extra={"packet": packet.model_dump(mode="json"), "prompt": prompt.model_dump(mode="json"), "design": design.payload,
                                          "style_rules": [rule.model_dump(mode="json") for rule in await self.applicable_style(
                                              design.payload.get("style_revision_id"), sequence_id,
                                              (await get_model_by_category(self.db, ModelCategoryKey.video, model_or_id=unit.model_id)).name)]})

    async def apply_review(self, sequence_id: str, task_id: str):
        """记录模型实际审稿结果，保留 revise 结论，不能用保存动作伪装通过。"""
        task = await self.db.get(Task, task_id)
        if task is None or task.project_id != self.project_id or task.target_id != sequence_id or task.kind != "directing_review" or task.status != "succeeded":
            raise ValueError("审稿任务尚无可保存结果")
        packet = ReviewPacket.model_validate(task.result)
        original = ReviewPacket.model_validate(task.input_snapshot["run_args"]["packet"])
        if packet.occurrences != original.occurrences or packet.roles != original.roles:
            raise ValueError("审稿结果与送审范围不一致")
        row = await self.save_revision(sequence_id, kind="review", payload=packet.model_dump(mode="json"))
        return await self.confirm_revision(row.id, expected_version=row.version, actor_id="local-user")

    async def prepare_shoot(self, sequence_id: str, *, prompt_id: str, review_id: str) -> GenerationCommand:
        """只读预检固定提示词、审稿、计划和模型输入，单次与批量共用且不创建任务。"""
        sequence = await self.read_sequence(sequence_id)
        if sequence.source_changed:
            raise ValueError("章节原文已变化，请重新核对当前场次")
        prompt_row = await self.revision(prompt_id, kind="prompt", sequence_id=sequence_id, confirmed=True)
        review_row = await self.revision(review_id, kind="review", sequence_id=sequence_id, confirmed=True)
        prompt, review = Prompt.model_validate(prompt_row.payload), ReviewPacket.model_validate(review_row.payload)
        if review.mode != "formal" or any(row.verdict != "pass" for row in review.rows):
            raise ValueError("六部门审稿仍有未处理项，请修改方案并重新编译审稿")
        if {o.prompt_revision_id for o in review.occurrences} != {prompt_id}:
            raise ValueError("审稿不是本次提示词版本")
        if any(d.disposition == "unexpressed" for d in prompt.decisions):
            raise ValueError("重要要求尚未表达，不能试拍")
        if len("".join(prompt.text.split())) > 5000:
            raise ValueError("提示词超过格式长度限制")
        await self._validate(await self.sequence(sequence_id), review)
        plan, unit, media = await self.validate_unit(sequence_id, prompt.plan_revision_id, prompt.unit_id, prompt.text)
        command = GenerationCommand(modality=GenerationModality.video, operation=GenerationOperation.video_generation,
            delivery=GenerationDelivery.async_polling,
            target=GenerationTarget(kind=GenerationTargetKind.directing_unit, entity_id=prompt_id),
            request=GenerationSubmitRequest(model_id=unit.model_id, execution_prompt=prompt.text, media=media,
                operation_input=VideoGenerationOperationInput(ratio=unit.ratio, seconds=unit.duration_ms // 1000, seed=unit.parameters.get("seed"))))
        await GenerationEntityGate().validate(self.db, command)
        return command

    async def shoot(self, sequence_id: str, *, prompt_id: str, review_id: str, request_id: str):
        """版本检查、明确执行授权与幂等任务创建在同一短事务完成。"""
        async with self.db.begin_nested():
            await self.sequence(sequence_id)
            await self.db.get(Sequence, sequence_id, with_for_update=True, populate_existing=True)
            existing = await self.db.scalar(select(DirectingAction).where(DirectingAction.request_id == request_id))
            if existing:
                if existing.sequence_id != sequence_id or existing.revision_id != prompt_id or existing.review_revision_id != review_id:
                    raise ValueError("请求身份已用于其他版本，不能复用")
                return await self.db.get(Task, existing.task_id)
            command = await self.prepare_shoot(sequence_id, prompt_id=prompt_id, review_id=review_id)
            accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(self.db, command)
            self.db.add(DirectingAction(id=uuid4().hex, sequence_id=sequence_id, revision_id=prompt_id,
                review_revision_id=review_id, unit_id=Prompt.model_validate((await self.revision(prompt_id)).payload).unit_id, action="execute", actor_id="local-user",
                displayed_label="确认并开始试拍", request_id=request_id, task_id=accepted.task_id))
            await self.db.flush()
        return await self.db.get(Task, accepted.task_id)


    async def resolve_review(self, sequence_id: str, review_id: str, *, role: str, occurrence_id: str, reason: str):
        """用户接受一项艺术偏离时派生审稿版本，原模型结论和拒绝的建议仍可追溯。"""
        if not reason.strip():
            raise ValueError("请说明接受此偏离的理由")
        original = await self.revision(review_id, kind="review", sequence_id=sequence_id, confirmed=True)
        packet = ReviewPacket.model_validate(original.payload)
        row = next((r for r in packet.rows if r.role == role and r.occurrence_id == occurrence_id), None)
        if row is None or row.verdict != "revise":
            raise ValueError("没有待裁决的对应审稿项")
        row.rationale = f"原审稿要求修改：{row.rationale}。用户选择保留当前方案，理由：{reason}"
        row.verdict = "pass"
        revision = await self.save_revision(sequence_id, kind="review", payload=packet.model_dump(mode="json"), parent_id=review_id)
        return await self.confirm_revision(revision.id, expected_version=revision.version, actor_id="local-user")
