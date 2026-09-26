"""剧本文档解析（TXT / MD / DOCX → 纯文本）。

产品背景：「从剧本开始」的项目需要把已有剧本文件导进章节，而不是只能手动粘贴。

设计要点：
1. **只解析、不落盘、不写库、不上传对象存储**。这是一个纯函数式的读取端点，
   因此不需要付费出口守卫（不会调用任何外部服务，也不产生费用）。
2. DOCX 用**标准库**解析（DOCX 就是一个 zip，正文在 `word/document.xml`），
   不引入新依赖：逐个 `<w:p>` 段落取 `<w:t>` 文本。
3. 旧版 `.doc` 是二进制复合文档，无法可靠解析 —— 明确返回 400 并提示
   「请另存为 DOCX」，绝不静默返回空文本。
"""

from __future__ import annotations

import io
import zipfile
from xml.etree import ElementTree

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.documents import DocumentParseRead

router = APIRouter()

#: 单次解析的大小上限（剧本文件足够大，但不接受超大文件把内存打满）。
MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

#: DOCX 里正文所在的位置。
DOCX_DOCUMENT_XML = "word/document.xml"

#: WordprocessingML 命名空间。
_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

TEXT_EXTENSIONS = {"txt", "md", "markdown"}
DOCX_EXTENSIONS = {"docx"}
LEGACY_DOC_EXTENSIONS = {"doc"}

LEGACY_DOC_HINT = "旧版 .doc（二进制格式）无法可靠解析，请在 Word / WPS 里「另存为 DOCX」后重新导入。"
UNSUPPORTED_HINT = "暂不支持该文件类型；请导入 TXT、MD 或 DOCX 文件。"


def _extension(filename: str) -> str:
    name = (filename or "").strip().lower()
    _, _, tail = name.rpartition(".")
    return tail if tail and tail != name else ""


def _decode_text(raw: bytes) -> tuple[str, list[str]]:
    """按常见编码尝试解码，返回文本与告警。"""
    warnings: list[str] = []
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            text = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        if encoding != "utf-8-sig":
            warnings.append(f"文件按 {encoding} 解码（不是 UTF-8），如有乱码请另存为 UTF-8 后重试。")
        return text, warnings
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="无法识别文件编码（已尝试 UTF-8 / GB18030）。请另存为 UTF-8 编码的 TXT 后重试。",
    )


def extract_docx_text(raw: bytes) -> str:
    """从 DOCX 字节里取正文纯文本（标准库实现，无第三方依赖）。"""
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if DOCX_DOCUMENT_XML not in archive.namelist():
                raise KeyError(DOCX_DOCUMENT_XML)
            xml_bytes = archive.read(DOCX_DOCUMENT_XML)
    except (zipfile.BadZipFile, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "文件不是有效的 DOCX（无法作为 zip 打开或缺少 word/document.xml）。"
                "如果它其实是老版 .doc，请另存为 DOCX 后重试。"
            ),
        ) from exc

    try:
        root = ElementTree.fromstring(xml_bytes)
    except ElementTree.ParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="DOCX 正文 XML 解析失败，文件可能已损坏。",
        ) from exc

    paragraphs: list[str] = []
    for paragraph in root.iter(f"{_W_NS}p"):
        pieces: list[str] = []
        for node in paragraph.iter():
            if node.tag == f"{_W_NS}t" and node.text:
                pieces.append(node.text)
            elif node.tag == f"{_W_NS}tab":
                pieces.append("\t")
            elif node.tag == f"{_W_NS}br":
                pieces.append("\n")
        paragraphs.append("".join(pieces))
    # 段落之间用换行分隔；结尾去掉多余空行，保持与「粘贴文本」一致的形态。
    return "\n".join(paragraphs).strip("\n")


@router.post(
    "/parse",
    response_model=ApiResponse[DocumentParseRead],
    summary="解析剧本文档（TXT / MD / DOCX）为纯文本",
)
async def parse_document(file: UploadFile = File(..., description="TXT / MD / DOCX 文件")) -> ApiResponse[DocumentParseRead]:
    """把上传的剧本文档解析成纯文本。

    只读取上传内容并解析，**不写库、不上传对象存储、不调用任何外部服务**。
    """
    raw = await file.read()
    if len(raw) == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件内容为空，请检查后重试。")
    if len(raw) > MAX_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"文件超过 {MAX_DOCUMENT_BYTES // (1024 * 1024)} MB 上限，请拆分后再导入。",
        )

    filename = file.filename or "未命名文件"
    ext = _extension(filename)
    warnings: list[str] = []

    if ext in LEGACY_DOC_EXTENSIONS:
        # 明确提示，不静默失败、不返回空文本。
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=LEGACY_DOC_HINT)
    if ext in TEXT_EXTENSIONS:
        text, decode_warnings = _decode_text(raw)
        warnings.extend(decode_warnings)
        fmt = "md" if ext in {"md", "markdown"} else "txt"
    elif ext in DOCX_EXTENSIONS:
        text = extract_docx_text(raw)
        fmt = "docx"
        if not text.strip():
            warnings.append("DOCX 里没有解析到任何文字：如果正文在文本框/图片里，请改为粘贴文本。")
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNSUPPORTED_HINT)

    # 换行归一化 + 去掉首尾空行：粘贴进章节的内容不该带一串空行（DOCX 分支同样处理）
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    return success_response(
        DocumentParseRead(
            filename=filename,
            format=fmt,
            text=text,
            char_count=len(text),
            paragraph_count=len([line for line in text.split("\n") if line.strip()]),
            warnings=warnings,
        )
    )
