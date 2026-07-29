"""构建分镜帧提示词渲染所需的只读上下文。"""

from __future__ import annotations

from typing import TypedDict

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.studio import (
    Chapter,
    Character,
    ProjectSceneLink,
    Scene,
    Shot,
    ShotCharacterLink,
    ShotDetail,
)
from app.services.common import entity_not_found, invalid_choice
from app.services.studio.action_beats import pick_action_beat_for_frame


class FrameRenderGuidance(TypedDict):
    """定义统一 Renderer 可消费的镜头高优先级约束字段。"""

    director_command_summary: str
    continuity_guidance: str
    frame_specific_guidance: str
    composition_anchor: str
    screen_direction_guidance: str


def _enum_value(value: object | None) -> str:
    """将数据库枚举或普通值规整为提示词可用字符串。"""
    return str(getattr(value, "value", value) or "")


def _compact_text(value: str | None) -> str:
    """移除上下文文本两端空白，避免空值参与 guidance 拼接。"""
    return str(value or "").strip()


def _same_scene(shot: Shot | None, current_scene_id: str) -> bool:
    """判断相邻镜头是否与当前镜头属于同一场景。"""
    return bool(
        shot is not None
        and current_scene_id
        and str(getattr(getattr(shot, "detail", None), "scene_id", "") or "") == current_scene_id
    )


def _build_continuity_guidance(*, previous_shot: Shot | None, current_shot: Shot, next_shot: Shot | None) -> str:
    """基于相邻镜头关系生成动作、轴线和收束约束。"""
    guidance: list[str] = []
    current_detail = current_shot.detail
    current_scene_id = str(getattr(current_detail, "scene_id", "") or "")
    previous_detail = getattr(previous_shot, "detail", None)
    next_detail = getattr(next_shot, "detail", None)
    if previous_shot is not None:
        guidance.append("当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局")
        if current_scene_id and current_scene_id == str(getattr(previous_detail, "scene_id", "") or ""):
            guidance.append("上一镜头与当前镜头处于同一场景，优先保持空间轴线和主体朝向稳定")
    if next_shot is not None:
        guidance.append("当前镜头应形成自然收束，为下一镜头预留动作或情绪落点，避免硬切")
        if current_scene_id and current_scene_id == str(getattr(next_detail, "scene_id", "") or ""):
            guidance.append("下一镜头与当前镜头处于同一场景，尽量保持视觉重心与空间关系可连续延展")
    return "；".join(guidance)


def _build_composition_anchor(
    *, detail: ShotDetail, previous_shot: Shot | None, next_shot: Shot | None, characters: list[Character], scenes: list[Scene]
) -> str:
    """根据镜头语言、资产与相邻镜头生成构图锚点。"""
    anchors: list[str] = []
    camera_shot = _enum_value(detail.camera_shot)
    movement = _enum_value(detail.movement)
    if camera_shot in {"ECU", "CU"}:
        anchors.append("以主角色面部或关键动作作为画面重心，弱化环境干扰")
    elif camera_shot in {"MS", "FS"}:
        anchors.append("保持人物与环境同时可读，避免只剩情绪特写或只剩空场")
    else:
        anchors.append("优先建立空间关系，再突出主角色动作")
    if movement in {"DOLLY_IN", "ZOOM_IN"}:
        anchors.append("构图应体现向主体推进的视觉趋势，焦点逐步收束到主角色")
    elif movement in {"DOLLY_OUT", "ZOOM_OUT"}:
        anchors.append("构图应体现从主体向环境退开的趋势，保留更多空间信息")
    elif movement == "STATIC":
        anchors.append("保持构图稳定，不要无故改变主体在画面中的重心位置")
    if scenes:
        anchors.append(f"以场景 {scenes[0].name} 作为空间锚点，保证主体与环境关系清晰")
    if characters:
        anchors.append(f"优先锁定角色 {characters[0].name} 的朝向和视线，不要无故翻转左右关系")
    if _same_scene(previous_shot, str(detail.scene_id or "")):
        anchors.append("与上一镜头同场景时，尽量延续同一空间轴线和主体朝向")
    if _same_scene(next_shot, str(detail.scene_id or "")):
        anchors.append("与下一镜头同场景时，为后续镜头保留稳定的视觉落点与空间方向")
    return "；".join(anchors)


