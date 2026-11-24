"""角色绑定的审批工具，将模型参数映射到服务端已核对的范围和版本。"""

from collections.abc import Awaitable, Iterable

from fastapi import HTTPException
from langchain_core.tools import StructuredTool, ToolException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.generation_canvas import CanvasPrecheck
from app.services.approval import (
    ApprovalAccess, ApprovalDecisionView, ApprovalError, ApprovalRequestStatus, ApprovalRequestView,
    ApprovalService, DecisionAction, GroupId, Key,
)
from app.services.generation_canvas.approved_edits import OBJECT_TYPE as EDIT_APPROVAL, CanvasEditApprovals
from app.services.generation_canvas.approved_generation import (
    OBJECT_TYPE as GENERATION_APPROVAL, CanvasGenerationApprovalPreview, CanvasGenerationApprovals,
)
from app.services.generation_canvas.edits import CanvasEditPreview

_CANVAS_APPROVAL_TYPES = frozenset({EDIT_APPROVAL, GENERATION_APPROVAL})


class SubmitCanvasApproval(BaseModel):
    """送审服务端暂存的指定预演。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    preview_id: Key
    version: Key


class QueryCanvasApproval(BaseModel):
    """查询对本轮调用方可见的申请。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    request_id: Key


class DecideCanvasApproval(BaseModel):
    """核对人工已明确确认的决定参数。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    request_id: Key
    version: Key
    group_ids: tuple[GroupId, ...] = Field(min_length=1)
    action: DecisionAction

    @field_validator('group_ids')
    @classmethod
    def require_distinct_groups(cls, groups: tuple[str, ...]) -> tuple[str, ...]:
        """选择按集合比较，禁止重复组。"""
        if len(set(groups)) != len(groups):
            raise ValueError('所选审批组不能重复')
        return groups


class StagedCanvasApproval(BaseModel):
    """可信应用方暂存的完整预演及提交定位信息。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    preview_id: Key
    object_id: Key
    version: Key
    idempotency_key: Key
    preview: CanvasEditPreview | CanvasGenerationApprovalPreview
    supersedes_request_id: str | None = None
    generation_group_id: GroupId = 'generate'


