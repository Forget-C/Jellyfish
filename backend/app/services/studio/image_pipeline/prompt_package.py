"""P3 提示词包导出：把一个项目/一批镜头的图片提示词 + 视频提示词 + 绑定资产 + 参考图打成包。

设计要点：
- **只读**：不写库、不出图、不出视频；
- 复用 P1 的编排服务（图片逐槽位提示词、视频提示词）与 P2 的绑定状态读取，
  不重复实现提示词逻辑；
- 同时给出 json（结构化）、text（纯文本，可直接粘贴）、markdown（带小标题）三种渲染，
  对齐既有 ``prompt_delivery`` 出口 A 的用途。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.studio.image_pipeline import (
    PromptPackageRead,
    PromptPackageRequest,
    PromptPackageShotRead,
    ReferenceImageRead,
)
from app.schemas.studio.llm_orchestration import (
    ImagePromptPreviewRequest,
    VideoPromptPreviewRequest,
)
from app.services.studio.image_pipeline.reference_resolver import resolve_references
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.asset_binding import (
    load_shots_for_binding,
    missing_shot_ids,
)
from app.services.studio.llm_orchestration.context import (
    build_profile_cards,
    load_project_entity_profiles,
    render_profile_cards,
)
from app.services.studio.llm_orchestration.image_prompt import preview_image_prompts
from app.services.studio.llm_orchestration.registry import DEFAULT_IMAGE_PROMPT_CATEGORIES
from app.services.studio.llm_orchestration.video_prompt import preview_video_prompt

# 参考图类型 → 槽位
REFERENCE_SLOT_BY_TYPE: dict[str, str] = {
    "character": "characters",
    "scene": "scene",
    "prop": "props",
    "costume": "costumes",
    "product": "products",
}
MAX_REFERENCE_ASSETS = 20


def _to_reference_read(item: Any) -> ReferenceImageRead:
    return ReferenceImageRead(
        asset_id=item.asset_id,
        asset_type=item.asset_type,
        file_id=item.file_id,
        url=item.url,
        view_angle=item.view_angle,
        quality_level=item.quality_level,
        is_primary=item.is_primary,
        resolved_from=item.resolved_from,
        warnings=list(item.warnings),
    )


async def _collect_references(
    db: AsyncSession,
    *,
    bound: dict[str, list[str]],
) -> tuple[list[ReferenceImageRead], list[str]]:
    """把镜头已绑定资产里"有定版图"的挑出来，作为可参考的定版图。"""
    references: list[ReferenceImageRead] = []
    warnings: list[str] = []
    for asset_type, slot in REFERENCE_SLOT_BY_TYPE.items():
        asset_ids = [str(x) for x in (bound.get(slot) or []) if str(x).strip()][:MAX_REFERENCE_ASSETS]
        if not asset_ids:
            continue
        resolved = await resolve_references(db, asset_type=asset_type, asset_ids=asset_ids)
        for asset_id in asset_ids:
            item = resolved.get(asset_id)
            if item is None:
                continue
            read = _to_reference_read(item)
            references.append(read)
            if item.is_primary and not item.url:
                warnings.append(f"{asset_type} {asset_id} 已定版但解析不到可访问地址。")
    return references, warnings


async def build_prompt_package(
    db: AsyncSession,
    *,
    body: PromptPackageRequest,
) -> PromptPackageRead:
    """组装提示词包（只读）。"""
    warnings: list[str] = []
    requested = [str(x).strip() for x in body.shot_ids if str(x).strip()]
    shots = await load_shots_for_binding(
        db,
        project_id=body.project_id,
        shot_ids=requested or None,
        max_shots=body.max_shots,
    )
    if not shots:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"项目 {body.project_id} 内没有找到可导出的镜头。",
        )
    missing = missing_shot_ids(requested, shots)
    if missing:
        warnings.append(f"以下 shot_id 不属于该项目或不存在，已忽略：{missing}。")

    if dry_run.dry_run_enabled():
        warnings.append(
            f"[DRY_RUN] 提示词包中的图片/视频提示词来自**确定性占位**（未调用大模型）。"
            f"要真实调用请设置 {dry_run.DRY_RUN_ENV}=0 且 {dry_run.CONFIRM_ENV}=1。"
        )
    elif len(shots) > 1 and (body.include_image_prompts or body.include_video_prompts):
        warnings.append(
            f"真实模式下本次会对 {len(shots)} 个镜头逐个调用大模型生成提示词，请留意费用与耗时。"
        )

    # 画像卡只装载一次，供所有镜头的图片提示词复用（保证跨镜头一致性与查询量）。
    profiles = await load_project_entity_profiles(db, project_id=body.project_id)
    cards = build_profile_cards(profiles, source="project")
    if not cards:
        warnings.append("项目内没有实体画像，图片提示词将只依据镜头文本生成。")

    shot_reads: list[PromptPackageShotRead] = []
    total_images = 0
    total_video = 0

    for shot in shots:
        bound = {slot: sorted(ids) for slot, ids in (shot.bound_ids or {}).items() if ids}
        image_prompts: list[dict[str, Any]] = []
        video_prompt: dict[str, Any] | None = None
        shot_warnings: list[str] = []

        if body.include_image_prompts:
            image_result = await preview_image_prompts(
                db,
                body=ImagePromptPreviewRequest(
                    shot_id=shot.shot_id,
                    shot_text=shot.script_text or None,
                    project_id=body.project_id,
                    entity_profiles=profiles,
                    categories=list(DEFAULT_IMAGE_PROMPT_CATEGORIES),
                ),
            )
            image_prompts = [
                {
                    "category": str(slot.category.value),
                    "label": slot.label,
                    "entity_name": slot.entity_name,
                    "layers": slot.layers,
                    "prompt": slot.prompt,
                    "negative_prompt": slot.negative_prompt,
                }
                for slot in image_result.slots
            ]
            shot_warnings.extend(image_result.warnings)
            total_images += len(image_prompts)

        if body.include_video_prompts:
            video_result = await preview_video_prompt(
                db,
                body=VideoPromptPreviewRequest(
                    shot_id=shot.shot_id,
                    shot_text=shot.script_text or None,
                    project_id=body.project_id,
                    entity_profiles=profiles,
                ),
            )
            video_prompt = {
                "final_prompt": video_result.final_prompt,
                "negative_prompt": video_result.negative_prompt,
                "camera_movement": video_result.camera_movement.model_dump(),
                "camera": video_result.camera.model_dump(),
                "frame_mode": video_result.frame_mode,
                "duration_seconds": video_result.duration_seconds,
                "subject_action": video_result.subject_action,
                "expression_mood": video_result.expression_mood,
                "atmosphere": video_result.atmosphere,
                "action_beats": video_result.action_beats,
                "dry_run": video_result.meta.dry_run,
            }
            shot_warnings.extend(video_result.warnings)
            total_video += 1

        references: list[ReferenceImageRead] = []
        if body.include_bindings:
            references, reference_warnings = await _collect_references(db, bound=bound)
            shot_warnings.extend(reference_warnings)

        shot_reads.append(
            PromptPackageShotRead(
                shot_id=shot.shot_id,
                index=shot.index,
                title=shot.title,
                script_excerpt=shot.script_text,
                bound_assets=bound if body.include_bindings else {},
                image_prompts=image_prompts,
                video_prompt=video_prompt,
                references=references,
                warnings=shot_warnings,
            )
        )

    package = PromptPackageRead(
        project_id=body.project_id,
        shots=shot_reads,
        warnings=warnings,
        meta={
            "shot_count": len(shot_reads),
            "image_prompt_count": total_images,
            "video_prompt_count": total_video,
            "entity_card_count": len(cards),
            "dry_run": dry_run.dry_run_enabled(),
            "format": body.format,
            "entity_profile_preview": render_profile_cards(cards)[:400],
        },
    )
    package.rendered_text = render_package_text(package)
    package.rendered_markdown = render_package_markdown(package)
    return package


# ---------------------------------------------------------------------------
# 渲染
# ---------------------------------------------------------------------------


def render_package_text(package: PromptPackageRead) -> str:
    """纯文本渲染：便于直接粘贴或走既有 TXT 导出。"""
    lines: list[str] = [f"# 提示词包 · 项目 {package.project_id}", ""]
    for shot in package.shots:
        lines.append(f"===== [{shot.index}] {shot.shot_id} {shot.title} =====")
        if shot.script_excerpt:
            lines.append(f"剧情：{shot.script_excerpt}")
        if shot.bound_assets:
            lines.append("已绑定资产：")
            for slot, ids in shot.bound_assets.items():
                lines.append(f"  - {slot}: {', '.join(ids)}")
        for item in shot.image_prompts:
            lines.append(f"[图片提示词 · {item.get('category')}] {item.get('prompt')}")
            if item.get("negative_prompt"):
                lines.append(f"  负面：{item.get('negative_prompt')}")
        if shot.video_prompt:
            lines.append(f"[视频提示词] {shot.video_prompt.get('final_prompt')}")
            lines.append(f"  运镜：{shot.video_prompt.get('camera_movement', {}).get('label', '')}")
            lines.append(f"  时长：{shot.video_prompt.get('duration_seconds')}s")
        if shot.references:
            lines.append("参考图（定版）：")
            for reference in shot.references:
                lines.append(f"  - {reference.asset_type} {reference.asset_id}: {reference.url or '（无地址）'}")
        lines.append("")
    return "\n".join(lines).strip()


def render_package_markdown(package: PromptPackageRead) -> str:
    """Markdown 渲染：便于进文档交付。"""
    lines: list[str] = [f"# 提示词包 · 项目 {package.project_id}", ""]
    for shot in package.shots:
        lines.append(f"## [{shot.index}] {shot.shot_id} · {shot.title or '未命名'}")
        if shot.script_excerpt:
            lines.append(f"> {shot.script_excerpt}")
            lines.append("")
        if shot.bound_assets:
            lines.append("**已绑定资产**")
            for slot, ids in shot.bound_assets.items():
                lines.append(f"- `{slot}`: {', '.join(ids)}")
            lines.append("")
        if shot.image_prompts:
            lines.append("**图片提示词**")
            for item in shot.image_prompts:
                lines.append(f"- `{item.get('category')}`: {item.get('prompt')}")
            lines.append("")
        if shot.video_prompt:
            lines.append("**视频提示词**")
            lines.append(f"- 提示词：{shot.video_prompt.get('final_prompt')}")
            lines.append(
                f"- 运镜：{shot.video_prompt.get('camera_movement', {}).get('label', '')}"
                f"｜时长：{shot.video_prompt.get('duration_seconds')}s"
                f"｜帧模式：{shot.video_prompt.get('frame_mode')}"
            )
            lines.append("")
        if shot.references:
            lines.append("**参考图（定版）**")
            for reference in shot.references:
                mark = "定版" if reference.is_primary else "非定版"
                lines.append(f"- {reference.asset_type} `{reference.asset_id}`（{mark}）：{reference.url or '（无地址）'}")
            lines.append("")
    return "\n".join(lines).strip()
