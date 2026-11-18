"""导演任务的冻结输入、纯 AI 计算和显式采用；网络调用复用统一 Worker。"""

import json
from uuid import uuid4

from httpx import HTTPError
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from openai import APIError
from pydantic import ValidationError
from sqlalchemy import select

from app.core.contracts.directing.shooting_preparation import ShootingCheckReport
from app.core.contracts.directing.common import Source
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.production import ReviewPacket
from app.core.contracts.directing.scene_objects import SceneObjectExtraction
from app.core.contracts.directing.scene_storyboard import SceneStoryboard, StoryboardOrganization
from app.services.chapters.explanations import explanation_basis
from app.services.directing.storyboard_assembly import STORYBOARD_KIND, validate_storyboard
from app.services.directing.storyboard_scope import REQUIRED_SUBJECTS, SUBJECT_PORTS, organization_inputs, validate_organization
from app.core.contracts.directing.review_revision import ReviewRevisionCandidate
from app.core.contracts.directing.workspace import AIRequest, DivisionResult
from app.models.directing import DirectingRevision, Sequence
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task
from app.models.studio import Chapter, Character, Scene, Prop, ProjectSceneLink, ProjectPropLink
from app.services.directing.errors import DirectingOutputError
from app.services.directing.scene_objects import OBJECT_EXTRACTION_KIND, object_candidates
from app.services.directing.workspace import WorkspaceService
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService


STORYBOARD_ORGANIZATION = 'directing_storyboard_organization'
RESULT_CONTRACTS = {
    'directing_shooting_check': ShootingCheckReport,
    STORYBOARD_KIND: SceneStoryboard,
    STORYBOARD_ORGANIZATION: StoryboardOrganization,
    OBJECT_EXTRACTION_KIND: SceneObjectExtraction,
    'directing_divide': DivisionResult,
    'directing_design': SceneDesign,
    'directing_review': ReviewPacket,
    'directing_review_revision': ReviewRevisionCandidate,
}


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
        "directing_shooting_check": (
            "这是面向章节原文的整章拍摄检查。分析人物路线、具体动作及空间关系，保留原文意思。"
            "解释是创作者的拍摄预期，供后续参考。不要安排镜头、机位、景别、剪辑或分镜验收条件。"
            "原文有依据的解释标 supported。需要创作者判断的问题标 insufficient_basis，明确矛盾标 conflict，"
            "未由原文确定且有实际补充价值的可选拍法标 optional，不猜测作者意图。"
            "先判断原文动作能否成立。动作成立时，未写下车后是否绕车、绕车路线、距离、朝向或用哪只手都属正常留白。"
            "不要为这些留白输出任何条目，也不要转成可选建议。只有原文明示的动作或关系无法成立，或与已有拍摄解释冲突，才指出具体依据。"
            "原文支持的推断不得超出证据覆盖的时间。比如“摘下墨镜”只支持摘下前戴着墨镜，"
            "不能据此推断下车或打招呼时就戴着。单纯复述已明确的动作无需补充解释。没有值得报告的内容时返回空 issues。"
            "有原文依据时 excerpt 逐字引用原文，无法定位时留空，由用户确认适用范围。针对已有解释填写真实 note_id。对可采用的新增解释填写 proposed_change=add，"
            "对明确修改的已有解释填写 proposed_change=update 及目标 note_id，两者的 suggestion 都填写完整解释。"
            "纯疑点不填 proposed_change；语义问题归 source，仅提示。每个目标最多提出一个修改。"
        ),
        "directing_divide": "将章节分成连续叙事场次。excerpt 必须逐字复制原文中连续的一段，不得改写，按原文顺序排列。不同地点或时间转换可分场，不按镜头分场。",
        "directing_design": "根据场次原文、已有资产与人工意见，设计可拍摄的六部门工作单。已有资产只有适用于本场时才引用其 ID，不得凭空编造资产 ID，不得让资产设定改变原文事实。镜头与节拍使用稳定 ID。保留剧情事实。所有角色、对白、背景行为和摄影必须有因果。未知技术值标 unknown，不适用给理由。不得自称用户确认。每镜必须有摄影行，并明确 participant_ids，引用本工作单的参与对象 ID；包括实际参与的静态车辆与手持物件。明确无对象用空列表，不得省略或使用 null，不因同一节拍或全场名单就把其他镜头对象加入。所有有内容的 Note 必须带 model 来源，reference 使用所提供的 task_identity，version 使用 1。",
        "directing_review": "以六部门分别审查本轮每个镜头出现项。严格保留提供的 roles 和 occurrences，不得减少、更换、合并。同一镜头不同单元分别检查。每行给出 pass 或 revise、具体理由及可执行修改建议。检查共同空间、先后反应、参考绑定、摄影、声音和相邻衔接。模型不能授权用户执行。",
    }[kind]
    if "source_explanations" in args:
        instruction += "\nsource_explanations 是用户确认的原意解释，仅用于理解，不能冒充原文摘录、新增剧情或覆盖正文冲突；只采用适用于当前摘录的解释。解释 start/end 为整章 Unicode 字符半开范围，script_text 从 source_start 开始；不得把其他位置同名词的解释套到当前片段。kind=normal 表示用户确认的正常表述，不反复报为异常。"
    if args.get('shooting_notes'):
        instruction += "\nshooting_notes 是按本场原文范围选入的章节拍摄解释，两种模式均用于理解空间、动作和状态；不是必须逐条满足的执行约束，也不构成验收门槛。choice=delegate 交由生成设计。与原文事实分别表达，不伪造原文摘录，不覆盖原文冲突，不视为模型自行新增的场次情节。"
    model_args = args
    if kind == STORYBOARD_KIND:
        from app.services.directing.storyboard_assembly import storyboard_design_fields
        model_args = {'mode': args['mode'], 'script_text': args['script_text'],
                      'objects': [{key: item[key] for key in ('id', 'kind', 'name', 'excerpt')} for item in args['objects']],
                      'source_explanations': args.get('source_explanations', []), 'source_start': args.get('source_start'),
                      'shooting_notes': args.get('shooting_notes', []),
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
            result = contract.model_validate_json(text, context={"require_shot_participants": kind == "directing_design"})
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
    if kind == 'directing_shooting_check':
        notes = {note['id'] for note in args['shooting_preparation']['notes']}
        if len({issue.id for issue in result.issues}) != len(result.issues):
            raise ValueError('拍摄检查建议身份重复')
        updates = set()
        for issue in result.issues:
            if issue.excerpt and issue.excerpt not in args['script_text']:
                raise ValueError('拍摄检查引用了原文不存在的内容')
            if issue.note_id is not None and issue.note_id not in notes:
                raise ValueError('拍摄检查引用了不存在的拍摄解释')
            if issue.proposed_change and (not issue.suggestion.strip() or issue.category == 'source'):
                raise ValueError('可采用的拍摄建议必须提供完整解释')
            if issue.kind == 'supported' and not issue.excerpt:
                raise ValueError('原文可支持的解释必须引用依据')
            if issue.proposed_change == 'update':
                if not issue.note_id or issue.note_id in updates:
                    raise ValueError('修改建议必须指向不同的已有解释')
                updates.add(issue.note_id)
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
