"""ComfyUI 集成（自托管推理服务）。"""

from app.core.integrations.comfyui.video import (
    ComfyUIError,
    ComfyUIVideoApiAdapter,
    extract_video_output,
    is_video_filename,
    read_execution_status,
)
from app.core.integrations.comfyui.workflow import (
    REQUIRED_RENDER_INPUTS,
    WorkflowConfigError,
    WorkflowMapping,
    apply_inputs,
    load_mapping,
    require_render_inputs,
)

__all__ = [
    "REQUIRED_RENDER_INPUTS",
    "ComfyUIError",
    "ComfyUIVideoApiAdapter",
    "WorkflowConfigError",
    "require_render_inputs",
    "WorkflowMapping",
    "apply_inputs",
    "extract_video_output",
    "is_video_filename",
    "load_mapping",
    "read_execution_status",
]
