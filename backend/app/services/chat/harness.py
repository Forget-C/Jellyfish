"""Shared Deep Agents loop with scene-provided tools, policy and progress sink."""
from deepagents import create_deep_agent
from langchain.agents.middleware import wrap_tool_call


def build_chat_agent(model, *, tools, middleware, system_prompt, checkpointer=None, on_tool=None):
    """Report actual tool executions while leaving authorization to the scene."""
    layers = list(middleware)
    if on_tool is not None:
        @wrap_tool_call
        async def observe_tool(request, handler):
            call = request.tool_call
            # Only publish explicitly user-facing identifiers and paging parameters.
            parameters = {key: value for key, value in call.get('args', {}).items()
                          if key in ('card_id', 'offset', 'limit', 'file_id', 'group_id', 'preview_id')
                          and isinstance(value, (int, str))}
            identity = {'id': call['id'], 'name': call['name'], 'parameters': parameters}
            await on_tool(**identity, state='started')
            try:
                response = await handler(request)
            except Exception:
                await on_tool(**identity, state='failed')
                raise
            state = 'failed' if getattr(response, 'status', None) == 'error' else 'completed'
            await on_tool(**identity, state=state)
            return response
        layers.append(observe_tool)
    return create_deep_agent(model=model, tools=tools, middleware=layers,
                             system_prompt=system_prompt, checkpointer=checkpointer)
