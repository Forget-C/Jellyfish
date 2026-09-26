from __future__ import annotations

"""文件相关工具：从 URL 或 base64 内容创建 FileItem，并上传到对象存储。"""

import base64
import mimetypes
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.models.studio import FileItem, FileType
from app.models.types import FileUsageKind
from app.services import paid_outlet_guard


# 后缀 → 类型。音频此前被漏掉，一律落到「默认 image」，于是声音绑定（要求
# ``files.type=audio``）永远拿不到正确类型；这里补齐。
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
_VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
_AUDIO_EXTENSIONS = {
    ".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma", ".aiff", ".aif",
}


async def _infer_file_type_from_ext(ext: str) -> FileType:
    ext = ext.lower()
    if ext in _IMAGE_EXTENSIONS:
        return FileType.image
    if ext in _VIDEO_EXTENSIONS:
        return FileType.video
    if ext in _AUDIO_EXTENSIONS:
        return FileType.audio
    # 默认按图片处理，调用方若有更精细需求可在外层再封装
    return FileType.image


@dataclass(frozen=True)
class FileUsageCreateParams:
    """创建 FileItem 后写入 file_usages 的参数。"""

    project_id: str
    chapter_id: str | None = None
    shot_id: str | None = None
    usage_kind: FileUsageKind | str = FileUsageKind.api
    source_ref: str | None = None


async def _infer_file_type_from_content_type(content_type: str | None) -> FileType:
    if not content_type:
        return FileType.image
    ct = content_type.lower()
    if ct.startswith("image/"):
        return FileType.image
    if ct.startswith("video/"):
        return FileType.video
    if ct.startswith("audio/") or ct in {"application/ogg", "application/octet-stream+audio"}:
        return FileType.audio
    return FileType.image


async def create_file_from_url_or_b64(
    session: AsyncSession,
    *,
    url: str | None = None,
    b64_data: str | None = None,
    name: str | None = None,
    prefix: str = "files",
    url_request_headers: dict[str, str] | None = None,
    httpx_timeout: float | None = None,
    usage: FileUsageCreateParams | None = None,
) -> FileItem:
    """从远端 URL 或 base64 内容创建 FileItem。

    - 若提供 url：会先下载内容，推断 content_type 和后缀；
    - 若提供 b64_data：优先解析 data URL 前缀中的 MIME 类型，否则默认 image/png；
    - 始终通过 storage.upload_file 上传到对象存储，再创建 FileItem 记录并返回。
    - url_request_headers / httpx_timeout：用于需鉴权或大文件下载（如 OpenAI /videos/{id}/content）。

    **付费出口守卫（oss）**：这里最终会走 ``storage.upload_file`` 真实写对象存储，
    属于「对象存储上传」出口，与出图 / 出视频 / 大模型共用**同一套**闸门
    （``paid_outlet_guard.require_outlet``）。演练模式（默认）下**不下载、不上传、
    不落库**，直接结构化 409（判定在下载之前，演练模式零出站）；本地驱动
    （``is_local_storage()``）是本地落盘而不是 OSS 上传，不走这道闸门。
    """
    if not url and not b64_data:
        raise ValueError("create_file_from_url_or_b64 需要提供 url 或 b64_data 至少其一")

    if not storage.is_local_storage():
        paid_outlet_guard.require_outlet(
            "把远端 / 生成的素材落库到对象存储（会真实写入 OSS）",
            outlet=paid_outlet_guard.OUTLET_OSS,
        )

    content: bytes
    content_type: str | None = None
    filename: str = ""

    if url:
        client_kwargs: dict = {}
        if httpx_timeout is not None:
            client_kwargs["timeout"] = httpx_timeout
        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.get(url, headers=url_request_headers or None)
            resp.raise_for_status()
            content = resp.content
            content_type = resp.headers.get("Content-Type")

        # 从 URL 推断文件名
        path = Path(httpx.URL(url).path)
        filename = path.name or "file"
    else:
        raw = b64_data or ""
        # 支持 data URL 形式：data:image/png;base64,xxxxxx
        if raw.startswith("data:") and ";base64," in raw:
            header, encoded = raw.split(";base64,", 1)
            # 形如 data:image/png
            mime = header[5:]
            content_type = mime or "image/png"
            content = base64.b64decode(encoded)
        else:
            content_type = "image/png"
            content = base64.b64decode(raw)

        filename = "image.png"

    # 推断扩展名和 FileType
    _, ext = os.path.splitext(filename)
    file_type = await _infer_file_type_from_content_type(content_type)
    if not ext:
        # 根据类型给一个默认后缀
        ext = ".png" if file_type == FileType.image else ".mp4"

    display_name = name or os.path.splitext(filename)[0] or filename

    key = f"{prefix}/{uuid.uuid4().hex}{ext}"
    info = await storage.upload_file(
        key=key,
        data=content,
        content_type=content_type,
        extra_args={"ACL": "public-read"},
    )

    file_id = str(uuid.uuid4())
    file_obj = FileItem(
        id=file_id,
        type=file_type,
        name=display_name,
        thumbnail=info.url,
        tags=[],
        storage_key=key,
    )
    session.add(file_obj)
    await session.flush()
    await session.refresh(file_obj)

    if usage is not None:
        from app.services.studio.file_usages import upsert_file_usage

        await upsert_file_usage(
            session,
            file_id=file_obj.id,
            project_id=usage.project_id,
            chapter_id=usage.chapter_id,
            shot_id=usage.shot_id,
            usage_kind=usage.usage_kind,
            source_ref=usage.source_ref,
        )

    return file_obj