def _build_screen_direction_guidance(
    *, detail: ShotDetail, previous_shot: Shot | None, next_shot: Shot | None, dialogue_summary: str, character_names: list[str]
) -> str:
    """生成角色视线、站位和左右轴线约束。"""
    guidance: list[str] = []
    angle = _enum_value(detail.angle)
    if angle == "OVER_SHOULDER":
        guidance.append("当前镜头为过肩视角，应保持前景肩部与被看对象的左右关系稳定")
    elif angle == "EYE_LEVEL":
        guidance.append("优先保持人物视线水平和对视方向稳定，避免无故翻转左右朝向")
    else:
        guidance.append("明确主体朝向和视线落点，避免人物突然改向或跳轴")
    if dialogue_summary.strip():
        guidance.append("存在对白时，优先保证说话者与受话者的视线关系连续")
    if len(character_names) >= 2:
        guidance.append(f"角色 {character_names[0]} 与 {character_names[1]} 的左右站位和对视方向应保持一致")
    elif character_names:
        guidance.append(f"角色 {character_names[0]} 的朝向与视线落点应在相邻镜头中保持延续")
    if _same_scene(previous_shot, str(detail.scene_id or "")):
        guidance.append("与上一镜头同场景时，不要无故翻转人物面向和左右轴线")
    if _same_scene(next_shot, str(detail.scene_id or "")):
        guidance.append("与下一镜头同场景时，当前镜头结尾应保留可延续的视线方向")
    return "；".join(guidance)


_SEQUENTIAL_REACTION_KEYWORDS = ("听到", "闻声", "忽然", "突然", "下意识", "立刻", "随即", "紧接着", "随后", "脱手", "掉在地上", "捂住耳朵", "捂住", "蹲下", "跪下", "跌坐", "转身", "回头")


def _has_sequential_reaction_chain(*values: str | None) -> bool:
    """判断文本是否存在需要按时间切片的连续反应链。"""
    text = " ".join(_compact_text(value) for value in values if _compact_text(value))
    keyword_hits = sum(1 for keyword in _SEQUENTIAL_REACTION_KEYWORDS if keyword in text)
    return keyword_hits >= 2 or (keyword_hits >= 1 and sum(text.count(item) for item in "，。；、") >= 2)


def _build_frame_specific_guidance(
    *, frame_type: str, previous_shot: Shot | None, next_shot: Shot | None, detail: ShotDetail, script_excerpt: str, action_beats: list[str]
) -> str:
    """按首帧、关键帧和尾帧角色生成专项约束。"""
    guidance: list[str] = []
    if frame_type == "first":
        guidance.extend((
            "首帧应优先建立空间、主体初始站位和第一眼视觉印象，不要直接跳到动作尾声",
            "首帧只表现事件触发瞬间或最初反应的起始状态，不要直接写成后续完成动作、最终姿态或情绪爆发结果",
            "若剧本存在连续反应链，优先写成动作刚开始、尚未完成或被打断的状态，例如手刚松脱、身体骤然僵住、人物尚未完全蹲下",
        ))
        if _has_sequential_reaction_chain(script_excerpt, detail.description):
            guidance.append("当前镜头存在明显连续反应链，首帧必须截取触发后最早的可见瞬间，禁止直接落到捂耳、蹲下、倒地或转身完成态")
        if previous_shot is not None:
            guidance.append("首帧要承接上一镜头结束状态，但仍应让观众迅速看清当前空间与主体起始状态")
    elif frame_type == "last":
        guidance.append("尾帧应强调动作收束、情绪余韵或视线停留点，不要重新铺开新的动作起点")
        if next_shot is not None:
            guidance.append("尾帧应为下一镜头留下自然衔接的姿态、视线或情绪落点")
        guidance.append("尾帧中的主体姿态应更稳定，便于后续镜头承接")
    else:
        guidance.extend(("关键帧应锁定镜头内最有戏剧张力或信息密度最高的瞬间，不要平均描述整个过程", "优先选择动作峰值、情绪爆点或构图最有代表性的瞬间"))
    beat = pick_action_beat_for_frame(frame_type, action_beats)
    if beat is not None:
        phase = {"trigger": "触发阶段", "peak": "峰值阶段", "aftermath": "收束阶段"}.get(beat.phase, "当前阶段")
        guidance.append(f"当前帧优先围绕动作拍点“{beat.text}”组织画面（{phase}），不要越级跳到其他阶段")
    return "；".join(guidance)


