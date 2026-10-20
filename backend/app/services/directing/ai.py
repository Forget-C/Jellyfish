"""导演任务的冻结输入、纯 AI 计算和显式采用；网络调用复用统一 Worker。"""

import json
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import ValidationError
from sqlalchemy import select

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.scene_version import EditableSceneDesign, SceneVersionContent, validate_new_design_row_ids
from app.core.contracts.directing.scene_design import SceneDesignDiagnostics
from app.core.contracts.directing.design_scope import design_scope_issues, resolved_design_fields
from app.core.contracts.directing.production import ReviewPacket
from app.core.contracts.directing.instruction_check import InstructionCheckResult
from app.core.contracts.directing.instruction_basis import InstructionInputs
from app.core.contracts.directing.scene_instruction import SceneInstructionResult, SceneInstructionScope
from app.core.contracts.directing.review_revision import ReviewRevisionCandidate
from app.core.contracts.directing.workspace import AIRequest, DivisionResult, DirectingTaskRead
from app.models.directing import DirectingRevision, Sequence
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task, TaskOutput
from app.models.studio import Chapter, Character, Scene, Prop, ProjectSceneLink, ProjectPropLink
from app.services.directing.workspace import WorkspaceService
from app.services.directing.scene_design_sources import DesignSourceError, record_chapter_generation_source, validate_model_sources
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService

RESULT_CONTRACTS = {"directing_instruction_check": InstructionCheckResult, "directing_instruction": SceneInstructionResult, "directing_divide": DivisionResult, "directing_design": SceneDesign, "directing_review": ReviewPacket, "directing_review_revision": ReviewRevisionCandidate}


class DirectingOutputError(ValueError):
    """可显示的结构错误摘要，不携带模型正文或上游连接信息。"""

    def __init__(self, message: str, diagnostics: SceneDesignDiagnostics | None = None):
        """模型主动返回的工作单另存只读诊断，不混入错误摘要或成功结果。"""
        super().__init__(message)
        self.diagnostics = diagnostics


