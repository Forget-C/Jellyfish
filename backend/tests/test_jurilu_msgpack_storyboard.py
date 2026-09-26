"""巨日禄第二步 ``getStoryboardPage`` 的 **msgpack 载荷**解析测试。

真实故障（2026-09-20 真实验收，用户点了一次「获取整集提示词」）：
    三个 scriptId 的 getStoryboardPage **全部 HTTP 200**，响应是
    ``{"code":0,"message":"success","data":{"enc":"msgpack","payload":"<base64>"}}``
    —— 记录被 msgpack 序列化后 base64 塞在 ``data.payload``。
    当时解析器只认 ``data.records``，于是三个都「解析出 0 条」，
    页面提示写成「接口阶段 getScriptPage｜HTTP 200」，看着像接口拒绝，
    实际是**有数据没识别**。

这组用例把「能自己解出来」和「解不出来时必须如实说清形状」两边都钉住。
"""

from __future__ import annotations

import base64
import json
import struct

from app.services.external import jurilu_agent_import as jurilu

COOKIE = "Authorization=abc.def.ghi; ph_phc_demo=1"


def _enc(obj) -> bytes:  # noqa: ANN001 —— 测试用最小编码器（环境没有 msgpack）
    if obj is None:
        return b"\xc0"
    if isinstance(obj, bool):
        return b"\xc3" if obj else b"\xc2"
    if isinstance(obj, int):
        if 0 <= obj <= 0x7F:
            return bytes([obj])
        if -32 <= obj < 0:
            return bytes([obj & 0xFF])
        if 0 <= obj <= 0xFFFF:
            return b"\xcd" + obj.to_bytes(2, "big")
        return b"\xce" + obj.to_bytes(4, "big")
    if isinstance(obj, float):
        return b"\xcb" + struct.pack(">d", obj)
    if isinstance(obj, str):
        raw = obj.encode("utf-8")
        if len(raw) <= 31:
            return bytes([0xA0 | len(raw)]) + raw
        if len(raw) <= 0xFF:
            return b"\xd9" + bytes([len(raw)]) + raw
        return b"\xda" + len(raw).to_bytes(2, "big") + raw
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


def _msgpack_envelope(records) -> str:  # noqa: ANN001
    payload = base64.b64encode(_enc({"records": records})).decode()
    return json.dumps(
        {"code": 0, "message": "success", "data": {"enc": "msgpack", "payload": payload}},
        ensure_ascii=False,
    )


RECORDS = [
    {
        "id": 113315317, "userId": "73646", "uid": "2274541435908873296",
        "scriptId": "2936083", "projectId": "163260", "clipId": "3277394",
        "sbid": "S1", "seqNum": 1,
        "description": "薄雾山路Vivian夜攀摔落，Rose旁白交代弱点",
        "prompt": "镜头提示词：薄雾山路，Vivian 夜攀摔落，特写手指抓岩",
        "modelName": "seedance-2.0-mini", "duration": 5, "aspectRatio": "16:9",
    },
    {
        "id": 113315318, "scriptId": "2936083", "sbid": "S2", "seqNum": 2,
        "description": "Rose 旁白", "prompt": "镜头提示词二：Rose 站在雨里",
    },
]


def test_msgpack_payload_records_are_parsed() -> None:
    """真实形状：msgpack 载荷里的 records 必须能解析出来。"""
    text = _msgpack_envelope(RECORDS)
    records = jurilu._extract_records_from_response(text)
    assert len(records) == 2
    assert records[0]["prompt"].startswith("镜头提示词")


def test_storyboard_records_are_normalized_from_msgpack() -> None:
    """规范化的分镜记录：agent_name / prompt_text / sbid / seqNum 都对。"""
    text = _msgpack_envelope(RECORDS)
    out = jurilu._extract_storyboard_records(text, "2936083", "第1集", 1)
    assert len(out) == 2
    first = out[0]
    assert first["agent_name"] == "EP01｜第1集｜分镜 S1"
    assert first["prompt_text"] == RECORDS[0]["prompt"]
    assert first["sbid"] == "S1"
    assert first["seqNum"] == "1"
    assert first["source_script_id"] == "2936083"
    assert first["scriptId"] == "2936083"
    assert first["modelName"] == "seedance-2.0-mini"


def test_plain_json_still_works() -> None:
    """第一步那种普通 JSON（data.records）不受影响。"""
    text = json.dumps({"code": 0, "data": {"records": RECORDS}}, ensure_ascii=False)
    assert len(jurilu._extract_records_from_response(text)) == 2


