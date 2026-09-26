"""「广告剧情流程」的编排步骤：**一次调用**产出整份剧情方案草稿。

为什么是"一次调用"
==================

剧情方案的四块内容（人物、场景、镜头、卖点）**互相牵制**：镜头里出现的角色必须来自人物表、
卖点必须落在具体镜头的冲突里。拆成多次调用最容易出的问题是"人物表与镜头里的角色对不上"，
而校验只能事后打补丁。所以首发一次调用出全部，**返工按段重生成**（改某一镜/某个角色只重调一段）。

截断是主要失败形态（``DEFAULT_MAX_TOKENS`` 默认 4096，长 JSON 很容易被截断；
编排层没有模型重试、没有主备模型），因此：
- 提示词里明确要求"只输出 JSON、不要 Markdown"（``JSON_ONLY_SYSTEM_PROMPT``）；
- 解析走 ``json_utils`` 的三级抢救（直解析 → 去尾随逗号 → 括号配平）；
- 抢救失败一律 422 ``llm_json_parse_failed`` 且**不落库、不写半成品**。

本模块**不写库**（与编排层其他服务同一口径）：它只返回归一化后的草稿与运行元信息，
落草稿/落正式产物分别由 ``drama_plan_drafts`` 与 ``drama_plan_materialize`` 负责。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import CameraAngle, CameraMovement, CameraShotType, Chapter, Project
from app.schemas.studio.drama_plan import (
    DEFAULT_SHOT_COUNT,
    DramaPlanDialogueDraft,
    DramaPlanDraft,
    DramaPlanNamedAssetDraft,
    DramaPlanProductDraft,
    DramaPlanShotDraft,
)
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration.client import (
    LLMRequestError,
    TextLLMCaller,
    call_text_llm,
    resolve_text_llm_target,
)
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    coerce_int,
    coerce_str,
    coerce_str_list,
    normalize_name,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.prompt_templates import DRAMA_PLAN_TEMPLATE
from app.services.studio.llm_orchestration.support import (
    build_run_meta,
    raise_llm_failure,
    raise_parse_failure,
    shortcut_context,
)

#: 镜头编号上限（防模型返回几十条空壳镜头把章节撑爆）
MAX_SHOTS = 24
#: 单次生成允许的镜头数上限（与前端表单一致）
MAX_SHOT_COUNT = 16
#: 章节原文送进提示词的上限（与编排层其他服务同量级）
MAX_SOURCE_CHARS = 12000

#: 景别 / 机位 / 运镜的别名表：模型可能给中文、英文 code 或大小写混写。
#: 落库必须存 **code**（``shot_details.camera_shot`` 等列存的是 code），
#: 非法值落默认并记 warning（用户口径：不许静默通过）。
SHOT_TYPE_ALIASES: dict[str, str] = {
    "ecu": CameraShotType.ecu.value, "大特写": CameraShotType.ecu.value,
    "cu": CameraShotType.cu.value, "特写": CameraShotType.cu.value,
    "mcu": CameraShotType.mcu.value, "中近景": CameraShotType.mcu.value,
    "ms": CameraShotType.ms.value, "中景": CameraShotType.ms.value,
    "mls": CameraShotType.mls.value, "中远景": CameraShotType.mls.value,
    "ls": CameraShotType.ls.value, "远景": CameraShotType.ls.value, "全景": CameraShotType.ls.value,
    "els": CameraShotType.els.value, "大远景": CameraShotType.els.value,
}
ANGLE_ALIASES: dict[str, str] = {
    "eye_level": CameraAngle.eye_level.value, "平视": CameraAngle.eye_level.value,
    "high_angle": CameraAngle.high_angle.value, "高角度": CameraAngle.high_angle.value,
    "俯拍": CameraAngle.high_angle.value,
    "low_angle": CameraAngle.low_angle.value, "低角度": CameraAngle.low_angle.value,
    "仰拍": CameraAngle.low_angle.value,
    "bird_eye": CameraAngle.bird_eye.value, "鸟瞰": CameraAngle.bird_eye.value,
    "dutch": CameraAngle.dutch.value, "荷兰式": CameraAngle.dutch.value, "斜侧": CameraAngle.dutch.value,
    "over_shoulder": CameraAngle.over_shoulder.value, "过肩": CameraAngle.over_shoulder.value,
}
MOVEMENT_ALIASES: dict[str, str] = {
    "static": CameraMovement.static.value, "静止": CameraMovement.static.value, "固定": CameraMovement.static.value,
    "pan": CameraMovement.pan.value, "平移": CameraMovement.pan.value, "摇镜": CameraMovement.pan.value,
    "tilt": CameraMovement.tilt.value, "倾斜": CameraMovement.tilt.value,
    "dolly_in": CameraMovement.dolly_in.value, "推近": CameraMovement.dolly_in.value, "拉近": CameraMovement.dolly_in.value,
    "dolly_out": CameraMovement.dolly_out.value, "拉远": CameraMovement.dolly_out.value,
    "track": CameraMovement.track.value, "轨道": CameraMovement.track.value, "跟拍": CameraMovement.track.value,
    "crane": CameraMovement.crane.value, "摇臂": CameraMovement.crane.value,
    "handheld": CameraMovement.handheld.value, "手持": CameraMovement.handheld.value,
    "steadicam": CameraMovement.steadicam.value, "稳定器": CameraMovement.steadicam.value,
    "zoom_in": CameraMovement.zoom_in.value, "变焦推近": CameraMovement.zoom_in.value,
    "zoom_out": CameraMovement.zoom_out.value, "变焦拉远": CameraMovement.zoom_out.value,
    # 英文短语（模型常写这种）：参与_fuzzy 包含匹配
    "push in": CameraMovement.dolly_in.value, "push": CameraMovement.dolly_in.value,
    "pull out": CameraMovement.dolly_out.value, "pull": CameraMovement.dolly_out.value,
    "dolly": CameraMovement.dolly_in.value, "zoom": CameraMovement.zoom_in.value,
    "panning": CameraMovement.pan.value, "tilting": CameraMovement.tilt.value,
    "tracking": CameraMovement.track.value, "follow": CameraMovement.track.value,
}

#: 参与「包含匹配」的别名键（长度 ≥3，避免 "in"/"up" 这类短词误命中）
MOVEMENT_FUZZY_KEYS: tuple[str, ...] = tuple(
    key for key in MOVEMENT_ALIASES if len(key) >= 3
)

#: 允许的台词模式（与 ``models.types.DialogueLineMode`` 同值）
DIALOGUE_MODES: tuple[str, ...] = ("DIALOGUE", "VOICE_OVER", "OFF_SCREEN", "PHONE")

DEFAULT_SHOT_TYPE = CameraShotType.ms.value
DEFAULT_ANGLE = CameraAngle.eye_level.value
DEFAULT_MOVEMENT = CameraMovement.static.value

#: 允许的时长档位（与 ``registry.ALLOWED_DURATION_SECONDS`` 同值，这里显式列出便于提示词渲染）
ALLOWED_DURATIONS: tuple[int, ...] = (4, 5, 8, 10, 12, 15)


def _coerce_bool(value: Any) -> bool:
    """把模型给的"真假"归一成 bool（``"false"`` 直接 ``bool()`` 会是 True，必须显式判）。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "是", "有", "出现"}


