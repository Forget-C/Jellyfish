"""导演任务的冻结输入、纯 AI 计算和显式采用；网络调用复用统一 Worker。"""

import json
from uuid import uuid4

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import ValidationError
from sqlalchemy import select

from app.core.contracts.directing.common import Source
from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.production import ReviewPacket
from app.core.contracts.directing.workspace import AIRequest, DivisionResult, DirectingTaskRead
from app.models.directing import DirectingRevision
from app.models.llm import ModelCategoryKey, Provider
from app.models.task import Task
from app.models.studio import Character, Scene, Prop, ProjectSceneLink, ProjectPropLink
from app.services.directing.workspace import WorkspaceService
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import get_model_by_category
from app.services.task_service import TaskService

RESULT_CONTRACTS = {"directing_divide": DivisionResult, "directing_design": SceneDesign, "directing_review": ReviewPacket}


class DirectingOutputError(ValueError):
    """可显示的结构错误摘要，不携带模型正文或上游连接信息。"""


def generate_directing_result(kind: str, llm, args: dict):
    """在 Worker 有界线程执行，返回严格结构，绝不由模型直接批准或覆盖工作单。"""
    contract = RESULT_CONTRACTS[kind]
    instruction = {
        "directing_divide": "将章节分成连续叙事场次。excerpt 必须逐字复制原文中连续的一段，不得改写，按原文顺序排列。不同地点或时间转换可分场，不按镜头分场。",
        "directing_design": "根据场次原文、已有资产与人工意见，设计可拍摄的六部门工作单。已有资产只有适用于本场时才引用其 ID，不得凭空编造资产 ID，不得让资产设定改变原文事实。镜头与节拍使用稳定 ID。保留剧情事实。所有角色、对白、背景行为和摄影必须有因果。未知技术值标 unknown，不适用给理由。不得自称用户确认。每镜必须有摄影行。所有有内容的 Note 必须带 model 来源，reference 使用所提供的 task_identity，version 使用 1。",
        "directing_review": "以六部门分别审查本轮每个镜头出现项。严格保留提供的 roles 和 occurrences，不得减少、更换、合并。同一镜头不同单元分别检查。每行给出 pass 或 revise、具体理由及可执行修改建议。检查共同空间、先后反应、参考绑定、摄影、声音和相邻衔接。模型不能授权用户执行。",
    }[kind]
    messages = [
        SystemMessage(content=instruction + '\nNote 的 fact/proposal 必须有 text 和 sources；其余状态不得带 text，none/not_applicable 必须有 reason。Source.version 必须是字符串，例如 "1"。所有关联 ID 必须存在于本工作单对应列表。\n仅返回符合以下 JSON Schema 的 JSON 对象，不添加 Markdown：\n' + json.dumps(contract.model_json_schema(), ensure_ascii=False)),
        HumanMessage(content=json.dumps(args, ensure_ascii=False)),
    ]
    for attempt in range(2):
        response = llm.invoke(messages)
        content = response.content
        if not isinstance(content, str):
            raise DirectingOutputError("导演模型未返回文本 JSON")
        text = content.strip()
        if text.startswith("```") and "\n" in text:
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        try:
            result = contract.model_validate_json(text)
            break
        except ValidationError as error:
            errors = error.errors(include_url=False, include_input=False, include_context=False)
            if attempt == 1:
                paths = [(".".join(map(str, item["loc"])) or "工作单关联") + "：" + item["msg"] for item in errors[:8]]
                raise DirectingOutputError("导演输出结构校验失败，请重新生成或手动修正：" + "、".join(paths)) from None
            # 只允许一次结构纠错，继续沿用 Worker 的取消回调和总时限。
            messages.extend([AIMessage(content=content), HumanMessage(content=
                "只修正以下结构或关联错误，保留原文事实和既有设计意图，返回完整 JSON：\n" + json.dumps(errors, ensure_ascii=False))])
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
    return result


class DirectingAIService(WorkspaceService):
    """提交真实文本任务；任务成功只保留建议，人工采用走已有版本保护。"""

    async def submit_ai(self, *, kind: str, body: AIRequest, chapter_id: str | None = None,
                        sequence_id: str | None = None, extra: dict | None = None) -> Task:
        """冻结原文、人工意见和起始版本，避免 AI 在后台读取变化中的工作区。"""
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
            chapter = await self.list_sequences(chapter_id)
            args.update(script_text=chapter.raw_text, chapter_id=chapter.chapter_id, source_version=chapter.source_version)
        if not args["script_text"].strip():
            raise ValueError("请先填写章节原文")
        if kind == "directing_design":
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
        return await TaskService(self.db).submit(
            kind=kind, title={"directing_divide": "分析章节场次", "directing_design": "生成导演方案", "directing_review": "六部门审稿"}[kind],
            snapshot={"model_id": model.id, "model_name": model.name, "provider_key": config.provider_key, "run_args": args},
            provider_id=provider.id, project_id=self.project_id,
            target_type="directing_sequence" if sequence_id else "directing_chapter", target_id=sequence_id or chapter_id,
        )

    async def apply_design(self, sequence_id: str, task_id: str) -> DirectingRevision:
        """显式采用成功建议；迟到结果生成独立草稿，不覆盖更新后的人工版本。"""
        sequence = await self.sequence(sequence_id)
        task = await self.db.get(Task, task_id)
        if task is None or task.project_id != self.project_id or task.target_id != sequence_id or task.kind != "directing_design" or task.status != "succeeded":
            raise ValueError("没有可采用的导演任务结果")
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
        if task is None or task.project_id != self.project_id or task.target_type not in {"directing_chapter", "directing_sequence", "directing_unit"}:
            raise ValueError("任务不属于当前工作区")
        result = {}
        result_key = {"directing_divide": "division", "directing_design": "design", "directing_review": "review"}.get(task.kind)
        if task.status == "succeeded" and result_key:
            result[result_key] = RESULT_CONTRACTS[task.kind].model_validate(task.result)
        return DirectingTaskRead(task_id=task.id, kind=task.kind, status=task.status,
                                 error=task.error_message,
                                 source_version=task.input_snapshot.get("run_args", {}).get("source_version"), **result)
