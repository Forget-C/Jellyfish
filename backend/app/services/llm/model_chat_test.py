"""文本模型试聊：按已保存模型发起一次真实对话请求（管理页调试用，非生产任务）。"""

from __future__ import annotations

import asyncio
import time

from fastapi import HTTPException, status
from langchain_core.messages import HumanMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import ModelCategoryKey, Provider
from app.schemas.llm import ModelChatTestRead
from app.services.llm.manage import get_model
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.llm.resolver import build_chat_model_for_model

# 试聊允许略长于验证探测，但仍需上限以免拖死 worker
_CHAT_TIMEOUT_S = 120.0
_MAX_REPLY_TOKENS = 2048


def _elapsed_ms(t0: float) -> int:
    return int((time.perf_counter() - t0) * 1000)


async def chat_test_with_model(
    db: AsyncSession,
    *,
    model_id: str,
    user_message: str,
) -> ModelChatTestRead:
    """对单条已保存**文本**模型发送一条用户消息并返回模型回复。"""
    text = (user_message or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="message is empty")

    t0 = time.perf_counter()
    model = await get_model(db, model_id=model_id)
    if model.category != ModelCategoryKey.text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chat test is only available for text models",
        )

    provider = await db.get(Provider, model.provider_id)
    if provider is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Provider not found for model_id={model_id}",
        )

    # 与验证路径一致：先确认供应商解析可用（自定义无适配器等会在此失败）
    resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)

    try:
        llm = build_chat_model_for_model(provider=provider, model=model, thinking=False)
        bounded = llm.bind(max_tokens=_MAX_REPLY_TOKENS)
        msg = await asyncio.wait_for(
            bounded.ainvoke([HumanMessage(content=text)]),
            timeout=_CHAT_TIMEOUT_S,
        )
        raw = getattr(msg, "content", "") or ""
        if isinstance(raw, list):
            reply = str(raw)
        else:
            reply = str(raw)
        return ModelChatTestRead(reply=reply, elapsed_ms=_elapsed_ms(t0))
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Chat test timed out",
        ) from None
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc)[:800],
        ) from exc
