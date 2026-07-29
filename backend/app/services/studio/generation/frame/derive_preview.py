from __future__ import annotations

from app.schemas.studio.shots import FrameGuidanceDecisionRead, RenderedShotFramePromptRead, ShotFramePromptMappingRead
from app.services.studio.generation.frame.build_base import FrameBaseDraft
from app.services.studio.generation.frame.build_context import FrameGenerationContext
from app.services.studio.generation.shared.types import GenerationDerivedPreview


def replace_reference_names_in_prompt(
    *,
    base_prompt: str,
    mappings: list[ShotFramePromptMappingRead],
) -> str:
    """将提示词中的实体名称替换为稳定的图片 token。"""
    text = (base_prompt or "").strip()
    replace_pairs = [
        ((mapping.name or "").strip(), mapping.token)
        for mapping in mappings
        if (mapping.name or "").strip()
    ]
    replace_pairs.sort(key=lambda item: len(item[0]), reverse=True)
    for name, token in replace_pairs:
        text = text.replace(name, token)
    return text


def _score_frame_guidance_line(
    *,
    frame_type: str,
    category: str,
    text: str,
) -> int:
    """按帧类型和文本特征给图片 guidance 打分，控制最终 prompt 的收敛顺序。"""
    score_by_category = {
        "summary": 100,
        "continuity": 80,
        "frame": 70,
        "screen": 65,
        "composition": 60,
    }
    score = score_by_category.get(category, 0)

    if frame_type == "first" and category == "frame":
        score += 18
    if frame_type == "first" and category == "composition":
        score += 15
    if frame_type == "key" and category == "frame":
        score += 6
    if frame_type == "last" and category == "frame":
        score += 8
    if frame_type in {"key", "last"} and category == "screen":
        score += 10
    if frame_type == "last" and category == "continuity":
        score += 5

    if category == "frame" and any(keyword in text for keyword in ("触发瞬间", "初始反应", "尚未完成", "动作峰值", "情绪余韵", "收束")):
        score += 8
    if category == "screen" and any(keyword in text for keyword in ("视线", "对视", "左右", "朝向", "跳轴")):
        score += 10
    if category == "composition" and any(keyword in text for keyword in ("空间", "重心", "环境", "锚点", "站位")):
        score += 10
    if category == "continuity" and any(keyword in text for keyword in ("上一镜头", "下一镜头", "承接", "收束")):
        score += 5

    return score


def _build_frame_guidance_reason(
    *,
    frame_type: str,
    category: str,
    selected: bool,
) -> str:
    """生成 guidance 被保留或压缩的可解释原因。"""
    # 本函数是纯字符串查表：19 个 return 全部为 (selected, category, frame_type) 组合的
    # 解释文案，且**依赖 guard clause 的先后顺序**（例如 category == "frame" 但 frame_type
    # 不在 {first,key,last} 时会继续向下匹配）。改写成映射表会破坏这种 fallthrough 语义，
    # 或需要额外的优先级列表才能等价，可读性反而下降。故按仓库既有的行级注解方式
    # 窄范围豁免该单条检查（非模块级 disable）。
    # pylint: disable=too-many-return-statements
    if selected:
        if category == "frame":
            if frame_type == "first":
                return "当前是首帧，系统优先保留触发瞬间与未完成态约束，避免画面直接跳到后续完成动作。"
            if frame_type == "key":
                return "当前是关键帧，系统保留帧职责 guidance 来强化动作峰值或情绪爆点。"
            if frame_type == "last":
                return "当前是尾帧，系统保留帧职责 guidance 来强化动作收束与情绪落点。"
        if frame_type == "first" and category == "composition":
            return "当前是首帧，系统优先稳住空间建立与主体站位，所以保留构图锚点。"
        if frame_type in {"key", "last"} and category == "screen":
            return "当前镜头更看重视线与左右轴线稳定，因此优先保留朝向与视线 guidance。"
        if category == "summary":
            return "导演主指令始终属于最高优先级约束，因此会优先保留。"
        if category == "continuity":
            return "连续性 guidance 直接影响镜头承接稳定性，因此被保留。"
        if category == "composition":
            return "这条 guidance 对画面空间重心更关键，因此被保留。"
        if category == "screen":
            return "这条 guidance 对视线、朝向或轴线更关键，因此被保留。"

    if category == "frame":
        if frame_type == "first":
            return "当前已有更高优先级的首帧约束进入最终 prompt，因此这条帧职责 guidance 被压缩。"
        if frame_type == "key":
            return "当前已有更高优先级的关键帧约束进入最终 prompt，因此这条帧职责 guidance 被压缩。"
        if frame_type == "last":
            return "当前已有更高优先级的尾帧约束进入最终 prompt，因此这条帧职责 guidance 被压缩。"
    if frame_type == "first" and category == "screen":
        return "当前是首帧，系统更优先保空间建立与站位关系，因此将朝向与视线 guidance 降为次级。"
    if frame_type in {"key", "last"} and category == "composition":
        return "当前镜头更优先保视线与左右轴线稳定，因此构图锚点 guidance 被压缩。"
    if category == "summary":
        return "当前已有更高分的导演主指令进入最终 prompt，这条摘要未继续保留。"
    if category == "continuity":
        return "当前已有更高优先级的镜头约束进入最终 prompt，因此这条连续性 guidance 被压缩。"
    if category == "composition":
        return "当前已有更高优先级的空间或朝向约束进入最终 prompt，因此这条构图 guidance 被压缩。"
    if category == "screen":
        return "当前已有更高优先级的空间或连续性约束进入最终 prompt，因此这条朝向/视线 guidance 被压缩。"
    return "当前已有更高优先级 guidance 进入最终 prompt，因此该条目未被保留。"