class ConfirmedCanvasApproval(BaseModel):
    """从真实用户确认或可信应用决定中捕获，包括原重试身份。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    choice: DecideCanvasApproval
    idempotency_key: Key


class CanvasApprovalQueryResult(BaseModel):
    """已记录的申请、原预演和组级决定。"""

    request: ApprovalRequestStatus
    snapshot: CanvasEditPreview | CanvasPrecheck
    decisions: tuple[ApprovalDecisionView, ...]


async def _tool_json(result: Awaitable[BaseModel]) -> str:
    try:
        return (await result).model_dump_json()
    except ApprovalError as error:
        raise ToolException(str(error)) from error
    except HTTPException as error:
        detail = error.detail
        message = detail.get('message') if isinstance(detail, dict) else detail
        raise ToolException(message or '暂时无法处理画布审批') from error


class CanvasApprovalTools:
    """创作角色可送审可信预演，并查询本轮获准可见的申请。"""

    def __init__(self, db: AsyncSession, access: ApprovalAccess, project_id: str | None, *,
                 allow_submit: bool, readable_request_ids: Iterable[str] = ()):
        self._db = db
        self._access = access
        self._project_id = project_id
        self._allow_submit = allow_submit
        self._readable = set(readable_request_ids)
        self._staged: dict[str, StagedCanvasApproval] = {}

    def stage(self, approval: StagedCanvasApproval) -> None:
        """由可信应用方暂存经过业务预演的版本，不向模型开放。"""
        if self._access.scope.kind != 'canvas' or approval.preview.canvas_id != self._access.scope.id:
            raise ApprovalError('forbidden', '暂存预演不属于当前画布')
        if isinstance(approval.preview, CanvasEditPreview) and not any(group.differences for group in approval.preview.groups):
            raise ApprovalError('preview_no_change', '预演没有需要送审的改动')
        previous = self._staged.get(approval.preview_id)
        if previous and previous != approval:
            raise ApprovalError('idempotency_conflict', '暂存标识已绑定另一份预演')
        self._staged[approval.preview_id] = approval.model_copy(deep=True)

    async def submit(self, command: SubmitCanvasApproval) -> ApprovalRequestView:
        """仅送审当前明确获准且可找回原内容的预演。"""
        if not self._allow_submit or 'submit' not in self._access.permissions:
            raise ApprovalError('forbidden', '当前对话仅允许预演，待用户明确要求再送审')
        staged = self._staged.get(command.preview_id)
        if staged is None or staged.version != command.version:
            raise ApprovalError('preview_not_found', '暂存预演不存在或版本已变化')
        options = dict(object_id=staged.object_id, version=staged.version, idempotency_key=staged.idempotency_key,
                       supersedes_request_id=staged.supersedes_request_id)
        preview = staged.preview
        if isinstance(preview, CanvasEditPreview):
            request = await CanvasEditApprovals(self._db).submit(self._access, self._project_id, preview, **options)
        else:
            request = await CanvasGenerationApprovals(self._db).submit(
                self._access, self._project_id, preview.canvas_id, preview.precheck.card_id,
                group_id=staged.generation_group_id, staged_preview=preview, **options,
            )
        self._readable.add(request.id)
        return request

    async def query(self, command: QueryCanvasApproval) -> CanvasApprovalQueryResult:
        """从独立组件查组级决定，再从业务方取原展示快照。"""
        if self._access.scope.kind != 'canvas' or command.request_id not in self._readable:
            raise ApprovalError('request_not_found', '当前范围未找到该审批申请')
        approvals = ApprovalService(self._db)
        request = await approvals.read(self._access, command.request_id)
        if request.object_type == EDIT_APPROVAL:
            snapshot = await CanvasEditApprovals(self._db).read_snapshot(self._access, request.id)
        elif request.object_type == GENERATION_APPROVAL:
            snapshot = await CanvasGenerationApprovals(self._db).read_snapshot(self._access, request.id)
        else:
            raise ApprovalError('request_not_found', '当前范围未找到该审批申请')
        decisions = await approvals.list_decisions(self._access, request.id)
        return CanvasApprovalQueryResult(request=request, snapshot=snapshot, decisions=decisions)

    def tools(self) -> list[StructuredTool]:
        """只向创作角色注册自身获准的查询与送审。"""
        tools = []
        if 'read' in self._access.permissions:
            tools.append(StructuredTool.from_function(
                coroutine=self._native_query, name='read_canvas_approval', args_schema=QueryCanvasApproval,
                description='查询当前可见审批请求的原预演和改动组状态。',
                handle_tool_error=True, handle_validation_error='请提供已显示的审批申请标识。',
            ))
        if self._allow_submit and 'submit' in self._access.permissions:
            tools.append(StructuredTool.from_function(
                coroutine=self._native_submit, name='submit_canvas_approval', args_schema=SubmitCanvasApproval,
                description='把明确要求送审的暂存预演版本交由用户审批。',
                handle_tool_error=True, handle_validation_error='请提供暂存预演标识和原版本。',
            ))
        return tools

    async def _native_submit(self, preview_id: str, version: str) -> str:
        return await _tool_json(self.submit(SubmitCanvasApproval(preview_id=preview_id, version=version)))

    async def _native_query(self, request_id: str) -> str:
        return await _tool_json(self.query(QueryCanvasApproval(request_id=request_id)))


class CanvasApprovalDecisionTool:
    """决定角色只可对本次可信确认的版本、分组和动作签发决定。"""

    def __init__(self, db: AsyncSession, access: ApprovalAccess, *, confirmed: ConfirmedCanvasApproval):
        if (access.scope.kind != 'canvas' or not {'decide', 'read'} <= access.permissions
                or access.source == 'automatic'):
            raise ApprovalError('forbidden', '当前角色不可签发已确认的审批决定')
        self._approvals = ApprovalService(db)
        self._access = access
        self._confirmed = confirmed

    async def decide(self, command: DecideCanvasApproval) -> ApprovalDecisionView:
        """校验模型参数与真实确认一致，再记录原决定。"""
        expected = self._confirmed.choice
        if ((command.request_id, command.version, command.action, sorted(command.group_ids))
                != (expected.request_id, expected.version, expected.action, sorted(expected.group_ids))):
            raise ApprovalError('confirmation_mismatch', '决定与用户实际确认的版本或所选组不一致')
        request = await self._approvals.read(self._access, command.request_id)
        if request.object_type not in _CANVAS_APPROVAL_TYPES:
            raise ApprovalError('request_not_found', '当前范围未找到该审批申请')
        return await self._approvals.decide(
            self._access, request.id, version=command.version, group_ids=command.group_ids,
            action=command.action, idempotency_key=self._confirmed.idempotency_key,
        )

    def tool(self) -> StructuredTool:
        """只在决定角色中注册，身份、权限和重试键均来自可信应用。"""
        return StructuredTool.from_function(
            coroutine=self._native_decide, name='decide_canvas_approval', args_schema=DecideCanvasApproval,
            description='记录现有的明确用户决定，参数须对应原申请版本和已确认组。',
            handle_tool_error=True, handle_validation_error='请按实际确认提供版本、组和决定。',
        )

    async def _native_decide(self, request_id: str, version: str, group_ids: tuple[str, ...],
                             action: DecisionAction) -> str:
        return await _tool_json(self.decide(DecideCanvasApproval(
            request_id=request_id, version=version, group_ids=group_ids, action=action,
        )))
