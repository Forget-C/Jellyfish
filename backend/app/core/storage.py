"""统一的对象存储封装（目前以 S3 兼容为主）。

设计目标：
- 提供上传 / 下载 / 列表 / 详情 等基础能力；
- 尽量不绑定具体云厂商，只依赖 S3 兼容协议；
- 在 FastAPI 异步环境下，避免阻塞事件循环：通过 anyio 在线程池中调用 boto3。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, BinaryIO

from anyio import to_thread
import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from app.config import settings


@dataclass
class StoredFileInfo:
    """文件基础信息（供调用方在路由层自行封装为 Pydantic schema）。"""

    key: str
    url: str
    size: int | None = None
    content_type: str | None = None
    etag: str | None = None
    extra: dict[str, Any] | None = None


def _build_s3_client():
    if not settings.s3_bucket_name:
        raise RuntimeError("S3 未配置：请在配置中设置 s3_bucket_name 等必要字段")

    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region_name,
        aws_access_key_id=settings.s3_access_key_id,
        aws_secret_access_key=settings.s3_secret_access_key,
        # 对 MinIO/RustFS 等自建 S3 兼容服务，优先使用 path-style，
        # 避免解析出 <bucket>.<endpoint-host> 导致容器内 DNS 失败。
        config=BotoConfig(s3={"addressing_style": "path"}),
    )
    return client


def _normalize_key(key: str) -> str:
    key = key.lstrip("/")
    base = settings.s3_base_path.strip().strip("/")
    if base:
        return f"{base}/{key}"
    return key


def _build_public_url(key: str) -> str:
    key = _normalize_key(key)
    if settings.s3_public_base_url:
        base = settings.s3_public_base_url.rstrip("/")
        return f"{base}/{key}"
    # fallback：使用标准 S3 URL 形式；具体可根据实际厂商调整
    if not settings.s3_bucket_name:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")
    endpoint = settings.s3_endpoint_url.rstrip("/") if settings.s3_endpoint_url else ""
    if endpoint:
        return f"{endpoint}/{settings.s3_bucket_name}/{key}"
    # 若未配置 endpoint，则退回最基础的 path 形式
    return f"/{settings.s3_bucket_name}/{key}"


def init_storage() -> None:
    """初始化对象存储（例如创建 bucket）。

    说明：
    - 若 bucket 已存在则直接返回；
    - 若无权限/配置错误会抛出异常，便于在部署时尽早失败；
    - 对于部分 S3 兼容服务（MinIO 等），CreateBucket 的参数可能不同，这里尽量兼容常见情形。
    """
    client = _build_s3_client()
    bucket = settings.s3_bucket_name
    if not bucket:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")

    try:
        client.head_bucket(Bucket=bucket)
        return
    except ClientError as e:
        code = str(e.response.get("Error", {}).get("Code", ""))
        # 常见不存在：404 / NoSuchBucket / NotFound
        if code not in {"404", "NoSuchBucket", "NotFound"}:
            raise

    params: dict[str, Any] = {"Bucket": bucket}
    region = settings.s3_region_name
    # AWS S3 在 us-east-1 不需要 LocationConstraint，其他 region 需要
    if region and region != "us-east-1":
        params["CreateBucketConfiguration"] = {"LocationConstraint": region}

    try:
        client.create_bucket(**params)
    except ClientError as e:
        # 可能出现并发创建或服务端返回已存在
        code = str(e.response.get("Error", {}).get("Code", ""))
        if code in {"BucketAlreadyOwnedByYou", "BucketAlreadyExists"}:
            return
        raise

    # 再次确认 bucket 可用
    client.head_bucket(Bucket=bucket)


async def upload_file(
    *,
    key: str,
    data: bytes | BinaryIO,
    content_type: str | None = None,
    extra_args: dict[str, Any] | None = None,
) -> StoredFileInfo:
    """上传文件到 S3。

    参数：
    - key：逻辑 key（不需要带 base_path，会自动拼接）；
    - data：字节内容或类文件对象；
    - content_type：MIME 类型，例如 image/png；
    - extra_args：透传给 boto3 的 ExtraArgs，如 {"ACL": "public-read"}。
    """

    client = _build_s3_client()
    bucket = settings.s3_bucket_name
    if bucket is None:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")

    s3_key = _normalize_key(key)
    extra = extra_args.copy() if extra_args else {}
    if content_type and "ContentType" not in extra:
        extra["ContentType"] = content_type

    def _upload():
        if isinstance(data, (bytes, bytearray)):
            return client.put_object(Bucket=bucket, Key=s3_key, Body=data, **extra)
        return client.upload_fileobj(data, bucket, s3_key, ExtraArgs=extra)  # type: ignore[arg-type]

    result = await to_thread.run_sync(_upload)

    etag = None
    if isinstance(result, dict):
        etag = result.get("ETag")

    url = _build_public_url(key)
    return StoredFileInfo(key=s3_key, url=url, etag=etag)


async def download_file(*, key: str) -> bytes:
    """下载文件内容（整个对象读入内存）。"""
    client = _build_s3_client()
    bucket = settings.s3_bucket_name
    if bucket is None:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")

    s3_key = _normalize_key(key)

    def _download() -> bytes:
        obj = client.get_object(Bucket=bucket, Key=s3_key)
        body = obj["Body"].read()
        return body  # type: ignore[no-any-return]

    return await to_thread.run_sync(_download)


async def get_file_info(*, key: str) -> StoredFileInfo:
    """获取文件元信息（不下载内容）。"""
    client = _build_s3_client()
    bucket = settings.s3_bucket_name
    if bucket is None:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")

    s3_key = _normalize_key(key)

    def _head() -> dict[str, Any]:
        return client.head_object(Bucket=bucket, Key=s3_key)  # type: ignore[no-any-return]

    meta = await to_thread.run_sync(_head)

    size = int(meta.get("ContentLength") or 0)
    content_type = meta.get("ContentType")
    etag = meta.get("ETag")

    url = _build_public_url(key)
    return StoredFileInfo(
        key=s3_key,
        url=url,
        size=size,
        content_type=content_type,
        etag=etag,
        extra={k: v for k, v in meta.items() if k not in {"ContentLength", "ContentType", "ETag"}},
    )


async def list_files(*, prefix: str = "") -> list[StoredFileInfo]:
    """根据前缀列出文件（最多一页，若需翻页可扩展）。"""
    client = _build_s3_client()
    bucket = settings.s3_bucket_name
    if bucket is None:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")

    normalized_prefix = _normalize_key(prefix) if prefix else settings.s3_base_path.strip().strip("/")

    def _list() -> list[dict[str, Any]]:
        resp = client.list_objects_v2(Bucket=bucket, Prefix=normalized_prefix or None)
        return resp.get("Contents", [])  # type: ignore[no-any-return]

    contents = await to_thread.run_sync(_list)

    results: list[StoredFileInfo] = []
    for item in contents:
        key = item["Key"]
        size = int(item.get("Size") or 0)
        url = _build_public_url(key)
        results.append(
            StoredFileInfo(
                key=key,
                url=url,
                size=size,
                extra={"LastModified": item.get("LastModified"), "StorageClass": item.get("StorageClass")},
            )
        )
    return results


async def delete_file(*, key: str) -> None:
    """删除文件。"""
    client = _build_s3_client()
    bucket = settings.s3_bucket_name
    if bucket is None:
        raise RuntimeError("S3 未配置：缺少 s3_bucket_name")

    s3_key = _normalize_key(key)

    def _delete() -> None:
        client.delete_object(Bucket=bucket, Key=s3_key)

    await to_thread.run_sync(_delete)