def _alias(value: Any, aliases: dict[str, str], default: str, *, label: str, warnings: list[str]) -> str:
    """把景别/机位/运镜归一到 code；空值也落默认，但**空值不记 warning**（模型没写很正常）。"""
    text = str(value or "").strip()
    if not text:
        return default
    hit = aliases.get(text.lower())
    if hit:
        return hit
    warnings.append(f"{label}「{text}」不在允许取值内，已落默认 {default}。")
    return default


def _resolve_movement(value: Any, *, warnings: list[str]) -> str:
    """运镜归一：精确别名 → **包含匹配** → 默认值（英文 code）。

    为什么要包含匹配：模型常写 ``slow push in`` / ``缓缓推近`` 这类复合写法，
    精确表查不到就会落默认 STATIC —— 那等于**把推近镜头悄悄变成固定镜头**。

    为什么不用 ``registry.normalize_camera_movement``：那张表的 ``key`` 是**中文词**
    （例如 ``移``），而 ``shot_details.movement`` 存的是 **code**（``STATIC``/``PAN``/…），
    直接拿它的 key 落库会写脏数据。所以这里按 code 自己判。
    只对长度 ≥3 的别名做包含匹配，避免单字中文误命中。
    """
    text = str(value or "").strip()
    if not text:
        return DEFAULT_MOVEMENT
    lower = text.lower()
    hit = MOVEMENT_ALIASES.get(lower)
    if hit:
        return hit
    for key in sorted(MOVEMENT_FUZZY_KEYS, key=len, reverse=True):
        if key in lower:
            return MOVEMENT_ALIASES[key]
    warnings.append(f"运镜「{text}」不在允许取值内，已落默认 {DEFAULT_MOVEMENT}。")
    return DEFAULT_MOVEMENT


