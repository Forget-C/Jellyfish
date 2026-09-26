"""``msgpack_lite`` 解码器测试。

上游（巨日禄第二步 getStoryboardPage）把 records 用 msgpack 序列化后 base64 塞进
``data.payload``；环境里**没有装 msgpack**，所以这个解码器是纯标准库实现，
测试里自带一个**最小编码器**来造夹具（不引入任何第三方依赖）。
"""

from __future__ import annotations

import struct

import pytest

from app.services.external import msgpack_lite as ml


# ---------- 测试用最小编码器（只覆盖断言用到的类型） ----------


def _enc(obj) -> bytes:  # noqa: ANN001
    if obj is None:
        return b"\xc0"
    if obj is True:
        return b"\xc3"
    if obj is False:
        return b"\xc2"
    if isinstance(obj, int):
        if 0 <= obj <= 0x7F:
            return bytes([obj])
        if -32 <= obj < 0:
            return bytes([obj & 0xFF])
        if 0 <= obj <= 0xFF:
            return b"\xcc" + obj.to_bytes(1, "big")
        if 0 <= obj <= 0xFFFF:
            return b"\xcd" + obj.to_bytes(2, "big")
        if obj >= 0:
            return b"\xce" + obj.to_bytes(4, "big")
        return b"\xd0" + (obj & 0xFF).to_bytes(1, "big")
    if isinstance(obj, float):
        return b"\xcb" + struct.pack(">d", obj)
    if isinstance(obj, str):
        raw = obj.encode("utf-8")
        if len(raw) <= 31:
            return bytes([0xA0 | len(raw)]) + raw
        if len(raw) <= 0xFF:
            return b"\xd9" + bytes([len(raw)]) + raw
        return b"\xda" + len(raw).to_bytes(2, "big") + raw
    if isinstance(obj, (bytes, bytearray)):
        raw = bytes(obj)
        return b"\xc4" + bytes([len(raw)]) + raw
    if isinstance(obj, list):
        if len(obj) <= 15:
            return bytes([0x90 | len(obj)]) + b"".join(_enc(v) for v in obj)
        return b"\xdc" + len(obj).to_bytes(2, "big") + b"".join(_enc(v) for v in obj)
    if isinstance(obj, dict):
        if len(obj) <= 15:
            head = bytes([0x80 | len(obj)])
        else:
            head = b"\xde" + len(obj).to_bytes(2, "big")
        return head + b"".join(_enc(k) + _enc(v) for k, v in obj.items())
    raise TypeError(f"编码器不支持 {type(obj)}")


def test_scalars_roundtrip() -> None:
    assert ml.loads(_enc(None)) is None
    assert ml.loads(_enc(True)) is True
    assert ml.loads(_enc(False)) is False
    assert ml.loads(_enc(0)) == 0
    assert ml.loads(_enc(127)) == 127
    assert ml.loads(_enc(-1)) == -1
    assert ml.loads(_enc(-32)) == -32
    assert ml.loads(_enc(200)) == 200
    assert ml.loads(_enc(70000)) == 70000
    assert ml.loads(_enc(3_000_000_000)) == 3_000_000_000
    assert ml.loads(_enc(1.5)) == 1.5


def test_strings_binary_and_big_arrays() -> None:
    assert ml.loads(_enc("短")) == "短"
    assert ml.loads(_enc("records")) == "records"
    long_text = "x" * 300
    assert ml.loads(_enc(long_text)) == long_text
    assert ml.loads(_enc(b"\x01\x02\x03")) == b"\x01\x02\x03"
    big = list(range(20))
    assert ml.loads(_enc(big)) == big


def test_nested_map_like_real_storyboard_payload() -> None:
    """真实形状：{"records": [{...,"prompt": "..."}]}。"""
    payload = {
        "records": [
            {"id": 113315317, "scriptId": "2936083", "sbid": "S1", "seqNum": 1,
             "description": "薄雾山路", "prompt": "镜头提示词一", "duration": 5},
            {"id": 113315318, "scriptId": "2936083", "sbid": "S2", "seqNum": 2,
             "description": "Rose 旁白", "prompt": "镜头提示词二"},
        ]
    }
    decoded = ml.loads(_enc(payload))
    assert decoded == payload
    assert decoded["records"][0]["prompt"] == "镜头提示词一"


def test_map16_and_utf8_keys() -> None:
    payload = {f"键{i}": i for i in range(20)}
    assert ml.loads(_enc(payload)) == payload


def test_ext_type_is_kept_not_dropped() -> None:
    # fixext4（0xd6）：类型码 + 4 字节
    value = ml.loads(b"\xd6\x05" + b"\x00\x01\x02\x03")
    assert value == {"__ext__": 5, "data": b"\x00\x01\x02\x03"}


def test_truncated_payload_raises_instead_of_returning_half_data() -> None:
    blob = _enc({"records": [{"prompt": "x" * 40}]})
    with pytest.raises(ml.MsgpackError):
        ml.loads(blob[:-5])


def test_empty_payload_raises() -> None:
    with pytest.raises(ml.MsgpackError):
        ml.loads(b"")
    with pytest.raises(ml.MsgpackError):
        ml.loads("不是 bytes")  # type: ignore[arg-type]


def test_unknown_marker_raises() -> None:
    with pytest.raises(ml.MsgpackError):
        ml.loads(b"\xc1")  # 0xc1 是 msgpack 规范里未使用的标记


def test_non_hashable_map_key_raises_clearly() -> None:
    # map(1) { [1] : "v" } —— 键是 list，不可哈希
    blob = b"\x81" + _enc([1]) + _enc("v")
    with pytest.raises(ml.MsgpackError):
        ml.loads(blob)


def test_strict_tail_and_span_helper() -> None:
    blob = _enc("ab") + b"\x01"
    assert ml.loads(blob) == "ab"  # 默认宽容
    with pytest.raises(ml.MsgpackError):
        ml.loads(blob, strict_tail=True)
    value, consumed = ml.loads_with_span(blob)
    assert (value, consumed) == ("ab", 3)


def test_deep_nesting_is_rejected() -> None:
    blob = b"\x91" * 200 + b"\xc0"
    with pytest.raises(ml.MsgpackError):
        ml.loads(blob)
