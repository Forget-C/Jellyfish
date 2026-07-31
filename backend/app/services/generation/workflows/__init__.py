"""统一生成终态工作流的基础注册接口。"""

from app.services.generation.workflows.base import (
    AbstractGenerationWorkflowHandler,
    GenerationWorkflowExecutionContext,
    GenerationWorkflowHandler,
    GenerationWorkflowKey,
    GenerationWorkflowSubmissionContext,
    GenerationWorkflowTerminalContext,
)
from app.services.generation.workflows.defaults import generation_workflow_registry
from app.services.generation.workflows.handlers import (
    ExperimentWorkflowHandler,
    PassthroughWorkflowHandler,
    SlotPublisherWorkflowHandler,
)
from app.services.generation.workflows.registry import (
    DEFAULT_WORKFLOW_KEYS,
    GenerationWorkflowHandlerNotRegisteredError,
    GenerationWorkflowRegistry,
    UnsupportedGenerationWorkflowError,
)

__all__ = [
    "AbstractGenerationWorkflowHandler",
    "DEFAULT_WORKFLOW_KEYS",
    "GenerationWorkflowExecutionContext",
    "GenerationWorkflowHandler",
    "GenerationWorkflowHandlerNotRegisteredError",
    "GenerationWorkflowKey",
    "GenerationWorkflowRegistry",
    "GenerationWorkflowSubmissionContext",
    "GenerationWorkflowTerminalContext",
    "ExperimentWorkflowHandler",
    "PassthroughWorkflowHandler",
    "SlotPublisherWorkflowHandler",
    "UnsupportedGenerationWorkflowError",
    "generation_workflow_registry",
]