def _snap_duration(value: Any) -> int:
    """把时长归一到允许档位（取最近的合法值）。"""
    parsed = coerce_int(value, default=0) or 0
    if parsed in ALLOWED_DURATIONS:
        return parsed
    if parsed <= 0:
        return 8
    return min(ALLOWED_DURATIONS, key=lambda item: abs(item - parsed))


def render_brief_text(brief: dict[str, Any]) -> str:
    """把 DramaBrief 渲染成提示词里的行文本（键固定，模型不需要猜）。"""
    lines: list[str] = []
    mapping: tuple[tuple[str, str], ...] = (
        ("product_name", "商品名称"),
        ("product_description", "商品外观描述"),
        ("target_audience", "目标人群"),
        ("genre", "题材"),
        ("tone", "调性"),
        ("brand_voice", "品牌调性/规则"),
        ("director_notes", "导演备注"),
    )
    for key, label in mapping:
        value = coerce_str(brief.get(key))
        if value:
            lines.append(f"- {label}：{value}")
    for key, label in (("selling_points", "卖点"), ("mandatory_elements", "必须出现"), ("forbidden_elements", "禁止出现")):
        items = coerce_str_list(brief.get(key))
        if items:
            lines.append(f"- {label}：" + "；".join(items))
    return "\n".join(lines) if lines else "- （用户未填写更多信息）"


def build_drama_plan_prompt(
    *,
    brief: dict[str, Any],
    chapter_title: str,
    chapter_text: str,
    shot_count: int,
    duration_hint: int,
    style_hint: str,
) -> str:
    """组装剧情策划提示词（``string.Template`` + ``$name`` 占位，禁用 ``str.format``）。"""
    return DRAMA_PLAN_TEMPLATE.safe_substitute(
        brief_text=render_brief_text(brief),
        chapter_title=chapter_title or "（未命名）",
        chapter_text=(chapter_text or "（本章还没有原文，请完全依据商品信息创作）")[:MAX_SOURCE_CHARS],
        shot_count=shot_count,
        duration_hint=duration_hint or shot_count * 8,
        allowed_durations="/".join(str(item) for item in ALLOWED_DURATIONS),
        style_hint=style_hint or "（沿用项目风格）",
    )