def _score_director_guidance_item(*, category: str, text: str, frame_type: str, has_dialogue: bool, character_count: int, same_scene_with_previous: bool, same_scene_with_next: bool, movement: str) -> int:
    """为 guidance 句子打分，优先保留能稳定镜头连续性的约束。"""
    score = {"frame": 10, "continuity": 8, "composition": 7, "screen": 6}.get(category, 0)
    if category == "frame" and frame_type == "first":
        score += 8 if any(item in text for item in ("连续反应链", "最早的可见瞬间", "完成态")) else 0
        score += 6 if any(item in text for item in ("触发瞬间", "后续完成动作", "尚未完成")) else 0
        score += 5 if any(item in text for item in ("建立空间", "起始状态")) else 0
    if category == "frame" and frame_type == "key" and any(item in text for item in ("动作峰值", "戏剧张力", "情绪爆点")):
        score += 5
    if category == "frame" and frame_type == "last" and any(item in text for item in ("动作收束", "情绪余韵", "停留点")):
        score += 5
    if category == "continuity":
        score += 3 if "承接上一镜头" in text else 0
        score += 3 if "下一镜头" in text or "收束" in text else 0
        score += 3 if any(item in text for item in ("空间轴线", "主体朝向稳定", "视觉重心")) else 0
        score += 4 if same_scene_with_previous and "承接上一镜头" in text else 0
        score += 4 if same_scene_with_next and ("下一镜头" in text or "收束" in text) else 0
    if category == "composition":
        score += 5 if frame_type == "first" and any(item in text for item in ("空间锚点", "建立空间")) else 0
        score += 4 if frame_type == "key" and any(item in text for item in ("画面重心", "推进", "焦点")) else 0
        score += 4 if frame_type == "last" and any(item in text for item in ("视觉落点", "空间方向")) else 0
        score += 2 if any(item in text for item in ("锁定角色", "重心位置")) else 0
    if category == "screen":
        score += 5 if any(item in text for item in ("不要无故翻转", "跳轴")) else 0
        score += 5 if has_dialogue and any(item in text for item in ("视线关系连续", "对视方向")) else 0
        score += 4 if character_count >= 2 and any(item in text for item in ("左右站位", "对视方向")) else 0
        score += 4 if (same_scene_with_previous or same_scene_with_next) and any(item in text for item in ("同场景", "视线方向", "左右轴线")) else 0
    return score + (3 if movement in {"DOLLY_IN", "ZOOM_IN", "TRACK"} and category == "composition" and "推进" in text else 0)


def _build_director_command_summary(*, frame_type: str, frame_specific_guidance: str, continuity_guidance: str, composition_anchor: str, screen_direction_guidance: str, has_dialogue: bool, character_count: int, same_scene_with_previous: bool, same_scene_with_next: bool, movement: str) -> str:
    """按帧类型和镜头风险压缩 guidance，并保留必要的优先级顺序。"""
    seen: set[str] = set()
    def _bucket(category: str, block: str) -> list[str]:
        values = [item.strip() for item in block.split("；") if item.strip() and item.strip() not in seen]
        seen.update(values)
        return sorted(values, key=lambda item: _score_director_guidance_item(category=category, text=item, frame_type=frame_type, has_dialogue=has_dialogue, character_count=character_count, same_scene_with_previous=same_scene_with_previous, same_scene_with_next=same_scene_with_next, movement=movement), reverse=True)
    buckets = {"frame": _bucket("frame", frame_specific_guidance), "continuity": _bucket("continuity", continuity_guidance), "composition": _bucket("composition", composition_anchor), "screen": _bucket("screen", screen_direction_guidance)}
    must = ["frame", "continuity", "composition"] if frame_type == "first" else (["frame", "composition", "continuity"] if frame_type == "key" else ["frame", "continuity", "screen"])
    if has_dialogue or character_count >= 2 or same_scene_with_previous or same_scene_with_next:
        must.insert(2 if frame_type == "key" else 1, "screen")
    ordered = list(dict.fromkeys(must))[:4]
    must_items = [buckets[category][0] for category in ordered if buckets[category]]
    consumed = set(must_items)
    preferred = [item for category in ("frame", "continuity", "composition", "screen") for item in buckets[category] if item not in consumed]
    return "；".join([*(f"必须：{item}" for item in must_items[:4]), *(f"优先：{item}" for item in preferred[:4])])


