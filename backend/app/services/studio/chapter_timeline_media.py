"""章节时间线相关媒体探测：ffprobe 解析时长与音轨存在性。"""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path

from app.core import storage


async def _read_json_subprocess(cmd: list[str]) -> dict:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        msg = (stderr or b"").decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"子进程失败 ({proc.returncode}): {msg}")
    return json.loads(stdout.decode("utf-8"))


async def ffprobe_local_file(path: Path) -> dict:
    """对本地文件执行 ffprobe，返回 JSON（含 format 与 streams）。"""
    return await _read_json_subprocess(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ],
    )


def probe_duration_and_audio(probe: dict) -> tuple[float, bool]:
    """从 ffprobe JSON 得到时长（秒）及是否存在音频流。"""
    fmt = probe.get("format") or {}
    dur_raw = fmt.get("duration")
    try:
        dur_s = float(dur_raw) if dur_raw is not None else 0.0
    except (TypeError, ValueError):
        dur_s = 0.0
    has_audio = any(s.get("codec_type") == "audio" for s in (probe.get("streams") or []))
    return dur_s, has_audio


async def probe_video_duration_ms_from_storage(storage_key: str) -> int:
    """下载存储对象到临时文件并 ffprobe，返回成片时长毫秒（用于 PUT 裁剪校验）。"""
    from app.services.studio.chapter_timeline_trim import source_duration_ms_from_seconds

    data = await storage.download_file(key=storage_key)
    if not data:
        msg = "无法下载成片文件，无法校验裁剪范围"
        raise ValueError(msg)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)
        probe = await ffprobe_local_file(tmp_path)
        dur_s, _ = probe_duration_and_audio(probe)
        return source_duration_ms_from_seconds(dur_s)
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


__all__ = [
    "ffprobe_local_file",
    "probe_duration_and_audio",
    "probe_video_duration_ms_from_storage",
]
