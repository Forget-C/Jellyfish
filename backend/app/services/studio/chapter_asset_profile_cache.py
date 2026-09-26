"""章节结构化资产清单的**进程内缓存**。

存在的理由
==========

本流程分两步：

1. ``GET  /studio/chapters/{id}/asset-profiles``——调大模型，产出结构化清单（花钱）；
2. ``POST /studio/chapters/{id}/asset-profiles/confirm``——按清单建/绑资产（写库）。

第 2 步必须拿到第 1 步的结果，否则用户点"确认"时会**再花一次钱**，
而且两次结果不一致（模型有温度）会让"我刚确认的那份"和"库里写的"对不上。

方案与既有 ``script_extraction_cache`` 完全一致：**进程内缓存 + 内容签名 key**。
签名的输入是"章节原文 + 分镜 + 附加要求"，所以：

- 剧本没改 → 命中同一份清单，确认时不重复调模型；
- 剧本改了 → 自动换 key，不会拿旧清单去建资产（这一点比"按 chapter_id 缓存"安全得多）；
- 进程重启 → 缓存自然失效，``confirm`` 会明确告诉用户"请先重新生成清单"，
  而不是悄悄用一份空清单建出一堆空资产。

至于"落库"，2026-09 已按用户要求改为**专用表持久化**
（``chapter_asset_profiles`` / ``chapter_asset_profile_runs``，见
:mod:`app.services.studio.chapter_asset_record_store`）：

- **数据库是事实来源**：重启后直接读库，不会再花钱、也不会出现"请先重新生成清单"；
- 本模块的进程内缓存**降级为纯性能优化**（同一进程内重复读时省一次 JSON 深拷贝），
  清空它不影响任何结论 —— 因为确认动作读的是库，不再只认缓存。
"""

from __future__ import annotations

import hashlib
import json
from threading import Lock
from typing import Any

_CACHE_LOCK = Lock()
_CHAPTER_PROFILE_CACHE: dict[str, dict[str, Any]] = {}

#: 进程内最多保留多少份章节清单（防止长时间运行把内存撑大）
MAX_CACHED_CHAPTER_PROFILES = 32


def _shots_payload(shots: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "shot_id": str(shot.get("shot_id") or ""),
            "index": int(shot.get("index") or 0),
            "script_excerpt": str(shot.get("script_excerpt") or ""),
        }
        for shot in shots
    ]


def build_chapter_source_hash(*, chapter_text: str, shots: list[dict[str, Any]]) -> str:
    """**剧本 + 分镜**的内容签名（不含附加要求）。

    这是"这份清单对应哪一版剧本"的判据：``chapter_asset_profiles.source_hash``
    存的是它；与当前算出来的值不一致 → 标记「内容已变化，建议重新分析」。
    刻意**不含**附带要求：改了附加要求只说明"这次的提问方式变了"，
    剧本本身没变，不该把已有资料标成过期。
    """
    payload = {
        "chapter_text": str(chapter_text or ""),
        "shots": _shots_payload(shots),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def build_chapter_profile_cache_key(
    *,
    project_id: str,
    chapter_id: str,
    chapter_text: str,
    shots: list[dict[str, Any]],
    extra_instructions: str = "",
) -> str:
    """按**内容**算签名（不是按 ID）：剧本/分镜变了，key 就变。"""
    payload = {
        "project_id": project_id,
        "chapter_id": chapter_id,
        "chapter_text": str(chapter_text or ""),
        "shots": _shots_payload(shots),
        "extra_instructions": str(extra_instructions or ""),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _clone(payload: dict[str, Any]) -> dict[str, Any]:
    """深拷贝（只走 JSON 里本来就合法的部分；pydantic 模型先 dump 成 dict）。"""
    return json.loads(json.dumps(payload, ensure_ascii=False, default=_json_default))


def _json_default(value: Any) -> Any:
    """缓存写入时的兜底序列化：pydantic 模型 dump 成 dict，其余转字符串。"""
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        return dump()
    return str(value)


def get_cached_chapter_profile(cache_key: str) -> dict[str, Any] | None:
    """取缓存的清单（深拷贝出去，调用方改不动缓存）。"""
    with _CACHE_LOCK:
        cached = _CHAPTER_PROFILE_CACHE.get(cache_key)
        if cached is None:
            return None
        return _clone(cached)


def set_cached_chapter_profile(cache_key: str, payload: dict[str, Any]) -> None:
    """写入缓存；超出上限时按插入顺序淘汰最旧的一份。"""
    with _CACHE_LOCK:
        _CHAPTER_PROFILE_CACHE[cache_key] = _clone(payload)
        while len(_CHAPTER_PROFILE_CACHE) > MAX_CACHED_CHAPTER_PROFILES:
            oldest = next(iter(_CHAPTER_PROFILE_CACHE))
            if oldest == cache_key and len(_CHAPTER_PROFILE_CACHE) == 1:
                break
            _CHAPTER_PROFILE_CACHE.pop(oldest, None)


def clear_chapter_profile_cache() -> None:
    """清空缓存（测试用）。"""
    with _CACHE_LOCK:
        _CHAPTER_PROFILE_CACHE.clear()


__all__ = [
    "MAX_CACHED_CHAPTER_PROFILES",
    "build_chapter_profile_cache_key",
    "build_chapter_source_hash",
    "clear_chapter_profile_cache",
    "get_cached_chapter_profile",
    "set_cached_chapter_profile",
]
