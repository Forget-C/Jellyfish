"""Resolve local image payloads into HTTPS URLs through DreamAPI Storage."""

from __future__ import annotations

import base64
import binascii
import mimetypes
from typing import Any
from urllib.parse import urlsplit

from app.core.contracts.provider import ProviderConfig
from app.core.integrations.dreamapi.common import _response_data

_STORAGE_POLICY_PATH = "/api/file/v1/get_policy"
_STORAGE_FINISH_PATH = "/api/file/v1/policy_upload_finish"
_MAX_UPLOAD_BYTES = 30 * 1024 * 1024


def _parse_image_reference(image_ref: str) -> tuple[bytes, str, str]:
    """Decode an image data URL or raw base64 value for DreamAPI Storage."""
    value = image_ref.strip()
    content_type = "image/jpeg"
    encoded = value
    if value.lower().startswith("data:"):
        header, separator, encoded = value.partition(",")
        if not separator or ";base64" not in header.lower():
            raise ValueError("DreamAPI image references must be base64 data URLs")
        content_type = header[5:].split(";", 1)[0].lower()
        if not content_type.startswith("image/"):
            raise ValueError("DreamAPI Storage only accepts image data")

    max_encoded_length = ((_MAX_UPLOAD_BYTES + 2) // 3) * 4
    if len(encoded) > max_encoded_length:
        raise ValueError("DreamAPI reference image exceeds the 30 MB upload limit")

    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("DreamAPI image reference is not valid base64 data") from exc
    if not content:
        raise ValueError("DreamAPI image reference is empty")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise ValueError("DreamAPI reference image exceeds the 30 MB upload limit")

    extension = mimetypes.guess_extension(content_type) or ".jpg"
    if extension == ".jpe":
        extension = ".jpg"
    return content, content_type, f"reference{extension}"


def _validate_storage_host(value: str) -> str:
    """Accept only DreamAPI's HTTPS Aliyun OSS upload origin, preventing SSRF."""
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("unsafe DreamAPI storage host") from exc
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not hostname.endswith(".aliyuncs.com"):
        raise ValueError("unsafe DreamAPI storage host")
    if parsed.username is not None or parsed.password is not None or port not in (None, 443):
        raise ValueError("unsafe DreamAPI storage host")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("unsafe DreamAPI storage host")
    return value.rstrip("/")


def _policy_fields(data: dict[str, Any], filename: str) -> dict[str, str]:
    """Normalize current and legacy DreamAPI upload-policy response fields."""
    key = str(data.get("key") or "")
    if not key and data.get("dir"):
        key = f"{data['dir']}{filename}"
    fields = {
        "key": key,
        "policy": str(data.get("policy") or ""),
        "OSSAccessKeyId": str(data.get("OSSAccessKeyId") or data.get("accessId") or ""),
        "signature": str(data.get("signature") or ""),
        "callback": str(data.get("callback") or ""),
        "reqId": str(data.get("reqId") or ""),
    }
    if not all(fields[name] for name in ("key", "policy", "OSSAccessKeyId", "signature")):
        raise RuntimeError("DreamAPI upload policy is incomplete")
    return fields


async def image_ref_to_public_url(
    *,
    cfg: ProviderConfig,
    image_ref: str,
    timeout_s: float,
) -> str:
    """Upload base64 images to DreamAPI Storage; HTTPS URLs pass through unchanged."""
    value = image_ref.strip()
    parsed = urlsplit(value)
    if value.lower().startswith(("http://", "https://")):
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("DreamAPI image URL must be a public HTTPS URL")
        return value
    if parsed.scheme and not value.lower().startswith("data:"):
        raise ValueError("DreamAPI image reference must be an HTTPS URL or base64 image")

    content, content_type, filename = _parse_image_reference(value)
    import httpx

    base_url = (cfg.base_url or "https://api.newportai.com").rstrip("/")
    headers = {"Authorization": f"Bearer {cfg.api_key}"}
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        policy_response = await client.post(
            f"{base_url}{_STORAGE_POLICY_PATH}",
            headers=headers,
            json={"scene": "Dream-CN"},
        )
        policy_response.raise_for_status()
        policy_data = _response_data(policy_response.json())
        policy = _policy_fields(policy_data, filename)
        upload_host = _validate_storage_host(str(policy_data.get("host") or ""))

        form_fields = {
            "key": policy["key"],
            "policy": policy["policy"],
            "OSSAccessKeyId": policy["OSSAccessKeyId"],
            "success_action_status": "200",
            "signature": policy["signature"],
            "callback": policy["callback"],
        }
        upload_response = await client.post(
            upload_host,
            data=form_fields,
            files={"file": (filename, content, content_type)},
        )
        upload_response.raise_for_status()
        upload_payload = upload_response.json()
        upload_data = upload_payload.get("data") if isinstance(upload_payload, dict) else None
        upload_req_id = (
            str(upload_data.get("reqId") or "") if isinstance(upload_data, dict) else ""
        ) or policy["reqId"]
        if not upload_req_id:
            raise RuntimeError("DreamAPI upload response is missing reqId")

        finish_response = await client.post(
            f"{base_url}{_STORAGE_FINISH_PATH}",
            headers=headers,
            json={"reqId": upload_req_id},
        )
        finish_response.raise_for_status()
        result = _response_data(finish_response.json())
        url = str(result.get("url") or "")
        parsed_result = urlsplit(url)
        if parsed_result.scheme != "https" or not parsed_result.hostname:
            raise RuntimeError("DreamAPI upload finish response is missing an HTTPS URL")
        return url
