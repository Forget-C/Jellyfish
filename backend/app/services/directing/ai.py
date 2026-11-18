"""导演任务的冻结输入、纯 AI 计算和显式采用；网络调用复用统一 Worker。"""

import json
from uuid import uuid4

from httpx import HTTPError
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from openai import APIError
from pydantic import ValidationError
from sqlalchemy import select

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.scene_version import EditableSceneDesign
from app.core.contracts.directing.scene_design import SceneDesignDiagnostics, parse_scene_design_candidate
from app.core.contracts.directing.production import ReviewPacket
from app.core.contracts.directing.instruction_check import InstructionCheckResult
from app.core.contracts.directing.scene_objects import SceneObjectExtraction
from app.core.contracts.directing.scene_storyboard import SceneStoryboard, StoryboardOrganization
from app.services.chapters.explanations import explanation_basis
from app.services.directing.storyboard_assembly import STORYBOARD_KIND, validate_storyboard
from app.services.directing.storyboard_scope import REQUIRED_SUBJECTS, SUBJECT_PORTS, organization_inputs, validate_organization
from app.core.contracts.directing.scene_instruction import SceneInstructionResult
from app.core.contracts.directing.review_revision import ReviewRevisionCandidate
from app.core.contracts.directing.workspace import AIRequest, DivisionResult, DirectingTaskRead
from app.models.directing import DirectingRevision, Sequence
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task, TaskOutput
from app.models.studio import Chapter, Character, Scene, Prop, ProjectSceneLink, ProjectPropLink
from app.services.directing.scene_objects import OBJECT_EXTRACTION_KIND, object_candidates
from app.services.directing.workspace import WorkspaceService
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


STORYBOARD_ORGANIZATION = 'directing_storyboard_organization'
RESULT_CONTRACTS = {
    STORYBOARD_KIND: SceneStoryboard,
    STORYBOARD_ORGANIZATION: StoryboardOrganization,
    OBJECT_EXTRACTION_KIND: SceneObjectExtraction,
    'directing_divide': DivisionResult,
    'directing_design': SceneDesign,
    'directing_review': ReviewPacket,
    'directing_review_revision': ReviewRevisionCandidate,
}
HISTORICAL_RESULT_CONTRACTS = {
    'directing_instruction': SceneInstructionResult,
    'directing_instruction_check': InstructionCheckResult,
}


class DirectingOutputError(ValueError):
    """可显示的错误摘要；模型输出仅保存在任务内部诊断中。"""

    def __init__(self, message: str, diagnostics: SceneDesignDiagnostics | None = None):
        """模型主动返回的工作单另存只读诊断，不混入错误摘要或成功结果。"""
        super().__init__(message)
        self.diagnostics = diagnostics
        self.storyboard_structure: dict | None = None