def test_describe_payload_shape_tells_msgpack_from_empty() -> None:
    """诊断要能区分「有数据没识别」和「接口真 0 条」，且只报字段名与计数。"""
    shape = jurilu.describe_payload_shape(_msgpack_envelope(RECORDS))
    assert "msgpack" in shape["encodings"]
    assert shape["declared_encodings"] == ["msgpack"]
    assert shape["decode_errors"] == []
    assert shape["record_counts"]["msgpack"] == 2
    keys = shape["record_keys"]["msgpack"]
    assert "prompt" in keys and "sbid" in keys
    blob = json.dumps(shape, ensure_ascii=False)
    assert RECORDS[0]["prompt"] not in blob, "诊断不能把正文整段带出来"
    assert "abc.def.ghi" not in blob

    empty = jurilu.describe_payload_shape('{"code":0,"data":{"records":[]}}')
    assert empty["record_counts"] == {}, "真 0 条时不该谎报有记录"


def test_unknown_encoding_is_reported_not_guessed() -> None:
    """未知编码（例如 protobuf）不解码、不猜，但要把编码名如实报出来。"""
    text = json.dumps({"code": 0, "data": {"enc": "protobuf", "payload": "AAAA"}})
    assert jurilu._extract_records_from_response(text) == []
    shape = jurilu.describe_payload_shape(text)
    assert shape["encodings"] == ["json"]
    assert shape["declared_encodings"] == ["protobuf"], "未知编码要如实报出来"
    assert shape["unsupported_encodings"] == ["protobuf"]
    assert shape["decode_errors"] == [], "不认识 ≠ 我们解不开，两者不能混"
    enc, decoded = jurilu.decode_encoded_payload(json.loads(text))
    assert enc == "protobuf" and decoded is None


def test_broken_base64_does_not_crash() -> None:
    """载荷坏掉时不能抛异常炸掉整条链路，只能少这一条并留证。"""
    text = json.dumps({"code": 0, "data": {"enc": "msgpack", "payload": "!!!!"}})
    assert jurilu._extract_records_from_response(text) == []
    shape = jurilu.describe_payload_shape(text)
    assert shape["record_counts"] == {}
    assert shape["decode_errors"] == ["msgpack"], "解不开必须报出来，不能装作 0 条"


def test_truncated_msgpack_payload_is_not_half_parsed() -> None:
    """被截断的 msgpack 不能「解一半就当成功」。"""
    good = base64.b64encode(_enc({"records": RECORDS})).decode()
    text = json.dumps({"code": 0, "data": {"enc": "msgpack", "payload": good[:-8]}})
    assert jurilu._extract_records_from_response(text) == []
    assert jurilu.describe_payload_shape(text)["decode_errors"] == ["msgpack"]


def test_storyboard_attempt_diagnostics_include_payload_shape(monkeypatch) -> None:
    """两步流程里，第二步解析 0 条时要把载荷形状写进 storyboard_attempts。"""

    class _Resp:
        status = 200

        def __init__(self, body: str) -> None:
            self._body = body.encode("utf-8")
            self.headers = type("H", (), {"get": staticmethod(lambda *a, **k: "application/json")})()

        def read(self) -> bytes:
            return self._body

        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, *args):  # noqa: ANN002, ANN204
            return False

    def fake_urlopen(request, timeout=None):  # noqa: ANN001, ANN202
        url = request.full_url
        if "getScriptPage" in url:
            return _Resp(json.dumps({"code": 0, "data": {"records": [{"id": 2936083, "title": "第1集"}]}}))
        # 第二步：故意返回一个**坏掉**的 msgpack，制造「0 条」，看是否留证
        broken = base64.b64encode(b"\x92\x01").decode()
        return _Resp(json.dumps({"code": 0, "data": {"enc": "msgpack", "payload": broken}}))

    monkeypatch.setattr(jurilu.urllib.request, "urlopen", fake_urlopen)
    result = jurilu.fetch_all_storyboards(
        source_url="https://video.jurilu.com/project_management/project_page/snippets/material_list"
        "?projectId=163260&clipId=3277394",
        cookie_text=COOKIE,
        authorization="",
        referer="",
    )
    assert result["ok"] is False
    attempts = result["diagnostics"]["storyboard_attempts"]
    assert attempts[0]["status"] == 200
    assert attempts[0]["parsed_count"] == 0
    shape = attempts[0]["payload_shape"]
    assert shape["declared_encodings"] == ["msgpack"]
    assert shape["decode_errors"] == ["msgpack"]
    assert "abc.def.ghi" not in json.dumps(result["diagnostics"], ensure_ascii=False)