async def build_frame_render_guidance(*, db: AsyncSession, shot_id: str, frame_type: str) -> FrameRenderGuidance:
    """读取分镜及相邻镜头，构建统一提示词渲染使用的不可编辑业务约束。"""
    normalized_frame_type = str(frame_type or "").strip().lower()
    if normalized_frame_type not in {"first", "last", "key"}:
        raise HTTPException(status_code=400, detail=invalid_choice("frame_type", ["first", "last", "key"]))
    shot_stmt = select(Shot).options(
        selectinload(Shot.detail).selectinload(ShotDetail.dialog_lines),
        selectinload(Shot.detail).selectinload(ShotDetail.scene),
        selectinload(Shot.chapter).selectinload(Chapter.project),
        selectinload(Shot.character_links).selectinload(ShotCharacterLink.character),
        selectinload(Shot.scene_links).selectinload(ProjectSceneLink.scene),
    ).where(Shot.id == shot_id)
    shot = (await db.execute(shot_stmt)).scalar_one_or_none()
    if shot is None:
        raise HTTPException(status_code=404, detail=entity_not_found("Shot"))
    if shot.detail is None:
        raise HTTPException(status_code=404, detail=entity_not_found("ShotDetail"))
    neighbor_rows = (await db.execute(select(Shot).options(selectinload(Shot.detail)).where(Shot.chapter_id == shot.chapter_id, Shot.index.in_([shot.index - 1, shot.index + 1])))).scalars().all()
    previous_shot = next((item for item in neighbor_rows if item.index == shot.index - 1), None)
    next_shot = next((item for item in neighbor_rows if item.index == shot.index + 1), None)
    detail = shot.detail
    characters = [link.character for link in sorted(shot.character_links or [], key=lambda item: (item.index, item.id)) if link.character is not None]
    scenes_by_id = {str(detail.scene.id): detail.scene} if detail.scene is not None else {}
    scenes_by_id.update({str(link.scene.id): link.scene for link in shot.scene_links or [] if link.scene is not None})
    dialogue_summary = "\n".join(line.text for line in detail.dialog_lines or [] if line.text)
    action_beats = [str(item).strip() for item in detail.action_beats or [] if str(item).strip()]
    continuity = _build_continuity_guidance(previous_shot=previous_shot, current_shot=shot, next_shot=next_shot)
    composition = _build_composition_anchor(detail=detail, previous_shot=previous_shot, next_shot=next_shot, characters=characters, scenes=list(scenes_by_id.values()))
    screen = _build_screen_direction_guidance(detail=detail, previous_shot=previous_shot, next_shot=next_shot, dialogue_summary=dialogue_summary, character_names=[item.name for item in characters])
    frame_specific = _build_frame_specific_guidance(frame_type=normalized_frame_type, previous_shot=previous_shot, next_shot=next_shot, detail=detail, script_excerpt=shot.script_excerpt or "", action_beats=action_beats)
    return {
        "director_command_summary": _build_director_command_summary(frame_type=normalized_frame_type, frame_specific_guidance=frame_specific, continuity_guidance=continuity, composition_anchor=composition, screen_direction_guidance=screen, has_dialogue=bool(dialogue_summary.strip()), character_count=len(characters), same_scene_with_previous=_same_scene(previous_shot, str(detail.scene_id or "")), same_scene_with_next=_same_scene(next_shot, str(detail.scene_id or "")), movement=_enum_value(detail.movement)),
        "continuity_guidance": continuity,
        "frame_specific_guidance": frame_specific,
        "composition_anchor": composition,
        "screen_direction_guidance": screen,
    }
