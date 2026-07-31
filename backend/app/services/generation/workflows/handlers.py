"""图片、视频初始场景的 WorkflowHandler 实现。"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select

from app.core.contracts.generation import (
    GenerationCommand,
    GenerationOperation,
    GenerationTargetKind,
    ResolvedGenerationSnapshot,
)
from app.core.contracts.generation_delivery import (
    DeliveredArtifact,
    DeliveredArtifactPublishState,
    GenerationDeliveryResult,
    GenerationOutcome,
)
from app.models.generation_artifacts import GenerationArtifact
from app.models.experiment_sessions import ExperimentMessage, ExperimentSession
from app.services.generation.publishers import GenerationResultPublisher
from app.services.studio.shot_status import recompute_shot_status
from app.services.generation.workflows.base import (
    AbstractGenerationWorkflowHandler,
    GenerationWorkflowExecutionContext,
    GenerationWorkflowKey,
    GenerationWorkflowSubmissionContext,
    GenerationWorkflowTerminalContext,
)


class ExperimentWorkflowHandler(AbstractGenerationWorkflowHandler):
    """交付实验室生成产物，不将结果自动采用到业务槽位。"""

    def __init__(self, *, operation: GenerationOperation) -> None:
        """为图片或视频实验室声明对应的 workflow key。"""
        self.key = GenerationWorkflowKey(operation, GenerationTargetKind.experiment_session)

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:
        """在任务持久化前确认实验会话仍匹配本次生成 operation。"""

        db, command = _submission_inputs(context)
        if command.operation is not self.key.operation:
            raise ValueError("experiment workflow command operation mismatch")
        await _require_experiment_session(db, session_id=command.target.entity_id, operation=self.key.operation)

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:
        """在 Provider 调用前复核会话类型与任务展示消息的归属。"""

        db, snapshot = _execution_inputs(context)
        await _require_experiment_session(
            db,
            session_id=snapshot.canonical_target.entity_id,
            operation=self.key.operation,
        )
        message = (await db.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == context.task_id))).scalars().first()
        if message is None or message.role != "task" or message.session_id != snapshot.canonical_target.entity_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """投影已归档产物到所属实验室消息，不触发 CAS Publisher。"""

        _, _, artifacts, message = await _experiment_delivery_inputs(context)
        result = _result_projection(artifacts)
        _project_experiment_task_terminal(message, status="succeeded", result=result.model_dump(mode="json"), progress=100)
        return result

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:
        """将稳定错误摘要投影到属于可信实验会话的任务消息。"""

        _, _, _, message = await _experiment_delivery_inputs(context)
        _project_experiment_task_terminal(message, status="failed", error=_terminal_error(context))

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:
        """将取消状态投影到属于可信实验会话的任务消息。"""

        _, _, _, message = await _experiment_delivery_inputs(context)
        _project_experiment_task_terminal(message, status="cancelled", error=_terminal_error(context, default="任务已取消"))


class SlotPublisherWorkflowHandler(AbstractGenerationWorkflowHandler):
    """通过既有 CAS Publisher 自动采用主产物到明确的业务槽位。"""

    def __init__(
        self,
        *,
        operation: GenerationOperation,
        target_kind: GenerationTargetKind,
        publisher: GenerationResultPublisher,
    ) -> None:
        """绑定唯一 workflow key 与只处理槽位 CAS 的 Publisher。"""
        self.key = GenerationWorkflowKey(operation, target_kind)
        self._publisher = publisher

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:  # noqa: ARG002
        """保留槽位领域提交校验入口；现阶段由 EntityGate 完成归属校验。"""

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:  # noqa: ARG002
        """保留槽位执行前复核入口；版本变化在 CAS 阶段表达为冲突。"""

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """执行 CAS 自动采用，并返回包含冲突或发布状态的任务结果投影。"""
        db, snapshot, artifacts = _delivery_inputs(context)
        await self._publisher.publish_terminal(db, snapshot=snapshot, artifacts=artifacts)
        return _result_projection(artifacts)

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:  # noqa: ARG002
        """失败领域投影后续由 Finalizer 统一收口。"""

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:  # noqa: ARG002
        """取消领域投影后续由 Finalizer 统一收口。"""


class _ShotStatusWorkflowHandler(SlotPublisherWorkflowHandler):
    """为镜头相关槽位发布补充镜头状态刷新的共享工作流基类。"""

    _expected_target_kind: GenerationTargetKind

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """仅在可信镜头目标完成 CAS 发布后刷新该镜头的提取状态。"""

        db, snapshot, _ = _delivery_inputs(context)
        if snapshot.canonical_target.kind is not self._expected_target_kind:
            raise ValueError("shot workflow snapshot target_kind mismatch")
        result = await super().deliver_success(context)
        await recompute_shot_status(db, shot_id=snapshot.canonical_target.entity_id)
        return result


class ShotFrameWorkflowHandler(_ShotStatusWorkflowHandler):
    """将图片 Artifact 发布到镜头帧槽位，并刷新对应镜头状态。"""

    _expected_target_kind = GenerationTargetKind.shot_frame_slot

    def __init__(self, *, publisher: GenerationResultPublisher) -> None:
        """绑定镜头帧图片 operation 与已注入的帧槽位 Publisher。"""

        super().__init__(
            operation=GenerationOperation.image_generation,
            target_kind=self._expected_target_kind,
            publisher=publisher,
        )


class ShotVideoWorkflowHandler(_ShotStatusWorkflowHandler):
    """将视频 Artifact 发布到镜头视频字段，并刷新对应镜头状态。"""

    _expected_target_kind = GenerationTargetKind.shot_video

    def __init__(self, *, publisher: GenerationResultPublisher) -> None:
        """绑定镜头视频 operation 与已注入的视频 Publisher。"""

        super().__init__(
            operation=GenerationOperation.video_generation,
            target_kind=self._expected_target_kind,
            publisher=publisher,
        )


class PassthroughWorkflowHandler(AbstractGenerationWorkflowHandler):
    """保留尚未迁移领域任务的工作流入口，避免基础注册表改变既有提交行为。"""

    def __init__(self, *, operation: GenerationOperation, target_kind: GenerationTargetKind) -> None:
        """声明不需要文件发布的既有 operation 与可信目标组合。"""
        self.key = GenerationWorkflowKey(operation, target_kind)

    async def validate_submission(self, context: GenerationWorkflowSubmissionContext) -> None:  # noqa: ARG002
        """现有文本/脚本门禁保持原语义，后续迁移时替换为领域校验。"""

    async def validate_execution(self, context: GenerationWorkflowExecutionContext) -> None:  # noqa: ARG002
        """现有文本/脚本执行路径暂不引入新的运行期限制。"""

    async def deliver_success(self, context: GenerationWorkflowTerminalContext) -> GenerationDeliveryResult:
        """返回调用方已准备的结果投影，不对领域数据执行文件发布。"""
        return GenerationDeliveryResult(outcome=GenerationOutcome.succeeded)

    async def deliver_failed(self, context: GenerationWorkflowTerminalContext) -> None:  # noqa: ARG002
        """失败投影由既有文本/脚本终态路径处理。"""

    async def deliver_cancelled(self, context: GenerationWorkflowTerminalContext) -> None:  # noqa: ARG002
        """取消投影由既有文本/脚本终态路径处理。"""


def _delivery_inputs(context: GenerationWorkflowTerminalContext) -> tuple[Any, ResolvedGenerationSnapshot, list[GenerationArtifact]]:
    """提取槽位发布必需的运行期数据，并拒绝不完整的 Worker 调用。"""
    db = context.data.get("db")
    snapshot = context.data.get("snapshot")
    if db is None or not isinstance(snapshot, ResolvedGenerationSnapshot):
        raise ValueError("workflow terminal context requires db and snapshot")
    return db, snapshot, _artifacts_from_context(context)


def _submission_inputs(context: GenerationWorkflowSubmissionContext) -> tuple[Any, GenerationCommand]:
    """读取实验室提交期所需的数据库会话与强类型命令。"""

    db = context.data.get("db")
    command = context.data.get("command")
    if db is None or not isinstance(command, GenerationCommand):
        raise ValueError("workflow submission context requires db and command")
    return db, command


def _execution_inputs(context: GenerationWorkflowExecutionContext) -> tuple[Any, ResolvedGenerationSnapshot]:
    """读取实验室执行期所需的数据库会话与冻结快照。"""

    db = context.data.get("db")
    snapshot = context.data.get("snapshot")
    if db is None or not isinstance(snapshot, ResolvedGenerationSnapshot):
        raise ValueError("workflow execution context requires db and snapshot")
    return db, snapshot


async def _require_experiment_session(db: Any, *, session_id: str, operation: GenerationOperation) -> None:
    """验证实验会话存在，并且其类型与目标生成 operation 一一对应。"""

    session = await db.get(ExperimentSession, session_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="target_not_found")
    expected_lab_type = {
        GenerationOperation.text_chat: "text",
        GenerationOperation.image_generation: "image",
        GenerationOperation.video_generation: "video",
    }.get(operation)
    if expected_lab_type is None or session.lab_type != expected_lab_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="experiment_session_type_invalid")


async def _experiment_delivery_inputs(
    context: GenerationWorkflowTerminalContext,
) -> tuple[Any, ResolvedGenerationSnapshot, list[GenerationArtifact], ExperimentMessage]:
    """读取实验室交付输入，并验证任务消息仍属于可信 target 会话。

    Handler 只修改调用方持有 Session 中的 ORM 行，不在此处 commit；这使任务状态、
    产物和展示投影仍能由上层在同一事务原子提交。
    """

    db, snapshot, artifacts = _delivery_inputs(context)
    message = (await db.execute(select(ExperimentMessage).where(ExperimentMessage.task_id == context.task_id))).scalars().first()
    if message is None:
        raise ValueError("experiment workflow task message is unavailable")
    if message.session_id != snapshot.canonical_target.entity_id:
        raise ValueError("experiment workflow task message session mismatch")
    return db, snapshot, artifacts, message


def _artifacts_from_context(context: GenerationWorkflowTerminalContext) -> list[GenerationArtifact]:
    """读取归档产物列表，确保所有 Handler 共享相同的输入约束。"""
    artifacts = context.data.get("artifacts")
    if not isinstance(artifacts, list):
        raise ValueError("workflow terminal context requires artifacts")
    return artifacts


def _terminal_error(context: GenerationWorkflowTerminalContext, *, default: str = "任务执行失败") -> str:
    """从终态上下文读取稳定错误文本，避免把非字符串 Provider 数据投影给用户。"""

    error = context.data.get("error")
    return error.strip() if isinstance(error, str) and error.strip() else default


def _project_experiment_task_terminal(
    message: ExperimentMessage,
    *,
    status: str,
    result: dict[str, Any] | None = None,
    error: str | None = None,
    progress: int | None = None,
) -> None:
    """延迟导入实验室展示投影，避免 Studio 聚合模块与 Worker 形成导入环。"""
    from app.services.studio.experiment_messages import project_task_message_terminal

    project_task_message_terminal(message, status=status, result=result, error=error, progress=progress)


def _result_projection(artifacts: list[GenerationArtifact]) -> GenerationDeliveryResult:
    """构建 Artifact-first 的稳定终态结果，不暴露 Provider 原始响应。"""
    ordered = sorted(artifacts, key=lambda artifact: artifact.ordinal)
    delivered = [
        DeliveredArtifact(
            artifact_id=artifact.id,
            file_id=artifact.file_id,
            text_content=getattr(artifact, "text_content", None),
            ordinal=artifact.ordinal,
            modality=artifact.modality,
            publish_state=DeliveredArtifactPublishState(artifact.publish_status.value),
            publish_error=artifact.publish_error,
        )
        for artifact in ordered
    ]
    primary = next((artifact for artifact in ordered if artifact.ordinal == 0), None)
    return GenerationDeliveryResult(
        outcome=GenerationOutcome.succeeded,
        artifacts=delivered,
        primary_file_id=primary.file_id if primary is not None else None,
    )