def generate_directing_result(kind: str, llm, args: dict):
    """在 Worker 有界线程执行，返回严格结构，绝不由模型直接批准或覆盖工作单。"""

    if kind == 'directing_design' and args.get('scene_version_design'):
        raise ValueError('旧场次版本任务已退役')
    contract = RESULT_CONTRACTS[kind]
    instruction = {
        STORYBOARD_KIND: (
            "根据 mode 生成场次分镜：按原文顺序，以唯一逐字摘录作为各镜头证据。"
            "faithful 忠实提取仅识别原文写明的内容，不允许 proposal。"
            "complete 完整分镜优先保留原文事实，再补足当前镜头确实需要的导演、表演、调度、摄影、连续性、声音和提示设计。"
            "补写、取舍与摄影安排必须使用 proposal；不得标为 fact。适用的建议可带作为依据的原文摘录，但不得伪造出处。"
            "两种模式的事实字段 text 均须逐字来自 excerpt，未知用 undecided，明确没有或不适用保留摘录和理由。"
            "不强求所有部门和字段都有值，不改变原文情节，不编造人物、道具资产、文件、模型和画布身份。"
            "先确定全场共同状态：人物与道具的位置、相对朝向、持物手、动作状态、摄影机轴线所在侧。"
            "用已有空间、站位、表演和连续性卡表达，不额外输出隐藏工作单。原文未写明的共同状态在忠实模式保留 undecided；完整模式只补必要的可拍安排并标为 proposal。"
            "明确区分人物自身左右、画面左右与靠近镜头的一侧，避免使用有歧义的画面前方。人物扭身或机位改变必须明确交代。"
            "提交前交叉核对共享机位、人物朝向、持物可见性与景别，逐镜安排不得与共享设计矛盾。"
            "逐镜核对前镜后态和本镜前态，用 direction.continuity 的 before、change、after、following_constraints 写清继承状态、允许变化、结束状态及后续约束。"
            "摄影切到人物、道具或动作细节只改变展示范围，不凭空让人物入场、换手、换位或改变动作阶段。对象出画仍须保持场内状态。"
            "镜头 object_ids 只列实际出现的对象，使用准备对象 ID，或原文确有漏提时使用 missed_objects 中有出处的临时 ID。场所可列入这里。"
            "简单直接设计放在镜头 designs 内，共用或跨镜设计放到全场 designs，从 supported_design_fields 选择。"
            "按字段用 scope 声明 shot_ids、phase、condition_id、occurrence_ids，没限制就省略；声音/后期仅在对应 phase。"
            "conditions 定义稳定条件键，只在镜头或 occurrences 的 condition_ids 中列实际成立的条件。"
            "设计卡的 object_id 是主体关系，只允许 subject_card_types 中的卡片填写。其他卡片省略它，即使正文提到了对象。"
            "required_subject_card_types 中的卡片只要有事实或建议就须填主体。主体通常是适用镜头 object_ids 中实际参与的人物或道具，不能是场所。"
            "必要的镜外对象状态使用有明确镜头或出现项范围的 direction.continuity，填写已知 object_id，采用用途为 design 或 constraint 并直接供模型采用。"
            "如果前态证据来自前镜，把连续性设计放在全场 designs 并明确适用镜头。不要为了保留镜外约束而把主体加进可见参与名单。"
            "需要的连续性依赖以逻辑设计 ID、实际字段和关系表达。仅作被引用依据的卡用 adoption=dependency。"
            "运镜画面写入 phases，构图或图片目标以 design_id、phase_id 指定。"
            "仅在明确有独立制作动作时列 occurrences，摘录按序覆盖整个镜头，可缩小参与对象。"
            "estimated_seconds 仅填写已有明确值或完整模式的实际设计估计；未知留空。"
        ),
        STORYBOARD_ORGANIZATION: (
            "组织所给镜头的既有连续动作，不改写设计或添加情节。保留镜头顺序。"
            "已有 occurrences 必须逐项原样复制 id 和 excerpt；否则按原文连续片段拆分，完整覆盖不重叠。"
            "根据已验证的生产模型能力填写支持的 ratio 和整秒 seconds。总时长已知时各段相加须保持原值。"
            "时长未知保留待配置。不得生成资产、媒体、镜头或模型 ID。"
        ),
        OBJECT_EXTRACTION_KIND: "仅从场次原文提取明确出现的角色、场所和道具。每项提供类型、名称、简短描述及原样复制、在本场可唯一定位的摘录。不要合并原文中的同名不同对象。只有能从给定资产目录确认同一对象时才提出对应 asset_id，不确定时留空。不得构造身份、文件或分镜。没有对象返回空清单。",
        "directing_review_revision": "评估固定检查意见（review=null 时为用户主动修改，不得伪造问题）和整体 instruction。人工 request.edits 必须原样保留，不得覆盖；主动修改 changes.problem_keys 和 outcomes 可为空；用 summary 的 status/reason/choices 说明整体结果，status 为 planned、needs_choice、unresolved 或 unchanged。无实际变化用 unchanged，超出范围用 unresolved，必要选择用 needs_choice 和至少两项 choices，不能伪造检查问题。preview_text/candidate_identity/source_prompt_revision_id 留空，由服务端渲染。仅替换 revision_context.allowed_design_fields 或 allowed_unit_fields 列出的已有字段；before 必须逐字复制固定字段，input_identity 原样返回。不得增加 applicable_shot_ids 等不存在字段，不得增删身份或引用。sound.execution 只有 generated/postproduction/unknown。检查意见不是事实，不能通过删除正确设计掩盖编译器或供应商限制；此类问题返回 unresolved。原文事实优先；必要创作取舍返回 needs_choice 及至少两个简短选项，不猜测用户意图。每个 problem_keys 中的问题都必须有 outcome，即使用户没有填写方向，planned 必须关联实际修改。不能修复的问题明确解释。只输出必要修改，不能宣称新检查通过。Note 新来源使用 revision_context.task_identity。声音制作方式必须有 direction.sound_execution 明确选择才能拟落实，不能从自由文本猜测。",
        "directing_divide": "将章节分成连续叙事场次。excerpt 必须逐字复制原文中连续的一段，不得改写，按原文顺序排列。不同地点或时间转换可分场，不按镜头分场。",
        "directing_design": "根据场次原文、已有资产与人工意见，设计可拍摄的六部门工作单。已有资产只有适用于本场时才引用其 ID，不得凭空编造资产 ID，不得让资产设定改变原文事实。镜头与节拍使用稳定 ID。保留剧情事实。所有角色、对白、背景行为和摄影必须有因果。未知技术值标 unknown，不适用给理由。不得自称用户确认。每镜必须有摄影行，并明确 participant_ids，引用本工作单的参与对象 ID；包括实际参与的静态车辆与手持物件。明确无对象用空列表，不得省略或使用 null，不因同一节拍或全场名单就把其他镜头对象加入。所有有内容的 Note 必须带 model 来源，reference 使用所提供的 task_identity，version 使用 1。",
        "directing_review": "以六部门分别审查本轮每个镜头出现项。严格保留提供的 roles 和 occurrences，不得减少、更换、合并。同一镜头不同单元分别检查。每行给出 pass 或 revise、具体理由及可执行修改建议。检查共同空间、先后反应、参考绑定、摄影、声音和相邻衔接。模型不能授权用户执行。",
    }[kind]
    if args.get('design_scope'):
        instruction += '\n这是预先限定范围的局部修订。只能替换 design_scope 中列出的完整 Note，必须保留其余字段、来源、对象身份、顺序与关联，返回完整工作单；不得补齐范围外的未完成字段。'
    if "source_explanations" in args:
        instruction += "\nsource_explanations 是用户确认的原意解释，仅用于理解，不能冒充原文摘录、新增剧情或覆盖正文冲突；只采用适用于当前摘录的解释。解释 start/end 为整章 Unicode 字符半开范围，script_text 从 source_start 开始；不得把其他位置同名词的解释套到当前片段。kind=normal 表示用户确认的正常表述，不反复报为异常。"
    model_args = args
    if kind == STORYBOARD_KIND:
        from app.services.directing.storyboard_assembly import storyboard_design_fields
        model_args = {'mode': args['mode'], 'script_text': args['script_text'],
                      'objects': [{key: item[key] for key in ('id', 'kind', 'name', 'excerpt')} for item in args['objects']],
                      'source_explanations': args.get('source_explanations', []), 'source_start': args.get('source_start'),
                      'supported_design_fields': storyboard_design_fields(),
                      'subject_card_types': sorted(SUBJECT_PORTS),
                      'required_subject_card_types': sorted(REQUIRED_SUBJECTS)}
    elif kind == STORYBOARD_ORGANIZATION:
        model_args = args
    note_rules = (
        '分镜字段用 excerpt 表示出处。fact 必须同时有 text 和 excerpt，proposal 必须有 text，可选 excerpt。'
        '其他状态不得带 text，absent 和 not_applicable 必须有 excerpt 和 reason。'
        if kind == STORYBOARD_KIND else ''
        if kind == STORYBOARD_ORGANIZATION else
        'Note 的 fact/proposal 必须有 text 和 sources；其余状态不得带 text，none/not_applicable 必须有 reason。'
        'Source.version 必须是字符串，例如 "1"。所有关联 ID 必须存在于本工作单对应列表。'
    )
    messages = [
        SystemMessage(content=f'{instruction}\n{note_rules}\n仅返回符合以下 JSON Schema 的 JSON 对象，不添加 Markdown：\n'
                      + json.dumps(contract.model_json_schema(), ensure_ascii=False)),
        HumanMessage(content=json.dumps(model_args, ensure_ascii=False)),
    ]
    structure_saved = args.get('structure_resume') if kind == STORYBOARD_KIND else None
    if structure_saved:
        from app.services.directing.storyboard_structure import structure_feedback
        messages.append(HumanMessage(content=structure_feedback(structure_saved)))
    structure_failed = structure_saved
    structure_original = structure_saved.get('draft') if structure_saved else None
    structure_issues = structure_saved.get('issues', []) if structure_saved else []
    for attempt in range(1 if structure_saved else 2):
        if kind == STORYBOARD_KIND and structure_failed and args.get('structure_checkpoint'):
            args['structure_checkpoint'](structure_failed)
        try:
            response = llm.invoke(messages)
        except (HTTPError, APIError) as error:
            if kind == STORYBOARD_KIND and structure_failed:
                failure = DirectingOutputError('结构纠错调用未完成，原输出已保留，请核对后重试')
                failure.storyboard_structure = structure_failed
                raise failure from error
            raise
        content = response.content
        if not isinstance(content, str):
            raise DirectingOutputError("导演模型未返回文本 JSON")
        text = content.strip()
        if text.startswith("```") and "\n" in text:
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        try:
            if kind == STORYBOARD_KIND and structure_original:
                from app.services.directing.storyboard_structure import structure_choices
                choices = structure_choices(text)
                if choices is not None:
                    reason = json.loads(text).get('reason') or ('关联存在多种合理解释，需要选择修正方向。' if choices else '缺少可靠修正依据，无法自动决定对象关联或设计范围。')
                    reason = str(reason)[:1200]
                    failure = DirectingOutputError('结构纠错需要创作选择，请核对方案后继续' if choices else '无法形成可靠纠错方案，请核对设计依据或明确重新生成')
                    failure.storyboard_structure = {'output': text, 'draft': structure_original,
                        'issues': structure_issues + [reason], 'options': choices, 'decision_reason': reason, 'attempt_issues': [reason],
                        **({'draft_issues': (structure_saved or structure_failed)['draft_issues']} if 'draft_issues' in (structure_saved or structure_failed or {}) else {})}
                    raise failure
            result = contract.model_validate_json(text, context={"require_shot_participants": kind == "directing_design" and not args.get("design_scope")})
            if kind == STORYBOARD_KIND:
                if structure_original:
                    from app.services.directing.storyboard_structure import validate_structure_repair
                    validate_structure_repair(structure_original, result.model_dump(mode='json'), structure_issues, args['objects'])
                validate_storyboard(result, args)
            if kind == STORYBOARD_ORGANIZATION:
                validate_organization(result, args)
            if kind == OBJECT_EXTRACTION_KIND:
                object_candidates(result, args)
            break
        except (ValidationError, ValueError) as error:
            if isinstance(error, DirectingOutputError) and error.storyboard_structure:
                raise
            errors = (error.errors(include_url=False, include_input=False, include_context=False)
                      if isinstance(error, ValidationError) else [{'loc': ['design'], 'msg': str(error)}])
            if attempt == 1 or structure_saved:
                paths = [(".".join(map(str, item["loc"])) or "工作单关联") + "：" + item["msg"] for item in (errors if kind == STORYBOARD_KIND else errors[:8])]
                failure = DirectingOutputError("导演输出结构校验失败，请重新生成或手动修正：" + "、".join(paths))
                if kind == STORYBOARD_KIND:
                    from app.services.directing.storyboard_structure import retained_structure
                    failure.storyboard_structure = retained_structure(text, paths)
                    failure.storyboard_structure['attempt_issues'] = paths
                    if structure_original:
                        failure.storyboard_structure['draft'] = structure_original
                        if 'draft_issues' in (structure_saved or structure_failed or {}):
                            failure.storyboard_structure['draft_issues'] = (structure_saved or structure_failed)['draft_issues']
                        else:
                            failure.storyboard_structure.pop('draft_issues', None)
                        failure.storyboard_structure['issues'] = structure_issues + paths
                raise failure from None
            # 结构、来源与单元范围共用一次纠错，沿用 Worker 的取消回调和总时限。
            feedback = errors
            if kind == STORYBOARD_KIND:
                from app.services.directing.storyboard_structure import retained_structure
                structure_issues = [('.'.join(map(str, item['loc'])) or '工作单') + '：' + item['msg'] for item in errors]
                structure_failed = retained_structure(text, structure_issues)
                structure_original = structure_failed['draft']
            repair_instruction = '只修正以下结构、关联或来源错误，保留原文事实和既有设计意图，返回完整 JSON：\n'
            if kind == STORYBOARD_KIND:
                from app.services.directing.storyboard_structure import CHOICE_INSTRUCTION
                repair_instruction = CHOICE_INSTRUCTION + repair_instruction
            messages.extend([AIMessage(content=content), HumanMessage(content=
                repair_instruction + json.dumps(feedback, ensure_ascii=False))])
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
    if kind == "directing_design":
        # 风格身份来自用户冻结输入，不采信模型生成的其他版本 ID。
        if args.get('design_scope'):
            from app.services.directing.scene_design_scope import validate_design_scope  # pylint: disable=import-outside-toplevel
            previous = EditableSceneDesign.model_validate(args['previous_design']).model_dump(mode='json')
            validate_design_scope(args['design_scope'], previous, result.model_dump(mode='json'))
        else:
            result.style_revision_id = args.get("style_revision_id")
    if kind == STORYBOARD_KIND and (inputs := organization_inputs(result, args)):
        organized = generate_directing_result(STORYBOARD_ORGANIZATION, llm, {
            'organization_inputs': inputs, 'production_capability': args['production_capability']})
        result.attach_production(organized)
    return result


