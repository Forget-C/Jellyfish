"""LLM 输出解析工具：JSON 抢救 + 结构化错误。

移植自中控台 ``llm_client.py``（``extract_json_candidate`` / ``json_error_hint``），
并在其基础上补了"轻微修复"与修复痕迹记录，便于把"模型输出不干净"这件事
变成可观测的 warning 而不是静默吞掉。
"""

from __future__ import annotations

import json
import re
from typing import Any

_FENCE_START = re.compile(r"^```(?:json|JSON)?\s*")
_FENCE_END = re.compile(r"\s*```$")
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


class JSONParseError(ValueError):
    """模型输出无法解析为 JSON 对象。"""

    def __init__(self, detail: str, *, raw_text: str = "") -> None:
        self.raw_text = raw_text
        super().__init__(detail)


def extract_json_candidate(raw_text: str) -> str:
    """从模型输出里捞出最可能的那段 JSON 文本。

    处理三类常见脏输出：Markdown 代码围栏、前后寒暄、末尾截断。
    """
    text = str(raw_text or "").strip()
    if text.startswith("```"):
        text = _FENCE_START.sub("", text)
        text = _FENCE_END.sub("", text)
    text = text.strip()

    first_object = text.find("{")
    last_object = text.rfind("}")
    if first_object != -1 and last_object != -1 and last_object > first_object:
        return text[first_object : last_object + 1]
    return text


def json_error_hint(exc: json.JSONDecodeError, raw_text: str) -> str:
    """把 JSONDecodeError 翻译成对操作者有意义的提示。"""
    hints: list[str] = []
    message = str(exc)
    stripped = str(raw_text or "").rstrip()
    likely_truncated = (
        "Unterminated string" in message
        or stripped.endswith((",", "[", "{", ":"))
        or str(raw_text or "").count("{") > str(raw_text or "").count("}")
        or str(raw_text or "").count("[") > str(raw_text or "").count("]")
    )
    if likely_truncated:
        hints.append("疑似 LLM 输出被截断或字符串未正确闭合，可缩短输入或调大 max_tokens。")
    if "Invalid control character" in message:
        hints.append("疑似 JSON 字符串内含未转义换行，建议重试。")
    if "Expecting value" in message and not stripped:
        hints.append("模型返回为空。")
    return " ".join(hints)


def _strip_trailing_commas(text: str) -> str:
    previous = None
    current = text
    while previous != current:
        previous = current
        current = _TRAILING_COMMA.sub(r"\1", current)
    return current


def _close_unbalanced(text: str) -> str:
    """尽力补齐被截断的括号（只做括号配平，不猜测内容）。"""
    stack: list[str] = []
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            stack.append(char)
        elif char in "}]" and stack:
            stack.pop()

    repaired = text
    if in_string:
        repaired += '"'
    repaired = repaired.rstrip().rstrip(",")
    for opener in reversed(stack):
        repaired += "}" if opener == "{" else "]"
    return repaired


def parse_json_object_with_repairs(raw_text: str) -> tuple[dict[str, Any], list[str]]:
    """解析模型输出为 dict，返回 (对象, 修复动作清单)。

    修复顺序（每一步都记录，便于在预览里如实标注）：
      1. 直解析；
      2. 去掉尾随逗号后重试；
      3. 括号配平后重试。
    """
    candidate = extract_json_candidate(raw_text)
    text = str(raw_text or "")
    if not candidate.strip():
        raise JSONParseError("模型返回为空，无法解析 JSON。", raw_text=text)

    repairs: list[str] = []
    attempts: list[tuple[str, str]] = [("直解析", candidate)]

    stripped = _strip_trailing_commas(candidate)
    if stripped != candidate:
        attempts.append(("去除尾随逗号", stripped))

    balanced = _close_unbalanced(stripped)
    if balanced != stripped:
        attempts.append(("括号配平（疑似截断）", balanced))

    last_error: json.JSONDecodeError | None = None
    for label, payload in attempts:
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue
        if label != "直解析":
            repairs.append(label)
        if not isinstance(parsed, dict):
            raise JSONParseError("模型返回的 JSON 顶层必须是对象。", raw_text=text)
        return parsed, repairs

    assert last_error is not None
    hint = json_error_hint(last_error, text)
    detail = f"JSON 解析失败：{last_error}"
    if hint:
        detail = f"{detail}。{hint}"
    raise JSONParseError(detail, raw_text=text)


def coerce_str(value: Any, *, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float, bool)):
        return str(value)
    return default


def coerce_str_list(value: Any) -> list[str]:
    """把模型给的"数组/单值/带空格的串"统一成去空字符串列表。"""
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,，、;；\s]+", value)
        return [p.strip() for p in parts if p.strip()]
    if isinstance(value, (list, tuple, set)):
        result: list[str] = []
        for item in value:
            text = coerce_str(item)
            if text:
                result.append(text)
        return result
    return []


def coerce_float(value: Any, *, default: float | None = None) -> float | None:
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        match = re.search(r"-?\d+(?:\.\d+)?", value)
        if match:
            try:
                return float(match.group())
            except ValueError:
                return default
    return default


def coerce_int(value: Any, *, default: int | None = None) -> int | None:
    parsed = coerce_float(value)
    if parsed is None:
        return default
    return int(round(parsed))


def normalize_name(value: str) -> str:
    """名称归一：去空白、全角转半角、统一小写，用于去重与合并。"""
    text = str(value or "").strip()
    if not text:
        return ""
    text = text.translate(_FULLWIDTH_TABLE)
    text = re.sub(r"\s+", "", text)
    return text.lower()


def _build_fullwidth_table() -> dict[int, int]:
    table: dict[int, int] = {}
    for code in range(0xFF01, 0xFF5F):
        table[code] = code - 0xFEE0
    table[0x3000] = 0x20
    return table


_FULLWIDTH_TABLE = _build_fullwidth_table()
