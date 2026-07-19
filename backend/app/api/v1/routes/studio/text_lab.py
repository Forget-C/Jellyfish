"""独立文本生成实验室接口。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.studio.text_lab import TextLabGenerateRequest, TextLabGenerateResponse
from app.services.llm.resolver import build_text_chat_model

router = APIRouter()


def _to_langchain_messages(request: TextLabGenerateRequest) -> list[SystemMessage | HumanMessage | AIMessage]:
    """将 API 会话消息转换为 LangChain 消息，保留完整对话上下文。"""
    result: list[SystemMessage | HumanMessage | AIMessage] = []
    for item in request.messages:
        if item.role == "system":
            result.append(SystemMessage(content=item.content))
        elif item.role == "assistant":
            result.append(AIMessage(content=item.content))
        else:
            result.append(HumanMessage(content=item.content))
    return result


def _message_text(content: object) -> str:
    """将供应商可能返回的字符串或内容分段统一为可展示文本。"""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "".join(
            str(part.get("text", "")) if isinstance(part, dict) else str(part)
            for part in content
        ).strip()
    return str(content or "").strip()


@router.post(
    "/generate",
    response_model=ApiResponse[TextLabGenerateResponse],
    summary="使用指定文本模型执行一轮实验对话",
)
async def generate_text_lab_response(
    body: TextLabGenerateRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[TextLabGenerateResponse]:
    """执行单轮文本模型调用；会话持久化由客户端实验页面负责。"""
    model = await build_text_chat_model(db, model_id=body.model_id, thinking=False)
    try:
        result = await model.ainvoke(_to_langchain_messages(body))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Text model invocation failed: {exc}",
        ) from exc

    content = _message_text(getattr(result, "content", ""))
    if not content:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Text model returned an empty response")
    return success_response(TextLabGenerateResponse(model_id=body.model_id, content=content))