class DirectingAIService(WorkspaceService):
    """提交真实文本任务；任务成功只保留建议，人工采用走已有版本保护。"""

    async def submit_ai(self, *, kind: str, body: AIRequest, chapter_id: str | None = None,
                        sequence_id: str | None = None, extra: dict | None = None, request_context: dict | None = None) -> Task:
        """冻结原文、人工意见和起始版本，避免 AI 在后台读取变化中的工作区。"""
        if sequence_id:
            await self.current_sequence(sequence_id)
        if kind not in RESULT_CONTRACTS:
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
        if kind == "directing_divide":
            args["source_explanations"] = explanation_basis(await self.chapter(args['chapter_id']))["items"]
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
            candidate = parse_scene_design_candidate(task.result, task.input_snapshot.get('run_args', {}))
            result["scene_design"] = candidate.design if candidate else EditableSceneDesign.model_validate(task.result)
        elif task.status == "succeeded" and result_key:
            contract = HISTORICAL_RESULT_CONTRACTS.get(task.kind) or RESULT_CONTRACTS[task.kind]
            result[result_key] = contract.model_validate(task.result)
        if task.status == "succeeded" and task.target_type == "directing_image":
            result["image_file_ids"] = list(await self.db.scalars(select(TaskOutput.file_id).where(TaskOutput.task_id == task.id).order_by(TaskOutput.ordinal)))
        if task.kind == "directing_review_revision":
            result["revision_request"] = task.input_snapshot.get("revision_request")
            result["revision_application"] = task.input_snapshot.get("revision_application")
        return DirectingTaskRead(task_id=task.id, kind=task.kind, status=task.status,
                                 error=task.error_message,
                                 division_baseline=task.input_snapshot.get("run_args", {}).get("division_baseline"),
                                 source_version=task.input_snapshot.get("run_args", {}).get("source_version"), **result)
