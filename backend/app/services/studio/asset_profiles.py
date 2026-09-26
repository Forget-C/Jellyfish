"""四类资产（角色 / 场景 / 道具 / 服装）的**结构化资料**规格与确定性处理。

为什么要有这个模块
==================

「资产准备」这一步的真实缺陷不是页面少画了一个面板，而是**数据链路断了**：
从剧本分析到出图提示词，资产只剩下一句话（甚至一句话都没有），
于是图片提示词生成只能把「外观信息不足，需人工补充」写进
``canonical_subject``，并**要求模型逐字使用**这段空话。

本模块提供这条链路上唯一的一份"结构化资料"定义，四类资产各一套字段：

==================  ==========================================================
角色                identity / relations / gender_age / era / appearance /
                    hairstyle / costume_accessories / personality /
                    related_plot / shot_refs
场景                era_location / indoor_outdoor / time_weather /
                    spatial_structure / furnishings / light_tone /
                    atmosphere / related_events
道具                material / color / shape / size / state / usage /
                    owner / plot_role
服装                wearer / identity_era / style / color / material /
                    accessories / occasion
==================  ==========================================================

三件事都收敛在这里，避免"每个调用点各写一套"：

1. :func:`normalize_profile` —— 把任意来源（大模型 JSON / 人工表单 / 库里的旧 description）
   规整成固定字段集（未知键丢弃、值转成去空白文本）；
2. :func:`render_profile_text` —— 把结构化资料渲染成**确定性**的画像文本
   （决定性地拼字段标签 + 值，不让模型自由发挥），它可以同时充当
   ``<entities>.description``（落库）与图片提示词的画像卡主体描述；
3. :func:`find_vague_markers` —— 空话检测（「外观信息不足」「需人工补充」之流），
   保存前的质量拦截与结构完整性判定共用同一份词表。

**不改数据库结构**：结构化资料落进既有列 —— 候选表 ``shot_extracted_candidates.payload``
（JSON，已存在）与资产表 ``description``（Text，已存在）。本模块只做纯函数，
不碰 session、不发请求。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

#: 参与「资产准备」的四类资产（与 candidate_type / project_*_links 同名）。
ASSET_TYPES: tuple[str, ...] = ("character", "scene", "prop", "costume", "product")

TYPE_LABELS: dict[str, str] = {
    "character": "角色",
    "scene": "场景",
    "prop": "道具",
    "costume": "服装",
    "product": "商品",
}


@dataclass(frozen=True, slots=True)
class ProfileFieldSpec:
    """结构化资料里的一个字段。

    ``visual=True`` 表示这是"能直接落到画面上的硬特征"（外貌、材质、款式……）。
    出图质量拦截只认这些字段：一段提示词里若一个硬特征都没有，
    它就只是"资产名 + 通用摄影词"，不算"提示词已就绪"。
    """

    key: str
    label: str
    visual: bool = True
    required: bool = True


PROFILE_FIELD_SPECS: dict[str, tuple[ProfileFieldSpec, ...]] = {
    "character": (
        ProfileFieldSpec("identity", "身份"),
        ProfileFieldSpec("relations", "关系"),
        ProfileFieldSpec("gender_age", "性别年龄"),
        ProfileFieldSpec("era", "时代"),
        ProfileFieldSpec("appearance", "外貌"),
        ProfileFieldSpec("hairstyle", "发型"),
        ProfileFieldSpec("costume_accessories", "服装配饰"),
        ProfileFieldSpec("personality", "性格气质"),
        # 「相关剧情」「出场镜头」不是画面硬特征，但必须保留，否则无从追溯
        ProfileFieldSpec("related_plot", "相关剧情", visual=False),
        ProfileFieldSpec("shot_refs", "出场镜头", visual=False),
    ),
    "scene": (
        ProfileFieldSpec("era_location", "时代地点"),
        ProfileFieldSpec("indoor_outdoor", "室内外"),
        ProfileFieldSpec("time_weather", "时间天气"),
        ProfileFieldSpec("spatial_structure", "空间结构"),
        ProfileFieldSpec("furnishings", "陈设"),
        ProfileFieldSpec("light_tone", "光线色调"),
        ProfileFieldSpec("atmosphere", "氛围"),
        ProfileFieldSpec("related_events", "相关事件", visual=False),
    ),
    "prop": (
        ProfileFieldSpec("material", "材质"),
        ProfileFieldSpec("color", "颜色"),
        ProfileFieldSpec("shape", "形状"),
        ProfileFieldSpec("size", "尺寸"),
        ProfileFieldSpec("state", "状态"),
        ProfileFieldSpec("usage", "用途"),
        ProfileFieldSpec("owner", "所属人物或场景"),
        ProfileFieldSpec("plot_role", "剧情作用", visual=False),
    ),
    "costume": (
        ProfileFieldSpec("wearer", "穿着人物"),
        ProfileFieldSpec("identity_era", "身份时代"),
        ProfileFieldSpec("style", "款式"),
        ProfileFieldSpec("color", "颜色"),
        ProfileFieldSpec("material", "材质"),
        ProfileFieldSpec("accessories", "配饰"),
        ProfileFieldSpec("occasion", "使用场合"),
    ),
    "product": (
        # 商品资料**分两档**（用户 2026-09-26 口径）：必填只有外观描述，
        # 其余全部 optional。原因是 `profile_missing_fields()` 会把每个空字段都算进
        # 「待补资料」，字段一多，只填了商品名 + 一句描述的 brief 就会被整批判成"资料不全"。
        # 名称不是资料字段（它是 products.name 列），所以这里唯一必填的是外观描述。
        ProfileFieldSpec("appearance", "外观描述"),
        ProfileFieldSpec("material", "材质", required=False),
        ProfileFieldSpec("color", "颜色", required=False),
        ProfileFieldSpec("package", "包装", required=False),
        ProfileFieldSpec("logo", "Logo与品牌标识", required=False),
        # 规格与卖点是文字信息，不直接落到画面上（与「相关剧情」同理）
        ProfileFieldSpec("spec", "规格", visual=False, required=False),
        ProfileFieldSpec("selling_points", "关联卖点", visual=False, required=False),
    ),
}

#: 空话标记：出现这些词说明这段文本**没有提供任何可出图的信息**。
#: 「外观信息不足」「需人工补充」是最典型的两个（也是线上真实出现的那两个）。
VAGUE_MARKERS: tuple[str, ...] = (
    "外观信息不足",
    "信息不足",
    "需人工补充",
    "待人工补充",
    "待补充",
    "待人工确认",
    "信息不详",
    "不详",
    "未知",
    "不明确",
    "未提及",
    "无法判断",
    "无法确认",
    "不确定",
    "说不清",
    "待定",
    "暂无描述",
    "无描述",
    "待模型生成",
    "占位",
    "tbd",
    "n/a",
    "todo",
)

#: 渲染画像文本时跳过的字段（它们是"追溯依据"而不是"画面特征"）
EVIDENCE_FIELD_KEYS: frozenset[str] = frozenset({"shot_refs", "related_plot", "plot_role", "related_events"})


def type_label(asset_type: str) -> str:
    """资产类型的中文标签（不认识的类型原样返回）。"""
    return TYPE_LABELS.get(str(asset_type or "").strip().lower(), str(asset_type or ""))


def field_specs(asset_type: str) -> tuple[ProfileFieldSpec, ...]:
    """该资产类型的字段规格；不认识的类型返回空元组（调用方自行报错）。"""
    return PROFILE_FIELD_SPECS.get(str(asset_type or "").strip().lower(), ())


def field_keys(asset_type: str) -> tuple[str, ...]:
    return tuple(spec.key for spec in field_specs(asset_type))


def visual_field_keys(asset_type: str) -> tuple[str, ...]:
    """该类型的"画面硬特征"字段（出图质量拦截只认它们）。"""
    return tuple(spec.key for spec in field_specs(asset_type) if spec.visual)


def field_label(asset_type: str, key: str) -> str:
    for spec in field_specs(asset_type):
        if spec.key == key:
            return spec.label
    return key


def find_vague_markers(text: Any) -> list[str]:
    """返回命中的空话标记（去重、保持词表顺序）；没有命中返回空列表。"""
    haystack = str(text or "").strip().lower()
    if not haystack:
        return []
    hits: list[str] = []
    for marker in VAGUE_MARKERS:
        if marker.lower() in haystack and marker not in hits:
            hits.append(marker)
    return hits


def is_vague_text(text: Any) -> bool:
    """这段文本是不是"空话"（含 0 个可出图信息）。"""
    value = str(text or "").strip()
    return (not value) or bool(find_vague_markers(value))


def empty_profile(asset_type: str) -> dict[str, str]:
    """该类型的空结构化资料（字段齐全、值全为空串）。"""
    return {key: "" for key in field_keys(asset_type)}


def normalize_profile(asset_type: str, raw: Any) -> dict[str, str]:
    """把任意来源的资料规整成固定字段集（未知键丢弃，值去空白）。

    ``raw`` 可以是 ``{key: value}``，也可以是库里的旧 ``description`` 文本
    （此时整段文本放进第一个字段，保证信息不丢）。
    """
    profile = empty_profile(asset_type)
    keys = field_keys(asset_type)
    if not keys:
        return profile

    if isinstance(raw, dict):
        for key, value in raw.items():
            name = str(key or "").strip()
            if name not in profile:
                continue
            text = "" if value is None else str(value).strip()
            profile[name] = text
        return profile

    text = "" if raw is None else str(raw).strip()
    if text:
        profile[keys[0]] = text
    return profile


def profile_missing_fields(asset_type: str, profile: dict[str, str], *, visual_only: bool = False) -> list[str]:
    """缺字段的**中文标签**列表（用于页面提示"还差什么"）。"""
    missing: list[str] = []
    for spec in field_specs(asset_type):
        if visual_only and not spec.visual:
            continue
        if str(profile.get(spec.key) or "").strip():
            continue
        missing.append(spec.label)
    return missing


def profile_completeness(asset_type: str, profile: dict[str, str]) -> float:
    """画面硬特征的填充比例（0.0~1.0）；无字段定义时返回 0.0。"""
    keys = visual_field_keys(asset_type)
    if not keys:
        return 0.0
    filled = sum(1 for key in keys if str(profile.get(key) or "").strip())
    return round(filled / len(keys), 4)


def render_profile_text(
    asset_type: str,
    profile: dict[str, str],
    *,
    include_evidence_fields: bool = False,
) -> str:
    """把结构化资料渲染成确定性画像文本（``字段标签：值``，用「；」连接）。

    - 只输出非空字段，顺序由 :data:`PROFILE_FIELD_SPECS` 决定（跨调用稳定，
      同一资产在任何槽位都得到**逐字相同**的文本，这正是画像卡一致性要求的）；
    - 默认跳过"追溯依据"字段（出场镜头 / 相关剧情），避免把 `###` 之类的
      分镜 id 写进给图片模型的提示词；需要写进 ``description`` 时用
      ``include_evidence_fields=True``。
    """
    parts: list[str] = []
    for spec in field_specs(asset_type):
        if not include_evidence_fields and spec.key in EVIDENCE_FIELD_KEYS:
            continue
        value = str(profile.get(spec.key) or "").strip()
        if not value:
            continue
        parts.append(f"{spec.label}：{value}")
    return "；".join(parts)


def merged_profile_text(
    asset_type: str,
    *existing_texts: Any,
) -> str:
    """把若干段已有文本（库里的 description / 人工提示词）拼成一段画像文本。

    用于"结构化资料 + 库里旧描述"合并：去重、去空、保序，**不做改写**。
    """
    parts: list[str] = []
    seen: set[str] = set()
    for text in existing_texts:
        value = str(text or "").strip()
        if not value:
            continue
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        parts.append(value)
    return "；".join(parts)


def profile_has_visual_content(asset_type: str, profile: dict[str, str]) -> bool:
    """结构化资料里是否至少有一条**画面硬特征**（且不是空话）。"""
    for key in visual_field_keys(asset_type):
        value = str(profile.get(key) or "").strip()
        if value and not is_vague_text(value):
            return True
    return False


def normalize_asset_type(raw: Any, *, aliases: dict[str, str] | None = None) -> str | None:
    """把模型/调用方给的类型归一化到四类之一；不在范围内返回 ``None``。"""
    text = str(getattr(raw, "value", raw) or "").strip().lower()
    if not text:
        return None
    if text in ASSET_TYPES:
        return text
    table = aliases or DEFAULT_TYPE_ALIASES
    return table.get(text)


#: 常见的中英文类型别名（大模型经常返回这些写法）
DEFAULT_TYPE_ALIASES: dict[str, str] = {
    "characters": "character",
    "char": "character",
    "role": "character",
    "person": "character",
    "人物": "character",
    "角色": "character",
    "演员": "character",
    "scenes": "scene",
    "location": "scene",
    "locations": "scene",
    "place": "scene",
    "environment": "scene",
    "场景": "scene",
    "地点": "scene",
    "环境": "scene",
    "props": "prop",
    "item": "prop",
    "items": "prop",
    "object": "prop",
    "道具": "prop",
    "物件": "prop",
    "costumes": "costume",
    "wardrobe": "costume",
    "outfit": "costume",
    "服装": "costume",
    "服饰": "costume",
    "戏服": "costume",
    "products": "product",
    "product": "product",
    "goods": "product",
    "merchandise": "product",
    "商品": "product",
    "产品": "product",
    "货品": "product",
}


def required_field_schema_for_prompt(asset_type: str) -> str:
    """给大模型看的字段说明（提示词模板里逐字段列出，避免模型自创字段名）。"""
    lines: list[str] = []
    for spec in field_specs(asset_type):
        marker = "必填" if spec.required else "可选"
        lines.append(f'    "{spec.key}": "<{spec.label}（{marker}）：原文明确写出的具体内容>"')
    return ",\n".join(lines)


def all_asset_type_schemas_for_prompt() -> str:
    """四类资产的字段说明拼成一段（供结构化资料提取模板使用）。"""
    blocks: list[str] = []
    for asset_type in ASSET_TYPES:
        blocks.append(
            f'  "{asset_type}"（{type_label(asset_type)}）的 fields：\n'
            "  {\n" + required_field_schema_for_prompt(asset_type) + "\n  }"
        )
    return "\n".join(blocks)


__all__ = [
    "ASSET_TYPES",
    "DEFAULT_TYPE_ALIASES",
    "EVIDENCE_FIELD_KEYS",
    "PROFILE_FIELD_SPECS",
    "TYPE_LABELS",
    "VAGUE_MARKERS",
    "ProfileFieldSpec",
    "all_asset_type_schemas_for_prompt",
    "empty_profile",
    "field_keys",
    "field_label",
    "field_specs",
    "find_vague_markers",
    "is_vague_text",
    "merged_profile_text",
    "normalize_asset_type",
    "normalize_profile",
    "profile_completeness",
    "profile_has_visual_content",
    "profile_missing_fields",
    "render_profile_text",
    "required_field_schema_for_prompt",
    "type_label",
    "visual_field_keys",
]
