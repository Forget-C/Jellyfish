"""EpisodePackage 导入服务（application 层）。

职责严格限定为：**Validate → Map → Reuse → Create → Rollback**。绝不调用 LLM、
ScriptDivider、ElementExtractor、Celery、Redis、providers，也不生成资产、不改写台词/提示词。

事务模型：
- 复用 Jellyfish 的请求级会话（``get_db``）：会话在请求成功时 commit 一次、异常时 rollback。
- 本服务只 ``flush``（经 ``create_and_refresh``），从不自行 commit；因此整个导入天然是
  **恰好一个事务、提交一次**。
- dry-run：在构建并 flush 校验后调用 ``rollback()``，从而不写库（``get_db`` 随后的 commit 变为空提交）。

复用说明：Jellyfish 未提供「章节/整包导入」聚合 service；studio 各 service 本质是
``db.add + create_and_refresh(flush, 不 commit)`` 的薄封装。为保证「单事务」语义并避免重复
业务逻辑，本导入器在同一请求会话上复用 ``services.common.create_and_refresh`` 这一共享写原语，
按需直接构造既有 Jellyfish ORM 实体（不新建任何平行系统）。
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto_animal_studio.application.hashing import canonical_payload_hash
from app.crypto_animal_studio.application.import_result import ImportCounts, ImportResult
from app.crypto_animal_studio.domain import mapping
from app.crypto_animal_studio.domain.import_ledger import CasImportLedger
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage
from app.models.studio import (
    Chapter,
    Character,
    Actor,
    Costume,
    Prop,
    Project,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Scene,
    Shot,
    ShotCharacterLink,
    ShotDetail,
    ShotDialogLine,
)
from app.models.types import ChapterStatus, ShotStatus
from app.services.common import create_and_refresh


# --------------------------------------------------------------------------- #
# 领域异常（application 层，不依赖 FastAPI；由 api 层翻译为 HTTP）
# --------------------------------------------------------------------------- #
class CasImportError(Exception):
    """CAS 导入错误基类。"""


class ProjectNotFoundError(CasImportError):
    """目标 Project 不存在。"""


class IdempotencyConflictError(CasImportError):
    """同一 (project, idempotency_key) 下 payload 发生变化。"""


class EpisodeAlreadyImportedError(CasImportError):
    """同一 (project, episode) 已在另一幂等键下导入。"""


class _EntityResolver:
    """事务内的资产/角色解析器：复用优先、必要才新建、单事务内不重复。"""

    def __init__(self, db: AsyncSession, project: Project) -> None:
        """记录会话与目标项目，并初始化缓存与计数。"""
        self._db = db
        self._project = project
        self._cache: dict[tuple[str, str], str] = {}
        self.created = ImportCounts()
        self.reused = ImportCounts()

    async def _resolve_global_asset(self, kind: str, model: type, name: str, description: str) -> str:
        """解析全局资产（Actor/Scene/Prop/Costume）：按规范化名称复用，否则新建。"""
        norm = mapping.normalize_key(name)
        cache_key = (kind, norm)
        if cache_key in self._cache:
            return self._cache[cache_key]
        stmt = select(model).where(func.lower(model.name) == norm).limit(1)
        existing = (await self._db.execute(stmt)).scalars().first()
        if existing is not None:
            self._cache[cache_key] = existing.id
            setattr(self.reused, kind, getattr(self.reused, kind) + 1)
            return existing.id
        obj = model(
            id=str(uuid.uuid4()),
            name=name,
            description=description,
            style=self._project.style,
            visual_style=self._project.visual_style,
        )
        await create_and_refresh(self._db, obj)
        self._cache[cache_key] = obj.id
        setattr(self.created, kind, getattr(self.created, kind) + 1)
        return obj.id

    async def resolve_actor(self, name: str, description: str) -> str:
        """解析/新建 Actor（视觉演员）。"""
        return await self._resolve_global_asset("actors", Actor, name, description)

    async def resolve_scene(self, name: str, description: str) -> str:
        """解析/新建 Scene。"""
        return await self._resolve_global_asset("scenes", Scene, name, description)

    async def resolve_prop(self, name: str, description: str) -> str:
        """解析/新建 Prop。"""
        return await self._resolve_global_asset("props", Prop, name, description)

    async def resolve_costume(self, name: str, description: str) -> str:
        """解析/新建 Costume。"""
        return await self._resolve_global_asset("costumes", Costume, name, description)

    async def resolve_character(
        self, name: str, description: str, actor_id: str | None, costume_id: str | None
    ) -> str:
        """解析/新建 Character（项目内、按名称复用）。Character≠Actor，绝不合并。"""
        norm = mapping.normalize_key(name)
        cache_key = ("characters", norm)
        if cache_key in self._cache:
            return self._cache[cache_key]
        stmt = (
            select(Character)
            .where(Character.project_id == self._project.id, func.lower(Character.name) == norm)
            .limit(1)
        )
        existing = (await self._db.execute(stmt)).scalars().first()
        if existing is not None:
            self._cache[cache_key] = existing.id
            self.reused.characters += 1
            return existing.id
        obj = Character(
            id=str(uuid.uuid4()),
            project_id=self._project.id,
            name=name,
            description=description,
            style=self._project.style,
            visual_style=self._project.visual_style,
            actor_id=actor_id,
            costume_id=costume_id,
        )
        await create_and_refresh(self._db, obj)
        self._cache[cache_key] = obj.id
        self.created.characters += 1
        return obj.id


async def import_episode(
    db: AsyncSession,
    *,
    project_id: str,
    package: EpisodePackage,
    idempotency_key: str,
    dry_run: bool = False,
) -> ImportResult:
    """把一个已校验的 EpisodePackage 导入为一个 Jellyfish Chapter（含 Shots 等）。

    参数：
        db: 请求级异步会话（单事务；本函数只 flush，不自行 commit）。
        project_id: 目标项目（代表系列/季）。
        package: 已通过契约校验的 EpisodePackage。
        idempotency_key: 幂等键。
        dry_run: 为真时执行校验/映射/复用查找/告警但不写库。
    返回：
        ImportResult 摘要。
    异常：
        ProjectNotFoundError / IdempotencyConflictError / EpisodeAlreadyImportedError。
    """
    payload_hash = canonical_payload_hash(package)

    project = await db.get(Project, project_id)
    if project is None:
        raise ProjectNotFoundError(f"Project not found: {project_id}")

    # --- 幂等：先查台账（读，不写） ---
    ledger_row = (
        await db.execute(
            select(CasImportLedger).where(
                CasImportLedger.project_id == project_id,
                CasImportLedger.idempotency_key == idempotency_key,
            )
        )
    ).scalars().first()
    if ledger_row is not None:
        if ledger_row.payload_hash == payload_hash:
            # 同 key 同 payload → 幂等重放，返回既有结果，不重复建章节。
            return ImportResult(
                status="replayed",
                dry_run=dry_run,
                idempotent_replay=True,
                project_id=project_id,
                episode_id=package.episode_id,
                idempotency_key=idempotency_key,
                payload_hash=payload_hash,
                chapter_id=ledger_row.chapter_id,
                chapter_index=None,
                warnings=["idempotent replay: returned existing import result"],
            )
        # 同 key 不同 payload → 冲突。
        raise IdempotencyConflictError(
            f"idempotency_key '{idempotency_key}' already used with a different payload"
        )

    # 同 project+episode 已在另一 key 下导入 → 保守拒绝。
    dup_episode = (
        await db.execute(
            select(CasImportLedger).where(
                CasImportLedger.project_id == project_id,
                CasImportLedger.episode_id == package.episode_id,
            )
        )
    ).scalars().first()
    if dup_episode is not None:
        raise EpisodeAlreadyImportedError(
            f"episode '{package.episode_id}' already imported under another idempotency_key"
        )

    warnings: list[str] = []
    resolver = _EntityResolver(db, project)

    # --- 章节序号（项目内递增） ---
    max_index = (
        await db.execute(select(func.max(Chapter.index)).where(Chapter.project_id == project_id))
    ).scalar()
    next_index = int(max_index or 0) + 1

    # --- Chapter ---
    chapter = Chapter(
        id=str(uuid.uuid4()),
        project_id=project_id,
        index=next_index,
        title=package.title,
        summary=package.logline,
        raw_text=mapping.assemble_raw_text(package),  # 完整剧本，仅供追溯
        condensed_text="",
        storyboard_count=len(package.shots),
        status=ChapterStatus.draft,
    )
    await create_and_refresh(db, chapter)
    resolver.created.chapters += 1

    # --- 角色（含 Actor/Costume 解析）：Character≠Actor ---
    actors_by_key = {a.actor_key: a for a in package.assets.actors}
    scenes_by_key = {s.scene_key: s for s in package.assets.scenes}
    props_by_key = {p.prop_key: p for p in package.assets.props}
    costumes_by_key = {c.costume_key: c for c in package.assets.costumes}

    char_key_to_id: dict[str, str] = {}
    for character in package.characters:
        actor_id: str | None = None
        if character.actor_key is not None:
            spec = actors_by_key.get(character.actor_key)
            actor_id = await resolver.resolve_actor(
                (spec.display_name if spec and spec.display_name else character.actor_key),
                (spec.description if spec else ""),
            )
        else:
            warnings.append(
                f"character '{character.character_key}' has no actor_key; actor_id left unset"
            )
        costume_id: str | None = None
        if character.costume_key is not None:
            spec = costumes_by_key.get(character.costume_key)
            costume_id = await resolver.resolve_costume(
                (spec.display_name if spec and spec.display_name else character.costume_key),
                (spec.description if spec else ""),
            )
        char_key_to_id[character.character_key] = await resolver.resolve_character(
            character.display_name, character.description, actor_id, costume_id
        )

    # --- 逐镜头 ---
    for shot_spec in sorted(package.shots, key=lambda s: s.sequence):
        shot = Shot(
            id=str(uuid.uuid4()),
            chapter_id=chapter.id,
            index=shot_spec.sequence,
            title=shot_spec.title,
            status=ShotStatus.pending,
            skip_extraction=True,  # CAS storyboard 权威：跳过抽取
            script_excerpt=shot_spec.script_excerpt,
        )
        await create_and_refresh(db, shot)
        resolver.created.shots += 1

        camera_shot, angle, movement, cam_warnings = mapping.resolve_camera(shot_spec.camera)
        warnings.extend(f"shot '{shot_spec.shot_id}': {w}" for w in cam_warnings)

        scene_id: str | None = None
        if shot_spec.scene_key is not None:
            spec = scenes_by_key.get(shot_spec.scene_key)
            scene_id = await resolver.resolve_scene(
                (spec.display_name if spec and spec.display_name else shot_spec.scene_key),
                (spec.description if spec else ""),
            )

        if shot_spec.video_prompt:
            warnings.append(
                f"shot '{shot_spec.shot_id}': video_prompt not mapped (no ShotDetail field)"
            )
        if shot_spec.negative_prompt:
            warnings.append(
                f"shot '{shot_spec.shot_id}': negative_prompt not mapped (no ShotDetail field)"
            )

        detail = ShotDetail(
            id=shot.id,  # 与 Shot 共享主键（1:1）
            camera_shot=camera_shot,
            angle=angle,
            movement=movement,
            scene_id=scene_id,
            duration=mapping.round_duration(shot_spec.duration_seconds),
            description=shot_spec.action,
            first_frame_prompt="",
            last_frame_prompt="",
            key_frame_prompt=shot_spec.image_prompt,
        )
        await create_and_refresh(db, detail)
        resolver.created.shot_details += 1

        # 对白
        for line in sorted(shot_spec.dialogue, key=lambda d: d.order):
            line_mode, lm_warning = mapping.resolve_line_mode(line.line_mode)
            if lm_warning:
                warnings.append(f"shot '{shot_spec.shot_id}': {lm_warning}")
            dialog = ShotDialogLine(
                shot_detail_id=detail.id,
                index=line.order,
                text=line.text,
                line_mode=line_mode,
                speaker_character_id=char_key_to_id.get(line.character_key)
                if line.character_key
                else None,
                speaker_name=mapping.dialogue_speaker_name(package, line),
            )
            await create_and_refresh(db, dialog)
            resolver.created.dialog_lines += 1

        # 出场角色 → ShotCharacterLink
        for order, ckey in enumerate(shot_spec.character_keys, start=1):
            link = ShotCharacterLink(
                shot_id=shot.id, character_id=char_key_to_id[ckey], index=order
            )
            await create_and_refresh(db, link)
            resolver.created.links += 1

        # 场景 → ProjectSceneLink（shot 维度）
        if scene_id is not None:
            await create_and_refresh(
                db,
                ProjectSceneLink(
                    project_id=project_id, chapter_id=chapter.id, shot_id=shot.id, scene_id=scene_id
                ),
            )
            resolver.created.links += 1

        # 道具 → ProjectPropLink
        for pkey in shot_spec.prop_keys:
            spec = props_by_key.get(pkey)
            prop_id = await resolver.resolve_prop(
                (spec.display_name if spec and spec.display_name else pkey),
                (spec.description if spec else ""),
            )
            await create_and_refresh(
                db,
                ProjectPropLink(
                    project_id=project_id, chapter_id=chapter.id, shot_id=shot.id, prop_id=prop_id
                ),
            )
            resolver.created.links += 1

        # 服装 → ProjectCostumeLink
        for kkey in shot_spec.costume_keys:
            spec = costumes_by_key.get(kkey)
            costume_id = await resolver.resolve_costume(
                (spec.display_name if spec and spec.display_name else kkey),
                (spec.description if spec else ""),
            )
            await create_and_refresh(
                db,
                ProjectCostumeLink(
                    project_id=project_id,
                    chapter_id=chapter.id,
                    shot_id=shot.id,
                    costume_id=costume_id,
                ),
            )
            resolver.created.links += 1

    if dry_run:
        # 校验/映射/复用查找/告警均已完成；回滚以确保不写库。
        await db.rollback()
        return ImportResult(
            status="dry_run",
            dry_run=True,
            idempotent_replay=False,
            project_id=project_id,
            episode_id=package.episode_id,
            idempotency_key=idempotency_key,
            payload_hash=payload_hash,
            chapter_id=None,
            chapter_index=next_index,
            created=resolver.created,
            reused=resolver.reused,
            warnings=warnings,
        )

    # 写入幂等台账（同事务）。唯一约束在并发下兜底为冲突。
    await create_and_refresh(
        db,
        CasImportLedger(
            id=str(uuid.uuid4()),
            project_id=project_id,
            episode_id=package.episode_id,
            idempotency_key=idempotency_key,
            payload_hash=payload_hash,
            chapter_id=chapter.id,
            status="imported",
            schema_version=package.schema_version,
        ),
    )

    return ImportResult(
        status="imported",
        dry_run=False,
        idempotent_replay=False,
        project_id=project_id,
        episode_id=package.episode_id,
        idempotency_key=idempotency_key,
        payload_hash=payload_hash,
        chapter_id=chapter.id,
        chapter_index=next_index,
        created=resolver.created,
        reused=resolver.reused,
        warnings=warnings,
    )


__all__ = [
    "import_episode",
    "CasImportError",
    "ProjectNotFoundError",
    "IdempotencyConflictError",
    "EpisodeAlreadyImportedError",
]
