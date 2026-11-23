"""Pause the original Deep Agents graph while canvas decisions remain pending."""

from deepagents import create_deep_agent
from langchain.agents.middleware import after_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import ToolMessage
from langgraph.types import Command, interrupt
from pydantic import ValidationError

from app.schemas.canvas_assistant_edit import CanvasAssistantProposal, TextCanvasBatchResponse
from app.services.generation_canvas.assistant_checkpoint import CanvasGraphSnapshot

APPROVAL_INTERRUPT = 'canvas.approval'
PROPOSAL_TOOLS = frozenset({
    'propose_canvas_edit', 'propose_canvas_edit_groups', 'propose_canvas_structure',
    'propose_canvas_removal', 'propose_canvas_changes',
})


def _proposal_pending(messages):
    for message in reversed(messages):
        if isinstance(message, ToolMessage) and message.name in PROPOSAL_TOOLS and message.status == 'success':
            try:
                CanvasAssistantProposal.model_validate_json(message.text)
            except ValidationError:
                continue
            return True
    if messages and messages[-1].text.startswith('{'):
        try:
            TextCanvasBatchResponse.model_validate_json(messages[-1].text)
        except ValidationError:
            return False
        return True
    return False


@after_agent
def wait_for_canvas_approval(state, _runtime):
    """Use the canvas service as the authority for individual group outcomes."""
    if not _proposal_pending(state['messages']):
        return None
    resolution = interrupt({'kind': APPROVAL_INTERRUPT})
    while resolution['pending']:
        resolution = interrupt({'kind': APPROVAL_INTERRUPT})
    return None


def is_approval_pause(pause):
    """Distinguish a governed change from a creative question."""
    return isinstance(pause.value, dict) and pause.value.get('kind') == APPROVAL_INTERRUPT


class _ApprovalResumeModel(BaseChatModel):
    """Enforce that observing a business decision never calls the model again."""

    @property
    def _llm_type(self) -> str:
        return 'canvas-approval-resume'

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        raise RuntimeError('The paused approval graph cannot call a provider')


async def resume_canvas_approval(turn, *, pending: bool) -> bool:
    """Apply the durable business outcome to the exact saved interrupt."""
    if not turn.approval_checkpoint:
        return False
    checkpoint = CanvasGraphSnapshot(turn.request_id, turn.approval_checkpoint, redact_missing=True)
    agent = create_deep_agent(model=_ApprovalResumeModel(), checkpointer=checkpoint, middleware=[wait_for_canvas_approval])
    state = await agent.aget_state(checkpoint.config)
    pauses = [pause for pause in state.interrupts if is_approval_pause(pause)]
    if len(pauses) != 1 or state.next != ('wait_for_canvas_approval.after_agent',):
        raise RuntimeError('Invalid paused canvas approval graph')
    result = await agent.ainvoke(Command(resume={pauses[0].id: {'pending': pending}}),
                                 checkpoint.config, durability='sync')
    if bool(result.get('__interrupt__')) != pending:
        raise RuntimeError('Canvas approval graph did not record the business outcome')
    turn.approval_checkpoint = checkpoint.snapshot() if pending else None
    return True
