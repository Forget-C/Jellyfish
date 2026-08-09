"""CAS EpisodePackage 导入的异步任务集成（最小可用）。

本模块是 CAS 与 Jellyfish **任务中心**之间唯一的集成点，刻意做到最小：

- 复用既有 ``TaskManager`` / ``SqlAlchemyTaskStore`` / ``GenerationTaskLink``，
  与 ``app/services/script_processing_tasks.py`` 的写法保持一致；
- **不新增数据库迁移**：``generation_tasks.task_kind`` 与
  ``generation_task_links.relation_type`` 都是自由字符串列，新增取值无需改表；
- 只做「导入一个已存在且已校验的 EpisodePackage」。新闻抓取、选题、Comedy Engine、
  Character Director、LLM 生成、ComfyUI、视频/语音生成、FFmpeg 合成与发布自动化
  都**不**属于本步骤。

执行语义：
- 创建（``create_cas_import_task``）在调用方的请求事务内完成，只 flush；
- 运行（``run_cas_import_task``）自带独立会话，成功提交、失败回滚并落 failed 状态。
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.db import async_session_maker
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.crypto_animal_studio.application.import_episode import import_episode
from app.crypto_animal_studio.application.parsing import parse_episode_package
from app.models.task import GenerationTask, GenerationTaskStatus
from app.models.task_links import GenerationTaskLink

logger = logging.getLogger(__name__)

#: 任务种类。自由字符串列，无需迁移。
CAS_IMPORT_EPISODE_TASK_KIND = "cas_import_episode_package"

#: 业务关联类型（``relation_type`` 为 String(32)，本值 18 字符）。
CAS_EPISODE_IMPORT_RELATION_TYPE = "cas_episode_import"

_ACTIVE_TASK_STATUSES = (
    GenerationTaskStatus.pending,
    GenerationTaskStatus.running,
    GenerationTaskStatus.streaming,
)


class _CreateOnlyTask:
    """仅用于 ``TaskManager.create``，与 script_processing_tasks 的做法一致。"""

    async def run(self, *args: object, **kwargs: object) -> None:
        """本任务由 ``run_cas_import_task`` 驱动，这里不执行任何逻辑。"""
        return None

    async def status(self) -> dict[str, object]:
        """占位实现。"""
        return {}

    async def is_done(self) -> bool:
        """占位实现。"""
        return False

    async def get_result(self) -> object:
        """占位实现。"""
        return None


@dataclass(slots=True)
class CasImportTaskCreateResult:
    """创建（或复用）导入任务的结果。"""

    task_id: str
    status: TaskStatus
    reused: bool
    relation_type: str
    relation_entity_id: str


def episode_relation_entity_id(project_id: str, episode_id: str) -> str:
    """把 (project_id, episode_id) 映射为稳定的 64 字符关联键。

    ``relation_entity_id`` 是 String(64)，而 ``project_id`` 本身即可长达 64 字符，
    直接拼接会溢出。这里取 SHA-256 十六进制摘要（恰好 64 字符），既确定性又不越界。
    """
    raw = f"{project_id}:{episode_id}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


async def find_active_import_task(
    db: AsyncSession, *, project_id: str, episode_id: str
) -> GenerationTask | None:
    """查询同一 (project, episode) 下是否已有活动中的导入任务。"""
    entity_id = episode_relation_entity_id(project_id, episode_id)
    stmt = (
        select(GenerationTask)
        .join(GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id)
        .where(
            GenerationTaskLink.relation_type == CAS_EPISODE_IMPORT_RELATION_TYPE,
            GenerationTaskLink.relation_entity_id == entity_id,
            GenerationTask.status.in_(_ACTIVE_TASK_STATUSES),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


async def create_cas_import_task(
    db: AsyncSession,
    *,
    project_id: str,
    episode_package: dict,
    idempotency_key: str,
    dry_run: bool = False,
) -> CasImportTaskCreateResult:
    """创建（或复用）一个 ``cas_import_episode_package`` 任务。

    参数：
        db: 请求级会话（本函数只 flush，不 commit）。
        project_id: 目标项目（系列/季容器）。
        episode_package: 已校验的 EpisodePackage 原始 dict（v1 或 v1.1）。
        idempotency_key: 导入幂等键，透传给导入服务。
        dry_run: 透传给导入服务。
    返回：
        CasImportTaskCreateResult；``reused=True`` 表示复用了活动中的同类任务。
    """
    episode_id = str(episode_package.get("episode_id") or "")
    entity_id = episode_relation_entity_id(project_id, episode_id)

    existing = await find_active_import_task(db, project_id=project_id, episode_id=episode_id)
    if existing is not None:
        status_value = (
            existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        )
        return CasImportTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=CAS_EPISODE_IMPORT_RELATION_TYPE,
            relation_entity_id=entity_id,
        )

    store = SqlAlchemyTaskStore(db)
    manager = TaskManager(store=store, strategies={})
    task_record = await manager.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind=CAS_IMPORT_EPISODE_TASK_KIND,
        run_args={
            "project_id": project_id,
            "episode_package": episode_package,
            "idempotency_key": idempotency_key,
            "dry_run": dry_run,
        },
    )
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="task_link",
            relation_type=CAS_EPISODE_IMPORT_RELATION_TYPE,
            relation_entity_id=entity_id,
        )
    )
    await db.flush()

    return CasImportTaskCreateResult(
        task_id=task_record.id,
        status=task_record.status,
        reused=False,
        relation_type=CAS_EPISODE_IMPORT_RELATION_TYPE,
        relation_entity_id=entity_id,
    )


async def run_cas_import_task(task_id: str, run_args: dict | None = None) -> None:
    """执行导入任务：成功落 succeeded + result，失败落 failed + error。

    签名与 Jellyfish 既有 worker runner 一致 ``(task_id, run_args)``，可直接注册到
    ``AbstractAsyncDelegatingExecutor``；``run_args`` 省略时回落到从任务负载读取。

    失败路径：先回滚导入事务，再用**新会话**写任务状态，确保部分写入不会被「写状态」
    这一步顺带提交；同时补偿删除本次新建的字幕对象，避免孤儿文件。
    """
    async with async_session_maker() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.get(task_id)
        if task is None:
            logger.warning("cas import task not found: %s", task_id)
            return
        await store.set_status(task_id, TaskStatus.running)
        await store.set_progress(task_id, 5)
        await db.commit()
        if not run_args:
            run_args = task.payload.get("run_args") or {}

    result = None
    try:
        async with async_session_maker() as db:
            store = SqlAlchemyTaskStore(db)
            try:
                package = parse_episode_package(run_args["episode_package"])
                result = await import_episode(
                    db,
                    project_id=run_args["project_id"],
                    package=package,
                    idempotency_key=run_args["idempotency_key"],
                    dry_run=bool(run_args.get("dry_run", False)),
                )
                await db.commit()
            except Exception:
                await db.rollback()
                raise
            # 提交成功后再写任务结果：结果里包含字幕产物信息（file_id / storage_key）。
            await store.set_progress(task_id, 100)
            await store.set_result(task_id, result.model_dump(mode="json"))
            await store.set_status(task_id, TaskStatus.succeeded)
            await db.commit()
    except Exception as exc:  # noqa: BLE001  # 任何失败都必须落到 failed 状态
        logger.exception("cas import task failed: %s", task_id)
        await _compensate_uploaded_artifacts(result)
        async with async_session_maker() as db:
            store = SqlAlchemyTaskStore(db)
            await store.set_error(task_id, str(exc))
            await store.set_status(task_id, TaskStatus.failed)
            await db.commit()


async def _compensate_uploaded_artifacts(result) -> None:
    """导入已上传但事务未能提交时，删除**本次新建**的字幕对象（best-effort）。

    只删除 ``created=True`` 的产物：复用既有产物时对象属于上一次成功的导入，不能删。
    """
    if result is None:
        return
    for artifact in getattr(result, "subtitle_artifacts", []) or []:
        if not artifact.created:
            continue
        try:
            await storage.delete_file(key=artifact.storage_key)
        except Exception:  # noqa: BLE001  # 补偿失败只记录，不掩盖原始错误
            logger.warning("failed to clean up subtitle object: %s", artifact.storage_key)


__all__ = [
    "CAS_IMPORT_EPISODE_TASK_KIND",
    "CAS_EPISODE_IMPORT_RELATION_TYPE",
    "CasImportTaskCreateResult",
    "create_cas_import_task",
    "find_active_import_task",
    "episode_relation_entity_id",
    "run_cas_import_task",
]
