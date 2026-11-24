"""独立的版本化审批服务。业务方拥有快照，并自行消费审批决定。"""

from datetime import UTC, datetime
from hashlib import sha256
import json
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.approval import ApprovalDecision, ApprovalRequest, ApprovalSubject

Key = Annotated[str, StringConstraints(min_length=1, max_length=128, pattern=r'\S')]
GroupId = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r'\S')]
Permission = Literal['read', 'submit', 'decide']
DecisionSource = Literal['human', 'automatic', 'service']
DecisionAction = Literal['approve', 'reject']
GroupState = Literal['pending', 'approved', 'rejected']


class ApprovalError(Exception):
    """供业务适配层映射成合适的错误响应。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ApprovalScope(BaseModel):
    """调用方已授权的具体资源，按类型和身份精确匹配。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    kind: GroupId
    id: Key


class ApprovalAccess(BaseModel):
    """业务入口根据认证及授权信息构造，审批命令不提供身份或权限。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    scope: ApprovalScope
    actor_id: Key
    permissions: frozenset[Permission]
    source: DecisionSource = 'human'


class ApprovalSubmission(BaseModel):
    """快照引用由申请业务提供，须能按不可变版本读取原展示内容。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    object_type: GroupId
    object_id: Key
    version: Key
    group_ids: tuple[GroupId, ...] = Field(min_length=1)
    snapshot_ref: str = Field(min_length=1, max_length=255)
    supersedes_request_id: str | None = None


class ApprovalRequestView(BaseModel):
    """原始申请回执，重放可获得相同内容。"""

    id: str
    scope: ApprovalScope
    object_type: str
    object_id: str
    version: str
    group_ids: tuple[str, ...]
    snapshot_ref: str
    applicant_id: str
    supersedes_request_id: str | None


class ApprovalRequestStatus(ApprovalRequestView):
    """查询时返回当前版本状态和每个组的审批事实。"""

    active: bool
    group_states: dict[str, GroupState]


class ApprovalDecisionView(BaseModel):
    """精确绑定展示版本和所选组的原审批决定。"""

    id: str
    request_id: str
    version: str
    group_ids: tuple[str, ...]
    action: DecisionAction
    source: DecisionSource
    actor_id: str
    decided_at: datetime


