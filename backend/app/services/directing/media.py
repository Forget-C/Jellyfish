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
