"""剧情方案草稿 → **正式产物**的落库（materialize）。

为什么不能复用 ``script_division._append_division_rows``
======================================================

那支函数是给"剧本原文拆镜头"用的，它把技术参数**硬编码**掉（已核实
``app/services/studio/script_division.py:14-44``）：

- ``camera_shot=MS`` / ``angle=EYE_LEVEL`` / ``movement=STATIC``；
- ``duration=4``；
- **完全不写对白独立表** ``shot_dialog_lines``（对白只留在剧本摘录里）。

而剧情方案的每镜都带真实景别 / 机位 / 运镜 / 时长 / 动作拍点 / 台词 —— 用那支函数落库
等于把方案里最有价值的部分全丢掉。所以这里新写一支，并且：
**复用它的边界口径**（章节已有镜头则拒绝写入），不重复造边界。

一条路、一个事务
================

- 写正式产物**只有这一条路**（``POST .../drama-plan/confirm``）；
- 全部写入都在调用方给的同一个 session 里完成，路由提交；
  **任何一步抛错整体回滚**，不会留下半个章节（校验全部前置，见 ``_validate``）。

校验（都是在确认时**再**做一遍的兜底，不信模型自述）
====================================================

1. 角色 / 场景名称不能为空、不能重名；
2. 每镜的「出场角色」与台词说话人必须能在人物表里解析到（悬空引用直接 409，
   不静默丢数据 —— 草稿阶段会修，人工编辑后可能又坏掉）；
3. 有商品时，「出现商品的镜头数」必须 ≥ 一半（user 口径）；
   这条同时决定 ``project_product_links`` 建多少行，用**行数**而不是布尔列表达。
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import (
    CameraAngle,
    CameraMovement,
    CameraShotType,
    Chapter,
    Character,
    DialogueLineMode,
    Product,
    Project,
    ProjectProductLink,
    ProjectSceneLink,
    Scene,
    Shot,
    ShotCharacterLink,
    ShotDetail,
    ShotDialogLine,
    VFXType,
)
from app.schemas.studio.drama_plan import DramaPlanDraft as DramaPlanDraftDTO
from app.services.studio.asset_profiles import render_profile_text

#: 章节标题缺省值（方案没给标题时用它，不编造内容）
FALLBACK_TITLE = "剧情广告"


def _conflict(code: str, message: str, *, fix: str, extra: dict[str, Any] | None = None) -> HTTPException:
    """结构化 409（路由会用 ``error_envelope`` 原样下发到 ``meta.error``）。"""
    detail: dict[str, Any] = {"code": code, "message": message, "fix": fix}
    if extra:
        detail.update(extra)
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _new_id(prefix: str) -> str:
    """新资产 / 镜头的 ID（仓库既有口径：本地生成的短 uuid）。"""
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def _validate(plan: DramaPlanDraftDTO) -> list[str]:
    """落库前的确定性校验；返回 warnings，问题是抛异常而不是静默修。"""
    warnings: list[str] = []
    if not plan.shots:
        raise _conflict(
            "drama_plan_no_shots",
            "草稿里没有任何镜头，无法确认落库。",
            fix="先在草稿编辑器里补上镜头，或重新生成一次。",
        )

    character_names: dict[str, str] = {}
    for item in plan.characters:
        name = item.name.strip()
        if not name:
            raise _conflict("drama_plan_blank_character", "人物表里有名称为空的角色。", fix="删掉它或补上名字。")
        if name in character_names:
            raise _conflict(
                "drama_plan_duplicate_character",
                f"人物表里「{name}」出现了两次。",
                fix="合并成一条（同一个人只应有一条人物资料）。",
            )
        character_names[name] = name

    scene_names: set[str] = set()
    for item in plan.scenes:
        name = item.name.strip()
        if not name:
            raise _conflict("drama_plan_blank_scene", "场景表里有名称为空的场景。", fix="删掉它或补上名字。")
        if name in scene_names:
            raise _conflict(
                "drama_plan_duplicate_scene", f"场景表里「{name}」出现了两次。", fix="合并成一条。"
            )
        scene_names.add(name)

    # 悬空引用：出场角色与台词说话人都必须能解析到人物表
    for shot in plan.shots:
        unknown = [name for name in shot.characters if name not in character_names]
        if unknown:
            raise _conflict(
                "drama_plan_unknown_character",
                f"镜头 {shot.index} 的出场角色里，「{unknown[0]}」不在人物表里。",
                fix="把该角色加进人物表，或从这一镜的出场角色里去掉。",
                extra={"shot_index": shot.index, "unknown_characters": unknown},
            )
        for line in shot.dialogue:
            if line.speaker and line.speaker not in character_names:
                raise _conflict(
                    "drama_plan_unknown_speaker",
                    f"镜头 {shot.index} 的台词说话人「{line.speaker}」不在人物表里。",
                    fix="把该角色加进人物表，或清空这句台词的说话人。",
                    extra={"shot_index": shot.index},
                )

    if plan.product is not None:
        if not plan.product.name.strip():
            raise _conflict("drama_plan_blank_product", "商品没有名称。", fix="补上商品名称或删掉商品。")
        present = sum(1 for shot in plan.shots if shot.product_present)
        need = (len(plan.shots) + 1) // 2
        if present < need:
            raise _conflict(
                "drama_plan_product_coverage",
                f"商品只出现在 {present}/{len(plan.shots)} 个镜头，少于要求的一半（{need} 个）。",
                fix="在草稿里把更多镜头标成「出现商品」，或改回没有商品的方案。",
                extra={"product_shots": present, "shot_total": len(plan.shots), "required": need},
            )
    elif any(shot.product_present for shot in plan.shots):
        warnings.append("草稿里标了「出现商品」但没有商品信息，已按无商品落库。")

    return warnings


async def _count_chapter_shots(db: AsyncSession, chapter_id: str) -> int:
    total = await db.scalar(select(func.count()).select_from(Shot).where(Shot.chapter_id == chapter_id))
    return int(total or 0)


async def materialize_drama_plan(
    db: AsyncSession,
    *,
    chapter_id: str,
    plan: dict[str, Any],
) -> dict[str, Any]:
    """把草稿落成正式产物（**同一个事务**，失败整体回滚）。返回统计字典。"""
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"章节不存在：{chapter_id}")
    project = await db.get(Project, chapter.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"项目不存在：{chapter.project_id}"
        )

    # 与 script_division 同一口径：章节里已经有镜头就不再写入（否则新旧分镜会混在一起）
    existing = await _count_chapter_shots(db, chapter_id)
    if existing:
        raise _conflict(
            "drama_plan_chapter_not_empty",
            f"这一集已有 {existing} 个镜头，拒绝写入方案（避免新旧分镜混在一起）。",
            fix="换一个空章节（例如新建一集）再确认落库。",
            extra={"existing_shots": existing},
        )

    try:
        dto = DramaPlanDraftDTO.model_validate(plan or {})
    except Exception as exc:  # noqa: BLE001 - 草稿结构坏了要如实报，不能猜
        raise _conflict(
            "drama_plan_invalid_draft",
            f"草稿结构不合法，无法落库：{exc}",
            fix="重新生成一次，或把草稿里明显的字段补齐。",
        ) from exc

    warnings = _validate(dto)

    counts = {
        "chapter_id": chapter_id,
        "shots_created": 0,
        "dialog_lines_created": 0,
        "characters_created": 0,
        "scenes_created": 0,
        "product_created": False,
        "shot_product_links": 0,
        "shot_character_links": 0,
        "warnings": warnings,
    }

    # 1) 章节：标题 / 一句话主线
    chapter.title = (dto.title or "").strip() or chapter.title or FALLBACK_TITLE
    chapter.summary = (dto.logline or "").strip() or chapter.summary

    # 2) 角色（唯一带 project_id 的资产）
    character_ids: dict[str, str] = {}
    for item in dto.characters:
        character_id = _new_id("char")
        character_ids[item.name] = character_id
        db.add(
            Character(
                id=character_id,
                project_id=project.id,
                name=item.name,
                description=render_profile_text("character", item.profile),
                style=project.style,
                visual_style=project.visual_style,
            )
        )
        counts["characters_created"] += 1

    # 3) 场景（全局资产 + 项目档关联）
    scene_ids: dict[str, str] = {}
    for item in dto.scenes:
        scene_id = _new_id("scene")
        scene_ids[item.name] = scene_id
        db.add(
            Scene(
                id=scene_id,
                name=item.name,
                description=render_profile_text("scene", item.profile),
                style=project.style,
                visual_style=project.visual_style,
            )
        )
        db.add(ProjectSceneLink(id=None, project_id=project.id, scene_id=scene_id))
        counts["scenes_created"] += 1

    # 4) 商品（全局资产 + 项目档关联；**逐镜的 shot 档关联在建镜头时补**）
    product_id = ""
    if dto.product is not None:
        product_id = _new_id("prod")
        db.add(
            Product(
                id=product_id,
                name=dto.product.name,
                description=dto.product.description or render_profile_text("product", dto.product.profile),
                style=project.style,
                visual_style=project.visual_style,
            )
        )
        db.add(ProjectProductLink(id=None, project_id=project.id, product_id=product_id))
        counts["product_created"] = True

    # 5) 镜头：Shot + ShotDetail（真实景别/机位/运镜/时长/动作拍点）+ 对白行 + 关联行
    for position, shot in enumerate(dto.shots, start=1):
        shot_id = _new_id("shot")
        db.add(
            Shot(
                id=shot_id,
                chapter_id=chapter_id,
                index=position,
                title=shot.title or f"镜头 {position}",
                script_excerpt=shot.script_excerpt,
            )
        )
        db.add(
            ShotDetail(
                id=shot_id,
                camera_shot=shot.camera_shot or CameraShotType.ms.value,
                angle=shot.angle or CameraAngle.eye_level.value,
                movement=shot.movement or CameraMovement.static.value,
                duration=int(shot.duration or 0),
                action_beats=list(shot.action_beats or []),
                description=shot.description,
                follow_atmosphere=True,
                vfx_type=VFXType.none,
            )
        )
        counts["shots_created"] += 1

        for link_index, name in enumerate(shot.characters):
            db.add(
                ShotCharacterLink(
                    id=None,
                    shot_id=shot_id,
                    character_id=character_ids[name],
                    index=link_index,
                    note="",
                )
            )
            counts["shot_character_links"] += 1

        for line_index, line in enumerate(shot.dialogue):
            mode = str(line.mode or "DIALOGUE").upper()
            if mode not in {item.value for item in DialogueLineMode}:
                mode = DialogueLineMode.dialogue.value
                warnings.append(f"镜头 {position} 的台词模式非法，已落 DIALOGUE。")
            db.add(
                ShotDialogLine(
                    id=None,
                    shot_detail_id=shot_id,
                    index=line_index,
                    text=line.text,
                    line_mode=mode,
                    speaker_character_id=character_ids.get(line.speaker) if line.speaker else None,
                    speaker_name=line.speaker or None,
                )
            )
            counts["dialog_lines_created"] += 1

        if product_id and shot.product_present:
            # 「这一镜出现了商品」的**唯一**表达：shot 档关联行（不是布尔列）
            db.add(
                ProjectProductLink(
                    id=None,
                    project_id=project.id,
                    chapter_id=chapter_id,
                    shot_id=shot_id,
                    product_id=product_id,
                )
            )
            counts["shot_product_links"] += 1

    chapter.storyboard_count = counts["shots_created"]
    await db.flush()
    return counts


__all__ = ["FALLBACK_TITLE", "materialize_drama_plan"]
