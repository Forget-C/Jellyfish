"""产物字段的写入护栏：来源白名单 + 禁止演练占位入库。

两件事，都是为了让「上一环确认保存的产物」真的是**经过确认的产物**：

1. **来源必须准确**（``validate_video_prompt_source``）
   视频提示词有四条真实来源：大模型生成（``llm``）、巨日禄导入（``jurilu``）、
   人工编辑（``manual``）、一键技能生成（``skill``）。
   **模板拼装（``template``）不是来源**——它只是把 ``shot_video_prompt_pack`` 渲染出来的预览，
   没有任何模型参与。此前工作室把"预览结果未经修改即保存"标成了 ``llm``，
   导致模板文本被当成模型产物进入交付导出。这里用白名单把这条路堵死。

2. **演练占位不得写入正式产物字段**（``reject_placeholder_text``）
   DRY_RUN 下编排层返回的是明确带 ``[DRY_RUN 占位]`` 标记的占位文本。
   如果把它写进 ``image_prompts`` / ``video_prompt``，交付与后续生成就会读到假内容。
   这里做确定性检查：产物字段的取值一旦包含占位标记，直接 422 拒绝。

放在这里而不是各调用点各写一遍，是为了保证"哪条路径写都不许绕过"。
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

# ---------------------------------------------------------------------------
# 视频提示词来源
# ---------------------------------------------------------------------------

VIDEO_PROMPT_SOURCE_LLM = "llm"
VIDEO_PROMPT_SOURCE_JURILU = "jurilu"
VIDEO_PROMPT_SOURCE_MANUAL = "manual"
VIDEO_PROMPT_SOURCE_SKILL = "skill"
#: 其它外部平台的批量导入（不是巨日禄）：必须与"大模型生成"区分开，不能混标
VIDEO_PROMPT_SOURCE_EXTERNAL_IMPORT = "external_import"
# 非来源：模板拼装预览。保留常量是为了能给出可解释的错误信息。
VIDEO_PROMPT_SOURCE_TEMPLATE = "template"

VIDEO_PROMPT_SOURCE_LABELS: dict[str, str] = {
    VIDEO_PROMPT_SOURCE_LLM: "大模型生成",
    VIDEO_PROMPT_SOURCE_JURILU: "巨日禄导入",
    VIDEO_PROMPT_SOURCE_MANUAL: "人工编辑",
    VIDEO_PROMPT_SOURCE_SKILL: "一键技能生成",
    VIDEO_PROMPT_SOURCE_EXTERNAL_IMPORT: "外部导入",
    VIDEO_PROMPT_SOURCE_TEMPLATE: "模板拼装（仅预览，不算来源）",
}

# 允许落库的来源白名单（有序，便于错误提示里按顺序展示）
SAVABLE_VIDEO_PROMPT_SOURCES: tuple[str, ...] = (
    VIDEO_PROMPT_SOURCE_LLM,
    VIDEO_PROMPT_SOURCE_JURILU,
    VIDEO_PROMPT_SOURCE_MANUAL,
    VIDEO_PROMPT_SOURCE_SKILL,
    VIDEO_PROMPT_SOURCE_EXTERNAL_IMPORT,
)

# 历史/其他入口已经在库里的来源值（实测存在，不能读不出来）：
#   manual_workspace  2 条 —— 工作室里手工维护
#   shot_description 18 条 —— 由镜头描述生成
# 写入口把它们归一成 manual；交付读取时两种都要认，否则会静默丢掉这些已保存的提示词。
LEGACY_SOURCE_ALIASES: dict[str, str] = {
    "internal": VIDEO_PROMPT_SOURCE_MANUAL,
    "manual_workspace": VIDEO_PROMPT_SOURCE_MANUAL,
}
LEGACY_EXPORTABLE_SOURCES: tuple[str, ...] = ("manual_workspace", "shot_description")

# 可以进入交付导出的来源（模板拼装不在其中）
EXPORTABLE_VIDEO_PROMPT_SOURCES: tuple[str, ...] = (
    *SAVABLE_VIDEO_PROMPT_SOURCES,
    *LEGACY_EXPORTABLE_SOURCES,
)


def validate_video_prompt_source(source: Any) -> str:
    """校验并归一化视频提示词来源；非法值抛 422（附可用取值）。

    空值允许（表示"还没设定来源"，历史数据里大量为空），原样返回空串。
    """
    text = str(source or "").strip().lower()
    if not text:
        return ""
    if text in SAVABLE_VIDEO_PROMPT_SOURCES:
        return text
    if text in LEGACY_SOURCE_ALIASES:
        return LEGACY_SOURCE_ALIASES[text]
    if text == VIDEO_PROMPT_SOURCE_TEMPLATE:
        raise HTTPException(
            status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
            detail=(
                "video_prompt_source 不接受 template：模板拼装只是本地预览，"
                "没有模型参与，不能记为已确认来源。若内容来自模板且你已修改，请标 manual；"
                f"若来自大模型生成，请标 {VIDEO_PROMPT_SOURCE_LLM}。"
            ),
        )
    allowed = "、".join(f"{key}（{VIDEO_PROMPT_SOURCE_LABELS[key]}）" for key in SAVABLE_VIDEO_PROMPT_SOURCES)
    raise HTTPException(
        status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
        detail=f"video_prompt_source 取值非法：{text!r}。可用取值：{allowed}。",
    )


# ---------------------------------------------------------------------------
# 演练占位护栏
# ---------------------------------------------------------------------------

# 编排层在 DRY_RUN 下生成的占位标记（见 llm_orchestration/dry_run.py 与各服务）
PLACEHOLDER_MARKERS: tuple[str, ...] = (
    "[DRY_RUN 占位]",
    "[DRY_RUN]",
)

PLACEHOLDER_FIELD_LABELS: dict[str, str] = {
    "image_prompts": "资产图片提示词",
    "video_prompt": "镜头视频提示词",
    "first_frame_prompt": "首帧提示词",
    "last_frame_prompt": "尾帧提示词",
    "key_frame_prompt": "关键帧提示词",
}


def _placeholder_hits(text: str) -> list[str]:
    return [marker for marker in PLACEHOLDER_MARKERS if marker in text]


def reject_placeholder_text(value: Any, *, field: str) -> None:
    """产物文本字段的占位检查；命中占位标记时抛 422。

    ``value`` 可以是字符串，也可以是 ``{key: text}`` 形态（``image_prompts``）。
    """
    if value is None:
        return
    label = PLACEHOLDER_FIELD_LABELS.get(field, field)

    if isinstance(value, dict):
        offenders = {key: hits for key, hits in ((k, _placeholder_hits(str(v or ""))) for k, v in value.items()) if hits}
        if offenders:
            first = next(iter(offenders))
            raise HTTPException(
                status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
                detail=(
                    f"{label} 含演练占位内容（{field}.{first} 命中 {offenders[first][0]}），拒绝写入正式产物字段。"
                    "请在 DRY_RUN 关闭并确认真实调用后重新生成，或改为人工填写。"
                ),
            )
        return

    hits = _placeholder_hits(str(value))
    if hits:
        raise HTTPException(
            status_code=422,  # 字面量：starlette 新旧版本对该常量命名不一致
            detail=(
                f"{label} 含演练占位内容（命中 {hits[0]}），拒绝写入正式产物字段。"
                "请在 DRY_RUN 关闭并确认真实调用后重新生成，或改为人工填写。"
            ),
        )


def validate_product_text_fields(update_data: dict[str, Any]) -> None:
    """对一批待写入字段统一做占位检查（只检查已知的产物字段）。"""
    for field in PLACEHOLDER_FIELD_LABELS:
        if field in update_data:
            reject_placeholder_text(update_data.get(field), field=field)