def _build_frame_guidance_reason_tag(
    *,
    frame_type: str,
    category: str,
    selected: bool,
) -> str:
    """生成更适合前端快速阅读的短标签。"""
    # 同上：纯查表 + 依赖 guard clause 顺序的短标签生成，窄范围豁免该单条检查。
    # pylint: disable=too-many-return-statements
    if category == "summary":
        return "导演主指令"
    if category == "frame":
        if frame_type == "first":
            return "首帧保时序" if selected else "首帧降时序"
        if frame_type == "key":
            return "关键帧保峰值" if selected else "关键帧降峰值"
        if frame_type == "last":
            return "尾帧保收束" if selected else "尾帧降收束"
    if category == "continuity":
        return "连续性优先" if selected else "连续性降级"
    if frame_type == "first" and category == "composition":
        return "首帧保空间" if selected else "首帧降构图"
    if frame_type == "first" and category == "screen":
        return "首帧降轴线"
    if frame_type in {"key", "last"} and category == "screen":
        return "关键帧保轴线" if frame_type == "key" and selected else ("尾帧保轴线" if selected else "轴线降级")
    if frame_type in {"key", "last"} and category == "composition":
        return "关键帧降构图" if frame_type == "key" else "尾帧降构图"
    if category == "composition":
        return "构图优先" if selected else "构图降级"
    if category == "screen":
        return "轴线优先" if selected else "轴线降级"
    return "优先级调整"


def _collect_frame_guidance_lines(
    *,
    frame_type: str,
    replaced_prompt: str,
    director_command_summary: str,
    continuity_guidance: str,
    frame_specific_guidance: str,
    composition_anchor: str,
    screen_direction_guidance: str,
) -> tuple[list[str], list[str], list[FrameGuidanceDecisionRead], list[FrameGuidanceDecisionRead]]:
    """收集最终保留与被压缩掉的 guidance，供渲染与前端展示共用。"""
    text = (replaced_prompt or "").strip()
    candidates: list[tuple[int, int, str, str]] = []
    normalized_summary = (director_command_summary or "").strip()
    normalized_continuity = (continuity_guidance or "").strip()
    normalized_frame = (frame_specific_guidance or "").strip()
    normalized_composition = (composition_anchor or "").strip()
    normalized_screen = (screen_direction_guidance or "").strip()

    if normalized_summary and normalized_summary not in text:
        candidates.append(
            (
                _score_frame_guidance_line(frame_type=frame_type, category="summary", text=normalized_summary),
                0,
                "summary",
                f"高优先级导演指令：{normalized_summary}",
            )
        )
    if (
        normalized_continuity
        and normalized_continuity not in text
        and normalized_continuity not in normalized_summary
        and "连续性要求：" not in text
    ):
        candidates.append(
            (
                _score_frame_guidance_line(frame_type=frame_type, category="continuity", text=normalized_continuity),
                1,
                "continuity",
                f"连续性要求：{normalized_continuity}",
            )
        )
    if (
        normalized_frame
        and normalized_frame not in text
        and normalized_frame not in normalized_summary
        and "当前帧职责：" not in text
    ):
        candidates.append(
            (
                _score_frame_guidance_line(frame_type=frame_type, category="frame", text=normalized_frame),
                2,
                "frame",
                f"当前帧职责：{normalized_frame}",
            )
        )
    if (
        normalized_composition
        and normalized_composition not in text
        and "构图锚点：" not in text
    ):
        candidates.append(
            (
                _score_frame_guidance_line(frame_type=frame_type, category="composition", text=normalized_composition),
                4,
                "composition",
                f"构图锚点：{normalized_composition}",
            )
        )
    if (
        normalized_screen
        and normalized_screen not in text
        and "朝向与视线：" not in text
    ):
        candidates.append(
            (
                _score_frame_guidance_line(frame_type=frame_type, category="screen", text=normalized_screen),
                3,
                "screen",
                f"朝向与视线：{normalized_screen}",
            )
        )

    ranked = sorted(candidates, key=lambda item: (-item[0], item[1]))
    selected_rows = ranked[:3]
    dropped_rows = ranked[3:]
    selected = [line for _, _, _, line in selected_rows]
    dropped = [line for _, _, _, line in dropped_rows]
    selected_details = [
        FrameGuidanceDecisionRead(
            text=line,
            category=category,
            reason_tag=_build_frame_guidance_reason_tag(frame_type=frame_type, category=category, selected=True),
            reason=_build_frame_guidance_reason(frame_type=frame_type, category=category, selected=True),
        )
        for _, _, category, line in selected_rows
    ]
    dropped_details = [
        FrameGuidanceDecisionRead(
            text=line,
            category=category,
            reason_tag=_build_frame_guidance_reason_tag(frame_type=frame_type, category=category, selected=False),
            reason=_build_frame_guidance_reason(frame_type=frame_type, category=category, selected=False),
        )
        for _, _, category, line in dropped_rows
    ]
    return selected, dropped, selected_details, dropped_details


