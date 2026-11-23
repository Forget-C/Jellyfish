"""Bound old dialogue in each assistant model call without trimming the active turn."""

from fastapi import HTTPException
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.messages.utils import count_tokens_approximately

CONTEXT_LIMIT_ERROR = 'ASSISTANT_CONTEXT_LIMIT_EXCEEDED'
_REVISION_SUBJECT = '正在修改这条待审批建议：'


def revision_subject(proposal):
    """Mark the existing suggestion as part of an explicit revision request."""
    return AIMessage(content=_REVISION_SUBJECT + str(proposal))


def _token_cost(message):
    # An encoded video is not tokenized as literal text. Reserve a conservative
    # allowance and keep actual media observations unchanged on the wire.
    video_allowance = 0
    if isinstance(message.content, list):
        text_parts = []
        for block in message.content:
            if isinstance(block, dict) and block.get('type') in ('video_url', 'audio_url'):
                video_allowance += 2048
            else:
                text_parts.append(block)
        message = message.model_copy(update={'content': text_parts})
    return count_tokens_approximately([message], chars_per_token=2) + video_allowance


def messages_within_budget(messages, system_message, tools, limit):
    """Keep the current request and tool exchange, then whole recent exchanges."""
    if limit is None:
        return messages
    preserved = next((index for index in range(len(messages) - 1, -1, -1)
                      if isinstance(messages[index], HumanMessage)), 0)
    if (preserved and isinstance(messages[preserved - 1], AIMessage)
            and messages[preserved - 1].text.startswith(_REVISION_SUBJECT)):
        preserved -= 1
    remaining = limit - count_tokens_approximately(
        [system_message] if system_message else [], chars_per_token=2, tools=tools,
    ) - sum(_token_cost(message) for message in messages[preserved:])
    if remaining < 0:
        raise HTTPException(422, CONTEXT_LIMIT_ERROR)
    cursor, exchange_cost = preserved, 0
    for index in range(preserved - 1, -1, -1):
        message = messages[index]
        exchange_cost += _token_cost(message)
        if isinstance(message, HumanMessage):
            remaining -= exchange_cost
            if remaining < 0:
                break
            cursor, exchange_cost = index, 0
    return messages[cursor:]
