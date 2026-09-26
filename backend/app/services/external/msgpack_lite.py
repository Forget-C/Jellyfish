"""msgpack 最小解码器（**纯标准库**，不引入第三方依赖）。

为什么需要它（2026-09-20 真实踩到）：
    巨日禄第二步 ``getStoryboardPage`` 返回的是
    ``{"code":0,"message":"success","data":{"enc":"msgpack","payload":"<base64>"}}``
    —— 记录被 msgpack 序列化后 base64 塞在 ``data.payload`` 里。原来的解析器只认
    ``data.records``，于是三个 scriptId 全部「解析出 0 条」，日志里看着像接口拒绝，
    实际上是**有数据没识别**。本模块只负责把这段载荷解出来。

为什么自己写（而不是 pip install msgpack）：
    本模块所在的 ``jurilu_agent_import`` 明确「零第三方依赖、纯 stdlib」，且引入新依赖
    需要用户批准。这里的解码需求很小（JSON 兼容的那几类），自己写反而更好审计。

支持的类型：nil / bool / 整数（含大整数）/ 浮点 / str / bin / array / map / ext。
遇到 ext 当作 ``{"__ext__": <type>, "data": <bytes>}`` 返回（本用途用不到，但不丢信息）。
截断或非法的输入一律抛 :class:`MsgpackError`，绝不静默返回半截数据。
"""

from __future__ import annotations

import struct
from typing import Any, Tuple

__all__ = ["MsgpackError", "loads"]


class MsgpackError(ValueError):
    """msgpack 载荷非法或截断。"""


class _Reader:
    __slots__ = ("_data", "_pos")

    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    @property
    def pos(self) -> int:
        return self._pos

    def take(self, size: int) -> bytes:
        end = self._pos + size
        if size < 0 or end > len(self._data):
            raise MsgpackError(f"载荷在第 {self._pos} 字节处截断（还需要 {size} 字节）")
        chunk = self._data[self._pos:end]
        self._pos = end
        return chunk

    def byte(self) -> int:
        return self.take(1)[0]

    def uint(self, size: int) -> int:
        return int.from_bytes(self.take(size), "big", signed=False)

    def sint(self, size: int) -> int:
        return int.from_bytes(self.take(size), "big", signed=True)

    def text(self, size: int) -> str:
        return self.take(size).decode("utf-8", "replace")


_UINT_SIZES = {0xCC: 1, 0xCD: 2, 0xCE: 4, 0xCF: 8}
_INT_SIZES = {0xD0: 1, 0xD1: 2, 0xD2: 4, 0xD3: 8}
_FLOAT_SIZES = {0xCA: 4, 0xCB: 8}
_BIN_SIZES = {0xC4: 1, 0xC5: 2, 0xC6: 4}
_STR_SIZES = {0xD9: 1, 0xDA: 2, 0xDB: 4}
_ARRAY_SIZES = {0xDC: 2, 0xDD: 4}
_MAP_SIZES = {0xDE: 2, 0xDF: 4}
_EXT_SIZES = {0xD4: 1, 0xD5: 2, 0xD6: 4, 0xD7: 8, 0xD8: 16}
_EXT_LEN_SIZES = {0xC7: 1, 0xC8: 2, 0xC9: 4}


def _read_value(reader: _Reader, depth: int) -> Any:
    # msgpack 是一张**标记表**：一个标记一个 return 最好读，拆开反而看不清格式全景
    # pylint: disable=too-many-return-statements
    if depth > 64:
        raise MsgpackError("嵌套过深（疑似非法载荷）")
    marker = reader.byte()

    if marker <= 0x7F:
        return marker
    if marker >= 0xE0:
        return marker - 0x100
    if 0xA0 <= marker <= 0xBF:
        return reader.text(marker & 0x1F)
    if 0x90 <= marker <= 0x9F:
        return [_read_value(reader, depth + 1) for _ in range(marker & 0x0F)]
    if 0x80 <= marker <= 0x8F:
        return _read_map(reader, depth, marker & 0x0F)

    if marker == 0xC0:
        return None
    if marker == 0xC2:
        return False
    if marker == 0xC3:
        return True
    if marker in _UINT_SIZES:
        return reader.uint(_UINT_SIZES[marker])
    if marker in _INT_SIZES:
        return reader.sint(_INT_SIZES[marker])
    if marker in _FLOAT_SIZES:
        raw = reader.take(_FLOAT_SIZES[marker])
        return struct.unpack(">f" if marker == 0xCA else ">d", raw)[0]
    if marker in _STR_SIZES:
        return reader.text(reader.uint(_STR_SIZES[marker]))
    if marker in _BIN_SIZES:
        return reader.take(reader.uint(_BIN_SIZES[marker]))
    if marker in _ARRAY_SIZES:
        return [
            _read_value(reader, depth + 1)
            for _ in range(reader.uint(_ARRAY_SIZES[marker]))
        ]
    if marker in _MAP_SIZES:
        return _read_map(reader, depth, reader.uint(_MAP_SIZES[marker]))
    if marker in _EXT_SIZES:
        return _read_ext(reader, _EXT_SIZES[marker])
    if marker in _EXT_LEN_SIZES:
        return _read_ext(reader, reader.uint(_EXT_LEN_SIZES[marker]))
    raise MsgpackError(f"未知的 msgpack 标记 0x{marker:02X}")


def _read_map(reader: _Reader, depth: int, size: int) -> dict:
    result: dict = {}
    for _ in range(size):
        key = _read_value(reader, depth + 1)
        try:
            result[key] = _read_value(reader, depth + 1)
        except TypeError as exc:  # 不可哈希的键（例如 list）→ 明确报错，别丢数据
            raise MsgpackError(f"map 的键不可哈希：{key!r}") from exc
    return result


def _read_ext(reader: _Reader, size: int) -> dict:
    ext_type = reader.sint(1)
    return {"__ext__": ext_type, "data": reader.take(size)}


def loads(data: bytes, *, strict_tail: bool = False) -> Any:
    """把 msgpack 字节解成 Python 对象。

    Args:
        data: msgpack 字节。
        strict_tail: 为 True 时，解完第一个对象后还有剩余字节就报错。
            默认 False（上游可能在后面追加别的帧，宽容一点，但绝不返回半截数据）。

    Raises:
        MsgpackError: 载荷截断、标记未知或尾随字节（strict 模式）。
    """
    if not isinstance(data, (bytes, bytearray, memoryview)):
        raise MsgpackError("msgpack 载荷必须是 bytes")
    blob = bytes(data)
    if not blob:
        raise MsgpackError("msgpack 载荷为空")
    reader = _Reader(blob)
    value = _read_value(reader, 0)
    if strict_tail and reader.pos != len(blob):
        raise MsgpackError(f"解出对象后还有 {len(blob) - reader.pos} 字节未消费")
    return value


def loads_with_span(data: bytes) -> Tuple[Any, int]:
    """解出第一个对象并返回 ``(对象, 已消费字节数)``，便于诊断「还剩多少」。"""
    blob = bytes(data or b"")
    if not blob:
        raise MsgpackError("msgpack 载荷为空")
    reader = _Reader(blob)
    return _read_value(reader, 0), reader.pos