def _hash(*parts) -> str:
    canonical = json.dumps(parts, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return sha256(canonical.encode()).hexdigest()


def _scope_key(access: ApprovalAccess) -> str:
    # 使用规范身份摘要，避免数据库默认校对规则将不同资源身份视为相等。
    return _hash(access.scope.kind, access.scope.id)


def _require(access: ApprovalAccess, capability: Permission) -> None:
    if capability not in access.permissions:
        raise ApprovalError('forbidden', '当前角色没有此审批权限')


def _request_view(subject: ApprovalSubject, request: ApprovalRequest) -> ApprovalRequestView:
    return ApprovalRequestView(
        id=request.id, scope=ApprovalScope(kind=subject.scope_kind, id=subject.scope_id),
        object_type=subject.object_type, object_id=subject.object_id, version=request.version,
        group_ids=tuple(request.group_ids), snapshot_ref=request.snapshot_ref,
        applicant_id=request.applicant_id, supersedes_request_id=request.supersedes_request_id,
    )


def _decision_view(request: ApprovalRequest, decision: ApprovalDecision) -> ApprovalDecisionView:
    return ApprovalDecisionView(
        id=decision.id, request_id=request.id, version=request.version, group_ids=tuple(decision.group_ids),
        action=decision.action, source=decision.source, actor_id=decision.actor_id,
        decided_at=decision.decided_at.replace(tzinfo=UTC),
    )


class ApprovalService:
    """按可信资源授权读写审批；外层业务事务负责提交或回滚。"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def submit(self, access: ApprovalAccess, command: ApprovalSubmission, *,
                     idempotency_key: str) -> ApprovalRequestView:
        """存下指定不可变版本；仅允许在已核对的当前版本之上提交替代版本。"""
        _require(access, 'submit')
        if not idempotency_key.strip():
            raise ApprovalError('invalid_identity', '提交需要稳定的幂等键')
        if len(set(command.group_ids)) != len(command.group_ids):
            raise ApprovalError('invalid_groups', '审批组身份须唯一')
        scope_key = _scope_key(access)
        subject_id = _hash(scope_key, command.object_type, command.object_id)
        subject = await self._ensure_subject(access, command, scope_key, subject_id)
        submission_key = _hash(subject_id, idempotency_key)
        digest = _hash(access.actor_id, command.model_dump(mode='json'))
        replay = await self.db.scalar(select(ApprovalRequest).where(
            ApprovalRequest.submission_key == submission_key).with_for_update())
        if replay:
            if replay.submission_hash != digest:
                raise ApprovalError('idempotency_conflict', '该幂等键已用于另一份申请')
            return _request_view(subject, replay)
        request_id = _hash(subject_id, command.version)
        if subject.active_request_id != command.supersedes_request_id:
            raise ApprovalError('version_conflict', '申请所依据的审批版本已变化')
        if await self.db.get(ApprovalRequest, request_id, with_for_update=True):
            raise ApprovalError('version_conflict', '审批对象版本已经存在')
        row = ApprovalRequest(
            id=request_id, subject_id=subject_id, version=command.version,
            submission_key=submission_key, submission_hash=digest, applicant_id=access.actor_id,
            snapshot_ref=command.snapshot_ref, group_ids=list(command.group_ids),
            group_states=dict.fromkeys(command.group_ids, 'pending'),
            supersedes_request_id=command.supersedes_request_id,
        )
        self.db.add(row)
        subject.active_request_id = request_id
        await self.db.flush()
        return _request_view(subject, row)

    async def read(self, access: ApprovalAccess, request_id: str) -> ApprovalRequestStatus:
        """按可信资源范围读取原申请与当前分组状态。"""
        _require(access, 'read')
        subject, request = await self._request_in_scope(access, request_id)
        return ApprovalRequestStatus(
            **_request_view(subject, request).model_dump(),
            active=subject.active_request_id == request.id,
            group_states=request.group_states,
        )

    async def decide(self, access: ApprovalAccess, request_id: str, *, version: str, group_ids: tuple[str, ...],
                     action: DecisionAction, idempotency_key: str) -> ApprovalDecisionView:
        """按所见版本和组签发决定；原重放优先于过期及已决定检查。"""
        if access.source == 'automatic':
            raise ApprovalError('review_required', '自动审批必须先经过授权校验和独立复核')
        return await self._decide(access, request_id, version=version, group_ids=group_ids,
                                  action=action, idempotency_key=idempotency_key)

    async def _decide(self, access: ApprovalAccess, request_id: str, *, version: str, group_ids: tuple[str, ...],
                      action: DecisionAction, idempotency_key: str,
                      reviewed_states: dict[str, GroupState] | None = None) -> ApprovalDecisionView:
        """保存人工决定或已通过自动授权和复核的决定。"""
        _require(access, 'decide')
        if not idempotency_key.strip() or action not in ('approve', 'reject'):
            raise ApprovalError('invalid_decision', '审批决定需要动作和稳定的幂等键')
        if not group_ids or len(set(group_ids)) != len(group_ids):
            raise ApprovalError('invalid_groups', '请选择非空且互异的审批组')
        subject, request = await self._request_in_scope(access, request_id, lock=True)
        if set(group_ids) - set(request.group_ids):
            raise ApprovalError('invalid_groups', '所选组不属于所见审批版本')
        selection = [group_id for group_id in request.group_ids if group_id in group_ids]
        # 人工幂等键不能与框架生成的自动审批键冲突。
        decision_id = (_hash(subject.id, 'automatic', idempotency_key) if access.source == 'automatic'
                       else _hash(subject.id, idempotency_key))
        digest = _hash(access.actor_id, access.source, request_id, version, action, selection)
        replay = await self.db.get(ApprovalDecision, decision_id, with_for_update=True)
        if replay:
            if replay.intent_hash != digest:
                raise ApprovalError('idempotency_conflict', '该幂等键已用于其他审批决定')
            return _decision_view(request, replay)
        if request.version != version or subject.active_request_id != request.id:
            raise ApprovalError('superseded', '所见审批版本已失效，请重新核对')
        if reviewed_states is not None and reviewed_states != request.group_states:
            raise ApprovalError('review_stale', '复核期间审批状态已改变')
        if any(request.group_states[group_id] != 'pending' for group_id in selection):
            raise ApprovalError('already_decided', '所选组包含已作出决定的事项')
        row = ApprovalDecision(
            id=decision_id, request_id=request.id, intent_hash=digest,
            action=action, source=access.source, actor_id=access.actor_id, group_ids=selection,
            decided_at=datetime.now(UTC).replace(tzinfo=None),
        )
        self.db.add(row)
        state = 'approved' if action == 'approve' else 'rejected'
        request.group_states = request.group_states | dict.fromkeys(selection, state)
        await self.db.flush()
        return _decision_view(request, row)

    async def read_decision(self, access: ApprovalAccess, decision_id: str) -> ApprovalDecisionView:
        """业务执行方在同一资源范围内取得原决定，独立检查执行依据。"""
        _require(access, 'read')
        statement = (
            select(ApprovalRequest, ApprovalDecision)
            .join(ApprovalDecision, ApprovalDecision.request_id == ApprovalRequest.id)
            .join(ApprovalSubject, ApprovalSubject.id == ApprovalRequest.subject_id)
            .where(ApprovalDecision.id == decision_id, ApprovalSubject.scope_key == _scope_key(access))
        )
        row = (await self.db.execute(statement)).one_or_none()
        if not row:
            raise ApprovalError('decision_not_found', '审批决定不存在')
        return _decision_view(*row)

    async def list_decisions(self, access: ApprovalAccess, request_id: str) -> tuple[ApprovalDecisionView, ...]:
        """按申请读取历史决定。被替代的申请仍可读取已签发的决定。"""
        _require(access, 'read')
        _, request = await self._request_in_scope(access, request_id)
        decisions = await self.db.scalars(
            select(ApprovalDecision).where(ApprovalDecision.request_id == request.id)
            .order_by(ApprovalDecision.decided_at, ApprovalDecision.id),
        )
        return tuple(_decision_view(request, decision) for decision in decisions)

    async def _ensure_subject(self, access: ApprovalAccess, command: ApprovalSubmission,
                              scope_key: str, subject_id: str) -> ApprovalSubject:
        values = dict(id=subject_id, scope_key=scope_key, scope_kind=access.scope.kind, scope_id=access.scope.id,
                      object_type=command.object_type, object_id=command.object_id)
        if self.db.get_bind().dialect.name == 'sqlite':
            insert = sqlite_insert(ApprovalSubject).values(**values).on_conflict_do_nothing(
                index_elements=[ApprovalSubject.id])
        else:
            insert = mysql_insert(ApprovalSubject).values(**values).on_duplicate_key_update(id=ApprovalSubject.id)
        # 首次提交也通过同一唯一键串行，已存在时只获取该对象的锁。
        await self.db.execute(insert)
        return await self.db.get(ApprovalSubject, subject_id, with_for_update=True, populate_existing=True)

    async def _request_in_scope(self, access: ApprovalAccess, request_id: str, *,
                                lock: bool = False) -> tuple[ApprovalSubject, ApprovalRequest]:
        scope_key = _scope_key(access)
        if lock:
            subject_id = select(ApprovalRequest.subject_id).where(ApprovalRequest.id == request_id).scalar_subquery()
            scoped_subject = (ApprovalSubject.id == subject_id, ApprovalSubject.scope_key == scope_key)
            if self.db.get_bind().dialect.name == 'sqlite':
                await self.db.execute(update(ApprovalSubject).where(*scoped_subject)
                                      .values(id=ApprovalSubject.id).execution_options(synchronize_session=False))
            # 与 submit 都先获取对象锁，再检查和操作请求。
            subject = await self.db.scalar(select(ApprovalSubject).where(*scoped_subject)
                                           .with_for_update().execution_options(populate_existing=True))
            if subject:
                request = await self.db.get(ApprovalRequest, request_id, with_for_update=True, populate_existing=True)
                if request:
                    return subject, request
        else:
            statement = (
                select(ApprovalSubject, ApprovalRequest)
                .join(ApprovalRequest, ApprovalRequest.subject_id == ApprovalSubject.id)
                .where(ApprovalSubject.scope_key == scope_key, ApprovalRequest.id == request_id)
                .execution_options(populate_existing=True)
            )
            row = (await self.db.execute(statement)).one_or_none()
            if row:
                return tuple(row)
        raise ApprovalError('request_not_found', '审批请求不存在')