def postprocess_plan(
    raw: dict[str, Any],
    *,
    shot_count: int,
) -> tuple[DramaPlanDraft, list[str]]:
    """把模型返回的 JSON 归一到 ``DramaPlanDraft``（确定性后校验，越界即修正并记 warning）。"""
    warnings: list[str] = []

    characters: list[DramaPlanNamedAssetDraft] = []
    seen_characters: set[str] = set()
    for item in raw.get("characters") or []:
        if not isinstance(item, dict):
            continue
        name = coerce_str(item.get("name"))
        key = normalize_name(name)
        if not name or not key or key in seen_characters:
            continue
        seen_characters.add(key)
        characters.append(
            DramaPlanNamedAssetDraft(
                name=name,
                profile={str(k): coerce_str(v) for k, v in (item.get("profile") or {}).items()},
                shot_indexes=[value for value in (coerce_int(x, default=0) or 0 for x in item.get("shot_indexes") or []) if value],
            )
        )

    scenes: list[DramaPlanNamedAssetDraft] = []
    seen_scenes: set[str] = set()
    for item in raw.get("scenes") or []:
        if not isinstance(item, dict):
            continue
        name = coerce_str(item.get("name"))
        key = normalize_name(name)
        if not name or not key or key in seen_scenes:
            continue
        seen_scenes.add(key)
        scenes.append(
            DramaPlanNamedAssetDraft(
                name=name,
                profile={str(k): coerce_str(v) for k, v in (item.get("profile") or {}).items()},
                shot_indexes=[value for value in (coerce_int(x, default=0) or 0 for x in item.get("shot_indexes") or []) if value],
            )
        )

    product_raw = raw.get("product")
    product: DramaPlanProductDraft | None = None
    if isinstance(product_raw, dict):
        product_name = coerce_str(product_raw.get("name"))
        if product_name:
            product = DramaPlanProductDraft(
                name=product_name,
                description=coerce_str(product_raw.get("description")),
                profile={str(k): coerce_str(v) for k, v in (product_raw.get("profile") or {}).items()},
                shot_indexes=[value for value in (coerce_int(x, default=0) or 0 for x in product_raw.get("shot_indexes") or []) if value],
            )
        else:
            warnings.append("模型返回的 product 没有名称，已忽略该字段。")

    shot_types: dict[str, int] = {}
    shots: list[DramaPlanShotDraft] = []
    raw_shots = [item for item in (raw.get("shots") or []) if isinstance(item, dict)][:MAX_SHOTS]
    for position, item in enumerate(raw_shots, start=1):
        title = coerce_str(item.get("title"))
        action_beats = coerce_str_list(item.get("action_beats"))
        dialogue: list[DramaPlanDialogueDraft] = []
        for line in item.get("dialogue") or []:
            if not isinstance(line, dict):
                continue
            text = coerce_str(line.get("text"))
            if not text:
                continue
            mode = coerce_str(line.get("mode")).upper() or "DIALOGUE"
            if mode not in DIALOGUE_MODES:
                warnings.append(f"镜头 {position} 的台词模式「{mode}」非法，已落 DIALOGUE。")
                mode = "DIALOGUE"
            dialogue.append(
                DramaPlanDialogueDraft(speaker=coerce_str(line.get("speaker")), text=text, mode=mode)
            )
        if not title and not action_beats and not dialogue:
            # 空壳镜头：既没有标题也没有动作/台词，落库只会得到一条无意义的分镜
            warnings.append(f"第 {position} 条镜头是空壳（无标题/动作/台词），已丢弃。")
            continue
        camera_shot = _alias(
            item.get("camera_shot"), SHOT_TYPE_ALIASES, DEFAULT_SHOT_TYPE,
            label="景别", warnings=warnings,
        )
        shot_types[camera_shot] = shot_types.get(camera_shot, 0) + 1
        shots.append(
            DramaPlanShotDraft(
                index=position,
                title=title or f"镜头 {position}",
                characters=coerce_str_list(item.get("characters")),
                script_excerpt=coerce_str(item.get("script_excerpt")),
                description=coerce_str(item.get("description")),
                duration=_snap_duration(item.get("duration")),
                camera_shot=camera_shot,
                angle=_alias(item.get("angle"), ANGLE_ALIASES, DEFAULT_ANGLE, label="机位", warnings=warnings),
                movement=_resolve_movement(item.get("movement"), warnings=warnings),
                action_beats=action_beats,
                dialogue=dialogue,
                product_present=_coerce_bool(item.get("product_present")),
            )
        )

    if not shots:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="模型返回里没有任何可用镜头，本次生成视为失败（不落草稿）。",
        )

    # 重新编号为连续的 1..N：模型给的序号可能重复或跳号，丢了空壳镜头后更会留空洞；
    # 而正式表 `shots` 上有 uq_shots_chapter_index 唯一约束，草稿阶段先归一，
    # 免得确认落库时因为重号而炸在一个用户看不懂的地方。
    renumbered = False
    for position, shot in enumerate(shots, start=1):
        if shot.index != position:
            shot.index = position
            renumbered = True
    if renumbered:
        warnings.append(f"镜头序号已重排为 1..{len(shots)}（模型给的序号有重复或跳号）。")

    # 悬空引用一律修掉并如实告警（确认落库时还会再校验一次，见 drama_plan_materialize）：
    # 1) 镜头的「出场角色」必须是人物表里的人 —— 决定建哪些镜头↔角色关联，悬空会让关联指向不存在的人；
    # 2) 台词说话人同理；说不清就把说话人清空（保留台词文本）。
    known_names = {normalize_name(item.name): item.name for item in characters}
    unknown_characters = 0
    for shot in shots:
        kept: list[str] = []
        for name in shot.characters:
            canonical = known_names.get(normalize_name(name))
            if canonical is None:
                unknown_characters += 1
                continue
            if canonical not in kept:
                kept.append(canonical)
        shot.characters = kept
    if unknown_characters:
        warnings.append(f"{unknown_characters} 处「出场角色」不在人物表里，已剔除。")

    dangling = 0
    for shot in shots:
        for line in shot.dialogue:
            if line.speaker and normalize_name(line.speaker) not in known_names:
                dangling += 1
                line.speaker = ""
    if dangling:
        warnings.append(f"{dangling} 句台词的说话人不在人物表里，已清空说话人并保留台词。")

    # 商品：模型说某镜有商品但没有商品信息 → 落 False（不信模型自述）
    if product is None:
        forced = sum(1 for shot in shots if shot.product_present)
        if forced:
            warnings.append(f"模型标了 {forced} 个镜头「出现商品」，但没有给商品信息，已全部置为 False。")
        for shot in shots:
            shot.product_present = False
    else:
        present = sum(1 for shot in shots if shot.product_present)
        need = (len(shots) + 1) // 2
        if present < need:
            warnings.append(
                f"商品只出现在 {present}/{len(shots)} 个镜头，少于「至少一半」（{need}）的要求；"
                "确认时会再校验一次。"
            )

    if len(shots) != shot_count:
        warnings.append(f"要求 {shot_count} 个镜头，模型返回可用 {len(shots)} 个（已修正编号）。")
    if shot_types.get(DEFAULT_SHOT_TYPE, 0) == len(shots) and len(shots) > 1:
        warnings.append("所有镜头景别都相同，注意画面单调。")

    plan = DramaPlanDraft(
        title=coerce_str(raw.get("title")),
        logline=coerce_str(raw.get("logline")),
        selling_points=coerce_str_list(raw.get("sellingPoints") or raw.get("selling_points")),
        characters=characters,
        scenes=scenes,
        product=product,
        shots=shots,
        climax=coerce_str(raw.get("climax")),
        warnings=warnings,
    )
    return plan, warnings