# ---------------------------------------------------------------------------
# file_id → 供应商可用的图片地址
# ---------------------------------------------------------------------------

# storage_key 是这些前缀时，说明这条 FileItem 指向的是**已经公网可达**的地址
# （外链登记的素材、或历史迁移进来的 OSS 资产），不需要也不应该再去本地存储目录里找。
PUBLIC_STORAGE_PREFIXES: tuple[str, ...] = ("http://", "https://", "asset://")

# 供应商接受的图片引用前缀（与 PUBLIC_STORAGE_PREFIXES 同义；单独命名是为了在
# "供应商能不能用"这层语义上有一个明确的名字，APIMart 官方报错原文：
# ``Only http/https URLs or asset:// private asset URLs are supported``）。
VENDOR_ACCEPTED_IMAGE_PREFIXES: tuple[str, ...] = PUBLIC_STORAGE_PREFIXES


def is_public_storage_key(storage_key: str | None) -> bool:
    """storage_key 是否为公网地址（而不是本地存储的相对路径）。"""
    return str(storage_key or "").strip().lower().startswith(PUBLIC_STORAGE_PREFIXES)


# 哪些供应商适配器接受 base64 data URL。APIMart 明确拒绝；openai / volcengine 接受。
# 表里没有的供应商一律按"不接受"处理（宁可在提交前拦下，也不要发出去才发现）。
_VENDOR_DATA_URL_SUPPORT: dict[str, bool] = {
    "apimart": False,
    "openai": True,
    "volcengine": True,
}

_VENDOR_LABELS: dict[str, str] = {
    "apimart": "APIMart",
    "openai": "OpenAI",
    "volcengine": "火山引擎",
}

# 特殊取值：调用方只想要一个"能打开的地址"（不关心供应商能不能用），例如出图参考图。
VENDOR_ACCEPTING_ANY = "__any__"


def vendor_label(vendor: str | None) -> str:
    """供应商展示名（未知供应商原样回显）。"""
    key = str(vendor or "").strip().lower()
    return _VENDOR_LABELS.get(key, key.upper() or "供应商")


def vendor_accepts_data_url(vendor: str | None) -> bool:
    """该供应商是否接受 base64 data URL 形式的图片引用。未知供应商按不接受处理。"""
    key = str(vendor or "").strip().lower()
    if key == VENDOR_ACCEPTING_ANY:
        return True
    return _VENDOR_DATA_URL_SUPPORT.get(key, False)


def is_vendor_accepted_ref(value: str | None) -> bool:
    """这个引用字符串本身是不是供应商接受的形态（http / https / asset://）。"""
    return str(value or "").strip().lower().startswith(VENDOR_ACCEPTED_IMAGE_PREFIXES)


