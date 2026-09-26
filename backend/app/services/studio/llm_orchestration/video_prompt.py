"""4.3 视频提示词生成编排服务。

统一内部模式：组装上下文 → 构建提示词 → 调 LLM（经守卫）→ 解析 JSON + 确定性后校验 → 返回预览。

要点：
- 输出结构对齐 ``shot_video_prompt_pack.py``：能解析到 shot_id 时复用
  ``build_shot_video_prompt_pack`` 的上下文包并原样返回 ``pack``；
- 运镜词只允许标准词库（推/拉/摇/移/跟/环绕 + 固定/上下摇），模型自造的运镜词会被
  归一化或退回兜底值并记 warning；
- 支持单帧与首尾帧两种模式；
- 确定性后校验会清掉 final_prompt 里的本地路径/URL/"参考图1" 这类非法引用。
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.studio.llm_orchestration import (
    CameraMovementResolvedRead,
    EntityProfileCardRead,
    EntityProfileInput,
    FrameModeLiteral,
    VideoPromptPreviewRead,
    VideoPromptPreviewRequest,
)
from app.schemas.studio.shots import ShotPromptCameraInfo, ShotVideoPromptPackRead
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.client import (
    LLMRequestError,
    TextLLMCaller,
    TextLLMTarget,
    call_text_llm,
    resolve_text_llm_target,
)
from app.services.studio.llm_orchestration.context import (
    build_profile_cards,
    load_project_entity_profiles,
    load_shot_context,
    render_profile_cards,
    render_project_context,
    resolve_project_id,
)
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    coerce_int,
    coerce_str,
    coerce_str_list,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.prompt_templates import VIDEO_PROMPT_TEMPLATE
from app.services.studio.llm_orchestration.registry import (
    ALLOWED_DURATION_SECONDS,
    CAMERA_MOVEMENT_SPECS,
    DEFAULT_NEGATIVE_PROMPT,
    DEFAULT_STYLE_WORDS,
    VIDEO_PROMPT_LAYER_LABELS,
    VIDEO_PROMPT_LAYER_ORDER,
    CameraMovementSpec,
    camera_movement_options,
    normalize_camera_movement,
)
from app.services.studio.llm_orchestration.support import (
    build_run_meta,
    dry_run_warning,
    raise_llm_failure,
    raise_parse_failure,
)

PLACEHOLDER_PREFIX = "[DRY_RUN 占位]"
DEFAULT_DURATION_SECONDS = 5
MAX_SHOT_TEXT_CHARS = 4000

# 不得出现在 final_prompt 里的引用：本地路径 / URL / 本地文件名 / "参考图1" 这种指代。
_FORBIDDEN_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"https?://\S+", "URL"),
    (r"asset://\S+", "asset:// 引用"),
    (r"outputs/\S*", "本地 outputs 路径"),
    (r"/Users/\S+", "本地绝对路径"),
    (r"data/(?:images|db\.json)\S*", "本地数据路径"),
    (r"\S+\.(?:png|jpe?g|webp|bmp|gif|mp4|mov|avi)\b", "本地文件名"),
    (r"参考图\s*\d*", "参考图指代"),
    (r"主体\s*\d+", "主体编号指代"),
    (r"@图片\s*\d*", "@图片指代"),
)

# 景别白名单（沿用 app 内既有的中文短标签习惯）。
CAMERA_SHOT_WHITELIST: tuple[str, ...] = (
    "远景",
    "极远景",
    "大全景",
    "全景",
    "中景",
    "中近景",
    "近景",
    "特写",
    "大特写",
    "过肩",
    "过肩镜头",
    "反应",
    "空镜",
    "动作镜头",
)

_ANGLE_WHITELIST: tuple[str, ...] = ("平视", "仰拍", "俯拍", "低角度", "高角度", "斜侧", "侧面")


# ---------------------------------------------------------------------------
# 确定性归一层
# ---------------------------------------------------------------------------


def snap_duration(seconds: Any) -> int:
    """把时长归一到允许档位（取最近的合法值）。"""
    parsed = coerce_int(seconds, default=DEFAULT_DURATION_SECONDS)
    assert parsed is not None
    if parsed in ALLOWED_DURATION_SECONDS:
        return parsed
    if parsed <= 0:
        return DEFAULT_DURATION_SECONDS
    return min(ALLOWED_DURATION_SECONDS, key=lambda item: abs(item - parsed))


def resolve_camera_movement(
    *,
    model_value: Any,
    request_value: Any,
    pack_value: Any,
    warnings: list[str],
) -> tuple[CameraMovementResolvedRead, str]:
    """运镜词归一层：模型值 → 请求值 → 上下文包值 → 固定镜头。

    返回 ``(归一化结果, 是否使用了模型自造词)``。
    模型自造运镜词一律不让它进最终结果。
    """
    fallback_spec: CameraMovementSpec | None = None
    for candidate in (request_value, pack_value):
        if not candidate:
            continue
        spec = normalize_camera_movement(candidate)
        if spec is not None:
            fallback_spec = spec
            break

    raw_model = str(model_value or "").strip()
    model_spec = normalize_camera_movement(raw_model)
    if model_spec is not None:
        return _resolved_read(model_spec, source="vocab"), ""

    if raw_model:
        if fallback_spec is not None:
            warnings.append(
                f"模型给出的运镜词「{raw_model}」不在标准词库内，已退回指定/上下文运镜"
                f"「{fallback_spec.zh}」。"
            )
            return _resolved_read(fallback_spec, source="vocab"), raw_model
        default_spec = normalize_camera_movement("固定")
        assert default_spec is not None
        warnings.append(f"模型给出的运镜词「{raw_model}」不在标准词库内，已退回「固定镜头」。")
        return _resolved_read(default_spec, source="fallback"), raw_model

    if fallback_spec is not None:
        return _resolved_read(fallback_spec, source="vocab"), ""
    default_spec = normalize_camera_movement("固定")
    assert default_spec is not None
    warnings.append("未指定运镜且模型未给出运镜，已按「固定镜头」兜底。")
    return _resolved_read(default_spec, source="fallback"), ""


def _resolved_read(spec: CameraMovementSpec, *, source: str) -> CameraMovementResolvedRead:
    return CameraMovementResolvedRead(
        key=spec.key,
        label=spec.zh,
        en=spec.en,
        enum_code=spec.enum_code,
        db_note=spec.db_note,
        source=source,  # type: ignore[arg-type]
    )


def normalize_camera_shot(value: Any, warnings: list[str]) -> str:
    text = coerce_str(value)
    if not text:
        return ""
    if text in CAMERA_SHOT_WHITELIST:
        return text
    for allowed in CAMERA_SHOT_WHITELIST:
        if allowed in text:
            return allowed
    warnings.append(f"景别「{text}」不在惯用标签内，已原样保留，建议人工确认。")
    return text


def normalize_angle(value: Any, warnings: list[str]) -> str:
    text = coerce_str(value)
    if not text:
        return ""
    if text in _ANGLE_WHITELIST:
        return text
    for allowed in _ANGLE_WHITELIST:
        if allowed in text:
            return allowed
    warnings.append(f"机位角度「{text}」不在惯用标签内，已原样保留，建议人工确认。")
    return text


def strip_forbidden_refs(text: str) -> tuple[str, list[str]]:
    """清掉不该出现在提示词里的路径/URL/指代，返回 (清洗后文本, 命中说明)。"""
    removed: list[str] = []
    cleaned = str(text or "")
    for pattern, label in _FORBIDDEN_PATTERNS:
        matches = re.findall(pattern, cleaned)
        if matches:
            removed.append(f"{label}（{len(matches)} 处）")
            cleaned = re.sub(pattern, "", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ，,；;、")
    return cleaned, removed


def assemble_video_prompt(
    *,
    subject_action: str,
    camera: CameraMovementResolvedRead,
    expression_mood: str,
    atmosphere: str,
    duration_seconds: int,
    style: str = "",
) -> str:
    """按固定层序确定性拼装视频提示词。"""
    parts = [
        coerce_str(subject_action),
        f"运镜：{camera.label}" if camera.label else "",
        coerce_str(expression_mood),
        f"氛围：{coerce_str(atmosphere)}" if coerce_str(atmosphere) else "",
        coerce_str(style),
        f"时长约 {duration_seconds} 秒",
    ]
    body = "；".join(part for part in parts if part)
    return f"{body}。" if body else ""


def build_layer_reference() -> str:
    return "、".join(f"{name}={VIDEO_PROMPT_LAYER_LABELS[name]}" for name in VIDEO_PROMPT_LAYER_ORDER)


def build_camera_options_text() -> str:
    return "\n".join(
        f"- {item['key']}：{item['label']}（{item['en']}）" for item in camera_movement_options()
    )


# ---------------------------------------------------------------------------
# 后校验 + 组装
# ---------------------------------------------------------------------------


def postprocess_video_plan(
    *,
    parsed: dict[str, Any],
    request_value: Any,
    pack: ShotVideoPromptPackRead | None,
    frame_mode: FrameModeLiteral,
    duration_hint: int,
    global_negative: str,
    shot_text: str,
    warnings: list[str],
) -> dict[str, Any]:
    """把模型输出规整成对齐 pack 的结构。"""
    pack_camera = pack.camera if pack is not None else ShotPromptCameraInfo()
    camera_movement, invented = resolve_camera_movement(
        model_value=parsed.get("camera_movement") or parsed.get("movement"),
        request_value=request_value,
        pack_value=pack_camera.movement,
        warnings=warnings,
    )

    camera_shot = normalize_camera_shot(parsed.get("camera_shot") or parsed.get("shot_type"), warnings)
    if not camera_shot:
        camera_shot = coerce_str(pack_camera.camera_shot)
    angle = normalize_angle(parsed.get("angle"), warnings) or coerce_str(pack_camera.angle)

    duration_raw = coerce_int(parsed.get("duration_seconds") or parsed.get("recommended_duration"), default=None)
    duration = snap_duration(duration_raw if duration_raw is not None else duration_hint)
    if duration_raw is not None and duration_raw != duration:
        warnings.append(
            f"模型给出的时长 {duration_raw}s 不在允许档位（{'/'.join(str(x) for x in ALLOWED_DURATION_SECONDS)}），"
            f"已归一为 {duration}s。"
        )

    action_beats = coerce_str_list(parsed.get("action_beats"))
    if not action_beats:
        action_beats = list(pack.action_beats) if pack is not None and pack.action_beats else []
        if action_beats:
            warnings.append("模型未返回 action_beats，已用镜头上下文包的动作要点补齐。")

    subject_action = coerce_str(parsed.get("subject_action") or parsed.get("action"))
    expression_mood = coerce_str(parsed.get("expression_mood") or parsed.get("emotion"))
    atmosphere = coerce_str(parsed.get("atmosphere")) or (coerce_str(pack.atmosphere) if pack is not None else "")
    first_frame_handling = coerce_str(parsed.get("first_frame_handling"))
    last_frame_handling = coerce_str(parsed.get("last_frame_handling"))

    final_prompt = coerce_str(parsed.get("final_prompt"))
    if not final_prompt:
        final_prompt = assemble_video_prompt(
            subject_action=subject_action or shot_text,
            camera=camera_movement,
            expression_mood=expression_mood,
            atmosphere=atmosphere,
            duration_seconds=duration,
        )
        warnings.append("模型未返回 final_prompt，已由确定性拼装补齐。")

    final_prompt = coerce_str(final_prompt)
    clean_prompt, removed = strip_forbidden_refs(final_prompt)
    if removed:
        warnings.append(f"final_prompt 含不允许的引用，已清除：{'、'.join(removed)}。")
        final_prompt = clean_prompt

    negative_prompt = coerce_str(parsed.get("negative_prompt"))
    negative_parts = [global_negative, negative_prompt, DEFAULT_NEGATIVE_PROMPT]
    negative_prompt = ", ".join(_dedupe([part for part in negative_parts if part]))

    if frame_mode == "first_last_frame" and not last_frame_handling:
        warnings.append("首尾帧模式下模型未给出 last_frame_handling，尾帧收束方式需人工确认。")
    if frame_mode == "single_frame":
        last_frame_handling = ""

    style = coerce_str(pack.style) if pack is not None else ""
    visual_style = coerce_str(pack.visual_style) if pack is not None else ""

    return {
        "camera_movement": camera_movement,
        "invented_movement": invented,
        "camera": ShotPromptCameraInfo(
            camera_shot=camera_shot,
            angle=angle,
            movement=camera_movement.label or camera_movement.key,
            duration=duration,
        ),
        "duration_seconds": duration,
        "action_beats": action_beats,
        "subject_action": subject_action,
        "expression_mood": expression_mood,
        "atmosphere": atmosphere,
        "first_frame_handling": first_frame_handling,
        "last_frame_handling": last_frame_handling,
        "final_prompt": final_prompt,
        "negative_prompt": negative_prompt,
        "style": style,
        "visual_style": visual_style or DEFAULT_STYLE_WORDS,
    }


def _dedupe(phrases: list[str]) -> list[str]:
    """按逗号/顿号拆分后逐条去重，避免全局负面词与默认规则重复。"""
    seen: set[str] = set()
    result: list[str] = []
    for phrase in phrases:
        for token in re.split(r"[,，、;；]+", str(phrase or "")):
            text = token.strip().strip("。 ")
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(text)
    return result


# ---------------------------------------------------------------------------
# DRY_RUN 占位
# ---------------------------------------------------------------------------


def build_dry_run_plan(
    *,
    shot_text: str,
    request_value: Any,
    pack: ShotVideoPromptPackRead | None,
    frame_mode: FrameModeLiteral,
    duration_hint: int,
    global_negative: str,
) -> tuple[dict[str, Any], list[str]]:
    """DRY_RUN 占位：结构完整、内容明确标注未生成。"""
    warnings = [dry_run_warning(skill="视频提示词生成")]
    pack_camera = pack.camera if pack is not None else ShotPromptCameraInfo()
    camera_movement, _ = resolve_camera_movement(
        model_value="",
        request_value=request_value,
        pack_value=pack_camera.movement,
        warnings=warnings,
    )
    duration = snap_duration(duration_hint)
    final_prompt, _ = strip_forbidden_refs(
        f"{PLACEHOLDER_PREFIX} 未调用大模型；结构占位：镜头文本「{shot_text[:80]}」"
        f"；运镜：{camera_movement.label}；时长约 {duration} 秒。"
    )
    action_beats = list(pack.action_beats) if pack is not None and pack.action_beats else []
    return (
        {
            "camera_movement": camera_movement,
            "invented_movement": "",
            "camera": ShotPromptCameraInfo(
                camera_shot=coerce_str(pack_camera.camera_shot),
                angle=coerce_str(pack_camera.angle),
                movement=camera_movement.label or camera_movement.key,
                duration=duration,
            ),
            "duration_seconds": duration,
            "action_beats": action_beats,
            "subject_action": f"{PLACEHOLDER_PREFIX} 主体动作待模型生成",
            "expression_mood": f"{PLACEHOLDER_PREFIX} 表情/氛围待模型生成",
            "atmosphere": coerce_str(pack.atmosphere) if pack is not None else "",
            "first_frame_handling": f"{PLACEHOLDER_PREFIX} 首帧衔接待模型生成",
            "last_frame_handling": (
                f"{PLACEHOLDER_PREFIX} 尾帧收束待模型生成" if frame_mode == "first_last_frame" else ""
            ),
            "final_prompt": final_prompt,
            "negative_prompt": ", ".join(_dedupe([global_negative, DEFAULT_NEGATIVE_PROMPT])),
            "style": coerce_str(pack.style) if pack is not None else "",
            "visual_style": (coerce_str(pack.visual_style) if pack is not None else "") or DEFAULT_STYLE_WORDS,
        },
        warnings,
    )


# ---------------------------------------------------------------------------
# 编排入口
# ---------------------------------------------------------------------------


async def preview_video_prompt(
    db: AsyncSession,
    *,
    body: VideoPromptPreviewRequest,
    llm_caller: TextLLMCaller | None = None,
) -> VideoPromptPreviewRead:
    """视频提示词预览。"""
    warnings: list[str] = []
    shot_context = None
    shot_text = str(body.shot_text or "").strip()
    shot_id = body.shot_id
    pack: ShotVideoPromptPackRead | None = None

    if shot_id:
        try:
            from app.services.studio.shot_video_prompt_pack import build_shot_video_prompt_pack

            pack = await build_shot_video_prompt_pack(db, shot_id=shot_id)
        except HTTPException as exc:
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                raise
            warnings.append(f"未能装载镜头上下文包（{exc.detail}），本次仅按传入文本生成。")
            pack = None
        except Exception as exc:  # noqa: BLE001 - 上下文包只用于增强，装载失败不该阻断预览
            warnings.append(f"未能装载镜头上下文包（{exc}），本次仅按传入文本生成。")
            pack = None

    if not shot_text:
        if shot_id:
            if pack is not None:
                shot_text = (pack.script_excerpt or pack.title or "").strip()
            if not shot_text:
                shot_context = await load_shot_context(db, shot_id)
                shot_text = shot_context.script_excerpt or shot_context.title
        if not shot_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="shot_id 与 shot_text 至少需要提供一个，且镜头文本不能为空。",
            )

    shot_text = shot_text[:MAX_SHOT_TEXT_CHARS]

    if pack is None and shot_id and shot_context is None:
        try:
            shot_context = await load_shot_context(db, shot_id)
        except HTTPException:
            # 仅用于补充项目上下文，失败不阻断预览。
            shot_context = None

    project_id = await resolve_project_id(
        db,
        shot_id=shot_id,
        chapter_id=shot_context.chapter_id if shot_context else None,
        project_id=body.project_id or (shot_context.project_id if shot_context else None),
    )

    profiles: list[EntityProfileInput] = list(body.entity_profiles)
    cards: list[EntityProfileCardRead] = []
    if profiles:
        cards = build_profile_cards(profiles, source="request")
    elif project_id:
        cards = build_profile_cards(
            await load_project_entity_profiles(db, project_id=project_id),
            source="project",
        )

    frame_mode: FrameModeLiteral = body.frame_mode or (
        "first_last_frame" if body.last_frame_image_ref else "single_frame"
    )
    if frame_mode == "first_last_frame" and not body.last_frame_image_ref:
        warnings.append("帧模式为 first_last_frame 但没有提供尾帧图引用，尾帧收束需人工确认。")

    duration_hint = snap_duration(
        body.duration_seconds
        if body.duration_seconds is not None
        else (pack.camera.duration if pack is not None else None)
    )

    project_context = render_project_context(
        project_name=shot_context.project_name if shot_context else "",
        style=shot_context.style if shot_context else "",
        visual_style=shot_context.visual_style if shot_context else "",
    )

    target, target_warning = await _try_resolve_target(db, needed=llm_caller is None)
    if target_warning:
        warnings.append(target_warning)

    if llm_caller is not None:
        plan, plan_warnings, raw_chars = await _run_with_caller(
            llm_caller=llm_caller,
            shot_text=shot_text,
            cards=cards,
            project_context=project_context,
            body=body,
            pack=pack,
            frame_mode=frame_mode,
            duration_hint=duration_hint,
        )
        warnings.extend(plan_warnings)
        return _build_read(
            shot_id=shot_id,
            shot_text=shot_text,
            plan=plan,
            pack=pack,
            frame_mode=frame_mode,
            warnings=warnings,
            target=target,
            llm_called=True,
            raw_output_chars=raw_chars,
            first_frame_ref=body.first_frame_image_ref,
            last_frame_ref=body.last_frame_image_ref,
        )

    if dry_run.dry_run_enabled():
        plan, plan_warnings = build_dry_run_plan(
            shot_text=shot_text,
            request_value=body.camera_movement,
            pack=pack,
            frame_mode=frame_mode,
            duration_hint=duration_hint,
            global_negative=body.negative_prompt,
        )
        warnings.extend(plan_warnings)
        return _build_read(
            shot_id=shot_id,
            shot_text=shot_text,
            plan=plan,
            pack=pack,
            frame_mode=frame_mode,
            warnings=warnings,
            target=target,
            llm_called=False,
            raw_output_chars=0,
            first_frame_ref=body.first_frame_image_ref,
            last_frame_ref=body.last_frame_image_ref,
        )

    if target is None:  # pragma: no cover
        target, _ = await _try_resolve_target(db, needed=True)

    prompt = _build_prompt(
        shot_text=shot_text,
        cards=cards,
        project_context=project_context,
        body=body,
        pack=pack,
        frame_mode=frame_mode,
        duration_hint=duration_hint,
    )
    try:
        completion = await call_text_llm(prompt, target=target)
    except LLMRequestError as exc:
        raise_llm_failure(exc)
        raise  # pragma: no cover

    plan, plan_warnings = _parse_plan(
        raw_text=completion.text,
        request_value=body.camera_movement,
        pack=pack,
        frame_mode=frame_mode,
        duration_hint=duration_hint,
        global_negative=body.negative_prompt,
        shot_text=shot_text,
    )
    warnings.extend(plan_warnings)
    return _build_read(
        shot_id=shot_id,
        shot_text=shot_text,
        plan=plan,
        pack=pack,
        frame_mode=frame_mode,
        warnings=warnings,
        target=target,
        llm_called=True,
        raw_output_chars=len(completion.text),
        latency_ms=completion.latency_ms,
        first_frame_ref=body.first_frame_image_ref,
        last_frame_ref=body.last_frame_image_ref,
    )


def _build_read(
    *,
    shot_id: str | None,
    shot_text: str,
    plan: dict[str, Any],
    pack: ShotVideoPromptPackRead | None,
    frame_mode: FrameModeLiteral,
    warnings: list[str],
    target: TextLLMTarget | None,
    llm_called: bool,
    raw_output_chars: int,
    first_frame_ref: str | None,
    last_frame_ref: str | None,
    latency_ms: int | None = None,
) -> VideoPromptPreviewRead:
    return VideoPromptPreviewRead(
        shot_id=shot_id,
        title=coerce_str(pack.title) if pack is not None else "",
        script_excerpt=shot_text,
        action_beats=plan["action_beats"],
        dialogue_summary=coerce_str(pack.dialogue_summary) if pack is not None else "",
        camera=plan["camera"],
        camera_movement=plan["camera_movement"],
        frame_mode=frame_mode,
        duration_seconds=plan["duration_seconds"],
        subject_action=plan["subject_action"],
        expression_mood=plan["expression_mood"],
        atmosphere=plan["atmosphere"],
        first_frame_image_ref=first_frame_ref,
        last_frame_image_ref=last_frame_ref,
        first_frame_handling=plan["first_frame_handling"],
        last_frame_handling=plan["last_frame_handling"],
        final_prompt=plan["final_prompt"],
        negative_prompt=plan["negative_prompt"],
        visual_style=plan["visual_style"],
        style=plan["style"],
        pack=pack,
        warnings=warnings,
        meta=build_run_meta(
            target=target,
            llm_called=llm_called,
            latency_ms=latency_ms,
            raw_output_chars=raw_output_chars,
            dry_run_reason=dry_run.short_status() if not llm_called else None,
        ),
    )


def _build_prompt(
    *,
    shot_text: str,
    cards: list[EntityProfileCardRead],
    project_context: str,
    body: VideoPromptPreviewRequest,
    pack: ShotVideoPromptPackRead | None,
    frame_mode: FrameModeLiteral,
    duration_hint: int,
) -> str:
    extra = str(body.extra_instructions or "").strip()
    context_extra = ""
    if pack is not None:
        beats = "；".join(pack.action_beats) if pack.action_beats else "（无）"
        context_extra = (
            f"\n\n镜头上下文包（供参考，不要照抄结构）：\n"
            f"- 标题：{pack.title}\n"
            f"- 动作要点：{beats}\n"
            f"- 连续性要求：{pack.continuity_guidance or '（无）'}\n"
            f"- 构图锚点：{pack.composition_anchor or '（无）'}\n"
            f"- 朝向与视线：{pack.screen_direction_guidance or '（无）'}\n"
            f"- 对白摘要：{pack.dialogue_summary or '（无）'}"
        )
    prompt = VIDEO_PROMPT_TEMPLATE.safe_substitute(
        shot_text=shot_text + context_extra,
        camera_options=build_camera_options_text(),
        allowed_durations="/".join(str(x) for x in ALLOWED_DURATION_SECONDS),
        duration_hint=f"{duration_hint}s",
        frame_mode=frame_mode,
        entity_profiles=render_profile_cards(cards),
        first_frame_ref=str(body.first_frame_image_ref or "").strip() or "（未提供）",
        last_frame_ref=str(body.last_frame_image_ref or "").strip() or "（未提供）",
        project_context=project_context,
        style_hint=str(body.style_hint or "").strip() or "（未指定，按项目风格）",
        negative_prompt=str(body.negative_prompt or "").strip() or DEFAULT_NEGATIVE_PROMPT,
    )
    return prompt + (f"\n\n附加要求：{extra}" if extra else "")


def _parse_plan(
    *,
    raw_text: str,
    request_value: Any,
    pack: ShotVideoPromptPackRead | None,
    frame_mode: FrameModeLiteral,
    duration_hint: int,
    global_negative: str,
    shot_text: str,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    try:
        parsed, repairs = parse_json_object_with_repairs(raw_text)
        if not any(
            key in parsed for key in ("final_prompt", "subject_action", "action", "subject")
        ):
            raise JSONParseError(
                "模型返回的 JSON 缺少可用字段（final_prompt / subject_action），无法生成视频提示词。",
                raw_text=raw_text,
            )
    except JSONParseError as exc:
        raise_parse_failure(exc, raw_text=raw_text)
        raise  # pragma: no cover
    if repairs:
        warnings.insert(0, f"模型输出经 JSON 抢救后解析成功：{'、'.join(repairs)}。")
    plan = postprocess_video_plan(
        parsed=parsed,
        request_value=request_value,
        pack=pack,
        frame_mode=frame_mode,
        duration_hint=duration_hint,
        global_negative=global_negative,
        shot_text=shot_text,
        warnings=warnings,
    )
    return plan, warnings


async def _try_resolve_target(
    db: AsyncSession,
    *,
    needed: bool,
) -> tuple[TextLLMTarget | None, str | None]:
    try:
        return await resolve_text_llm_target(db), None
    except HTTPException as exc:
        if needed and not dry_run.dry_run_enabled():
            raise
        return None, f"未能解析默认文本模型配置：{exc.detail}"


async def _run_with_caller(
    *,
    llm_caller: TextLLMCaller,
    shot_text: str,
    cards: list[EntityProfileCardRead],
    project_context: str,
    body: VideoPromptPreviewRequest,
    pack: ShotVideoPromptPackRead | None,
    frame_mode: FrameModeLiteral,
    duration_hint: int,
) -> tuple[dict[str, Any], list[str], int]:
    prompt = _build_prompt(
        shot_text=shot_text,
        cards=cards,
        project_context=project_context,
        body=body,
        pack=pack,
        frame_mode=frame_mode,
        duration_hint=duration_hint,
    )
    raw_text = await llm_caller(prompt)
    plan, warnings = _parse_plan(
        raw_text=raw_text,
        request_value=body.camera_movement,
        pack=pack,
        frame_mode=frame_mode,
        duration_hint=duration_hint,
        global_negative=body.negative_prompt,
        shot_text=shot_text,
    )
    return plan, warnings, len(raw_text)


__all__ = [
    "CAMERA_MOVEMENT_SPECS",
    "assemble_video_prompt",
    "build_dry_run_plan",
    "postprocess_video_plan",
    "preview_video_prompt",
    "resolve_camera_movement",
    "snap_duration",
    "strip_forbidden_refs",
]
