"""一键技能（导演 Skill）服务：列举 Skill、装配上下文、调 LLM 生成、写回镜头。

职责边界：
  - **生成会真实调用文字大模型**（付费出口）。这是本模块与中控台移植件的最大差别：
    中控台 B 工程在 DRY_RUN 下刻意不调 LLM（怕假数据写库污染真库），
    但本项目的目标就是"能用"，所以生成是真的，且**只有显式调用才发生**。
  - 本模块不写库，除非调用方显式要求 ``save_to_shot=True``；
    写回只落在 ``shot_details.video_prompt`` / ``video_prompt_source`` 两列，
    并把 source 记成 ``skill``，与 ``jurilu`` 分开——出口 A 只认 jurilu，不会被这里污染。
  - Skill 清单与提示词拼装口径在 ``prompt_skill_registry``（纯标准库，可沙箱自检）。

来源标注：
  - Skill 清单 / 规则拼装 —— 中控台 ``prompt_skill_registry.py``
  - 页面语义（选 Skill → 填需求 → 产出提示词） —— 中控台 ``one_click_skill_page.py``
  - 写回口径（video_prompt / video_prompt_source） —— 本项目迁移时的落点（见
    ``script/fix_video_prompt_field.py`` 的说明）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Project, Shot, ShotDetail
from app.services.llm.resolver import build_default_text_llm
from app.services.skills import prompt_skill_registry as registry

#: 写回镜头时的来源标记。刻意用 "skill" 而不是 "jurilu"：
#: 出口 A 的判定是 source == "jurilu"，不能被这里误伤。
SKILL_PROMPT_SOURCE = "skill"

#: 单次请求允许的输入长度上限（防止把整章剧本灌进去烧钱/超限）。
MAX_REQUEST_CHARS = 4000
MAX_CONTEXT_CHARS = 8000


class QuickSkillError(RuntimeError):
    """一键技能的可预期失败（未知 Skill / 资源缺失 / 模型返回空）。"""


@dataclass
class QuickSkillResult:
    skill_id: str
    skill_name: str
    stage: str
    prompt: str
    request: str
    context: str
    model_used: str = ""
    saved_shot_id: str | None = None
    saved: bool = False
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Skill 清单
# ---------------------------------------------------------------------------


def list_skills() -> list[dict[str, Any]]:
    """列出全部导演 Skill，并如实标注资源是否就位。"""
    items: list[dict[str, Any]] = []
    for spec in registry.PROMPT_SKILLS:
        exists = spec.source_path.exists()
        char_count = 0
        load_error = ""
        if exists:
            try:
                char_count = len(registry.load_prompt_skill(spec.skill_id))
            except Exception as exc:  # noqa: BLE001 - 资源坏了要如实报出来，而不是隐藏
                load_error = f"{type(exc).__name__}: {exc}"
        items.append(
            {
                "skill_id": spec.skill_id,
                "display_name": spec.display_name,
                "stage": spec.stage,
                "stage_label": registry.STAGE_LABELS.get(spec.stage, spec.stage),
                "summary": spec.summary,
                "pinned": spec.pinned,
                "source_name": spec.source_name,
                "source_present": exists,
                "rule_chars": char_count,
                "load_error": load_error,
            }
        )
    return items


# ---------------------------------------------------------------------------
# 上下文装配（只读）
# ---------------------------------------------------------------------------


async def build_shot_context(
    db: AsyncSession,
    *,
    chapter_id: str | None = None,
    shot_id: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """按「项目 → 章节 → 镜头」装配中台上下文。

    返回 ``(可读文本, 结构化字典)``：文本给模型看，字典给前端回显。
    只读，不做任何写入。
    """
    data: dict[str, Any] = {}
    lines: list[str] = []

    chapter: Chapter | None = None
    if chapter_id:
        chapter = await db.get(Chapter, chapter_id)
    elif shot_id:
        shot_row = await db.get(Shot, shot_id)
        if shot_row is not None:
            chapter = await db.get(Chapter, shot_row.chapter_id)

    project: Project | None = None
    if chapter is not None:
        project = await db.get(Project, chapter.project_id)

    if project is not None:
        data["project"] = {
            "id": project.id,
            "name": project.name,
            "style": str(project.style or ""),
            "visual_style": str(project.visual_style or ""),
            "default_video_ratio": project.default_video_ratio,
            "description": project.description,
        }
        lines.append(f"项目：{project.name}")
        lines.append(f"题材/风格：{project.style}；视觉风格：{project.visual_style}")
        if project.default_video_ratio:
            lines.append(f"默认画幅：{project.default_video_ratio}")
        if project.description:
            lines.append(f"项目简介：{project.description}")

    if chapter is not None:
        data["chapter"] = {
            "id": chapter.id,
            "index": chapter.index,
            "title": chapter.title,
            "summary": chapter.summary,
        }
        lines.append(f"章节：第 {chapter.index} 章《{chapter.title}》")
        if chapter.summary:
            lines.append(f"章节摘要：{chapter.summary}")

    if shot_id:
        shot = await db.get(Shot, shot_id)
        if shot is None:
            raise QuickSkillError(f"镜头不存在：{shot_id}")
        detail = await db.get(ShotDetail, shot_id)
        shot_info: dict[str, Any] = {
            "id": shot.id,
            "index": shot.index,
            "title": shot.title,
            "script_excerpt": shot.script_excerpt,
        }
        lines.append(f"镜头：S{int(shot.index):03d}《{shot.title}》")
        if shot.script_excerpt:
            lines.append(f"剧本摘录：{shot.script_excerpt}")

        if detail is not None:
            shot_info.update(
                {
                    "duration": detail.duration,
                    "description": detail.description,
                    "atmosphere": detail.atmosphere,
                    "mood_tags": list(detail.mood_tags or []),
                    "action_beats": list(detail.action_beats or []),
                    "camera_shot": str(detail.camera_shot or ""),
                    "angle": str(detail.angle or ""),
                    "movement": str(detail.movement or ""),
                }
            )
            if detail.duration:
                lines.append(f"计划时长：{detail.duration} 秒")
            if detail.description:
                lines.append(f"画面描述：{detail.description}")
            if detail.atmosphere:
                lines.append(f"氛围：{detail.atmosphere}")
            if detail.mood_tags:
                lines.append("情绪标签：" + "、".join(str(x) for x in detail.mood_tags))
            if detail.action_beats:
                lines.append("动作节拍：" + " → ".join(str(x) for x in detail.action_beats))

        asset_names = await _linked_asset_names(db, shot_id=shot_id)
        if asset_names:
            shot_info["assets"] = asset_names
            for kind, label in (("character", "人物"), ("scene", "场景"), ("prop", "道具"), ("costume", "服装")):
                names = asset_names.get(kind) or []
                if names:
                    lines.append(f"{label}资产：" + "、".join(names))
        data["shot"] = shot_info

    text = "\n".join(lines).strip()
    return text, data


async def _linked_asset_names(db: AsyncSession, *, shot_id: str) -> dict[str, list[str]]:
    """取镜头已绑定的资产名（人物/场景/道具/服装）。只读。"""
    from app.models.studio import (
        Character,
        Costume,
        ProjectCostumeLink,
        ProjectPropLink,
        ProjectSceneLink,
        Prop,
        Scene,
        ShotCharacterLink,
    )

    out: dict[str, list[str]] = {"character": [], "scene": [], "prop": [], "costume": []}

    char_ids = (
        await db.execute(select(ShotCharacterLink.character_id).where(ShotCharacterLink.shot_id == shot_id))
    ).scalars().all()
    if char_ids:
        rows = await db.execute(select(Character.name).where(Character.id.in_(list(char_ids))))
        out["character"] = [str(r[0]) for r in rows.all()]

    for key, link_model, field, asset_model in (
        ("scene", ProjectSceneLink, "scene_id", Scene),
        ("prop", ProjectPropLink, "prop_id", Prop),
        ("costume", ProjectCostumeLink, "costume_id", Costume),
    ):
        ids = (
            await db.execute(select(getattr(link_model, field)).where(link_model.shot_id == shot_id))
        ).scalars().all()
        ids = [x for x in dict.fromkeys(ids) if x]
        if ids:
            rows = await db.execute(select(asset_model.name).where(asset_model.id.in_(ids)))
            out[key] = [str(r[0]) for r in rows.all()]

    return out


# ---------------------------------------------------------------------------
# 生成
# ---------------------------------------------------------------------------


def _normalize_rule_context(extra_context: str) -> str:
    text = str(extra_context or "").strip()
    if len(text) > MAX_CONTEXT_CHARS:
        text = text[:MAX_CONTEXT_CHARS] + "\n（上下文过长，已截断）"
    return text


def _message_text(message: Any) -> str:
    """把 langchain 返回的消息压成纯文本（不同模型 content 形态不一）。"""
    content = getattr(message, "content", message)
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        chunks: list[str] = []
        for block in content:
            if isinstance(block, str):
                chunks.append(block)
            elif isinstance(block, dict):
                text = block.get("text") or block.get("content")
                if isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunks).strip()
    return str(content or "").strip()


async def generate_prompt(
    db: AsyncSession,
    *,
    skill_id: str,
    request: str,
    extra_context: str = "",
    project_id: str | None = None,
    chapter_id: str | None = None,
    shot_id: str | None = None,
    save_to_shot: bool = False,
    overwrite: bool = False,
) -> QuickSkillResult:
    """按导演 Skill 生成一条成品提示词。

    ``save_to_shot=True`` 时把结果写进 ``shot_details.video_prompt``（source=skill）；
    若该镜头已有非空提示词且 ``overwrite=False``，**不覆盖**，改为返回警告。
    """
    try:
        spec = registry.get_prompt_skill(skill_id)
    except KeyError as exc:
        raise QuickSkillError(str(exc)) from exc

    req = str(request or "").strip()
    if not req:
        raise QuickSkillError("请先写清楚要生成什么（request 不能为空）")
    if len(req) > MAX_REQUEST_CHARS:
        raise QuickSkillError(f"需求过长（{len(req)} 字），请压到 {MAX_REQUEST_CHARS} 字以内")

    warnings: list[str] = []
    auto_context, context_data = await build_shot_context(db, chapter_id=chapter_id, shot_id=shot_id)
    if project_id and (context_data.get("project") or {}).get("id") not in (None, project_id):
        warnings.append(
            f"传入的 project_id={project_id} 与镜头所属项目不一致，已以镜头实际归属为准。"
        )

    context_parts = [p for p in (auto_context, _normalize_rule_context(extra_context)) if p]
    context = "\n\n".join(context_parts)

    try:
        task_prompt = registry.build_skill_task_prompt(skill_id, req, context)
    except FileNotFoundError as exc:
        raise QuickSkillError(f"Skill 规则文件缺失，无法生成：{exc}") from exc
    except ValueError as exc:
        raise QuickSkillError(str(exc)) from exc

    try:
        llm = await build_default_text_llm(db, thinking=False)
    except HTTPException as exc:
        raise QuickSkillError(f"文字模型不可用：{exc.detail}") from exc

    try:
        message = await llm.ainvoke(task_prompt)
    except Exception as exc:  # noqa: BLE001 - 上游错误要原样带给用户
        raise QuickSkillError(f"调用文字模型失败：{type(exc).__name__}: {exc}") from exc

    prompt = _message_text(message)
    if not prompt:
        raise QuickSkillError("文字模型返回了空内容，请重试或更换文字模型")

    result = QuickSkillResult(
        skill_id=spec.skill_id,
        skill_name=spec.display_name,
        stage=spec.stage,
        prompt=prompt,
        request=req,
        context=context,
        model_used=_llm_label(llm),
        warnings=warnings,
    )

    if save_to_shot and shot_id:
        saved, note = await save_prompt_to_shot(db, shot_id=shot_id, prompt=prompt, overwrite=overwrite)
        result.saved = saved
        result.saved_shot_id = shot_id if saved else None
        if note:
            result.warnings.append(note)

    return result


def _llm_label(llm: Any) -> str:
    """取"用的是哪个模型"用于回显（不同版本字段名不同，取到就返回）。"""
    for attr in ("model_name", "model"):
        value = getattr(llm, attr, None)
        if isinstance(value, str) and value:
            return value
    return ""


async def save_prompt_to_shot(
    db: AsyncSession,
    *,
    shot_id: str,
    prompt: str,
    overwrite: bool = False,
) -> tuple[bool, str]:
    """把提示词写进镜头（``shot_details.video_prompt`` + source=skill）。

    返回 ``(是否写入, 说明)``。已有非空提示词且未要求覆盖时**不写**，
    转成一条可读说明——沉默覆盖会毁掉你手工整理过的提示词。
    """
    detail = await db.get(ShotDetail, shot_id)
    if detail is None:
        return False, f"镜头 {shot_id} 没有 shot_details 行，无法写入提示词"

    existing = str(detail.video_prompt or "").strip()
    if existing and not overwrite:
        source = str(detail.video_prompt_source or "").strip() or "未知"
        return False, f"该镜头已有提示词（来源：{source}），未覆盖；需要替换请勾选「覆盖已有提示词」。"

    detail.video_prompt = prompt
    detail.video_prompt_source = SKILL_PROMPT_SOURCE
    await db.flush()
    return True, ""


__all__ = [
    "SKILL_PROMPT_SOURCE",
    "MAX_REQUEST_CHARS",
    "QuickSkillError",
    "QuickSkillResult",
    "list_skills",
    "build_shot_context",
    "generate_prompt",
    "save_prompt_to_shot",
]