@dataclass(frozen=True, slots=True)
class VendorImageRef:
    """一个 file_id 在"供应商能不能用"这件事上的完整结论。"""

    file_id: str = ""
    storage_key: str = ""
    #: 真正会发给供应商的引用（公网原样；本地为 data URL；不可用时空）
    ref: str = ""
    #: missing（槽位没有 file_id）/ not_found（素材查不到）/ public / local_data_url / unreadable
    kind: str = "missing"
    #: 供应商能不能用这个引用当参考图
    vendor_usable: bool = False
    #: 给用户看的原因（可用时为空）
    reason: str = ""

    def to_read(self) -> dict[str, Any]:
        return {
            "file_id": self.file_id,
            "storage_key": self.storage_key,
            "ref_kind": self.kind,
            "vendor_usable": self.vendor_usable,
            "reason": self.reason,
        }


async def _read_image_as_data_url(session: AsyncSession, *, file_id: str, storage_key: str) -> str:
    """本地文件 → data URL（唯一的转换实现；``file_id_to_image_ref`` 也走这里）。"""
    from fastapi import HTTPException

    try:
        content = await storage.download_file(key=storage_key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"Failed to download file for file_id={file_id}: {exc}",
        ) from exc
    if not content:
        raise HTTPException(status_code=400, detail=f"Empty file content for file_id={file_id}")

    content_type = ""
    try:
        info = await storage.get_file_info(key=storage_key)
        content_type = (info.content_type or "").strip().lower()
    except Exception:  # noqa: BLE001
        content_type = ""
    if not content_type:
        guessed_type, _ = mimetypes.guess_type(storage_key)
        content_type = (guessed_type or "").strip().lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail=f"File is not an image for file_id={file_id}")

    image_format = content_type.split("/", 1)[1].split(";", 1)[0].strip().lower() or "png"
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:image/{image_format};base64,{encoded}"


async def resolve_vendor_image_ref(  # pylint: disable=too-many-return-statements
    session: AsyncSession,
    *,
    file_id: str | None,
    vendor: str = "apimart",
) -> VendorImageRef:
    """判断某个 file_id 能不能作为**该供应商**的参考图，并给出可直接展示的原因。

    为什么需要它（2026-09-19 真实提交暴露的问题）：``shot_frame_images`` 里有 file_id
    只说明**已上传/已绑定**，不代表供应商取得到。本机存储驱动是 local 时，帧文件只能被
    解析成 base64 data URL，而 APIMart 实测只接受 ``http(s)://`` / ``asset://``；
    计划预检若把"有 file_id"当成 usable，页面就会显示"可生成"并放开按钮，真实提交才 400。
    所以这条判定只写这一处，计划预检 / 集级就绪 / 提交前校验都用它。

    返回三态（**不抛异常**，由调用方决定阻断还是提示）：

    - ``kind=public``：storage_key 本身就是 http(s):// / asset:// → 供应商可用；
    - ``kind=local_data_url``：本地相对路径 → 只能变成本机 data URL；供应商不吃 data URL 时
      ``vendor_usable=False``，原因是"帧已存在但供应商无法访问"；
    - ``kind=missing / not_found / unreadable``：连地址都解不出来（附具体原因）。
    """
    clean_id = str(file_id or "").strip()
    if not clean_id:
        return VendorImageRef(
            kind="missing",
            reason="该帧还没有文件：槽位存在但没有 file_id（请在「关键帧与参考图」生成或上传该帧）。",
        )

    file_obj = await session.get(FileItem, clean_id)
    storage_key = str(getattr(file_obj, "storage_key", "") or "").strip()
    if file_obj is None or not storage_key:
        return VendorImageRef(
            file_id=clean_id,
            kind="not_found",
            reason=f"file_id={clean_id} 在素材库里查不到（或没有 storage_key），供应商无法访问。",
        )

    if is_public_storage_key(storage_key):
        return VendorImageRef(
            file_id=clean_id,
            storage_key=storage_key,
            ref=storage_key,
            kind="public",
            vendor_usable=True,
        )

    # S3 驱动下，逻辑 key 的对象其实已经公网可读（``{public_base}/{base_path}/{key}``）。
    # 这类 key 以前会被当成本机文件转 data URL → 明明公网可读却被判"供应商无法访问"。
    # 地址只有 ``storage.public_url_for_key`` 一个口径，且必须是**公网**地址才算数
    # （本地驱动的 ``/files/{key}`` 只是本机回放地址，供应商取不到）。
    s3_public_url = storage.public_url_for_key(storage_key)
    if storage.is_public_url(s3_public_url):
        return VendorImageRef(
            file_id=clean_id,
            storage_key=storage_key,
            ref=s3_public_url,
            kind="public",
            vendor_usable=True,
        )

    try:
        data_url = await _read_image_as_data_url(session, file_id=clean_id, storage_key=storage_key)
    except Exception as exc:  # noqa: BLE001 - 统一转成"不可用 + 原因"
        detail = getattr(exc, "detail", None) or str(exc)
        return VendorImageRef(
            file_id=clean_id,
            storage_key=storage_key,
            kind="unreadable",
            reason=f"帧已存在但读不出内容，供应商无法访问：{detail}",
        )

    if vendor_accepts_data_url(vendor):
        return VendorImageRef(
            file_id=clean_id,
            storage_key=storage_key,
            ref=data_url,
            kind="local_data_url",
            vendor_usable=True,
        )
    return VendorImageRef(
        file_id=clean_id,
        storage_key=storage_key,
        ref=data_url,
        kind="local_data_url",
        vendor_usable=False,
        reason=(
            f"帧已存在，但供应商无法访问：该文件是本机/相对地址（storage_key={storage_key}），"
            f"只能解析成本机 data URL；{vendor_label(vendor)} 只接受 http(s):// 或 asset://。"
            "请把图片放到公网（OSS 等），或用 POST /api/v1/studio/files/external "
            "把公网图片登记成素材后再设为该帧。"
        ),
    )


