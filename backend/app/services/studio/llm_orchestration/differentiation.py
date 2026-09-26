"""同身份多角色的**形象差异化**：让「两个丫鬟」拿到两条互不相同的提示词。

解决的真实事故（需求清单第 4 条，P0）
====================================

剧本里出现**两个丫鬟**时，系统按剧本原文给两人提取出了**同一段外貌资料**
（原文本来就是把两人写在一起的，例如「两个丫鬟穿着青色布衣」）。于是：

1. 画像卡的主体描述对两人几乎逐字相同（只差名字）；
2. 图片提示词由画像卡确定性拼装，两条提示词除了名字以外完全一样；
3. 保存/出图前的**跨资产查重**（``asset_prompt_quality.check_cross_asset_duplicates``）
   判定为「高度重复」并给 409 —— 用户**卡在生图之前**，流程被阻断。

这里**不放宽**查重门禁（那条门禁是对的：两条一样的提示词不该出两张一样的图），
而是**在上游把形象真的区分开**：为同身份、同类型的每个角色分配一组**互不重复的
差异化设计锚点**（脸型 / 眉眼 / 发式 / 身形 / 服装主色 / 标志物 / 年龄感），
把锚点并进画像卡的 ``canonical_subject``。提示词由画像卡确定性拼装，
所以锚点一定会出现在最终提示词里 —— 两条提示词因此**设计上**不同，而不是靠模型临场发挥。

为什么必须由后端算，而不是让模型自己区分
----------------------------------------

资产准备页是**一次请求只点名一个资产**（``asset_preview`` 逐项调用），
模型在单次调用里**看不到同批的另一个丫鬟**，没有任何依据去区分。
所以差异化必须由**看得到全项目资产**的后端来做，并且结果要**与调用顺序无关**：
本模块始终按「同身份组的名字稳定排序」分配锚点，因此
"给丫鬟乙生成提示词" 与 "给丫鬟甲生成提示词" 会得到彼此一致、互不冲突的结论。

设计口径
--------

- **只在真的同身份时生效**：一个身份组至少 2 个成员才分配锚点；
  单成员（绝大多数资产）**行为逐字不变**，不引入任何噪音；
- **锚点只并进主体描述**，不动 ``profile``，也不改 ``has_structured_profile`` ——
  「缺资料」的判定与提示词质量拦截的口径都不受影响；
- 锚点是**确定性的**：同一份项目数据永远得到同一组锚点，可回归、可复现、不需要调模型。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from app.schemas.studio.llm_orchestration import EntityProfileCardRead

# ---------------------------------------------------------------------------
# 差异化设计锚点维度
# ---------------------------------------------------------------------------

#: 七个互相独立的外观维度。每个维度内取值**互不相同**，
#: 因此只要其中一个维度取值不同，两个人的形象就不可能被认成同一个设计。
#:
#: 取值刻意写成**可直接落到画面上**的完整描述（而不是「长脸」两个字），原因有两层：
#:
#: 1. 需求要的是"为每个角色生成独立、唯一的提示词" —— 关键词级别的差异不足以让
#:    两个角色在成图上真的长得不一样；
#: 2. 出图前的**跨资产查重**是按整条提示词的相似度判定的（阈值 0.9），
#:    而角色提示词里有大段**本来就该完全相同**的版式词（角色设定图左右分栏那一套）。
#:    差异化文本如果太短，两个人的提示词仍然会被判成"高度重复"而卡住生图 ——
#:    这正是第 4 条既有的卡点形态，必须在源头给足差异量。
DESIGN_DIMENSIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "脸型",
        (
            "鹅蛋脸，额头饱满、下颌线条柔和",
            "圆润苹果脸，面颊饱满、颧骨不明显",
            "窄长脸，颧骨平缓、下颌收窄",
            "方下颌骨相脸，下颌角清晰、面部有棱角",
            "心形脸，额头较宽、下巴尖细",
            "瓜子脸，两颊清瘦、下巴小巧",
        ),
    ),
    (
        "眉眼神态",
        (
            "杏眼圆睁、眉形平直，眼神清亮",
            "细长丹凤眼、眼尾上挑，眼神锐利",
            "柳叶细眉、眼尾下垂，神态温顺",
            "圆眼短眉，眼距略宽、眼神机灵",
            "狭长锐利眼、眉压眼，眉眼距离近",
            "弯月眼、眉形柔和，不笑时也带三分笑意",
        ),
    ),
    (
        "发式",
        (
            "双丫髻，两侧各扎一个圆髻、以素色发带收口",
            "单侧垂鬓，一侧长发编辫垂至肩前",
            "双环髻，头顶两侧盘成环形发髻",
            "高束马尾，头发全部向后束起、露出额头",
            "齐额刘海低髻，额前留齐眉碎发、脑后低盘",
            "侧分长直发，三七分披散在肩后",
        ),
    ),
    (
        "身形体格",
        (
            "娇小纤细，个子不高、肩膀窄",
            "清瘦挺拔，身形单薄但脊背笔直",
            "匀称结实，肩宽腰细、四肢有力",
            "修长高挑，身高明显高于同批其它角色",
            "圆润敦实，身形偏丰满、站姿敦厚",
            "单薄瘦削，锁骨明显、手腕纤细",
        ),
    ),
    (
        "服装主色",
        (
            "豆青色为主，配月白色镶边",
            "藕荷色为主，配素白腰带",
            "月白色为主，配竹青色滚边",
            "竹青色为主，配深色系带",
            "淡鹅黄色为主，配豆绿色边饰",
            "赭石色为主，配浅豆色下裙",
        ),
    ),
    (
        "标志物",
        (
            "发间插一支银质小簪",
            "以素色布带束发",
            "腕上系一根红绳",
            "鬓边插一把木质发梳",
            "耳垂上一对素银耳饰",
            "头戴靛蓝色头巾",
        ),
    ),
    (
        "年龄感",
        (
            "十五六岁，面部轮廓未完全长开",
            "十七八岁，少女感明显",
            "二十出头，面容清爽利落",
            "二十六七岁，神态从容稳重",
            "三十上下，气质沉稳",
            "三十五岁上下，眼角有细微纹路",
        ),
    ),
)

#: 每个维度的**起始偏移**，保证前 6 个成员的锚点组合两两不同。
#: 取质数错位：即使维度只有 6 个取值，也不会出现"两个人每个维度都撞上"的组合。
_DIMENSION_OFFSETS: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 1)

#: 身份词表：名字里带这些词的角色，视为**同一身份的多个角色**。
#:
#: 为什么需要它：两个丫鬟的资料文本可能并不逐字相同（一个写了发饰、一个写了动作），
#: 但名字里的「丫鬟」已经足以说明"这是同一种身份的两个角色，必须长得不一样"。
IDENTITY_ROLE_WORDS: tuple[str, ...] = (
    # 从长到短匹配，避免"小丫鬟"被"丫鬟"截断后语义丢失
    "贴身丫鬟", "粗使丫鬟", "小丫鬟", "大丫鬟",
    "丫鬟", "婢女", "侍女", "侍女甲", "宫女", "嬷嬷", "婆子",
    "侍卫", "护卫", "随从", "亲卫", "暗卫", "士兵", "兵卒", "门卫",
    "小厮", "仆人", "家丁", "管家", "车夫", "掌柜", "伙计",
    "童子", "弟子", "门徒", "族人", "村民", "宾客", "侍从",
    "太监", "小太监", "衙役", "捕快", "镖师",
)

#: 剧情身份的显式前缀（``context.load_asset_profile_enrichments`` 写进画像文本的那一段）。
PLOT_IDENTITY_PREFIX = "本章剧情身份："


@dataclass(frozen=True, slots=True)
class DesignAnchor:
    """一个角色分配到的差异化设计锚点组合。"""

    #: 组内序号（按名字稳定排序后的位置），从 0 开始
    index: int
    #: 维度名 → 取值（顺序与 :data:`DESIGN_DIMENSIONS` 一致）
    choices: tuple[tuple[str, str], ...]

    @property
    def summary(self) -> str:
        """锚点的中文摘要（进提示词，也进 warnings 供人工核对）。

        维度之间用「；」分隔；取值内部**不使用**「；」，
        这样这段文本可以被稳定地逐项拆开比对（见测试里的逐维度断言）。
        """
        return "；".join(f"{name}：{value}" for name, value in self.choices)

    @property
    def short_summary(self) -> str:
        """只留每个维度的**核心取值**（warnings 里用，避免失败信息过长）。"""
        return "、".join(f"{name}{value.split('，')[0]}" for name, value in self.choices)

    def render(self) -> str:
        """锚点渲染成"必须逐字使用"的指令句（并进主体描述）。"""
        return (
            "差异化设计锚点（同身份多角色必须按此区分，逐字使用，不得与同批其它角色复用）："
            + self.summary
        )


def _normalize_text(value: object) -> str:
    """比较用归一化：去空白与常见标点，转小写。"""
    text = str(value or "").strip().lower()
    for ch in " \t\r\n，。、；：,.;:（）()【】[]「」\"'":
        text = text.replace(ch, "")
    return text


def extract_plot_identity(profile: str) -> str:
    """从画像文本里取「本章剧情身份」的值；没有就返回空串。

    这段文本由 ``context._enrichment_from_record`` / ``load_asset_profile_enrichments``
    写入，是**最可信的身份来源**（比从名字猜更准）。
    """
    text = str(profile or "")
    index = text.find(PLOT_IDENTITY_PREFIX)
    if index < 0:
        return ""
    rest = text[index + len(PLOT_IDENTITY_PREFIX) :]
    return rest.split("；")[0].split(";")[0].strip()


def role_word_of(name: str) -> str:
    """名字里命中的身份词（从长到短匹配），没有返回空串。"""
    text = str(name or "").strip()
    if not text:
        return ""
    for word in sorted(IDENTITY_ROLE_WORDS, key=len, reverse=True):
        if word in text:
            return word
    return ""


def identity_group_key(card: EntityProfileCardRead) -> tuple[str, str, str]:
    """同身份分组的键 ``(来源, 实体类型, 身份签名)``。

    三种身份来源，按可信度从高到低：

    1. ``identity``：画像文本里的「本章剧情身份」（明确写出来的身份）；
    2. ``role``：名字里命中的身份词（「丫鬟甲」/「丫鬟乙」→ 丫鬟）；
    3. ``profile``：画像资料文本本身 —— 两人资料**逐字相同**时，
       数据上就是"同一套设定"，必须拆开（这正是用户报的那次事故的形态）。

    返回值里的实体类型参与分组：角色与场景即使同名也不会被并成一组。
    """
    entity_type = _normalize_text(card.entity_type)
    identity = extract_plot_identity(card.profile)
    if identity:
        return ("identity", entity_type, _normalize_text(identity))
    role = role_word_of(card.name)
    if role:
        return ("role", entity_type, _normalize_text(role))
    return ("profile", entity_type, _normalize_text(card.profile))


def build_identity_groups(
    cards: Sequence[EntityProfileCardRead],
) -> list[list[EntityProfileCardRead]]:
    """把画像卡按同身份分组，**只返回成员 ≥2 的组**（单成员组没有任何区分对象）。

    组内成员按名字稳定排序 —— 这是"与调用顺序无关"的关键：
    无论本次请求只要其中一个还是两个，分配给某人的锚点都一样。
    """
    buckets: dict[tuple[str, str, str], list[EntityProfileCardRead]] = {}
    for card in cards:
        if not card.has_structured_profile:
            # 没有可用资料的角色本来就出不了提示词（走既有的"缺资料"路径），
            # 不参与分组，避免它们的空壳资料影响真实角色的锚点分配。
            continue
        if not _normalize_text(card.profile):
            continue
        buckets.setdefault(identity_group_key(card), []).append(card)

    groups: list[list[EntityProfileCardRead]] = []
    for members in buckets.values():
        if len(members) < 2:
            continue
        groups.append(sorted(members, key=lambda item: _normalize_text(item.name)))
    # 组间顺序稳定（便于测试与 warnings 复现）
    groups.sort(key=lambda group: (_normalize_text(group[0].entity_type), _normalize_text(group[0].name)))
    return groups


def pick_anchor(index: int) -> DesignAnchor:
    """按组内序号取一个锚点组合（确定性，无随机）。"""
    position = max(0, int(index))
    choices: list[tuple[str, str]] = []
    for offset, (name, options) in zip(_DIMENSION_OFFSETS, DESIGN_DIMENSIONS):
        choices.append((name, options[(position + offset) % len(options)]))
    return DesignAnchor(index=position, choices=tuple(choices))


def assign_design_anchors(
    cards: Sequence[EntityProfileCardRead],
) -> dict[str, DesignAnchor]:
    """为**同身份组**里的每个角色分配互不重复的锚点。

    返回 ``{画像卡名字的归一化键: 锚点}``；不属于任何多成员组的角色**不在返回里**
    （它们的行为逐字不变）。
    """
    anchors: dict[str, DesignAnchor] = {}
    for group in build_identity_groups(cards):
        # 组合去重：组内成员多于一个维度的取值数时，轮转仍可能撞车，
        # 用一个已用集合兜住，保证"同组内绝不出现两个相同的锚点组合"。
        used: set[tuple[str, ...]] = set()
        for member in group:
            index = group.index(member)
            anchor = pick_anchor(index)
            guard = 0
            while tuple(value for _name, value in anchor.choices) in used and guard < 64:
                guard += 1
                anchor = pick_anchor(index + guard * len(DESIGN_DIMENSIONS))
            used.add(tuple(value for _name, value in anchor.choices))
            anchors[_normalize_text(member.name)] = anchor
    return anchors


def apply_design_anchors(
    cards: Sequence[EntityProfileCardRead],
    *,
    all_cards: Sequence[EntityProfileCardRead],
) -> tuple[list[EntityProfileCardRead], list[str]]:
    """把差异化锚点并进本次要生成的那几张画像卡的主体描述。

    参数：
        cards：**本次请求点名**要生成的画像卡（收窄之后的）；
        all_cards：**同一装载范围里的全部**画像卡（收窄之前的）——
            同身份分组必须看全量，否则"只点名一个丫鬟"时看不到另一个，无法区分。

    返回 ``(新画像卡列表, 中文说明列表)``：
    说明文字进响应 ``warnings``，让用户在页面上就能看到"这两个角色被怎么区分开了"。

    为什么只改 ``canonical_subject``：
        主体描述是提示词里**逐字使用**的那一层（``image_prompt.build_slot_layers``
        会用画像卡覆盖模型写的主体），所以锚点一定落到最终提示词里；
        而 ``profile`` 与 ``has_structured_profile`` 保持原样，
        「有没有资料」的判定与质量拦截口径完全不受影响。
    """
    anchors = assign_design_anchors(all_cards)
    if not anchors:
        return list(cards), []

    result: list[EntityProfileCardRead] = []
    notes: list[str] = []
    for card in cards:
        anchor = anchors.get(_normalize_text(card.name))
        if anchor is None or not card.canonical_subject:
            result.append(card)
            continue
        subject = card.canonical_subject
        if anchor.render() in subject:  # 幂等：重复调用不会叠加
            result.append(card)
            continue
        result.append(card.model_copy(update={"canonical_subject": f"{subject}。{anchor.render()}"}))
        notes.append(
            f"「{card.name}」与同身份的其它角色（{_sibling_names(all_cards, card)}）"
            f"已按各自独立的形象设计分开：{anchor.short_summary}。"
        )
    return result, notes


def _sibling_names(all_cards: Iterable[EntityProfileCardRead], card: EntityProfileCardRead) -> str:
    """列出与这张卡同身份的其它角色名（说明文字用；没有就返回"无"）。"""
    key = identity_group_key(card)
    key_of_card = _normalize_text(card.name)
    names = [
        item.name
        for item in all_cards
        if _normalize_text(item.name) != key_of_card and identity_group_key(item) == key
    ]
    return "、".join(names) if names else "无"


def render_differentiation_rules(all_cards: Sequence[EntityProfileCardRead]) -> str:
    """渲染提示词模板里的「同身份多角色逐个独立设计」段落。

    只有**真的存在**同身份多角色时才写具体名单；否则只留一条通用硬规则，
    不额外增加 prompt 噪音（也避免让模型为单角色凭空编造区分对象）。
    """
    lines = [
        "- 当同一身份（例如两个丫鬟、两个侍卫）出现**多个不同角色**时，",
        "  **必须为每个角色单独设计互不重复的外貌**：脸型、眉眼、发式、身形、",
        "  服装主色、标志物、年龄感至少各有明确区别；",
        "- **严禁**把同一个角色的外貌描述复制给另一个角色，也**严禁**只改名字不改外形；",
        "- 每个角色的主体描述里给出的「差异化设计锚点」必须**逐字使用**，并围绕它展开外形细节；",
    ]
    groups = build_identity_groups(all_cards)
    if not groups:
        return "\n".join(lines)

    lines.append("")
    lines.append("## 本项目的同身份角色（必须逐个独立设计，不允许雷同）")
    for group in groups:
        members = "、".join(item.name for item in group)
        lines.append(f"- {members}：身份相同（{group[0].entity_type}），外观必须能一眼区分开。")
    return "\n".join(lines)


__all__ = [
    "DESIGN_DIMENSIONS",
    "IDENTITY_ROLE_WORDS",
    "DesignAnchor",
    "apply_design_anchors",
    "assign_design_anchors",
    "build_identity_groups",
    "extract_plot_identity",
    "identity_group_key",
    "pick_anchor",
    "render_differentiation_rules",
    "role_word_of",
]
