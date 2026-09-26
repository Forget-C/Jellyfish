"""4.2 图片提示词生成编排服务。

统一内部模式：组装上下文 → 构建提示词 → 调 LLM（经守卫）→ 解析 JSON + 确定性后校验 → 返回预览。

要点：
- 输出按 Jellyfish 提示词类别**逐槽位**生成（角色正/侧、场景正/侧、服装正/侧、首/尾/关键帧）；
- 分层结构固定为 主体描述 + 动作姿态 + 场景环境 + 镜头语言 + 风格 + 画质词，
  最终 prompt 由**确定性代码**按固定顺序拼接，避免模型自由发挥破坏结构；
- 同一实体的主体描述一律取画像卡的 ``canonical_subject``（画像卡思路），
  模型改写会被覆盖并记 warning，从而保证跨槽位/跨镜头一致。
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.types import PromptCategory
from app.schemas.studio.llm_orchestration import (
    EntityProfileCardRead,
    EntityProfileInput,
    ImagePromptPreviewRead,
    ImagePromptPreviewRequest,
    ImagePromptSlotRead,
)
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
from app.services.studio.llm_orchestration.differentiation import (
    apply_design_anchors,
    render_differentiation_rules,
)
from app.services.studio.llm_orchestration.json_utils import (
    JSONParseError,
    coerce_str,
    normalize_name,
    parse_json_object_with_repairs,
)
from app.services.studio.llm_orchestration.prompt_templates import IMAGE_PROMPT_TEMPLATE
from app.services.studio.llm_orchestration.registry import (
    DEFAULT_IMAGE_PROMPT_CATEGORIES,
    DEFAULT_NEGATIVE_PROMPT,
    DEFAULT_QUALITY_WORDS,
    DEFAULT_STYLE_WORDS,
    IMAGE_PROMPT_LAYER_LABELS,
    IMAGE_PROMPT_LAYER_ORDER,
    IMAGE_PROMPT_SLOT_BY_CATEGORY,
    SLOT_NEGATIVE_EXTRA,
    SLOT_STYLE_RULES,
    ImagePromptSlotSpec,
    base_style_words,
    slot_design_brief,
)
from app.services.studio.llm_orchestration.support import (
    build_run_meta,
    dry_run_warning,
    raise_llm_failure,
    raise_parse_failure,
)

PLACEHOLDER_PREFIX = "[DRY_RUN 占位]"
# 需要镜头上下文的槽位类别（资产级生成时自动排除）
FRAME_SLOT_CATEGORIES: tuple[str, ...] = (
    "frame_head_image",
    "frame_tail_image",
    "frame_key_image",
)
ASSET_ONLY_SHOT_TEXT = "（本次为资产级生成，没有具体镜头文本；只需生成资产参考图提示词。）"
MAX_SHOT_TEXT_CHARS = 4000

#: 某项资产"没有可用于出图的资料"时的中文原因（只落在**这一项**上）。
MISSING_PROFILE_REASON = "在库里没有可用于出图的资料（资产描述、外观资料、本章资料都是空的）"
#: 对应的"怎么补"（用户语言，可照做；不写接口与内部标识）。
MISSING_PROFILE_FIX = (
    "到这一项的编辑页补全外观资料（发型 / 服装 / 体型 / 面部特征 / 材质与颜色），"
    "或先在资产准备页生成并确认「章节资产清单」，补好之后再重新生成提示词"
)


# ---------------------------------------------------------------------------
# 槽位 / 实体选择
# ---------------------------------------------------------------------------


def resolve_requested_categories(raw: list[PromptCategory] | None) -> list[PromptCategory]:
    """归一化请求的槽位类别；为空时使用默认九槽位。"""
    if not raw:
        return list(DEFAULT_IMAGE_PROMPT_CATEGORIES)
    result: list[PromptCategory] = []
    seen: set[str] = set()
    for item in raw:
        value = str(getattr(item, "value", item))
        if value in IMAGE_PROMPT_SLOT_BY_CATEGORY and value not in seen:
            seen.add(value)
            result.append(PromptCategory(value))
    return result


def pick_entity_for_slot(
    spec: ImagePromptSlotSpec,
    *,
    cards: list[EntityProfileCardRead],
    shot_text: str,
) -> EntityProfileCardRead | None:
    """为槽位挑选实体画像卡：优先镜头文本里**最先出现**的实体。"""
    if not spec.entity_type:
        return None
    candidates = [card for card in cards if card.entity_type == spec.entity_type]
    if not candidates:
        return None

    haystack = normalize_name(shot_text)
    if not haystack:
        return candidates[0]

    mentioned: list[tuple[int, EntityProfileCardRead]] = []
    for card in candidates:
        name_key = normalize_name(card.name)
        if name_key and name_key in haystack:
            mentioned.append((haystack.index(name_key), card))
    if mentioned:
        return min(mentioned, key=lambda item: item[0])[1]
    return candidates[0]


def requested_asset_names(body: ImagePromptPreviewRequest) -> list[str]:
    """本次请求**点名**要生成哪些资产（``entity_names`` 优先，其次调用方传入的画像卡名）。

    两个来源都为空时返回空列表，表示"调用方没有点名"——
    这时本次请求涉及的实体只能按请求的槽位逐个挑（见 :func:`resolve_profile_scope`）。
    """
    named = [str(name).strip() for name in (body.entity_names or []) if str(name).strip()]
    if named:
        return named
    return [str(profile.name).strip() for profile in (body.entity_profiles or []) if profile.name]


def resolve_profile_scope(
    *,
    cards: list[EntityProfileCardRead],
    categories: list[PromptCategory],
    shot_text: str,
    explicit_names: list[str],
) -> list[EntityProfileCardRead]:
    """本次请求**真正涉及**的画像卡：资料可用性的预检只认这几张。

    为什么必须收窄（真实事故的根因之一）：资产级自动装载会把**整个项目/本章**的实体
    都装成画像卡（那是给模型当上下文的），此前"谁没有资料"的预检是拿**整份画像卡**做的，
    于是一个**没被勾选**的空壳资产（例如本章只留了资料记录的服装）会把本次要生成的
    每一项一起判成"不可用"，用户勾的 4 项一项都拿不到提示词。

    两种口径：
    - 调用方**点名**了资产（``entity_names`` / 传入的画像卡）：范围就是这些名字，
      因为那是"用户要的东西"；
    - 没点名：范围是**本次请求的槽位实际会用到的那几张卡**
      （:func:`pick_entity_for_slot` 逐槽位挑一遍，顺序去重），
      其余装进来的画像卡只是上下文，不参与"有没有资料"的判定。
    """
    if explicit_names:
        wanted = {normalize_name(name) for name in explicit_names if str(name).strip()}
        scoped = [card for card in cards if normalize_name(card.name) in wanted]
        if scoped:
            return scoped
    picked: list[EntityProfileCardRead] = []
    seen: set[str] = set()
    for category in categories:
        spec = IMAGE_PROMPT_SLOT_BY_CATEGORY[str(category.value)]
        card = pick_entity_for_slot(spec, cards=cards, shot_text=shot_text)
        if card is None:
            continue
        key = normalize_name(card.name) or str(card.name)
        if key in seen:
            continue
        seen.add(key)
        picked.append(card)
    return picked


def build_missing_profile_warning(card: EntityProfileCardRead) -> str:
    """**单项**缺资料的中文说明（为什么不可用 + 怎么补）。

    只写这一项自己的名字：**绝不**把没被本次请求要到的资产列进来 ——
    那段文字会被页面当成"这一行不可保存的原因"，牵进别的资产等于让用户拿不到本来能用的结果。
    """
    return f"「{card.name}」{MISSING_PROFILE_REASON}。怎么补：{MISSING_PROFILE_FIX}。"


def build_all_missing_profile_detail(cards: list[EntityProfileCardRead]) -> dict[str, Any]:
    """本次请求点到的**每一项**都没有资料：结构化拒绝体（原因只说这几项）。

    这是"整体不可用"的唯一拒绝口径：请求里只要还有一项能生成，就照常生成、逐项回报
    （见 :func:`preview_image_prompts` 的逐项隔离）。
    """
    names = "、".join(card.name for card in cards[:8])
    more = "" if len(cards) <= 8 else f" 等 {len(cards)} 项"
    return {
        "code": "asset_profile_missing",
        "message": (
            f"你选的这几项（{names}{more}）{MISSING_PROFILE_REASON}："
            "画像卡只能落到「外观信息不足，需人工补充」这类空话，"
            "生成结果不会通过质量拦截、也不能保存成「提示词已就绪」。"
            "本次没有发起生成，也没有产生费用。"
        ),
        "fix": MISSING_PROFILE_FIX,
        "assets": [card.name for card in cards],
    }


# ---------------------------------------------------------------------------
# 确定性拼装
# ---------------------------------------------------------------------------


def _dedupe_phrases(phrases: list[str]) -> list[str]:
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


def assemble_image_prompt(layers: dict[str, str]) -> str:
    """按固定层序拼接提示词（确定性，保证结构不被模型打乱）。"""
    parts = [str(layers.get(key, "")).strip().strip("，,。;；") for key in IMAGE_PROMPT_LAYER_ORDER]
    return "，".join(part for part in parts if part) + "。"


def build_slot_negative_prompt(*, slot_category: str, global_negative: str) -> str:
    """拼接槽位负面提示词：全局 + 默认规则 + 槽位特有规则。"""
    phrases = [global_negative, DEFAULT_NEGATIVE_PROMPT, *SLOT_NEGATIVE_EXTRA.get(slot_category, ())]
    return ", ".join(_dedupe_phrases(phrases))


def build_slot_layers(
    *,
    spec: ImagePromptSlotSpec,
    raw: dict[str, Any],
    card: EntityProfileCardRead | None,
    warnings: list[str],
) -> dict[str, str]:
    """把模型输出规整成固定的分层结构，并做画像卡一致性覆盖。"""
    layers: dict[str, str] = {
        "subject": coerce_str(raw.get("subject")),
        "action_pose": coerce_str(raw.get("action_pose")),
        "environment": coerce_str(raw.get("environment")),
        "camera_language": coerce_str(raw.get("camera_language")),
        "style": coerce_str(raw.get("style")),
        "quality": coerce_str(raw.get("quality")),
    }

    # 画像卡一致性：有画像卡时主体描述必须与画像卡完全一致。
    if card is not None and card.canonical_subject:
        provided = layers["subject"]
        if provided and normalize_name(provided) != normalize_name(card.canonical_subject):
            warnings.append(
                f"槽位 {spec.category.value} 的主体描述与画像卡不一致，已用画像卡统一"
                f"（保证同一实体跨槽位一致）。"
            )
        layers["subject"] = card.canonical_subject
    elif not layers["subject"]:
        warnings.append(f"槽位 {spec.category.value} 缺少主体描述，已按“信息不足”占位。")
        layers["subject"] = "主体信息不足，需人工补充"

    if not layers["action_pose"]:
        layers["action_pose"] = spec.view_hint
        warnings.append(f"槽位 {spec.category.value} 缺少动作姿态，已用槽位视角说明兜底。")
    if not layers["environment"]:
        layers["environment"] = "按镜头文本描述的环境"
        warnings.append(f"槽位 {spec.category.value} 缺少场景环境，已用默认描述兜底。")
    if not layers["camera_language"]:
        layers["camera_language"] = "中景平视，柔和主光"
        warnings.append(f"槽位 {spec.category.value} 缺少镜头语言，已用默认描述兜底。")
    if not layers["style"]:
        # 没有风格词兜底时按**该槽位对应的资产类型**取基础风格词（服装不是人物口径）
        layers["style"] = base_style_words(spec.entity_type or "")
    if not layers["quality"]:
        layers["quality"] = DEFAULT_QUALITY_WORDS

    extra_rules = SLOT_STYLE_RULES.get(spec.category.value, ())
    if extra_rules:
        style_text = layers["style"].lower()
        missing = [rule for rule in extra_rules if rule.lower() not in style_text]
        if missing:
            layers["style"] = ", ".join([layers["style"], *missing])

    return layers


def build_slot_quality(
    *,
    spec: ImagePromptSlotSpec,
    prompt: str,
    card: EntityProfileCardRead | None,
) -> tuple[bool, list[dict[str, Any]], str]:
    """用后端质量拦截的**同一份判定**标注这个槽位能不能保存。

    返回 ``(savable, issues, structured_source)``。前端拿这几个字段决定
    "保存 / 批量出图"按钮是否可用，以及把不可保存的原因（中文、可照做修）显示出来。
    判定逻辑本体在 :mod:`app.services.studio.asset_prompt_quality`，这里不复制规则。
    """
    from app.services.studio.asset_prompt_quality import check_single_prompt

    issues = check_single_prompt(
        prompt,
        slot=str(spec.category.value),
        asset_name=card.name if card else "",
        asset_type=card.entity_type if card else (spec.entity_type or ""),
    )
    structured_source = ""
    if card is not None:
        structured_source = str(card.profile_source or "") or (
            "asset_description" if card.has_structured_profile else "none"
        )
    return (not issues, [issue.to_read() for issue in issues], structured_source)


def postprocess_slots(
    *,
    parsed: dict[str, Any],
    categories: list[PromptCategory],
    cards: list[EntityProfileCardRead],
    shot_text: str,
    global_negative: str,
) -> tuple[list[ImagePromptSlotRead], list[str]]:
    """后校验：槽位白名单 + 去重 + 画像卡一致性 + 分层补齐 + 质量标注。"""
    warnings: list[str] = []
    raw_slots = parsed.get("slots")
    if not isinstance(raw_slots, list):
        raise JSONParseError("模型返回的 JSON 里找不到 slots 数组。")

    allowed = {str(category.value): category for category in categories}
    by_category: dict[str, dict[str, Any]] = {}
    for index, raw in enumerate(raw_slots, start=1):
        if not isinstance(raw, dict):
            warnings.append(f"第 {index} 个槽位不是对象，已忽略。")
            continue
        category = coerce_str(raw.get("category") or raw.get("slot") or raw.get("type"))
        if category not in allowed:
            warnings.append(f"槽位类别 {category or '空'} 不在本次请求范围内，已丢弃。")
            continue
        if category in by_category:
            warnings.append(f"槽位 {category} 重复返回，已保留第一条，其余合并丢弃。")
            continue
        by_category[category] = raw

    slots: list[ImagePromptSlotRead] = []
    for category in categories:
        spec = IMAGE_PROMPT_SLOT_BY_CATEGORY[str(category.value)]
        raw = by_category.get(str(category.value))
        if raw is None:
            warnings.append(f"槽位 {category.value}（{spec.label}）模型未返回，已跳过。")
            continue
        card = pick_entity_for_slot(spec, cards=cards, shot_text=shot_text)
        layers = build_slot_layers(spec=spec, raw=raw, card=card, warnings=warnings)
        entity_name = coerce_str(raw.get("entity_name")) or (card.name if card else "") or None
        prompt = assemble_image_prompt(layers)
        savable, quality_issues, structured_source = build_slot_quality(
            spec=spec,
            prompt=prompt,
            card=card,
        )
        if not savable:
            warnings.append(
                f"槽位 {category.value}（{spec.label}）未通过质量拦截，"
                f"不能保存成「提示词已就绪」，也不能进入批量出图："
                f"{quality_issues[0]['message'] if quality_issues else '内容不合格'}"
            )
        slots.append(
            ImagePromptSlotRead(
                category=category,
                label=spec.label,
                entity_name=entity_name,
                layers={key: layers[key] for key in IMAGE_PROMPT_LAYER_ORDER},
                prompt=prompt,
                negative_prompt=build_slot_negative_prompt(
                    slot_category=str(category.value),
                    global_negative=global_negative,
                ),
                design_brief=slot_design_brief(str(category.value)),
                savable=savable,
                quality_issues=quality_issues,
                structured_source=structured_source,
            )
        )
    return slots, warnings


def build_prompt_layer_reference() -> str:
    """给提示词的层名说明（保持模板与代码里的层名一致）。"""
    return "、".join(f"{name}={IMAGE_PROMPT_LAYER_LABELS[name]}" for name in IMAGE_PROMPT_LAYER_ORDER)


def build_slot_list_text(categories: list[PromptCategory]) -> str:
    """渲染「需要生成的槽位」段落。

    有**专属设计口径**的槽位（目前是服装的正/侧两个槽位）会把口径一并写进去：
    服装提示词必须落到款式 / 颜色 / 材质 / 配饰 / 穿着人物 / 身份时代 / 使用场合上，
    **不是**人物参考图或场景模板那一套。口径文字只有一个来源
    （``registry.slot_design_brief`` → ``asset_profiles`` 的字段表）。
    """
    lines = []
    for category in categories:
        spec = IMAGE_PROMPT_SLOT_BY_CATEGORY[str(category.value)]
        brief = slot_design_brief(str(category.value))
        line = f"- {category.value}（{spec.label}）：{spec.view_hint}"
        if brief:
            line += f"；{brief}"
        lines.append(line)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DRY_RUN 占位
# ---------------------------------------------------------------------------


def build_dry_run_slots(
    *,
    categories: list[PromptCategory],
    cards: list[EntityProfileCardRead],
    shot_text: str,
    global_negative: str,
) -> tuple[list[ImagePromptSlotRead], list[str]]:
    """DRY_RUN 占位：结构完整、内容明确标注为未生成。"""
    warnings = [dry_run_warning(skill="图片提示词生成")]
    slots: list[ImagePromptSlotRead] = []
    for category in categories:
        spec = IMAGE_PROMPT_SLOT_BY_CATEGORY[str(category.value)]
        card = pick_entity_for_slot(spec, cards=cards, shot_text=shot_text)
        subject = card.canonical_subject if card else f"{PLACEHOLDER_PREFIX} 主体描述待模型依据镜头文本生成"
        layers = {
            "subject": subject,
            "action_pose": f"{PLACEHOLDER_PREFIX} 动作姿态待模型生成",
            "environment": f"{PLACEHOLDER_PREFIX} 场景环境待模型生成",
            "camera_language": f"{PLACEHOLDER_PREFIX} {spec.view_hint}",
            # 基础风格词按槽位对应的资产类型取（服装不是人物短剧画面口径）
            "style": ", ".join(
                [base_style_words(spec.entity_type or ""), *SLOT_STYLE_RULES.get(str(category.value), ())]
            ),
            "quality": DEFAULT_QUALITY_WORDS,
        }
        prompt = assemble_image_prompt(layers)
        savable, quality_issues, structured_source = build_slot_quality(spec=spec, prompt=prompt, card=card)
        slots.append(
            ImagePromptSlotRead(
                category=category,
                label=spec.label,
                entity_name=card.name if card else None,
                layers={key: layers[key] for key in IMAGE_PROMPT_LAYER_ORDER},
                prompt=prompt,
                negative_prompt=build_slot_negative_prompt(
                    slot_category=str(category.value),
                    global_negative=global_negative,
                ),
                design_brief=slot_design_brief(str(category.value)),
                savable=savable,
                quality_issues=quality_issues,
                structured_source=structured_source,
            )
        )
    return slots, warnings


# ---------------------------------------------------------------------------
# 编排入口
# ---------------------------------------------------------------------------


async def preview_image_prompts(
    db: AsyncSession,
    *,
    body: ImagePromptPreviewRequest,
    llm_caller: TextLLMCaller | None = None,
) -> ImagePromptPreviewRead:
    """图片提示词预览。

    两种调用形态：
    - **镜头级**：给 ``shot_id`` 或 ``shot_text``，生成全部九个槽位（含首/尾/关键帧）；
    - **资产级**（资产准备页「生成图片提示词」用）：只给 ``entity_profiles``，
      不传镜头文本，只生成资产槽位（角色正/侧、场景正/侧、服装正/侧）。
      资产级不需要镜头，所以这里不再强制要求 shot_id / shot_text。
    """
    shot_context = None
    shot_text = str(body.shot_text or "").strip()
    shot_id = body.shot_id
    asset_only = False

    if not shot_text:
        if body.shot_id:
            shot_context = await load_shot_context(db, body.shot_id)
            shot_text = shot_context.script_excerpt or shot_context.title
            shot_id = shot_context.shot_id
            if not shot_text.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"镜头 {body.shot_id} 没有剧本摘录，无法生成图片提示词。",
                )
        elif body.entity_profiles or body.project_id:
            # 资产级：没有镜头文本是正常的，用占位文案让模板有东西可渲染。
            # 只给 ``project_id`` 也按资产级处理（画像卡由 ``load_project_entity_profiles``
            # 自动装载）—— 资产准备页正是这个调用形态，此前会被 400 挡掉，
            # 导致"项目内实体自动装载 + 结构化资料富化"这条能力根本没有入口。
            asset_only = True
            shot_text = ""
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="需要提供 shot_id / shot_text（镜头级），或 project_id / entity_profiles（资产级）。",
            )
    elif body.shot_id:
        shot_id = body.shot_id

    shot_text = shot_text[:MAX_SHOT_TEXT_CHARS]

    project_id = await resolve_project_id(
        db,
        shot_id=shot_id,
        chapter_id=shot_context.chapter_id if shot_context else None,
        project_id=body.project_id or (shot_context.project_id if shot_context else None),
    )

    profiles: list[EntityProfileInput] = list(body.entity_profiles)
    profile_source = "request"
    if not profiles and project_id:
        # 资产级自动装载：把 chapter_id 一起带下去，全局资产（场景/道具/服装）才会读到
        # **本章**的 overlay 而不是别的章节的资料（章节隔离，见 asset_overlays）。
        profiles = await load_project_entity_profiles(
            db,
            project_id=project_id,
            chapter_id=body.chapter_id or (shot_context.chapter_id if shot_context else None),
        )
        profile_source = "project"
    # 收窄之前的**全量**画像卡：只用于「同身份多角色」分组，不参与"资料够不够"的判定。
    # （与下面 ``resolve_profile_scope`` 的 ``scope_cards`` 是两回事：那个是"本次要的"，
    #   这个是"同一装载范围里的全部"，差异化分组必须看全量。）
    all_scope_cards = build_profile_cards(profiles, source=profile_source)
    if body.entity_names:
        # 逐资产生成：把画像卡收窄到指定名称（不改自动装载，也不绕过章节资料加载）
        wanted = {normalize_name(name) for name in body.entity_names if str(name).strip()}
        profiles = [profile for profile in profiles if normalize_name(profile.name) in wanted]
        if not profiles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"entity_names 里的名称在本项目/本章的实体画像里都找不到："
                    f"{list(body.entity_names)}。请检查名称写法，或先确认该资产已建/已关联。"
                ),
            )
    cards = build_profile_cards(profiles, source=profile_source)

    # 同身份多角色差异化（需求清单第 4 条）：分组必须看**收窄之前**的全量画像卡 ——
    # 资产准备页一次只点名一个资产，若只看收窄后的那一张，就永远看不到同批的另一个丫鬟，
    # 也就没有任何依据把两人的形象区分开（后果是两条提示词重复、被查重门禁拦在生图之前）。
    cards, differentiation_notes = apply_design_anchors(cards, all_cards=all_scope_cards)

    categories = resolve_requested_categories(body.categories)
    if asset_only and not body.categories:
        # 帧槽位（首/尾/关键帧）需要镜头文本，资产级默认不出
        categories = [c for c in categories if str(c.value) not in FRAME_SLOT_CATEGORIES]
        asset_only_note = (
            "本次为资产级生成（没有镜头文本），已只生成资产槽位（角色/场景/服装正侧视图）；"
            "首帧/尾帧/关键帧提示词请在镜头页生成。"
        )
    else:
        asset_only_note = ""
    if not categories:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="没有可生成的槽位类别，请检查 categories 取值。",
        )

    project_context = render_project_context(
        project_name=shot_context.project_name if shot_context else "",
        style=shot_context.style if shot_context else "",
        visual_style=shot_context.visual_style if shot_context else "",
    )

    warnings: list[str] = []
    if asset_only_note:
        warnings.append(asset_only_note)
    # 同身份多角色被怎么区分开了（用户语言，页面直接展示；不含内部 ID 与接口名）
    warnings.extend(differentiation_notes)
    if not cards:
        warnings.append("本次没有可用的实体画像卡，图片提示词只依据镜头文本生成，实体一致性可能较弱。")
    # 资料可用性预检：**只对本次请求涉及的资产**做（见 resolve_profile_scope）。
    # 没被要求的资产（自动装载进来的上下文）既不参与判定，也不会出现在原因里。
    scope_cards = resolve_profile_scope(
        cards=cards,
        categories=categories,
        shot_text=shot_text,
        explicit_names=requested_asset_names(body),
    )
    missing_cards = [card for card in scope_cards if not card.has_structured_profile]
    # 整体不可用（本次要的每一项都没资料）→ 如实拒绝：**不发起生成、不产生费用**，
    # 原因只说这几项，不把没被要求的资产列进来。
    if scope_cards and len(missing_cards) == len(scope_cards):
        raise HTTPException(
            status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
            detail=build_all_missing_profile_detail(missing_cards),
        )
    # 逐项隔离：只有缺资料的那一项拿到"为什么不可用 + 怎么补"，其它项照常生成。
    for card in missing_cards:
        warnings.append(build_missing_profile_warning(card))

    target, target_warning = await _try_resolve_target(db, needed=llm_caller is None)

    if llm_caller is not None:
        return await _run_with_caller(
            llm_caller=llm_caller,
            shot_id=shot_id,
            project_id=project_id,
            shot_text=shot_text,
            categories=categories,
            cards=cards,
            project_context=project_context,
            body=body,
            target=target,
            warnings=warnings,
            all_cards=all_scope_cards,
        )

    if dry_run.dry_run_enabled():
        slots, dry_warnings = build_dry_run_slots(
            categories=categories,
            cards=cards,
            shot_text=shot_text,
            global_negative=body.negative_prompt,
        )
        warnings.extend(dry_warnings)
        if target_warning:
            warnings.append(target_warning)
        return ImagePromptPreviewRead(
            shot_id=shot_id,
            project_id=project_id,
            shot_text_chars=len(shot_text),
            slots=slots,
            entity_cards=cards,
            warnings=warnings,
            meta=build_run_meta(
                target=target,
                llm_called=False,
                raw_output_chars=0,
                dry_run_reason=dry_run.short_status(),
            ),
        )

    if target is None:  # pragma: no cover
        target, _ = await _try_resolve_target(db, needed=True)

    prompt = _build_prompt(
        categories=categories,
        cards=cards,
        shot_text=shot_text,
        project_context=project_context,
        body=body,
        all_cards=all_scope_cards,
    )
    try:
        completion = await call_text_llm(prompt, target=target)
    except LLMRequestError as exc:
        raise_llm_failure(exc)
        raise  # pragma: no cover

    slots, slot_warnings = _parse_and_build_slots(
        raw_text=completion.text,
        categories=categories,
        cards=cards,
        shot_text=shot_text,
        global_negative=body.negative_prompt,
    )
    warnings.extend(slot_warnings)
    return ImagePromptPreviewRead(
        shot_id=shot_id,
        project_id=project_id,
        shot_text_chars=len(shot_text),
        slots=slots,
        entity_cards=cards,
        warnings=warnings,
        meta=build_run_meta(
            target=target,
            llm_called=True,
            latency_ms=completion.latency_ms,
            raw_output_chars=len(completion.text),
        ),
    )


def _build_prompt(
    *,
    categories: list[PromptCategory],
    cards: list[EntityProfileCardRead],
    shot_text: str,
    project_context: str,
    body: ImagePromptPreviewRequest,
    all_cards: list[EntityProfileCardRead] | None = None,
) -> str:
    extra = str(body.extra_instructions or "").strip()
    return IMAGE_PROMPT_TEMPLATE.safe_substitute(
        slot_list=build_slot_list_text(categories),
        entity_profiles=render_profile_cards(cards),
        # 同身份多角色：把"必须逐个独立设计"的硬规则与具体名单写进提示词
        differentiation_rules=render_differentiation_rules(all_cards or cards),
        shot_text=shot_text or ASSET_ONLY_SHOT_TEXT,
        project_context=project_context,
        style_hint=str(body.style_hint or "").strip() or "（未指定，按项目风格）",
        negative_prompt=str(body.negative_prompt or "").strip() or DEFAULT_NEGATIVE_PROMPT,
    ) + (f"\n\n附加要求：{extra}" if extra else "")


def _parse_and_build_slots(
    *,
    raw_text: str,
    categories: list[PromptCategory],
    cards: list[EntityProfileCardRead],
    shot_text: str,
    global_negative: str,
) -> tuple[list[ImagePromptSlotRead], list[str]]:
    try:
        parsed, repairs = parse_json_object_with_repairs(raw_text)
        slots, warnings = postprocess_slots(
            parsed=parsed,
            categories=categories,
            cards=cards,
            shot_text=shot_text,
            global_negative=global_negative,
        )
    except JSONParseError as exc:
        raise_parse_failure(exc, raw_text=raw_text)
        raise  # pragma: no cover
    if repairs:
        warnings.insert(0, f"模型输出经 JSON 抢救后解析成功：{'、'.join(repairs)}。")
    return slots, warnings


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
    shot_id: str | None,
    project_id: str | None,
    shot_text: str,
    categories: list[PromptCategory],
    cards: list[EntityProfileCardRead],
    project_context: str,
    body: ImagePromptPreviewRequest,
    target: TextLLMTarget | None,
    warnings: list[str],
    all_cards: list[EntityProfileCardRead] | None = None,
) -> ImagePromptPreviewRead:
    prompt = _build_prompt(
        categories=categories,
        cards=cards,
        shot_text=shot_text,
        project_context=project_context,
        body=body,
        all_cards=all_cards,
    )
    raw_text = await llm_caller(prompt)
    slots, slot_warnings = _parse_and_build_slots(
        raw_text=raw_text,
        categories=categories,
        cards=cards,
        shot_text=shot_text,
        global_negative=body.negative_prompt,
    )
    warnings = [*warnings, *slot_warnings]
    return ImagePromptPreviewRead(
        shot_id=shot_id,
        project_id=project_id,
        shot_text_chars=len(shot_text),
        slots=slots,
        entity_cards=cards,
        warnings=warnings,
        meta=build_run_meta(
            target=target,
            llm_called=True,
            raw_output_chars=len(raw_text),
        ),
    )


__all__ = [
    "assemble_image_prompt",
    "build_all_missing_profile_detail",
    "build_dry_run_slots",
    "build_missing_profile_warning",
    "build_slot_layers",
    "pick_entity_for_slot",
    "postprocess_slots",
    "preview_image_prompts",
    "requested_asset_names",
    "resolve_profile_scope",
    "resolve_requested_categories",
]
