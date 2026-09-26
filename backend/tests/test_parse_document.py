"""剧本文档解析端点的回归测试（TXT / MD / DOCX）。

重点：
1. TXT / MD / DOCX 都能解析出纯文本；
2. 旧版 `.doc` **明确拒绝**并提示「请另存为 DOCX」，绝不静默返回空文本；
3. 该端点**不写库、不落盘、不上传对象存储**：路由上没有任何 `get_db` 依赖
   （结构性断言），因此也不会被付费出口守卫拦住；
4. 边界：空文件 400、超大文件 413、坏 DOCX 400、不支持的后缀 400。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.api.v1.routes.studio import documents
from app.main import app

PARSE_URL = "/api/v1/studio/documents/parse"

DOCX_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def build_docx(paragraphs: list[str]) -> bytes:
    """用标准库造一个最小 DOCX（不引入任何依赖）。"""
    body = "".join(
        f'<w:p><w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>' for text in paragraphs
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{DOCX_NS}"><w:body>{body}</w:body></w:document>'
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


def _post(filename: str, payload: bytes) -> object:
    with TestClient(app) as client:
        return client.post(
            PARSE_URL,
            files={"file": (filename, payload, "application/octet-stream")},
        )


def test_parse_txt_utf8() -> None:
    text = "第一场 咖啡馆内 夜\n林小满推门而入。"
    response = _post("script.txt", text.encode("utf-8"))
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["format"] == "txt"
    assert data["text"] == text
    assert data["char_count"] == len(text)
    assert data["paragraph_count"] == 2


def test_parse_txt_with_bom_and_crlf() -> None:
    """带 BOM 与 CRLF 的 TXT 也要干净解析（BOM 不进正文、换行归一化）。"""
    response = _post("bom.txt", "\ufeff第一行\r\n第二行\r\n".encode("utf-8"))
    assert response.status_code == 200
    assert response.json()["data"]["text"] == "第一行\n第二行"


def test_parse_markdown() -> None:
    response = _post("story.md", "# 标题\n\n**正文**".encode("utf-8"))
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["format"] == "md"
    assert "# 标题" in data["text"]


def test_parse_docx() -> None:
    payload = build_docx(["第一集 雨夜咖啡店", "林小满推门而入，雨水顺着伞沿滴落。", ""])
    response = _post("剧本.docx", payload)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["format"] == "docx"
    assert data["text"].split("\n")[0] == "第一集 雨夜咖啡店"
    assert "林小满推门而入" in data["text"]
    assert data["paragraph_count"] == 2


def test_legacy_doc_is_rejected_with_clear_hint() -> None:
    """旧版 .doc：明确提示「另存为 DOCX」，不静默失败、不返回空文本。"""
    response = _post("老剧本.doc", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1binary-doc")
    assert response.status_code == 400
    detail = response.json()["message"]
    assert "DOCX" in detail
    assert "另存为" in detail


def test_broken_docx_is_rejected() -> None:
    response = _post("broken.docx", b"this is not a zip at all")
    assert response.status_code == 400
    assert "DOCX" in response.json()["message"]


def test_unsupported_extension_is_rejected() -> None:
    response = _post("script.pdf", b"%PDF-1.4")
    assert response.status_code == 400
    assert "TXT" in response.json()["message"]


def test_empty_file_is_rejected() -> None:
    response = _post("empty.txt", b"")
    assert response.status_code == 400
    assert "空" in response.json()["message"]


def test_oversized_file_is_rejected() -> None:
    big = b"a" * (documents.MAX_DOCUMENT_BYTES + 1)
    response = _post("huge.txt", big)
    assert response.status_code == 413


def test_endpoint_has_no_db_or_guard_dependencies() -> None:
    """结构性保证：解析端点不依赖数据库、也不挂付费出口守卫。

    这是「不写库、不上传对象存储、DRY_RUN 下也能用」的机器可验证版本。
    """
    specs = [route for route in app.routes if getattr(route, "path", "") == PARSE_URL]
    assert len(specs) == 1, f"应只注册一个 {PARSE_URL}"
    dependant = specs[0].dependant  # type: ignore[attr-defined]
    assert dependant.dependencies == [], "解析端点不应声明任何依赖（含 get_db 与门禁守卫）"

    # 源码里不得出现存储/上传调用（防止以后有人偷偷加回来）
    source = Path(documents.__file__).read_text(encoding="utf-8")
    for forbidden in ("storage", "upload", "guarded_upload", "session.add", "db.commit"):
        assert forbidden not in source, f"文档解析不应出现 {forbidden!r}"
