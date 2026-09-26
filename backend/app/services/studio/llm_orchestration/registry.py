"""编排层的确定性词表与白名单。

这些常量是"确定性后校验"的依据：模型只能在这个范围内选值，越界即被拦截并记 warning。
刻意不放进提示词模板里，避免"词表被当成提示词的一部分被模型改写"。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.models.types import PromptCategory

# --------------------------------------------------------------------------
# 实体类型白名单（4.1 实体提取）
# --------------------------------------------------------------------------

ENTITY_TYPE_WHITELIST: tuple[str, ...] = ("character", "scene", "prop")

ENTITY_TYPE_ALIASES: dict[str, str] = {
    "character": "character",
    "characters": "character",
    "char": "character",
    "role": "character",
    "actor": "character",
    "person": "character",
    "人物": "character",
    "角色": "character",
    "演员": "character",
    "scene": "scene",
    "scenes": "scene",
    "location": "scene",
    "place": "scene",
    "environment": "scene",
    "场景": "scene",
    "地点": "scene",
    "环境": "scene",
    "prop": "prop",
    "props": "prop",
    "item": "prop",
    "object": "prop",
    "道具": "prop",
    "物件": "prop",
    "costume": "costume",
    "costumes": "costume",
    "wardrobe": "costume",
    "服装": "costume",
    "服饰": "costume",
}

# 实体提取只接受 character/scene/prop；服装在 Jellyfish 里是独立资产，
# 但属于"不自动建资产"的边界外类型，这里显式记录以便给出可解释的 warning。
ENTITY_TYPE_REJECT_HINTS: dict[str, str] = {
    "costume": "服装属于独立资产类型，实体提取阶段不作为草稿类型返回（可后续人工创建）",
}


def normalize_entity_type(raw: object) -> str | None:
    """把模型给的类型归一化；不在白名单内返回 None。"""
    text = str(raw or "").strip().lower()
    if not text:
        return None
    if text in ENTITY_TYPE_ALIASES:
        return ENTITY_TYPE_ALIASES[text]
    return None


# --------------------------------------------------------------------------
# 图片提示词槽位（4.2）
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ImagePromptSlotSpec:
    category: PromptCategory
    label: str
    entity_type: str | None
    view_hint: str
    subject_source: str


IMAGE_PROMPT_SLOT_SPECS: tuple[ImagePromptSlotSpec, ...] = (
    ImagePromptSlotSpec(
        category=PromptCategory.character_image_front,
        label="角色设定图（正面）",
        entity_type="character",
        view_hint=(
            "16:9 横版角色设定图，画面分左右两块："
            "左侧只有一个大幅面部特写（单个人头，从头顶裁到锁骨附近，脸部占左区 75%-85%）；"
            "右侧是同一个人物的全身三视图——正面、侧面、背面，简单中性站姿、脚部完整"
        ),
        subject_source="角色画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.character_image_other,
        label="角色设定图（同套设定的侧背细节）",
        entity_type="character",
        view_hint=(
            "沿用同一张角色设定图的版式（左面部大特写 + 右全身三视图），"
            "重点交代侧面与背面的发型、头饰与衣摆结构，保持同一人同一造型"
        ),
        subject_source="角色画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.scene_image_front,
        label="场景正面图片",
        entity_type="scene",
        view_hint="广角建立镜头，空间结构清晰",
        subject_source="场景画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.scene_image_other,
        label="场景侧面/背面图片",
        entity_type="scene",
        view_hint="同场景另一视角，保持建筑与陈设一致",
        subject_source="场景画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.costume_image_front,
        label="服装正面图片",
        entity_type="costume",
        view_hint="服装正面平铺或立架展示",
        subject_source="服装画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.costume_image_other,
        label="服装侧面/背面图片",
        entity_type="costume",
        view_hint="同套服装侧面/背面细节",
        subject_source="服装画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.frame_head_image,
        label="首帧图片",
        entity_type=None,
        view_hint="按镜头内容定景别，作为视频首帧",
        subject_source="镜头文本",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.frame_tail_image,
        label="尾帧图片",
        entity_type=None,
        view_hint="承接首帧，动作推进后的落点状态",
        subject_source="镜头文本",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.frame_key_image,
        label="关键帧图片",
        entity_type=None,
        view_hint="情绪/动作爆发点的单帧",
        subject_source="镜头文本",
    ),
)

#: **默认九槽位**（镜头级/批量预览用的既有口径，顺序与取值都不动）。
DEFAULT_IMAGE_PROMPT_CATEGORIES: tuple[PromptCategory, ...] = tuple(
    spec.category for spec in IMAGE_PROMPT_SLOT_SPECS
)

#: 道具的**正式图片提示词槽位**。
#:
#: 为什么单独一张表：道具此前在 ``PromptCategory`` 里有 ``prop_image_front`` /
#: ``prop_image_other`` 两个枚举值，也有 ``asset_strategies.STRATEGIES["prop"]`` 指向
#: ``prop_image_front``，但**注册表里没有规格**——后果是两条真实的坏路径：
#:
#: 1. ``/studio/llm/image-prompt/preview`` 的 ``resolve_requested_categories`` 用
#:    ``if value in IMAGE_PROMPT_SLOT_BY_CATEGORY`` 过滤请求槽位，道具槽位**被静默丢掉**
#:    （请求里传了 prop_image_front，返回里一个道具槽位都没有，也没有任何 warning）；
#: 2. 出图链路 ``image_pipeline`` 取不到 ``slot_spec``，只能退到
#:    ``AssetImageStrategy.default_view_hint`` 的硬编码兜底文案。
#:
#: 补上规格后：道具走与人物/场景/服装**同一套**槽位、同一套风格/负面词规则、
#: 同一套保存与生成链路，不再是「不支持（无槽位）」。
#:
#: 单独放一张表而不是直接塞进 :data:`IMAGE_PROMPT_SLOT_SPECS`，是为了**不改**
#: 默认九槽位的口径（``DEFAULT_IMAGE_PROMPT_CATEGORIES`` 保持 9 个，
#: 镜头级/批量预览的既有行为逐字不变）。
PROP_IMAGE_PROMPT_SLOT_SPECS: tuple[ImagePromptSlotSpec, ...] = (
    ImagePromptSlotSpec(
        category=PromptCategory.prop_image_front,
        label="道具正面图片",
        entity_type="prop",
        view_hint="道具正面清晰展示，完整入画，干净背景",
        subject_source="道具画像卡",
    ),
    ImagePromptSlotSpec(
        category=PromptCategory.prop_image_other,
        label="道具侧面/背面图片",
        entity_type="prop",
        view_hint="同一道具的另一视角，保持材质、颜色与形制一致",
        subject_source="道具画像卡",
    ),
)

#: 槽位规格全集：默认九槽位 + 道具两槽位（**查表唯一入口**）。
ALL_IMAGE_PROMPT_SLOT_SPECS: tuple[ImagePromptSlotSpec, ...] = (
    *IMAGE_PROMPT_SLOT_SPECS,
    *PROP_IMAGE_PROMPT_SLOT_SPECS,
)

IMAGE_PROMPT_SLOT_BY_CATEGORY: dict[str, ImagePromptSlotSpec] = {
    str(spec.category.value): spec for spec in ALL_IMAGE_PROMPT_SLOT_SPECS
}

#: 资产类型 → 该类资产的图片提示词槽位（正面 / 其它视角）。四类资产**同构**。
ASSET_IMAGE_PROMPT_SLOTS: dict[str, tuple[PromptCategory, PromptCategory]] = {
    "character": (PromptCategory.character_image_front, PromptCategory.character_image_other),
    "scene": (PromptCategory.scene_image_front, PromptCategory.scene_image_other),
    "prop": (PromptCategory.prop_image_front, PromptCategory.prop_image_other),
    "costume": (PromptCategory.costume_image_front, PromptCategory.costume_image_other),
}


def image_prompt_slot_specs() -> list[dict[str, Any]]:
    """槽位规格全集的可序列化形式（只读，供前端渲染「手工填写提示词」表单）。

    返回**全部**已注册槽位（默认九槽位 + 道具两槽位）：道具槽位此前缺规格，
    前端只能靠硬编码或直接不给入口；补齐后四类资产在同一个列表里都能拿到槽位定义。

    DRY_RUN 下真实大模型被守卫挡住，用户仍然需要一条能把**自己写的**提示词保存到
    ``<entities>.image_prompts`` 的路；前端不应该靠硬编码槽位名来实现它。
    """
    return [
        {
            "category": str(spec.category.value),
            "label": spec.label,
            "entity_type": spec.entity_type,
            "view_hint": spec.view_hint,
            "subject_source": spec.subject_source,
            "default": spec in IMAGE_PROMPT_SLOT_SPECS,
        }
        for spec in ALL_IMAGE_PROMPT_SLOT_SPECS
    ]

# 分层结构顺序：主体描述 + 动作姿态 + 场景环境 + 镜头语言 + 风格 + 画质词
IMAGE_PROMPT_LAYER_ORDER: tuple[str, ...] = (
    "subject",
    "action_pose",
    "environment",
    "camera_language",
    "style",
    "quality",
)

IMAGE_PROMPT_LAYER_LABELS: dict[str, str] = {
    "subject": "主体描述",
    "action_pose": "动作姿态",
    "environment": "场景环境",
    "camera_language": "镜头语言",
    "style": "风格",
    "quality": "画质词",
}

# 中控台 llm_client.py 里的画质/负面词规则，迁到这里作为确定性兜底。
DEFAULT_QUALITY_WORDS = (
    "photorealistic, cinematic lighting, sharp focus, detailed skin texture, "
    "high consistency reference image"
)

DEFAULT_STYLE_WORDS = "realistic live-action short drama style, real human actor"

#: 具体资产的**基础风格词**（没有专属条目时用 :data:`DEFAULT_STYLE_WORDS`）。
#:
#: 目前只有服装一条：服装设定图要的是"**这一套衣服本身**"（平铺 / 立架展示），
#: 而 ``DEFAULT_STYLE_WORDS`` 里的 ``real human actor`` 是人物短剧画面的口径 ——
#: 两者混用就是"套用人物模板"。人物 / 场景 / 道具沿用既有基础风格词，行为不变。
STYLE_WORDS_BY_ASSET_TYPE: dict[str, str] = {
    "costume": "realistic costume reference photography, garment design sheet",
}


def base_style_words(asset_type: str) -> str:
    """该资产类型的基础风格词（没有专属条目就用全局默认）。"""
    key = str(asset_type or "").strip().lower()
    return STYLE_WORDS_BY_ASSET_TYPE.get(key, DEFAULT_STYLE_WORDS)

DEFAULT_NEGATIVE_PROMPT = (
    "3D, CGI, cartoon, anime, illustration, game character, doll-like face, plastic skin, "
    "low quality, blurry, distorted hands, extra fingers, deformed body, bad anatomy, "
    "text, watermark, logo, subtitles"
)

# ---------------------------------------------------------------------------
# 「角色设定图」版式（左面部大特写 + 右全身三视图）
# ---------------------------------------------------------------------------
#
# 需求清单第 2 条的硬口径：人物资产**不再生成"单张全身图"**，改为生成
# **角色设定图 / 人物参考图**，版式固定为：
#   左：面部大特写（单个人头，裁到锁骨附近，脸占左区 75%-85%）
#   右：同一人物的全身三视图（正面 / 侧面 / 背面）
#
# 配方来源：``/Users/apple/Documents/人物及场景生产项目`` 的
# ``src/server.js`` → ``buildCharacterReferenceSheet`` 与
# ``buildCharacterFirstReferencePrompt``（**只读参考**：按用户要求只把提示词文本
# port 过来，**不 import、不在运行时依赖该项目**，也不复制它的其它逻辑）。
#
# 这些词进 ``SLOT_STYLE_RULES``（风格/版式层），由 ``build_slot_layers`` 逐字补齐 ——
# 模型改写版式词会被"缺失就补回"的规则纠正，所以版式是**确定性**的。
CHARACTER_REFERENCE_SHEET_LAYOUT: tuple[str, ...] = (
    "16:9 horizontal character reference sheet",
    "the layout has two clear sections",
    "left panel contains exactly one large face close-up only, one single head, "
    "cropped from top of head to collarbone",
    "face occupies 75 to 85 percent of the left panel",
    "clear facial features, clear face shape, clear hairline, clear eyes and gaze, neutral expression",
    "right panel contains full-body three-view turnaround: front view, side view, back view",
    "same face, same hairstyle, same skin tone, same outfit, same body proportions in every view",
    "simple neutral standing pose, feet visible",
    "pure white seamless studio background",
)

#: 角色设定图的**专属负面词**。
#:
#: 与旧口径的关键差别（旧口径在这里是**反的**）：旧负面词里有 ``half body`` /
#: ``cropped body``，那是在要求"单张全身图"；新版式的左区**本来就是面部裁切特写**，
#: 留着这两条会把左区逼回全身，版式直接做不出来。
#: ``multiple people`` 同理要改写成"不许是**不同**的人"：
#: 三视图里同一个人本来就出现四次，写 ``multiple people`` 会让模型把版式压成单人。
CHARACTER_REFERENCE_SHEET_NEGATIVE: tuple[str, ...] = (
    "different people",
    "extra people",
    "duplicated face in the close-up area",
    "multiple close-up portraits",
    "stacked portraits",
    "portrait grid",
    "headshot collage",
    "extra heads",
    "second head",
    "exaggerated pose",
    "environmental background",
    "scene background",
    "bag, handbag, luggage or held props",
)

# 每个槽位的画质/风格补充（沿用中控台 ASSET_PROFILE 的"必须逐字包含"规则）。
SLOT_STYLE_RULES: dict[str, tuple[str, ...]] = {
    "character_image_front": CHARACTER_REFERENCE_SHEET_LAYOUT,
    "character_image_other": CHARACTER_REFERENCE_SHEET_LAYOUT,
    "scene_image_front": ("cinematic live-action environment", "wide establishing shot", "empty scene, no people"),
    "scene_image_other": ("cinematic live-action environment", "empty scene, no people"),
    "costume_image_front": ("isolated costume reference", "flat lay or mannequin display"),
    "costume_image_other": ("isolated costume reference", "back and side detail"),
    # 道具槽位补齐（此前完全没有 prop 条目 → 道具提示词拿不到任何道具专属风格词）
    "prop_image_front": ("isolated prop reference", "whole object in frame", "clean neutral background"),
    "prop_image_other": ("isolated prop reference", "matching material and colour", "clean neutral background"),
    "frame_head_image": ("cinematic still frame", "consistent character identity"),
    "frame_tail_image": ("cinematic still frame", "consistent character identity"),
    "frame_key_image": ("cinematic still frame", "peak emotion moment"),
}

SLOT_NEGATIVE_EXTRA: dict[str, tuple[str, ...]] = {
    # 角色：见 CHARACTER_REFERENCE_SHEET_NEGATIVE 的说明（旧口径的 half body /
    # cropped body / multiple people 与新版式直接冲突，已替换）
    "character_image_front": CHARACTER_REFERENCE_SHEET_NEGATIVE,
    "character_image_other": CHARACTER_REFERENCE_SHEET_NEGATIVE,
    "scene_image_front": ("isolated object", "product photo", "floating object", "white background"),
    "scene_image_other": ("isolated object", "product photo", "white background"),
    # 道具槽位专属负面词：道具图要的是「干净背景上的单件物品」，反面是人物/场景串味
    "prop_image_front": ("human figure", "hands holding object", "cluttered background", "multiple objects"),
    "prop_image_other": ("human figure", "cluttered background", "multiple objects"),
    # 服装槽位专属负面词（此前这两个槽位**一条都没有** → 服装提示词拿不到任何服装专属排除项）：
    # 服装设定图要的是「一套衣服本身」（平铺/立架），反面是人物肖像与场景串味。
    # 注意：这些词里**刻意不含**任何人物参考图 / 场景模板的特征串
    # （如 "full body character reference sheet" / "wide establishing shot"），
    # 否则服装提示词里就会混进别的类型的口径。
    "costume_image_front": ("real person portrait", "face close-up", "cluttered background", "multiple outfits"),
    "costume_image_other": ("real person portrait", "face close-up", "cluttered background"),
}


#: 槽位 → 它的**设计口径**该按哪类资产的结构化字段来写。
#:
#: 为什么只有服装两张表：人物 / 场景 / 道具的图片提示词口径已经在各自槽位里写足了
#: （``SLOT_STYLE_RULES`` + 画像卡里逐字段的结构化资料），本表**只补服装**这一条此前缺失的
#: 环节——服装的正式提示词必须落到「款式 / 颜色 / 材质 / 配饰 / 穿着人物 / 身份时代 / 使用场合」
#: 上，而不是人物参考图或场景模板的口径。口径文字由 ``asset_profiles`` 的字段表生成
#: （唯一事实来源），所以字段表改了这里自动跟着改，不会两处跑偏。
SLOT_DESIGN_BRIEF_ASSET_TYPES: dict[str, str] = {
    "costume_image_front": "costume",
    "costume_image_other": "costume",
}


def slot_design_brief(category: str) -> str:
    """该槽位提示词必须写出的**设计口径**；没有专属口径时返回空串。

    返回示例（服装）：``服装设计口径（必须逐项写出）：穿着人物、身份时代、款式、颜色、材质、配饰、使用场合``
    """
    asset_type = SLOT_DESIGN_BRIEF_ASSET_TYPES.get(str(category or "").strip())
    if not asset_type:
        return ""
    from app.services.studio.asset_profiles import field_specs, type_label  # 延迟导入，避免导入环

    labels = [spec.label for spec in field_specs(asset_type) if spec.visual]
    if not labels:
        return ""
    return f"{type_label(asset_type)}设计口径（必须逐项写出）：" + "、".join(labels)



# --------------------------------------------------------------------------
# 运镜词标准词库（4.3）
# --------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CameraMovementSpec:
    """一个标准运镜词。

    ``enum_code`` 对应 ``app.models.types.CameraMovement``；为 None 表示标准词库里
    有、但 DB 枚举没有对应值（写回 shots 时需要人工选择，见 ``db_note``）。
    """

    key: str
    zh: str
    en: str
    enum_code: str | None
    aliases: tuple[str, ...]
    db_note: str = ""


CAMERA_MOVEMENT_SPECS: tuple[CameraMovementSpec, ...] = (
    CameraMovementSpec(
        key="固定",
        zh="固定镜头",
        en="static locked-off camera",
        enum_code="STATIC",
        aliases=("固定", "静止", "定格", "static", "fixed", "locked", "STATIC", "固定镜头", "静止镜头"),
    ),
    CameraMovementSpec(
        key="推",
        zh="推镜（缓慢推近）",
        en="slow dolly in / push in",
        enum_code="DOLLY_IN",
        aliases=("推", "推镜", "推近", "推进", "缓慢推进", "dolly_in", "dolly in", "push in", "DOLLY_IN", "zoom in"),
    ),
    CameraMovementSpec(
        key="拉",
        zh="拉镜（缓慢拉远）",
        en="slow dolly out / pull back",
        enum_code="DOLLY_OUT",
        aliases=("拉", "拉镜", "拉远", "后拉", "dolly_out", "dolly out", "pull back", "DOLLY_OUT", "zoom out"),
    ),
    CameraMovementSpec(
        key="摇",
        zh="摇镜（左右横摇）",
        en="pan",
        enum_code="PAN",
        aliases=("摇", "摇镜", "横摇", "平摇", "pan", "PAN", "摇摄"),
    ),
    CameraMovementSpec(
        key="上下摇",
        zh="上下摇镜（俯仰）",
        en="tilt",
        enum_code="TILT",
        aliases=("上下摇", "俯仰", "抬头摇", "tilt", "TILT"),
    ),
    CameraMovementSpec(
        key="移",
        zh="移镜（横向移动）",
        en="tracking slide",
        enum_code="TRACK",
        aliases=("移", "移镜", "横移", "平移", "侧移", "移动", "track", "TRACK", "slider"),
    ),
    CameraMovementSpec(
        key="跟",
        zh="跟镜（跟随主体）",
        en="follow shot",
        enum_code="TRACK",
        aliases=("跟", "跟镜", "跟拍", "跟随", "跟随拍摄", "follow", "follow shot", "tracking shot"),
        db_note="DB 枚举无独立 FOLLOW，写回 shots.camera_movement 时用 TRACK 表达。",
    ),
    CameraMovementSpec(
        key="环绕",
        zh="环绕运镜",
        en="orbit around subject",
        enum_code=None,
        aliases=("环绕", "绕拍", "环绕运镜", "orbit", "orbit shot", "arc shot", "围绕"),
        db_note="DB 枚举 CameraMovement 无 ORBIT，写回 shots 前需人工确认。",
    ),
)

CAMERA_MOVEMENT_KEYS: tuple[str, ...] = tuple(spec.key for spec in CAMERA_MOVEMENT_SPECS)

_CAMERA_LOOKUP: dict[str, CameraMovementSpec] = {}


def _register_camera_aliases() -> None:
    for spec in CAMERA_MOVEMENT_SPECS:
        for alias in (spec.key, spec.zh, spec.en, *spec.aliases):
            key = str(alias or "").strip().lower()
            if key:
                _CAMERA_LOOKUP.setdefault(key, spec)


_register_camera_aliases()


def normalize_camera_movement(raw: object) -> CameraMovementSpec | None:
    """把模型/用户给的运镜词归一化到标准词库；不在词库内返回 None。"""
    text = str(raw or "").strip().lower()
    if not text:
        return None
    if text in _CAMERA_LOOKUP:
        return _CAMERA_LOOKUP[text]
    # 容忍"缓慢推近（push in）"这类复合写法：逐个标准词做包含匹配。
    for spec in CAMERA_MOVEMENT_SPECS:
        if spec.key in text or spec.zh in text:
            return spec
    return None


def camera_movement_options() -> list[dict[str, object]]:
    """给前端/文档用的标准运镜词清单。"""
    return [
        {
            "key": spec.key,
            "label": spec.zh,
            "en": spec.en,
            "enum_code": spec.enum_code,
            "db_note": spec.db_note,
        }
        for spec in CAMERA_MOVEMENT_SPECS
    ]


# --------------------------------------------------------------------------
# 视频提示词槽位（4.3）
# --------------------------------------------------------------------------

VIDEO_PROMPT_LAYER_ORDER: tuple[str, ...] = (
    "subject_action",
    "camera_movement",
    "expression_mood",
    "duration",
)

VIDEO_PROMPT_LAYER_LABELS: dict[str, str] = {
    "subject_action": "主体动作",
    "camera_movement": "运镜",
    "expression_mood": "表情/氛围",
    "duration": "时长",
}

ALLOWED_DURATION_SECONDS: tuple[int, ...] = (4, 5, 8, 10, 12, 15)

FRAME_MODES: tuple[str, ...] = ("single_frame", "first_last_frame")

CREATIVE_ENTITY_PROFILE_TEMPLATE = "画像卡：{name}（{entity_type}）｜{profile}"
