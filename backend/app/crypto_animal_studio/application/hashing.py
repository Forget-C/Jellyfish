"""EpisodePackage 规范化哈希（canonical payload hash）。

用途：为幂等提供**确定性**指纹。对已校验的 EpisodePackage 以稳定键序序列化后取
SHA-256。相同语义的 payload 总是得到相同哈希；任何字段变化都会改变哈希。
"""

from __future__ import annotations

import hashlib
import json

from app.crypto_animal_studio.schemas.episode_package import EpisodePackage


def canonical_payload_hash(package: EpisodePackage) -> str:
    """返回 EpisodePackage 的规范化 SHA-256 十六进制摘要。

    步骤：
    1. ``model_dump(mode="json")`` 得到可 JSON 序列化的纯数据（枚举转字符串等）。
    2. ``json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=False)``
       —— 稳定键序、无多余空白、保留 Unicode，保证确定性。
    3. 对 UTF-8 字节做 SHA-256。

    参数：
        package: 已通过校验的 EpisodePackage。
    返回：
        64 位十六进制 SHA-256 字符串。
    """
    payload = package.model_dump(mode="json")
    serialized = json.dumps(
        payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


__all__ = ["canonical_payload_hash"]
