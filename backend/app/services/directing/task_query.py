"""读取项目内导演任务的公开结果及历史格式。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.instruction_check import InstructionCheckResult
from app.core.contracts.directing.production import ReviewPacket
from app.core.contracts.directing.review_revision import ReviewRevisionCandidate
from app.core.contracts.directing.scene_design import parse_scene_design_candidate
from app.core.contracts.directing.scene_instruction import SceneInstructionResult
from app.core.contracts.directing.scene_version import EditableSceneDesign
from app.core.contracts.directing.workspace import DirectingTaskRead, DivisionResult
from app.models.task import Task, TaskOutput

TASK_TARGETS = {"directing_chapter", "directing_sequence", "directing_unit", "directing_image"}
TASK_RESULT_CONTRACTS = {
    "directing_divide": ("division", DivisionResult),
    "directing_design": ("design", SceneDesign),
    "directing_review": ("review", ReviewPacket),
    "directing_review_revision": ("revision", ReviewRevisionCandidate),
    "directing_instruction": ("scene_instruction", SceneInstructionResult),
    "directing_instruction_check": ("instruction_check", InstructionCheckResult),
}


async def read_directing_task(db: AsyncSession, project_id: str, task_id: str) -> DirectingTaskRead:
    """仅返回本项目导演任务的类型化结果，不暴露凭据或供应商原始响应。"""
    task = await db.get(Task, task_id)
    if (task is None or task.project_id != project_id
            or task.target_type not in TASK_TARGETS):
        raise ValueError("任务不属于当前工作区")
    run_args = task.input_snapshot.get("run_args", {})
    result = {}
    result_contract = TASK_RESULT_CONTRACTS.get(task.kind)
    if task.status == "succeeded" and result_contract and task.input_snapshot.get("scene_design"):
        candidate = parse_scene_design_candidate(task.result, run_args)
        result["scene_design"] = candidate.design if candidate else EditableSceneDesign.model_validate(task.result)
    elif task.status == "succeeded" and result_contract:
        result_key, contract = result_contract
        result[result_key] = contract.model_validate(task.result)
    if task.status == "succeeded" and task.target_type == "directing_image":
        result["image_file_ids"] = list(await db.scalars(select(TaskOutput.file_id).where(TaskOutput.task_id == task.id).order_by(TaskOutput.ordinal)))
    if task.kind == "directing_review_revision":
        result["revision_request"] = task.input_snapshot.get("revision_request")
        result["revision_application"] = task.input_snapshot.get("revision_application")
    return DirectingTaskRead(task_id=task.id, kind=task.kind, status=task.status,
                             error=task.error_message,
                             division_baseline=run_args.get("division_baseline"),
                             source_version=run_args.get("source_version"), **result)