def generate_directing_result(kind: str, llm, args: dict):
    """在 Worker 有界线程执行，返回严格结构，绝不由模型直接批准或覆盖工作单。"""
    contract = EditableSceneDesign if kind == 'directing_design' and args.get('scene_version_design') else RESULT_CONTRACTS[kind]
    require_complete = args.get('design_scope_version') == 1 and not args.get('design_scope')
    instruction = {
        "directing_instruction_check": "检查 instruction 是否准确表达 inputs 的当前原文、inputs.scope 中本次已选执行项及 video 阶段适用约束，并按已消费背景理解语义；sound/postproduction 规则保留阶段，不误要求视频模型执行。对每项非空 video 执行项和约束按 scope 原顺序输出 destinations，原样复制 owner、field、coverage_item_ids；正文去向给出 instruction 中实际存在的 instruction_excerpt，执行项必须由正文表达；只有身份、空间、构图或连续性约束可引用 inputs.unit.references 中实际绑定且用途相符的 reference_id。无法证明去向或发现正文、规则、参考之间冲突时标为 unresolved，并在相关六岗行标 revise、给出字段路径与修正建议。背景字段若含命令式要求，定位字段并标 revise，提示移入规则或改写背景，不自动升级。项目风格的条件和例外依其原文核对；自然语言冲突交由用户解决。inputs.design 是来源工作单，可能包含本单元未消费内容，不能据此补选动作。unit_id 必须保持 inputs.unit.id，每个 coverage.id 必须有 direction、performance、staging、cinematography、continuity、prompt 六行，occurrence_id 使用 coverage.id。逐行给出 pass 或 revise、具体理由和可执行问题建议，不得漏行、合并或返回 pending。不能更改正文、凭空补充素材或授权生成；检查通过也不保证模型实际遵从。",
        "directing_instruction": "仅依据给定原文、当前单元、明确参考与 scope 编写可直接执行的拍摄指令。scope.execution 是本次明确选择的可拍内容；scope.constraints 中仅 video 阶段适用视频正文，sound/postproduction 阶段不得误写成视频模型要求；scope.background 仅作解释，不自动变成动作或约束。design 是来源工作单，仅用于理解已纳入范围，不能从同镜关系或共用对象补选执行项。只返回原 unit.id 和完整正文 text，不修改设计、单元身份或参考，不声称检查通过或已生成视频。保留动作因果、人物与摄影约束，不编造未提供素材。requirements 是用户本次编写要求。",
        "directing_review_revision": "评估固定检查意见（review=null 时为用户主动修改，不得伪造问题）和整体 instruction。人工 request.edits 必须原样保留，不得覆盖；主动修改 changes.problem_keys 和 outcomes 可为空；用 summary 的 status/reason/choices 说明整体结果，status 为 planned、needs_choice、unresolved 或 unchanged。无实际变化用 unchanged，超出范围用 unresolved，必要选择用 needs_choice 和至少两项 choices，不能伪造检查问题。preview_text/candidate_identity/source_prompt_revision_id 留空，由服务端渲染。仅替换 revision_context.allowed_design_fields 或 allowed_unit_fields 列出的已有字段；before 必须逐字复制固定字段，input_identity 原样返回。不得增加 applicable_shot_ids 等不存在字段，不得增删身份或引用。sound.execution 只有 generated/postproduction/unknown。检查意见不是事实，不能通过删除正确设计掩盖编译器或供应商限制；此类问题返回 unresolved。原文事实优先；必要创作取舍返回 needs_choice 及至少两个简短选项，不猜测用户意图。每个 problem_keys 中的问题都必须有 outcome，即使用户没有填写方向，planned 必须关联实际修改。不能修复的问题明确解释。只输出必要修改，不能宣称新检查通过。Note 新来源使用 revision_context.task_identity。声音制作方式必须有 direction.sound_execution 明确选择才能拟落实，不能从自由文本猜测。",
        "directing_divide": "将章节分成连续叙事场次。excerpt 必须逐字复制原文中连续的一段，不得改写，按原文顺序排列。不同地点或时间转换可分场，不按镜头分场。",
        "directing_design": "根据场次原文、已有资产与人工意见，设计可拍摄的六部门工作单。已有资产只有适用于本场时才引用其 ID，不得凭空编造资产 ID，不得让资产设定改变原文事实。镜头与节拍使用稳定 ID。保留剧情事实。所有角色、对白、背景行为和摄影必须有因果。未知技术值标 unknown，不适用给理由。不得自称用户确认。每镜必须有摄影行，并明确 participant_ids，引用本工作单的参与对象 ID；包括实际参与的静态车辆与手持物件。明确无对象用空列表，不得省略或使用 null，不因同一节拍或全场名单就把其他镜头对象加入。所有有内容的 Note 必须带 model 来源，reference 使用所提供的 task_identity，version 使用 1。",
        "directing_review": "以六部门分别审查本轮每个镜头出现项。严格保留提供的 roles 和 occurrences，不得减少、更换、合并。同一镜头不同单元分别检查。每行给出 pass 或 revise、具体理由及可执行修改建议。检查共同空间、先后反应、参考绑定、摄影、声音和相邻衔接。模型不能授权用户执行。",
    }[kind]
    if kind == 'directing_design' and args.get('scene_version_design'):
        instruction += ('\n场次版本建议使用原工作单的 ID 与字段引用，并在 applicability 中逐字段声明实际镜头、单元出现项或全场约束。'
                        '叙事、人物情境和环境说明保留在原背景字段；动作和可见结果保留在原设计行；约束须声明 video、sound 或 postproduction 阶段。'
                        '共享人物、事件或锚点不能代替适用范围。'
                        '不得添加任意背景标签、采用状态或不存在的关联 ID。')
        if not require_complete:
            instruction += '旧局部修订保留范围外原有缺项，不扩展本次字段修改范围。'
    if args.get('design_scope'):
        instruction += '\n这是预先限定范围的局部修订。只能替换 design_scope 中列出的完整 Note，必须保留其余字段、来源、对象身份、顺序与关联，返回完整工作单；不得补齐范围外的未完成字段。'
    if require_complete:
        instruction += ('\n整场设计完成后每项保留内容必须有范围。按具体字段职责确定全场背景或全场规则，'
                        '摄影继承 shot_id，节拍／事件／调度／验收要求可复用镜头明确覆盖；'
                        '表演、镜内活动、连续性变化和对白的有内容字段分别声明镜头或出现项范围，'
                        '不能仅凭共用人物、节拍、触发事件或锚点推断。背景用途不能掩盖动作或约束；'
                        '恰好适用于全部现有镜头仍用 shots，不改为全场。未知可选技术值不必编造。'
                        '每镜须有可见结果与摄影工作单。缺少承接镜头可调整或增加必要镜头，'
                        '同时补齐摄影与受影响关系；保留有效原文事实、已有内容和用户约束，不得删除内容凑齐关系。')
    if args.get('instruction_scope'):
        instruction += '\n这是预先限定的正文局部修订。instruction_scope 的 start/end 是原 unit.instruction 的 Unicode 字符半开范围，只修改此范围，范围外逐字保留；仍返回完整正文 text，不只返回替换片段。'
    model_args = args
    if kind == 'directing_instruction':
        model_args = {key: value for key, value in args.items() if key != 'design'}
    elif kind == 'directing_instruction_check':
        model_args = {**args, 'inputs': {key: value for key, value in args['inputs'].items()
                                         if key != 'design'}}
    messages = [
        SystemMessage(content=instruction + '\nNote 的 fact/proposal 必须有 text 和 sources；其余状态不得带 text，none/not_applicable 必须有 reason。Source.version 必须是字符串，例如 "1"。所有关联 ID 必须存在于本工作单对应列表。\n仅返回符合以下 JSON Schema 的 JSON 对象，不添加 Markdown：\n' + json.dumps(contract.model_json_schema(), ensure_ascii=False)),
        HumanMessage(content=json.dumps(model_args, ensure_ascii=False)),
    ]
    retained_fields = set()
    for attempt in range(2):
        response = llm.invoke(messages)
        content = response.content
        if not isinstance(content, str):
            raise DirectingOutputError("导演模型未返回文本 JSON")
        text = content.strip()
        if text.startswith("```") and "\n" in text:
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        try:
            result = contract.model_validate_json(text, context={"require_shot_participants": kind == "directing_design" and not args.get("design_scope")})
            if kind == 'directing_design' and args.get('scene_version_design'):
                original = EditableSceneDesign.model_validate(args['previous_design'])
                result = record_chapter_generation_source(original, result, args['task_identity'], args.get('source'))
                validate_model_sources(original, result, args['task_identity'])
                validate_new_design_row_ids(result, original)
                if args.get('existing_assets') is not None:
                    assets = {(row['kind'], row['id']) for row in args['existing_assets']}
                    for participant in result.participants:
                        if participant.character_id and ('character', participant.character_id) not in assets:
                            raise ValueError('人物引用了当前项目不存在的角色资产')
                        if participant.prop_id and ('prop', participant.prop_id) not in assets:
                            raise ValueError('参与对象引用了当前项目不存在的道具资产')
                    if result.direction.location_asset_id and ('scene', result.direction.location_asset_id) not in assets:
                        raise ValueError('场所引用了当前项目不存在的场所资产')
                if args.get('design_scope'):
                    from app.services.directing.scene_design_scope import validate_design_scope  # pylint: disable=import-outside-toplevel
                    validate_design_scope(args['design_scope'], original.model_dump(mode='json'), result.model_dump(mode='json'))
                else:
                    result.style_revision_id = args.get('style_revision_id')
                if args.get('scene_version_content'):
                    SceneVersionContent.model_validate({**args['scene_version_content'], 'design': result.model_dump(mode='json')})
                if require_complete:
                    fields = resolved_design_fields(result)
                    present = {(row.owner, row.field) for row in fields if row.has_content}
                    removed = retained_fields - present
                    if removed:
                        raise ValueError('修正不能删除已有有效内容：' + '、'.join(f'{owner}.{name}' for owner, name in sorted(removed)))
                    retained_fields.update(present)
                    issues = design_scope_issues(result, fields)
                    if issues:
                        raise ValueError('设计未完整：' + '；'.join(
                            f'{issue.owner}.{issue.field}：{issue.reason}' for issue in issues))
            break
        except (ValidationError, ValueError) as error:
            errors = error.errors(include_url=False, include_input=False, include_context=False) if isinstance(error, ValidationError) else [{'loc': ['sources' if isinstance(error, DesignSourceError) else 'design'], 'msg': str(error)}]
            if attempt == 1:
                diagnostics = (SceneDesignDiagnostics(output=content,
                    issues=[('.'.join(map(str, item['loc'])) or '工作单') + '：' + item['msg'] for item in errors])
                    if require_complete else None)
                if isinstance(error, DesignSourceError):
                    raise DirectingOutputError(str(error), diagnostics) from None
                paths = [(".".join(map(str, item["loc"])) or "工作单关联") + "：" + item["msg"] for item in errors[:8]]
                raise DirectingOutputError("导演输出结构校验失败，请重新生成或手动修正：" + "、".join(paths), diagnostics) from None
            # 结构与来源共用一次纠错，继续沿用 Worker 的取消回调和总时限。
            messages.extend([AIMessage(content=content), HumanMessage(content=
                "只修正以下结构、关联或来源错误，保留原文事实和既有设计意图，返回完整 JSON：\n" + json.dumps(errors, ensure_ascii=False))])
    if kind == "directing_instruction" and result.unit_id != args["unit"]["id"]:
        raise ValueError("模型更改了当前单元身份")
    if kind == "directing_instruction" and args.get('instruction_scope'):
        SceneInstructionScope.model_validate(args['instruction_scope']).validate_text(args['unit']['instruction'], result.text)
    if kind == "directing_instruction_check":
        inputs = InstructionInputs.model_validate(args['inputs'])
        result.validate_scope(inputs.unit.id, [item.id for item in inputs.unit.coverage],
                              scope=inputs.scope, instruction=args['instruction'], references=inputs.unit.references,
                              require_destinations=args.get('destination_contract_version') == 1)
    if kind == "directing_divide":
        cursor = 0
        for scene in result.scenes:
            start = args["script_text"].find(scene.excerpt, cursor)
            if start < 0:
                raise ValueError("划场摘录不是按顺序出现的原文，请重新分析或手动划场")
            cursor = start + len(scene.excerpt)
    if kind == "directing_review":
        if result.occurrences != ReviewPacket.model_validate(args["packet"]).occurrences or result.roles != args["packet"]["roles"]:
            raise ValueError("模型改变了送审清单")
        if any(row.verdict == "pending" for row in result.rows):
            raise ValueError("审稿未完成")
    if kind == "directing_review_revision":
        from app.services.directing.review_revision import validate_candidate  # pylint: disable=import-outside-toplevel
        result, _, _ = validate_candidate(args["revision_context"], result)
    if kind == "directing_design" and not args.get('scene_version_design'):
        # 风格身份来自用户冻结输入，不采信模型生成的其他版本 ID。
        if args.get('design_scope'):
            from app.services.directing.scene_design_scope import validate_design_scope  # pylint: disable=import-outside-toplevel
            previous = EditableSceneDesign.model_validate(args['previous_design']).model_dump(mode='json')
            validate_design_scope(args['design_scope'], previous, result.model_dump(mode='json'))
        else:
            result.style_revision_id = args.get("style_revision_id")
    return result