async def file_id_to_image_ref(
    session: AsyncSession,
    *,
    file_id: str,
    public_passthrough: bool = True,
) -> str:
    """把 ``file_id`` 解成**一个能打开的图片地址**（公网优先，其次本机 data URL）。

    库里并存两类 storage_key（历史原因）：

    - **公网地址**（``https://…oss…`` / 外链）→ 直接返回原地址（``public_passthrough``），
      或者下载后转 data URL；
    - **本地相对路径** → 读对象存储并转 data URL（本机地址供应商抓不到）。

    为什么必须区分：图片参考图的解析此前**没有**这个分支，把公网地址当成相对路径
    拼到本地存储根目录下，得到
    ``backend/storage/https:/ai-shortdrama-assets.oss-cn-beijing.aliyuncs.com/…``
    这种必然不存在的路径 → 只要镜头绑定了资产图，关键帧生成就直接 400，
    连"提示词有没有被用上"都验证不了。视频那条路先修了这个坑，这里抽成公共实现。

    失败时抛 ``HTTPException(400)``：调用方要决定是中断还是降级。

    注意：**"能解出地址" ≠ "供应商能用"**（本地文件只能变成 data URL）。需要判断
    供应商可用性请用 ``resolve_vendor_image_ref()`` —— 计划预检 / 就绪判定 / 提交校验
    共用它这一条口径。
    """
    from fastapi import HTTPException

    if public_passthrough:
        outcome = await resolve_vendor_image_ref(session, file_id=file_id, vendor=VENDOR_ACCEPTING_ANY)
    else:
        clean_id = str(file_id or "").strip()
        if not clean_id:
            raise HTTPException(status_code=400, detail="file_id 不能为空。")
        file_obj = await session.get(FileItem, clean_id)
        storage_key = str(getattr(file_obj, "storage_key", "") or "").strip()
        if file_obj is None or not storage_key:
            raise HTTPException(
                status_code=400,
                detail=f"FileItem not found or storage_key empty for file_id={clean_id}",
            )
        try:
            return await _read_image_as_data_url(session, file_id=clean_id, storage_key=storage_key)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"Invalid image file_id: {clean_id}: {exc}") from None

    if not outcome.ref:
        raise HTTPException(
            status_code=400,
            detail=outcome.reason or f"无法解析 file_id={file_id} 的图片地址。",
        )
    return outcome.ref