def enrich_frame_prompt_with_guidance(
    *,
    frame_type: str,
    replaced_prompt: str,
    director_command_summary: str,
    continuity_guidance: str,
    frame_specific_guidance: str,
    composition_anchor: str,
    screen_direction_guidance: str,
) -> str:
    """将高优先级导演约束补入最终图片提示词，避免只停留在调试展示。"""
    text = (replaced_prompt or "").strip()
    guidance_lines, _, _, _ = _collect_frame_guidance_lines(
        frame_type=frame_type,
        replaced_prompt=text,
        director_command_summary=director_command_summary,
        continuity_guidance=continuity_guidance,
        frame_specific_guidance=frame_specific_guidance,
        composition_anchor=composition_anchor,
        screen_direction_guidance=screen_direction_guidance,
    )
    if not guidance_lines:
        return text
    return "\n".join([*guidance_lines, text]).strip()


def compose_shot_frame_rendered_prompt(
    *,
    replaced_prompt: str,
    mappings: list[ShotFramePromptMappingRead],
) -> str:
    """拼装最终提交给模型的关键帧提示词。"""
    lines: list[str] = []
    if mappings:
        lines.append("## 图片内容说明")
        for mapping in mappings:
            lines.append(f"{mapping.token}: {mapping.name}")
        lines.append("")
    lines.append("## 生成内容")
    lines.append((replaced_prompt or "").strip())
    return "\n".join(lines).strip()


class FrameDerivedPreview(GenerationDerivedPreview):
    """分镜帧图片生成的最终预览结果。"""

    kind: str = "frame"
    shot_id: str
    frame_type: str
    base_prompt: str
    rendered_prompt: str
    selected_guidance: list[str]
    dropped_guidance: list[str]
    selected_guidance_details: list[FrameGuidanceDecisionRead]
    dropped_guidance_details: list[FrameGuidanceDecisionRead]
    images: list[str]
    mappings: list[ShotFramePromptMappingRead]


def derive_frame_preview(
    *,
    base: FrameBaseDraft,
    context: FrameGenerationContext,
) -> FrameDerivedPreview:
    normalized_base_prompt = (base.prompt or "").strip()
    replaced_prompt = replace_reference_names_in_prompt(
        base_prompt=normalized_base_prompt,
        mappings=context.ordered_refs,
    )
    selected_guidance, dropped_guidance, selected_guidance_details, dropped_guidance_details = _collect_frame_guidance_lines(
        frame_type=base.frame_type.value if hasattr(base.frame_type, "value") else str(base.frame_type),
        replaced_prompt=replaced_prompt,
        director_command_summary=base.director_command_summary,
        continuity_guidance=base.continuity_guidance,
        frame_specific_guidance=base.frame_specific_guidance,
        composition_anchor=base.composition_anchor,
        screen_direction_guidance=base.screen_direction_guidance,
    )
    enriched_prompt = enrich_frame_prompt_with_guidance(
        frame_type=base.frame_type.value if hasattr(base.frame_type, "value") else str(base.frame_type),
        replaced_prompt=replaced_prompt,
        director_command_summary=base.director_command_summary,
        continuity_guidance=base.continuity_guidance,
        frame_specific_guidance=base.frame_specific_guidance,
        composition_anchor=base.composition_anchor,
        screen_direction_guidance=base.screen_direction_guidance,
    )
    rendered_prompt = compose_shot_frame_rendered_prompt(
        replaced_prompt=enriched_prompt,
        mappings=context.ordered_refs,
    )
    return FrameDerivedPreview(
        shot_id=base.shot_id,
        frame_type=base.frame_type.value if hasattr(base.frame_type, "value") else str(base.frame_type),
        base_prompt=normalized_base_prompt,
        rendered_prompt=rendered_prompt,
        selected_guidance=selected_guidance,
        dropped_guidance=dropped_guidance,
        selected_guidance_details=selected_guidance_details,
        dropped_guidance_details=dropped_guidance_details,
        images=[mapping.file_id for mapping in context.ordered_refs],
        mappings=context.ordered_refs,
    )


def to_rendered_shot_frame_prompt_read(
    *,
    derived: FrameDerivedPreview,
) -> RenderedShotFramePromptRead:
    return RenderedShotFramePromptRead(
        base_prompt=derived.base_prompt,
        rendered_prompt=derived.rendered_prompt,
        selected_guidance=derived.selected_guidance,
        dropped_guidance=derived.dropped_guidance,
        selected_guidance_details=derived.selected_guidance_details,
        dropped_guidance_details=derived.dropped_guidance_details,
        images=derived.images,
        mappings=derived.mappings,
    )
