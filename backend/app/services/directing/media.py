"""从真实视频字节提取剪辑所需时长，不采用模型预计秒数。"""

import json
import subprocess


def probe_duration(file) -> int:
    """ffprobe 只读取本地临时文件，禁用外部协议并限制执行时间。"""
    file.seek(0)
    result = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "pipe,file",
                             "-show_entries", "format=duration", "-of", "json", "pipe:0"],
                            stdin=file, capture_output=True, timeout=30, check=True)
    duration = float(json.loads(result.stdout)["format"]["duration"])
    if not 0 < duration < 86400:
        raise ValueError("视频时长无效")
    file.seek(0)
    return round(duration * 1000)


def extract_frame(content: bytes, at_ms: int) -> bytes:
    """从本地视频字节准确提取 PNG，禁用网络协议并限制处理时间。"""
    import tempfile

    try:
        with tempfile.TemporaryFile() as file:
            file.write(content)
            file.seek(0)
            result = subprocess.run(['ffmpeg', '-v', 'error', '-protocol_whitelist', 'pipe,file',
                '-i', 'pipe:0', '-ss', str(at_ms / 1000), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'],
                stdin=file, capture_output=True, timeout=30, check=True)
    except subprocess.TimeoutExpired as error:
        raise ValueError('提取画面超时，请选择其他位置后重试') from error
    except subprocess.CalledProcessError as error:
        raise ValueError('无法解码所选视频画面') from error
    if not result.stdout.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('所选位置没有可提取画面')
    return result.stdout
