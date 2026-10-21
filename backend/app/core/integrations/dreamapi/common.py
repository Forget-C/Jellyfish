"""Shared DreamAPI async-task submission and polling helpers."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.core.contracts.provider import ProviderConfig

POLL_PATH = "/api/getAsyncResult"
POLL_INTERVAL_S = 5.0
POLL_TIMEOUT_S = 600.0


def _response_data(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise RuntimeError("DreamAPI returned a non-object response")
    if payload.get("code") != 0:
        code = payload.get("code", "unknown")
        message = payload.get("message") or "request failed"
        raise RuntimeError(f"DreamAPI request failed ({code}): {message}")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("DreamAPI response is missing data")
    return data


async def submit_and_poll(
    *,
    cfg: ProviderConfig,
    endpoint: str,
    body: dict[str, Any],
    result_field: str,
    timeout_s: float,
) -> tuple[str, dict[str, Any]]:
    """Submit one async job and return its terminal response and provider task id."""
    import httpx

    base_url = (cfg.base_url or "https://api.newportai.com").rstrip("/")
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        response = await client.post(f"{base_url}{endpoint}", headers=headers, json=body)
        response.raise_for_status()
        submitted = _response_data(response.json())
        task_id = str(submitted.get("taskId") or "")
        if not task_id:
            raise RuntimeError("DreamAPI submit response is missing taskId")

        deadline = time.monotonic() + POLL_TIMEOUT_S
        while time.monotonic() < deadline:
            await asyncio.sleep(POLL_INTERVAL_S)
            response = await client.post(
                f"{base_url}{POLL_PATH}", headers=headers, json={"taskId": task_id}
            )
            response.raise_for_status()
            data = _response_data(response.json())
            task = data.get("task")
            status = task.get("status") if isinstance(task, dict) else data.get("status")
            if status == 4:
                reason = task.get("reason") if isinstance(task, dict) else None
                error_code = task.get("errorCode") if isinstance(task, dict) else None
                raise RuntimeError(f"DreamAPI task failed ({error_code or 'unknown'}): {reason or 'provider reported failure'}")
            if status == 3:
                items = data.get(result_field)
                if not isinstance(items, list) or not items:
                    raise RuntimeError(f"DreamAPI task completed without {result_field}")
                return task_id, data
        raise TimeoutError(f"DreamAPI task {task_id} did not complete within {POLL_TIMEOUT_S:g}s")
