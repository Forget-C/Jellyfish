"""逐组校验授权、独立复核，并通过审批服务记录自动决定。"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, JsonValue, PositiveInt, model_validator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services.approval import ApprovalAccess, ApprovalDecisionView, ApprovalError, ApprovalRequestStatus, ApprovalService

EffectKind = Literal['edit', 'delete_card', 'release_binding', 'generate']
ReviewStatus = Literal['approved', 'manual_required', 'not_authorized', 'stale', 'unavailable']


class ApprovalEffect(BaseModel):
    """可精确比对的业务影响。引用身份和生成数量参与授权比较。"""

    model_config = ConfigDict(extra='forbid', frozen=True)
    kind: EffectKind
    target_id: str = Field(min_length=1)
    binding_id: str | None = None
    count: PositiveInt | None = None

    @model_validator(mode='after')
    def validate_arguments(self):
        """每种敏感操作必须带齐所需目标依据。"""
        if self.kind == 'release_binding':
            if not self.binding_id or self.count is not None:
                raise ValueError('解除采用必须指定引用身份')
        elif self.kind == 'generate':
            if self.count is None or self.binding_id is not None:
                raise ValueError('生成必须指定生成数量')
        elif self.binding_id is not None or self.count is not None:
            raise ValueError('此操作只接受目标身份')
        return self


class AutomaticApprovalBasis(BaseModel):
    """业务方从持久化授权和所见快照重建的单组依据。"""

    model_config = ConfigDict(extra='forbid', frozen=True)
    authority_revision: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    user_request: str = Field(min_length=1)
    effects: tuple[ApprovalEffect, ...] = Field(min_length=1)
    allowed_effects: frozenset[ApprovalEffect]
    explicit_effects: frozenset[ApprovalEffect] = Field(default_factory=frozenset)
    evidence: dict[str, JsonValue] = Field(default_factory=dict)


class AutomaticApprovalPolicy(Protocol):
    """由服务端提供的业务授权规则，不能由创作工具构造。"""

    async def load_basis(
        self, db: AsyncSession, request: ApprovalRequestStatus, group_id: str, *, lock: bool,
    ) -> AutomaticApprovalBasis | None:
        """按原版本载入当前授权。签发时锁住与授权撤回共用的记录。

        authority_revision 随授权或相关业务依据改变，涵盖停止和重新开启授权。
        业务记录锁顺序先于通用审批锁。此处只读取或加锁，不调用模型。
        """


class AutomaticReviewEvidence(BaseModel):
    """独立复核只接收事实和实际影响，由代码决定授权。"""

    model_config = ConfigDict(extra='forbid', frozen=True)
    request_id: str
    version: str
    group_id: str
    user_request: str
    effects: tuple[ApprovalEffect, ...]
    evidence: dict[str, JsonValue]
    previous_decisions: tuple[ApprovalDecisionView, ...]


class AutomaticReviewVerdict(BaseModel):
    """独立复核明确给出通过或转人工及其理由。"""

    model_config = ConfigDict(extra='forbid', frozen=True)
    decision: Literal['approve', 'manual']
    reason: str = Field(min_length=1, max_length=600)


AutomaticReviewer = Callable[[AutomaticReviewEvidence], Awaitable[AutomaticReviewVerdict]]


class AutomaticGroupResult(BaseModel):
    """逐组返回处理结果。仅成功签发时附决定。"""

    group_id: str
    status: ReviewStatus
    reason: str
    decision: ApprovalDecisionView | None = None


def _authorized(basis: AutomaticApprovalBasis | None, access: ApprovalAccess) -> bool:
    return bool(basis and basis.actor_id == access.actor_id and all(
        effect in basis.allowed_effects and (effect.kind == 'edit' or effect in basis.explicit_effects)
        for effect in basis.effects
    ))


class AutomaticApprovalService:
    """自动复核期间释放数据库连接，签发前在一笔新事务中复查。"""

    def __init__(self, sessions: async_sessionmaker[AsyncSession],
                 policy: AutomaticApprovalPolicy, reviewer: AutomaticReviewer):
        self.sessions = sessions
        self.policy = policy
        self.reviewer = reviewer

    async def approve(self, access: ApprovalAccess, request_id: str, *, version: str,
                      group_ids: tuple[str, ...]) -> tuple[AutomaticGroupResult, ...]:
        """逐组签发服务端授权范围内、通过独立复核的决定。"""
        if access.source != 'automatic' or not {'read', 'decide'} <= access.permissions:
            raise ApprovalError('forbidden', '当前角色没有自动审批权限')
        async with self.sessions() as db:
            current = await ApprovalService(db).read(access, request_id)
        if current.version != version:
            raise ApprovalError('superseded', '所见审批版本已变化')
        if not group_ids or len(set(group_ids)) != len(group_ids) or set(group_ids) - set(current.group_ids):
            raise ApprovalError('invalid_groups', '请选择此版本下非空且互异的审批组')
        results = []
        for group_id in group_ids:
            results.append(await self._review_group(access, request_id, group_id))
        return tuple(results)

    async def _review_group(self, access: ApprovalAccess, request_id: str, group_id: str) -> AutomaticGroupResult:
        async with self.sessions() as db:
            approvals = ApprovalService(db)
            request = await approvals.read(access, request_id)
            previous = await approvals.list_decisions(access, request_id)
            if request.group_states[group_id] != 'pending' or not request.active:
                replay = next((decision for decision in previous if decision.source == 'automatic'
                               and decision.actor_id == access.actor_id and decision.group_ids == (group_id,)), None)
                if replay is not None:
                    return AutomaticGroupResult(group_id=group_id, status='approved', decision=replay,
                                                reason='已签发此组的原决定')
                return AutomaticGroupResult(group_id=group_id, status='stale', reason='所见版本或分组状态已更新')
            basis = await self.policy.load_basis(db, request, group_id, lock=False)
            if basis is not None:
                basis = basis.model_copy(deep=True)
        if not _authorized(basis, access):
            return AutomaticGroupResult(group_id=group_id, status='not_authorized', reason='未找到此操作的明确授权')
        evidence = AutomaticReviewEvidence(
            request_id=request_id, version=request.version, group_id=group_id, user_request=basis.user_request,
            effects=basis.effects, evidence=basis.evidence, previous_decisions=previous,
        ).model_copy(deep=True)
        try:
            async with asyncio.timeout(20):
                verdict = AutomaticReviewVerdict.model_validate(await self.reviewer(evidence))
        except Exception:  # pylint: disable=broad-exception-caught
            return AutomaticGroupResult(group_id=group_id, status='unavailable', reason='独立复核不可用，需人工审批')
        if verdict.decision != 'approve':
            return AutomaticGroupResult(group_id=group_id, status='manual_required', reason=verdict.reason)
        return await self._sign_reviewed(access, request, group_id, basis, verdict.reason)

    async def _sign_reviewed(self, access: ApprovalAccess, request: ApprovalRequestStatus, group_id: str,
                             reviewed: AutomaticApprovalBasis, reason: str) -> AutomaticGroupResult:
        """在同一事务重新确认业务授权和审批事实，随后签发。"""
        try:
            async with self.sessions.begin() as db:
                current = await self.policy.load_basis(db, request, group_id, lock=True)
                if current != reviewed or not _authorized(current, access):
                    return AutomaticGroupResult(group_id=group_id, status='stale', reason='授权或业务依据已改变')
                # 只有逐组通过校验的内部路径可使用同一个决定写入器。
                decision = await ApprovalService(db)._decide(  # pylint: disable=protected-access
                    access, request.id, version=request.version, group_ids=(group_id,), action='approve',
                    idempotency_key=f'{request.id}:{group_id}',
                    reviewed_states=request.group_states,
                )
        except ApprovalError as error:
            if error.code not in {'superseded', 'already_decided', 'request_not_found', 'review_stale'}:
                raise
            return AutomaticGroupResult(group_id=group_id, status='stale', reason=str(error))
        return AutomaticGroupResult(group_id=group_id, status='approved', reason=reason, decision=decision)
