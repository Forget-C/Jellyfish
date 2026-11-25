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
            await on_tool(id=call['id'], name=call['name'], state='started')
            try:
                response = await handler(request)
            except Exception:
                await on_tool(id=call['id'], name=call['name'], state='failed')
                raise
            state = 'failed' if getattr(response, 'status', None) == 'error' else 'completed'
            await on_tool(id=call['id'], name=call['name'], state=state)
            return response
        layers.append(observe_tool)
    return create_deep_agent(model=model, tools=tools, middleware=layers,
                             system_prompt=system_prompt, checkpointer=checkpointer)