async def preview_drama_plan(
    db: AsyncSession,
    *,
    chapter_id: str,
    brief: dict[str, Any],
    llm_caller: TextLLMCaller | None = None,
) -> dict[str, Any]:
    """生成剧情方案草稿（返回 dict：``plan`` / ``warnings`` / ``meta`` / ``note``）。

    **不写库**：调用方（``drama_plan_drafts``）负责在成功后落草稿列。
    """
    chapter = await db.get(Chapter, chapter_id)
    if chapter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"章节不存在：{chapter_id}")
    project = await db.get(Project, chapter.project_id)

    shot_count = coerce_int(brief.get("shot_count"), default=DEFAULT_SHOT_COUNT) or DEFAULT_SHOT_COUNT
    shot_count = max(1, min(MAX_SHOT_COUNT, shot_count))
    duration_hint = coerce_int(brief.get("duration_seconds"), default=0) or 0
    style_hint = " / ".join(
        item for item in (coerce_str(brief.get("genre")) or (project.style if project else ""), coerce_str(brief.get("tone"))) if item
    )
    prompt = build_drama_plan_prompt(
        brief=brief,
        chapter_title=chapter.title,
        chapter_text=chapter.raw_text or chapter.condensed_text,
        shot_count=shot_count,
        duration_hint=duration_hint,
        style_hint=style_hint,
    )

    if llm_caller is None:
        try:
            target = await resolve_text_llm_target(db)
        except HTTPException:
            if not dry_run.dry_run_enabled():
                raise
            target = None
    else:
        target = None

    if llm_caller is None and dry_run.dry_run_enabled():
        # 演练：不调用任何模型，也不给出假草稿（假 JSON 会被上层写进草稿列，那是污染）
        return {
            "plan": None,
            "warnings": [shortcut_context(skill="剧情策划")],
            "meta": build_run_meta(
                target=target, llm_called=False, raw_output_chars=0, dry_run_reason=dry_run.short_status()
            ),
            "note": "演练模式：未调用模型，未生成草稿。",
        }

    if llm_caller is None:
        try:
            completion = await call_text_llm(prompt, target=target)
        except LLMRequestError as exc:
            raise_llm_failure(exc)
            raise  # pragma: no cover - raise_llm_failure 一定抛异常
        raw_text, latency_ms = completion.text, completion.latency_ms
    else:
        # 测试注入的 caller：不走网络、不解析模型配置（与编排层其他服务的 llm_caller 同口径）
        try:
            raw_text = await llm_caller(prompt)
        except LLMRequestError as exc:
            raise_llm_failure(exc)
            raise  # pragma: no cover
        latency_ms = None

    try:
        parsed, repairs = parse_json_object_with_repairs(raw_text)
    except JSONParseError as exc:
        # 解析失败**不落库、不写半成品**：直接 422 结构化明细
        raise_parse_failure(exc, raw_text=raw_text)
        raise  # pragma: no cover

    plan, warnings = postprocess_plan(parsed, shot_count=shot_count)
    if repairs:
        warnings.insert(0, f"模型输出经 JSON 抢救后解析成功：{'、'.join(repairs)}。")
    return {
        "plan": plan.model_dump(),
        "warnings": warnings,
        "meta": build_run_meta(
            target=target,
            llm_called=True,
            latency_ms=latency_ms,
            raw_output_chars=len(raw_text),
            json_repairs=repairs,
        ),
        "note": "仅为草稿：确认之前不落任何正式行（章节/分镜/资产都还没有变化）。",
    }


__all__ = [
    "ALLOWED_DURATIONS",
    "MAX_SHOT_COUNT",
    "build_drama_plan_prompt",
    "postprocess_plan",
    "preview_drama_plan",
    "render_brief_text",
]
