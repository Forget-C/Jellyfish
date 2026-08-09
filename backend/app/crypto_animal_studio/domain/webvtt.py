"""SubtitleTrack → WebVTT 的确定性渲染（纯函数，无 I/O）。

设计约束：
- **确定性**：同一 track 永远得到逐字节相同的输出（无时间戳、无 UUID、无字典序抖动）；
- **保真**：语言标签、cue ID、cue 顺序、start_ms/end_ms、译文原文、镜头引用全部保留；
- 输出为 UTF-8 文本，行尾统一 ``\\n``（WebVTT 允许 LF；避免跨平台产生不同字节）。

镜头引用用 WebVTT 的 ``NOTE`` 注释承载（W3C WebVTT 允许在 cue 之间出现 NOTE 块），
因此既保留了信息，又不污染可渲染的字幕正文。
"""

from __future__ import annotations

from typing import Any

#: WebVTT 文件头。
WEBVTT_HEADER = "WEBVTT"

#: 产物 MIME 类型。
WEBVTT_MIME_TYPE = "text/vtt"


def format_timestamp(milliseconds: int) -> str:
    """把整数毫秒格式化为 WebVTT 时间戳 ``HH:MM:SS.mmm``。

    参数：
        milliseconds: 非负整数毫秒（episode-absolute）。
    返回：
        形如 ``00:00:02.400`` 的字符串。
    异常：
        ValueError：负值。
    """
    if milliseconds < 0:
        raise ValueError(f"timestamp must be >= 0, got {milliseconds}")
    total_seconds, millis = divmod(int(milliseconds), 1000)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def render_webvtt(track: Any) -> str:
    """把一条 SubtitleTrack 渲染为确定性的 WebVTT 文本。

    输出结构::

        WEBVTT
        Language: zh-Hant

        NOTE shot=SC01
        c1
        00:00:00.400 --> 00:00:02.000
        突破了！我們回來了！

    参数：
        track: 具备 ``language_tag`` 与 ``cues``（含 cue_id/start_ms/end_ms/text/shot_id）
            的字幕轨对象。
    返回：
        UTF-8 WebVTT 文本（以单个换行结尾）。
    异常：
        ValueError：cue 列表为空，或某个 cue 的 ``end_ms`` 不大于 ``start_ms``。
    """
    cues = list(track.cues)
    if not cues:
        raise ValueError(f"subtitle track '{track.language_tag}' has no cues")

    blocks: list[str] = [f"{WEBVTT_HEADER}\nLanguage: {track.language_tag}"]
    for index, cue in enumerate(cues):
        if cue.end_ms <= cue.start_ms:
            raise ValueError(
                f"cue '{cue.cue_id}' has end_ms {cue.end_ms} <= start_ms {cue.start_ms}"
            )
        lines: list[str] = []
        shot_id = getattr(cue, "shot_id", None)
        speaker = getattr(cue, "speaker_character_key", None)
        # 镜头 / 说话人引用放在 NOTE 里：保留信息且不进入可见字幕正文。
        note_parts = [f"cue={index + 1}"]
        if shot_id:
            note_parts.append(f"shot={shot_id}")
        if speaker:
            note_parts.append(f"speaker={speaker}")
        lines.append("NOTE " + " ".join(note_parts))
        lines.append(str(cue.cue_id))
        lines.append(f"{format_timestamp(cue.start_ms)} --> {format_timestamp(cue.end_ms)}")
        lines.append(cue.text)
        blocks.append("\n".join(lines))

    return "\n\n".join(blocks) + "\n"


def render_webvtt_bytes(track: Any) -> bytes:
    """``render_webvtt`` 的 UTF-8 字节形式（不带 BOM）。"""
    return render_webvtt(track).encode("utf-8")


__all__ = [
    "WEBVTT_HEADER",
    "WEBVTT_MIME_TYPE",
    "format_timestamp",
    "render_webvtt",
    "render_webvtt_bytes",
]