class DirectingAIService(WorkspaceService):
    """提交真实文本任务；任务成功只保留建议，人工采用走已有版本保护。"""

    async def submit_ai(self, *, kind: str, body: AIRequest, chapter_id: str | None = None,
                        sequence_id: str | None = None, extra: dict | None = None, request_context: dict | None = None) -> Task:
        """冻结原文、人工意见和起始版本，避免 AI 在后台读取变化中的工作区。"""
        if sequence_id:
            await self.current_sequence(sequence_id)
        if kind not in RESULT_CONTRACTS or kind in {"directing_instruction", "directing_instruction_check"}:
            raise ValueError("未知导演操作")
        model = await get_model_by_category(self.db, ModelCategoryKey.text, model_or_id=body.model_id)
        provider = await self.db.get(Provider, model.provider_id)
        config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
        args = {"instruction": body.instruction, "task_identity": uuid4().hex}
        if sequence_id:
            sequence = await self.read_sequence(sequence_id)
            if sequence.source_changed:
                raise ValueError("原文已变化，请先更新场次范围")
            args.update(script_text=sequence.source_text, sequence_id=sequence_id,
                        sequence_version=sequence.version, chapter_id=sequence.chapter_id,
                        source=sequence.source.model_dump(mode="json"))
        else:
            await self.chapter(chapter_id)
            await self.db.scalar(select(Chapter).where(Chapter.id == chapter_id).with_for_update().execution_options(populate_existing=True))
            members = list(await self.db.scalars(select(Sequence).where(Sequence.chapter_id == chapter_id,
                Sequence.is_current.is_(True)).order_by(Sequence.id).with_for_update().execution_options(populate_existing=True)))
            args['division_baseline'] = {row.id: row.version for row in members}
            chapter = await self.list_sequences(chapter_id)
            args.update(script_text=chapter.raw_text, chapter_id=chapter.chapter_id, source_version=chapter.source_version)
        if not args["script_text"].strip():
            raise ValueError("请先填写章节原文")
        if kind == "directing_design":
            args["style_revision_id"] = body.style_revision_id
            args["style_rules"] = [rule.model_dump(mode="json") for rule in await self.applicable_style(body.style_revision_id, sequence_id, model.name)]
            characters = list(await self.db.scalars(select(Character).where(Character.project_id == self.project_id)))
            locations = list(await self.db.scalars(select(Scene).join(ProjectSceneLink, ProjectSceneLink.scene_id == Scene.id).where(ProjectSceneLink.project_id == self.project_id)))
            props = list(await self.db.scalars(select(Prop).join(ProjectPropLink, ProjectPropLink.prop_id == Prop.id).where(ProjectPropLink.project_id == self.project_id)))
            args["existing_assets"] = {
                "characters": [{"id": row.id, "name": row.name, "description": row.description} for row in characters],
                "locations": [{"id": row.id, "name": row.name, **{key: getattr(row, key) for key, _ in row.description_fields}} for row in locations],
                "props": [{"id": row.id, "name": row.name, **{key: getattr(row, key) for key, _ in row.description_fields}} for row in props],
            }
        if body.revision_id:
            revision = await self.revision(body.revision_id, kind="design", sequence_id=sequence_id)
            if revision.version != body.expected_version:
                raise ValueError("导演草稿已变化，请刷新")
            args.update(starting_revision_id=revision.id, starting_version=revision.version, previous_design=revision.payload)
        if extra:
            args.update(extra)
        if kind == "directing_review_revision":
            args["revision_context"]["task_identity"] = args["task_identity"]
        return await TaskService(self.db).submit(
            kind=kind, title={"directing_divide": "分析章节场次", "directing_design": "生成导演方案", "directing_review": "六部门审稿", "directing_review_revision": "生成检查修改方案"}[kind],
            snapshot={**(request_context or {}), "model_id": model.id, "model_name": model.name, "provider_key": config.provider_key, "run_args": args,
                      **({'division_versioning': 1} if kind == 'directing_divide' else {})},
            provider_id=provider.id, project_id=self.project_id,
            target_type="directing_sequence" if sequence_id else "directing_chapter", target_id=sequence_id or chapter_id,
        )

    async def apply_design(self, sequence_id: str, task_id: str) -> DirectingRevision:
        """显式采用成功建议；迟到结果生成独立草稿，不覆盖更新后的人工版本。"""
        sequence = await self.current_sequence(sequence_id)
        task = await self.db.get(Task, task_id)
        if task is None or task.project_id != self.project_id or task.target_id != sequence_id or task.kind != "directing_design" or task.status != "succeeded":
            raise ValueError("没有可采用的导演任务结果")
        if task.input_snapshot.get("scene_design"):
            raise ValueError("场次版本建议须在原版本预览并明确应用")
        args = task.input_snapshot["run_args"]
        content = SceneDesign.model_validate(task.result)
        # Model provenance stays separate from the exact chapter version used for generation.
        content.sources.append(sequence_source := Source.model_validate(args["source"]))
        if sequence_source.version != sequence.source["version"] or args["sequence_version"] != sequence.version:
            raise ValueError("场次原文或范围已变化；旧建议仍保留在任务结果，请重新设计")
        revision_id, expected_version = None, None
        previous_id = args.get("starting_revision_id")
        if previous_id:
            previous = await self.revision(previous_id, kind="design", sequence_id=sequence_id)
            if previous.confirmed_at is None and previous.version == args["starting_version"]:
                revision_id, expected_version = previous.id, previous.version
        return await self.save_revision(sequence_id, kind="design", payload=content.model_dump(mode="json"),
                                        revision_id=revision_id, expected_version=expected_version)


    async def read_task(self, task_id: str) -> DirectingTaskRead:
        """仅返回本项目导演任务的类型化结果，不暴露凭据或供应商原始响应。"""
        task = await self.db.get(Task, task_id)
        if task is None or task.project_id != self.project_id or task.target_type not in {"directing_chapter", "directing_sequence", "directing_unit", "directing_image"}:
            raise ValueError("任务不属于当前工作区")
        result = {}
        result_key = {"directing_instruction_check": "instruction_check", "directing_instruction": "scene_instruction", "directing_divide": "division", "directing_design": "design", "directing_review": "review", "directing_review_revision": "revision"}.get(task.kind)
        if task.status == "succeeded" and result_key and task.input_snapshot.get("scene_design"):
            result["scene_design"] = EditableSceneDesign.model_validate(task.result)
        elif task.status == "succeeded" and result_key:
            result[result_key] = RESULT_CONTRACTS[task.kind].model_validate(task.result)
        if task.status == "succeeded" and task.target_type == "directing_image":
            result["image_file_ids"] = list(await self.db.scalars(select(TaskOutput.file_id).where(TaskOutput.task_id == task.id).order_by(TaskOutput.ordinal)))
        if task.kind == "directing_review_revision":
            result["revision_request"] = task.input_snapshot.get("revision_request")
            result["revision_application"] = task.input_snapshot.get("revision_application")
        return DirectingTaskRead(task_id=task.id, kind=task.kind, status=task.status,
                                 error=task.error_message,
                                 division_baseline=task.input_snapshot.get("run_args", {}).get("division_baseline"),
                                 source_version=task.input_snapshot.get("run_args", {}).get("source_version"), **result)
