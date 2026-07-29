"""市场事实字符串的解析与占位符检测（domain 层，纯函数、无副作用）。

v1.1 刻意保留「可含占位符的字符串」表示法（最小化改动）：
- 设计阶段允许 ``{{TOKEN}}``；
- data-lock 阶段拒绝任何未解析占位符，并要求按语义规则可解析。

**所有函数都不修改传入值**（只读判断/解析）。
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

#: 占位符语法：仅 ``{{...}}`` 形式；普通散文与单花括号不视为占位符。
PLACEHOLDER_PATTERN = re.compile(r"\{\{[^{}]*\}\}")

#: 被禁止的 NaN 类记号（比较前 strip + casefold）。
NAN_LIKE_TOKENS: frozenset[str] = frozenset(
    {"nan", "inf", "+inf", "-inf", "infinity", "+infinity", "-infinity", "none", "null", "undefined", "tbd", "?"}
)

#: 解析十进制数前允许剥除的货币符号与千分位分隔符。
_CURRENCY_CHARS = "$€£¥₩"
_THOUSANDS_CHARS = ","

#: 宽松的 BCP 47 形状校验（形状检查，不做注册表校验）。
BCP47_PATTERN = re.compile(
    r"^[A-Za-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?(-([A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*$"
)


def contains_placeholder(value: object) -> bool:
    """判断字符串是否含未解析的 ``{{...}}`` 占位符（非字符串一律 False）。"""
    return isinstance(value, str) and PLACEHOLDER_PATTERN.search(value) is not None


def is_blank(value: object) -> bool:
    """判断是否为空串或仅空白（非字符串一律 False）。"""
    return isinstance(value, str) and value.strip() == ""


def is_nan_like(value: object) -> bool:
    """判断是否为被禁止的 NaN 类记号（strip + casefold 后比较）。"""
    return isinstance(value, str) and value.strip().casefold() in NAN_LIKE_TOKENS


def is_valid_language_tag(value: object) -> bool:
    """判断字符串是否符合 BCP 47 形状（例如 ``en``、``zh-Hant``）。"""
    return isinstance(value, str) and BCP47_PATTERN.match(value) is not None


def parse_decimal(value: str) -> Decimal | None:
    """把价格/价位字符串解析为有限十进制数；失败返回 ``None``。

    允许：首尾空白、货币符号、千分位逗号、前导正负号。
    不修改传入字符串。
    """
    if not isinstance(value, str) or is_blank(value) or is_nan_like(value) or contains_placeholder(value):
        return None
    cleaned = value.strip()
    for char in _CURRENCY_CHARS:
        cleaned = cleaned.replace(char, "")
    cleaned = cleaned.replace(_THOUSANDS_CHARS, "").strip()
    if cleaned in {"", "+", "-"}:
        return None
    try:
        parsed = Decimal(cleaned)
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def parse_percentage(value: str) -> Decimal | None:
    """把百分比字符串解析为十进制数（允许剥除一个尾部 ``%``）；失败返回 ``None``。"""
    if not isinstance(value, str) or is_blank(value) or is_nan_like(value) or contains_placeholder(value):
        return None
    cleaned = value.strip()
    if cleaned.endswith("%"):
        cleaned = cleaned[:-1].strip()
    return parse_decimal(cleaned)


def parse_iso8601(value: str) -> datetime | None:
    """把 ISO-8601 字符串解析为 ``datetime``；失败返回 ``None``（支持尾部 ``Z``）。"""
    if not isinstance(value, str) or is_blank(value) or is_nan_like(value) or contains_placeholder(value):
        return None
    candidate = value.strip()
    if candidate.endswith(("Z", "z")):
        candidate = candidate[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(candidate)
    except ValueError:
        return None


def iter_placeholder_paths(node: object, path: str = "") -> list[str]:
    """递归收集所有含占位符的字段路径（用于 data-lock / publish 扫描）。"""
    found: list[str] = []
    if isinstance(node, dict):
        for key, item in node.items():
            found.extend(iter_placeholder_paths(item, f"{path}.{key}" if path else str(key)))
    elif isinstance(node, (list, tuple)):
        for index, item in enumerate(node):
            found.extend(iter_placeholder_paths(item, f"{path}[{index}]"))
    elif contains_placeholder(node):
        found.append(path or "<root>")
    return found


__all__ = [
    "PLACEHOLDER_PATTERN",
    "NAN_LIKE_TOKENS",
    "BCP47_PATTERN",
    "contains_placeholder",
    "is_blank",
    "is_nan_like",
    "is_valid_language_tag",
    "parse_decimal",
    "parse_percentage",
    "parse_iso8601",
    "iter_placeholder_paths",
]
