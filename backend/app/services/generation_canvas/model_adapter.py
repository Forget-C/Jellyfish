"""同一画布工具用例的原生调用及纯文本适配。"""

import json
from collections.abc import Awaitable, Callable

from fastapi import HTTPException
from langchain_core.tools import StructuredTool, ToolException
from pydantic import BaseModel, ConfigDict, Field, JsonValue, StrictBool, ValidationError, model_validator

from app.schemas.generation_canvas import CanvasCompiledInput
from app.services.approval import ApprovalAccess, ApprovalError, ApprovalRequestView, ApprovalService, Key
from app.services.generation_canvas.approval_tools import (
    CanvasApprovalQueryResult, CanvasApprovalTools, QueryCanvasApproval, StagedCanvasApproval, SubmitCanvasApproval,
)
from app.services.generation_canvas.approved_edits import OBJECT_TYPE
from app.services.generation_canvas.assistant_stream import public_proposal_prefix, reply_envelope
from app.services.generation_canvas.planning_tools import CanvasPlanningPreview, CanvasPlanningTools
from app.services.generation_canvas.store import CanvasStore

PREVIEW_TOOL = 'preview_canvas_changes'
READ_TOOL = 'read_canvas'
INVALID_COMMAND = '请按本轮工具格式提供改动组、预演标识或审批申请标识。'


class CanvasModelApprovalScope(BaseModel):
    """由会话宿主固定的送审权限、版本和重放身份。"""

    model_config = ConfigDict(extra='forbid', frozen=True)
    access: ApprovalAccess
    object_id: Key
    version: Key
    idempotency_key: Key
    allow_submit: bool = False
    readable_request_ids: tuple[str, ...] = ()
    supersedes_request_id: str | None = None


class _ToolArguments(BaseModel):
    model_config = ConfigDict(extra='forbid', frozen=True)


class _ReadCanvas(_ToolArguments):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=20)


class _PreviewCanvas(_ToolArguments):
    groups: list[JsonValue]


class _InspectCanvasInputs(_ToolArguments):
    card_id: Key
    group_id: Key | None = None
    preview_id: Key | None = None


class TextCanvasControl(_ToolArguments):
    """兼容逐组校验，使一组非法输入不会吞掉其他可验证的输出。"""

    reply: str = ''
    groups: list[JsonValue] | None = None
    submit_for_approval: StrictBool = False
    approval: SubmitCanvasApproval | None = None
    approval_query: QueryCanvasApproval | None = None
    canvas_read: _ReadCanvas | None = None
    input_check: _InspectCanvasInputs | None = None

    @model_validator(mode='after')
    def require_one_action(self):
        """一份模型回复只选择一个预演、送审或查询操作。"""
        actions = (self.groups, self.approval, self.approval_query, self.canvas_read, self.input_check)
        if sum(value is not None for value in actions) != 1:
            raise ValueError('需要一个明确的画布工具操作')
        if self.submit_for_approval and self.groups is None:
            raise ValueError('即时送审须包含改动组')
        return self


class CanvasTextReply(BaseModel):
    """对话正文单独展示，预演和申请从类型化字段读取。"""

    reply: str
    preview: CanvasPlanningPreview | None = None
    request: ApprovalRequestView | None = None
    approval_query: CanvasApprovalQueryResult | None = None
    canvas_page: dict | None = None
    compiled_input: CanvasCompiledInput | None = None


def public_canvas_reply(raw: str) -> str:
    """从原生模型最终正文移除工具控制数据。"""
    text = raw.strip()
    return public_proposal_prefix(text) if reply_envelope(text).startswith('{') else text


def _feedback(error: ApprovalError | HTTPException) -> str:
    if isinstance(error, ApprovalError):
        return str(error)
    detail = error.detail
    return detail.get('message', '暂时无法处理画布请求。') if isinstance(detail, dict) else str(detail)


async def _tool_result(action: Awaitable[dict | BaseModel]) -> str:
    try:
        result = await action
    except (ApprovalError, HTTPException) as error:
        raise ToolException(_feedback(error)) from error
    return result.model_dump_json() if isinstance(result, BaseModel) else json.dumps(result, ensure_ascii=False)


