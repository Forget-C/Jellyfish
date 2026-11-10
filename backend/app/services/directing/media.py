"""从真实视频字节提取剪辑所需时长，不采用模型预计秒数。"""

import json
import subprocess
from decimal import Decimal, InvalidOperation
from math import ceil


def probe_duration(file, *, exclusive_end: bool = False) -> int:
    """测量本地视频时长，选帧使用向上取整的毫秒排他上界。"""
    file.seek(0)
    result = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "pipe,file",
                             "-show_entries", "format=duration", "-of", "json", "pipe:0"],
                            stdin=file, capture_output=True, timeout=30, check=True)
    try:
        duration = Decimal(json.loads(result.stdout)["format"]["duration"])
    except InvalidOperation as error:
        raise ValueError("视频时长无效") from error
    if not duration.is_finite() or not 0 < duration < 86400:
        raise ValueError("视频时长无效")
    file.seek(0)
    milliseconds = duration * 1000
    return ceil(milliseconds) if exclusive_end else round(milliseconds)


def extract_frame(content: bytes, at_ms: int, *, thumbnail: bool = False) -> bytes:
    """从本地字节提取 PNG；预览限制为最长边480，不改变业务参考取帧。"""
    import tempfile

    try:
        with tempfile.NamedTemporaryFile(suffix='.video') as file:
            file.write(content)
            file.flush()
            result = subprocess.run(['ffmpeg', '-v', 'error', '-protocol_whitelist', 'pipe,file',
                '-i', file.name, '-ss', str(at_ms / 1000),
                *(['-vf', "scale=w='min(480,iw)':h='min(480,ih)':force_original_aspect_ratio=decrease"] if thumbnail else []), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
                capture_output=True, timeout=30, check=True)
    except subprocess.TimeoutExpired as error:
        raise ValueError('提取画面超时，请选择其他位置后重试') from error
    except subprocess.CalledProcessError as error:
        raise ValueError('无法解码所选视频画面') from error
    if not result.stdout.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('所选位置没有可提取画面')
    return result.stdout


def extract_boundary_frame(content: bytes, source_in_ms: int, source_out_ms: int, edge: str) -> tuple[bytes, int]:
    """按实际解码帧时间选择区间内第一/最后一帧，避免落幅越界或视频末尾取不到帧。"""
    import tempfile

    try:
        with tempfile.NamedTemporaryFile(suffix='.video') as file:
            file.write(content)
            file.flush()
            probe = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'pipe,file',
                '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file.name],
                capture_output=True, timeout=30, check=True)
            frames = [(index, int(Decimal(row['best_effort_timestamp_time']) * 1000))
                      for index, row in enumerate(json.loads(probe.stdout).get('frames', []))
                      if 'best_effort_timestamp_time' in row]
            valid = [(index, at_ms) for index, at_ms in frames if source_in_ms <= at_ms < source_out_ms]
            if not valid:
                raise ValueError('实际采用区间内没有可提取的视频帧，请调整采用区间')
            index, at_ms = valid[0] if edge == 'start' else valid[-1]
            file.flush()
            result = subprocess.run(['ffmpeg', '-v', 'error', '-protocol_whitelist', 'pipe,file', '-i', file.name,
                '-map', '0:v:0', '-vf', f'select=eq(n\\,{index})', '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
                capture_output=True, timeout=30, check=True)
    except subprocess.TimeoutExpired as error:
        raise ValueError('提取边界帧超时，请缩短采用区间后重试') from error
    except (subprocess.CalledProcessError, json.JSONDecodeError) as error:
        raise ValueError('无法读取视频实际帧时间或边界画面') from error
    if not result.stdout.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('实际采用区间内没有可解码的边界画面')
    return result.stdout, at_ms
