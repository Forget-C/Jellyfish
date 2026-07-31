"""初始图片、视频 WorkflowHandler 的默认注册表。"""

from __future__ import annotations

from app.core.contracts.generation import GenerationOperation, GenerationTargetKind
from app.services.generation.publishers import AssetImagePublisher, ShotFramePublisher, ShotVideoPublisher
from app.services.generation.workflows.handlers import (
    ExperimentWorkflowHandler,
    PassthroughWorkflowHandler,
    ShotFrameWorkflowHandler,
    ShotVideoWorkflowHandler,
    SlotPublisherWorkflowHandler,
)
from app.services.generation.workflows.registry import GenerationWorkflowRegistry


def build_generation_workflow_registry() -> GenerationWorkflowRegistry:
    """构造已注册初始场景 Handler 的 Registry，供图片和视频 Worker 共同使用。"""
    registry = GenerationWorkflowRegistry()
    registry.register(ExperimentWorkflowHandler(operation=GenerationOperation.image_generation))
    registry.register(ExperimentWorkflowHandler(operation=GenerationOperation.video_generation))
    registry.register(ExperimentWorkflowHandler(operation=GenerationOperation.text_chat))
    registry.register(SlotPublisherWorkflowHandler(operation=GenerationOperation.image_generation, target_kind=GenerationTargetKind.asset_image_slot, publisher=AssetImagePublisher()))
    registry.register(ShotFrameWorkflowHandler(publisher=ShotFramePublisher()))
    registry.register(ShotVideoWorkflowHandler(publisher=ShotVideoPublisher()))
    registry.register(PassthroughWorkflowHandler(operation=GenerationOperation.text_agent, target_kind=GenerationTargetKind.script_processing))
    registry.register(PassthroughWorkflowHandler(operation=GenerationOperation.text_agent, target_kind=GenerationTargetKind.shot_detail))
    return registry


generation_workflow_registry = build_generation_workflow_registry()
