"""ComfyUI 集成（自托管推理服务）。"""

from app.core.integrations.comfyui.video import (
    ComfyUIError,
    ComfyUIVideoApiAdapter,
    extract_video_output,
    is_video_filename,
    read_execution_status,
)
from app.core.integrations.comfyui.workflow import (
    WorkflowConfigError,
    WorkflowMapping,
    apply_inputs,
    load_mapping,
)

__all__ = [
    "ComfyUIError",
    "ComfyUIVideoApiAdapter",
    "WorkflowConfigError",
    "WorkflowMapping",
    "apply_inputs",
    "extract_video_output",
    "is_video_filename",
    "load_mapping",
    "read_execution_status",
]
