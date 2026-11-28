"""LangGraph interrupt and answer handling for creative decisions."""

from typing import Annotated

from langchain_core.tools import tool
from langgraph.types import Command, interrupt
from pydantic import Field, StringConstraints

from app.schemas.canvas_assistant import CanvasAssistantQuestion

QuestionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class CreativeQuestionPending(Exception):
    """The graph stopped at a creative question and is ready for user input."""

    def __init__(self, question: CanvasAssistantQuestion):
        super().__init__(question.id)
        self.question = question


@tool
def ask_canvas_question(question: QuestionText,
                        options: Annotated[list[QuestionText], Field(max_length=5)] | None = None) -> str:
    """Ask one consequential creative question. Wait for a choice or free answer."""
    return interrupt({'text': question, 'options': list(dict.fromkeys(options or []))})


def resume_question(prior, answers):
    """Replay an accepted answer only when its matching interrupt is still pending."""
    if not prior.interrupts:
        return None
    supplied = {entry['question_id']: entry['answer'] for entry in answers}
    resumed = {pause.id: supplied[pause.id] for pause in prior.interrupts if pause.id in supplied}
    if len(resumed) != len(prior.interrupts):
        pause = next(value for value in prior.interrupts if value.id not in resumed)
        raise CreativeQuestionPending(CanvasAssistantQuestion(id=pause.id, **pause.value))
    return Command(resume=resumed)


def check_new_question(state):
    """Expose the first unanswered creative interrupt from the current graph result."""
    if pauses := state.get('__interrupt__'):
        pause = pauses[0]
        raise CreativeQuestionPending(CanvasAssistantQuestion(id=pause.id, **pause.value))