def _tool(name: str, description: str, arguments: type[BaseModel], callback: Callable) -> StructuredTool:
    return StructuredTool.from_function(
        coroutine=callback, name=name, description=description, args_schema=arguments,
        handle_tool_error=True, handle_validation_error=INVALID_COMMAND,
    )


class CanvasModelAdapter:
    """模型参数只定位本轮可见数据，权限与真实预演由可信宿主提供。"""

    def __init__(self, planning: CanvasPlanningTools, approval: CanvasModelApprovalScope | None = None):
        if approval and (approval.access.scope.kind != 'canvas' or approval.access.scope.id != planning.canvas_id):
            raise ApprovalError('forbidden', '审批权限与当前画布不符')
        self.planning = planning
        self.approval = approval
        self.submitted: ApprovalRequestView | None = None
        self._readable = set(approval.readable_request_ids) if approval else set()

    @property
    def latest_preview(self) -> CanvasPlanningPreview:
        """返回本轮最近一次工具预演。"""
        return self.planning.latest

    @property
    def can_submit(self) -> bool:
        """仅服务端确认的送审轮次开放写入审批请求。"""
        return bool(self.approval and self.approval.allow_submit and 'submit' in self.approval.access.permissions)

    async def _read(self, offset: int = 0, limit: int = 20) -> str:
        return await _tool_result(self.planning.read(offset=offset, limit=limit))

    async def _preview(self, groups: list[JsonValue]) -> str:
        async def preview_result():
            checked = await self.planning.preview(groups)
            return {**checked.tool_result(), 'version': self.approval.version if checked.plan and self.approval else None}
        return await _tool_result(preview_result())

    async def _inspect(self, card_id: str, group_id: str | None = None, preview_id: str | None = None) -> str:
        return await _tool_result(self.planning.inspect_inputs(card_id, group_id=group_id, preview_id=preview_id))

    async def _submit(self, preview_id: str, version: str) -> str:
        return await _tool_result(self.submit(SubmitCanvasApproval(preview_id=preview_id, version=version)))

    async def _query(self, request_id: str) -> str:
        return await _tool_result(self.query(QueryCanvasApproval(request_id=request_id)))

    def native_tools(self) -> list[StructuredTool]:
        """仅注册创作角色可用的工具，模型无法签发审批决定。"""
        tools = [
            _tool(READ_TOOL, '分页读取当前画布的目标、来源和可用卡片。', _ReadCanvas, self._read),
            _tool(PREVIEW_TOOL, '预演独立改动组并返回核对结果。此调用只预演。', _PreviewCanvas, self._preview),
            _tool('inspect_canvas_inputs', '检查目标卡实际使用的正文和素材。', _InspectCanvasInputs, self._inspect),
        ]
        if self.approval and 'read' in self.approval.access.permissions:
            tools.append(_tool('read_canvas_approval', '查询已显示的原审批申请。', QueryCanvasApproval, self._query))
        if self.can_submit:
            tools.append(_tool('submit_canvas_approval', '送审已核对的预演，传入原标识和版本。',
                               SubmitCanvasApproval, self._submit))
        return tools

    async def submit(self, command: SubmitCanvasApproval) -> ApprovalRequestView:
        """只提交已发给模型的原预演身份和宿主版本。"""
        scope = self.approval
        if not self.can_submit:
            raise ApprovalError('forbidden', '当前对话仅允许预演，待用户明确要求再送审')
        preview = self.planning.get_preview(command.preview_id)
        if preview is None or preview.plan is None or command.version != scope.version:
            raise ApprovalError('preview_not_found', '暂存预演不存在或版本已变化')
        async with self.planning.sessions.begin() as db:
            canvas = await CanvasStore(db, self.planning.project_id).get(self.planning.canvas_id, lock=True)
            previous = await ApprovalService(db).read_submitted(
                scope.access, object_type=OBJECT_TYPE, object_id=scope.object_id, idempotency_key=scope.idempotency_key,
            )
            if previous is None and canvas.revision != preview.plan.revision:
                raise ApprovalError('preview_stale', '画布已变化，请重新预演后送审')
            tools = CanvasApprovalTools(db, scope.access, self.planning.project_id, allow_submit=True)
            tools.stage(StagedCanvasApproval(
                preview_id=command.preview_id, object_id=scope.object_id, version=scope.version,
                preview=preview.plan, idempotency_key=scope.idempotency_key,
                supersedes_request_id=scope.supersedes_request_id,
            ))
            request = await tools.submit(command)
        self._readable.add(request.id)
        self.submitted = request
        return request

    async def submit_latest(self) -> ApprovalRequestView | None:
        """明确送审轮结束时，宿主可提交最近通过核对的预演。"""
        if self.latest_preview.preview_id:
            if not self.can_submit:
                raise ApprovalError('forbidden', '当前对话仅允许预演，待用户明确要求再送审')
            return await self.submit(SubmitCanvasApproval(
                preview_id=self.latest_preview.preview_id, version=self.approval.version,
            ))
        return None

    async def recover_submission(self) -> ApprovalRequestView | None:
        """按原会话和重试身份找回已提交申请，无需重放模型或重算预演。"""
        scope = self.approval
        if scope is None or 'submit' not in scope.access.permissions:
            return None
        async with self.planning.sessions() as db:
            request = await ApprovalService(db).read_submitted(
                scope.access, object_type=OBJECT_TYPE, object_id=scope.object_id, idempotency_key=scope.idempotency_key,
            )
        if request and request.version != scope.version:
            raise ApprovalError('idempotency_conflict', '原审批申请与本轮版本不符')
        if request:
            self._readable.add(request.id)
            self.submitted = request
        return request

    async def query(self, command: QueryCanvasApproval) -> CanvasApprovalQueryResult:
        """使用当前范围获准读取的申请集合。"""
        if self.approval is None:
            raise ApprovalError('request_not_found', '当前范围未找到该审批申请')
        async with self.planning.sessions() as db:
            return await CanvasApprovalTools(
                db, self.approval.access, self.planning.project_id, allow_submit=False,
                readable_request_ids=self._readable,
            ).query(command)

    async def text_reply(self, raw: str) -> CanvasTextReply:
        """从纯文本模型的私有控制对象分离正文并调用同一类型化用例。"""
        envelope = reply_envelope(raw.strip())
        if not envelope.startswith('{'):
            return CanvasTextReply(reply=raw.strip())
        prefix = public_proposal_prefix(raw)
        try:
            command = TextCanvasControl.model_validate_json(envelope)
        except ValidationError:
            return CanvasTextReply(reply='\n\n'.join(filter(None, (prefix, INVALID_COMMAND))))
        reply = '\n\n'.join(dict.fromkeys(filter(None, (prefix, public_canvas_reply(command.reply)))))
        result = CanvasTextReply(reply=reply)
        try:
            if command.groups is not None:
                result.preview = await self.planning.preview(command.groups)
                if command.submit_for_approval:
                    if not self.can_submit:
                        raise ApprovalError('forbidden', '当前对话仅允许预演，待用户明确要求再送审')
                    result.request = await self.submit_latest()
            elif command.approval:
                result.request = await self.submit(command.approval)
            elif command.approval_query:
                result.approval_query = await self.query(command.approval_query)
            elif command.canvas_read:
                result.canvas_page = await self.planning.read(**command.canvas_read.model_dump())
            elif command.input_check:
                result.compiled_input = await self.planning.inspect_inputs(**command.input_check.model_dump())
        except (ApprovalError, HTTPException) as error:
            result.reply = '\n\n'.join(filter(None, (reply, _feedback(error))))
        if not result.reply:
            result.reply = '已核对本轮画布请求。' if (
                result.request or result.approval_query or result.canvas_page or result.compiled_input
            ) else (
                '请核对预演中的改动和未通过的操作。' if result.preview and result.preview.plan else INVALID_COMMAND)
        return result
