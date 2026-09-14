"""场次工作区 API；业务状态、归属和关联由领域服务验证。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.workspace import (
    AIRequest, ApplyDesignRequest, ChapterSequences, RevisionWrite, SequenceCreate, SequenceRead,
    CompileRequest, ShootRequest, TakeReviewWrite, MediaRead, ReviewDecisionRequest, DirectingTaskRead,
    SequenceUpdate, TaskAccepted, VersionRequest, WorkspaceRead,
)
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.services.directing.production import ProductionService
from app.services.studio.files import require_available_file
from app.services.directing.store import RevisionConflict

router = APIRouter(prefix="/projects/{project_id}/directing", tags=["studio/directing"])


async def _call(awaitable):
    """统一翻译领域错误；不把具体业务规则放到路由。"""
    try:
        return await awaitable
    except RevisionConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/chapters/{chapter_id}", response_model=ApiResponse[ChapterSequences], operation_id="directing_chapter")
async def chapter(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db)):
    """返回章节原文和有序场次。"""
    return success_response(await _call(ProductionService(db, project_id).list_sequences(chapter_id)))


@router.post("/chapters/{chapter_id}/sequences", response_model=ApiResponse[SequenceRead], operation_id="directing_create_sequence")
async def create_sequence(project_id: str, chapter_id: str, body: SequenceCreate, db: AsyncSession = Depends(get_db)):
    """确认一段原文为正式场次。"""
    return success_response(await _call(ProductionService(db, project_id).write_sequence(chapter_id, body)))


@router.put("/chapters/{chapter_id}/sequences/{sequence_id}", response_model=ApiResponse[SequenceRead], operation_id="directing_update_sequence")
async def update_sequence(project_id: str, chapter_id: str, sequence_id: str, body: SequenceUpdate, db: AsyncSession = Depends(get_db)):
    """修改场次范围或顺序，旧版本更新返回冲突。"""
    return success_response(await _call(ProductionService(db, project_id).write_sequence(chapter_id, body, sequence_id)))


@router.get("/sequences/{sequence_id}", response_model=ApiResponse[WorkspaceRead], operation_id="directing_workspace")
async def workspace(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db)):
    """三视图读取同一份场次上下文。"""
    return success_response(await _call(ProductionService(db, project_id).workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/revisions", response_model=ApiResponse[WorkspaceRead], operation_id="directing_save_revision")
async def save_revision(project_id: str, sequence_id: str, body: RevisionWrite, db: AsyncSession = Depends(get_db)):
    """保存设计、计划或粗剪草稿。"""
    service = ProductionService(db, project_id)
    await _call(service.save_revision(sequence_id, kind=body.document.kind, payload=body.document.content.model_dump(mode="json"),
                                     revision_id=body.revision_id, expected_version=body.expected_version, parent_id=body.parent_id))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/revisions/{revision_id}/confirm", response_model=ApiResponse[WorkspaceRead], operation_id="directing_confirm_revision")
async def confirm_revision(project_id: str, sequence_id: str, revision_id: str, body: VersionRequest, db: AsyncSession = Depends(get_db)):
    """登记本地单用户工作台的显式确认动作。"""
    service = ProductionService(db, project_id)
    await _call(service.revision(revision_id, sequence_id=sequence_id))
    await _call(service.confirm_revision(revision_id, expected_version=body.expected_version, actor_id="local-user"))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/chapters/{chapter_id}/analyze", response_model=ApiResponse[TaskAccepted], operation_id="directing_analyze_chapter")
async def analyze(project_id: str, chapter_id: str, body: AIRequest, db: AsyncSession = Depends(get_db)):
    """提交原文划场建议，结果通过通用任务查询。"""
    task = await _call(ProductionService(db, project_id).submit_ai(kind="directing_divide", body=body, chapter_id=chapter_id))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/design", response_model=ApiResponse[TaskAccepted], operation_id="directing_generate_design")
async def design(project_id: str, sequence_id: str, body: AIRequest, db: AsyncSession = Depends(get_db)):
    """提交带起始版本的六岗导演设计建议。"""
    task = await _call(ProductionService(db, project_id).submit_ai(kind="directing_design", body=body, sequence_id=sequence_id))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/design/apply", response_model=ApiResponse[WorkspaceRead], operation_id="directing_apply_design")
async def apply_design(project_id: str, sequence_id: str, body: ApplyDesignRequest, db: AsyncSession = Depends(get_db)):
    """显式采用已完成任务建议，迟到结果保留为独立草稿。"""
    service = ProductionService(db, project_id)
    await _call(service.apply_design(sequence_id, body.task_id))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/compile", response_model=ApiResponse[WorkspaceRead], operation_id="directing_compile")
async def compile_unit(project_id: str, sequence_id: str, body: CompileRequest, db: AsyncSession = Depends(get_db)):
    """明确授权编译所选单元，生成不可变提示词。"""
    service = ProductionService(db, project_id)
    await _call(service.compile_unit(sequence_id, body.plan_revision_id, body.unit_id))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/prompts/{prompt_id}/review", response_model=ApiResponse[TaskAccepted], operation_id="directing_review")
async def review(project_id: str, sequence_id: str, prompt_id: str, body: AIRequest, db: AsyncSession = Depends(get_db)):
    """对固定提示词提交六岗联合审查。"""
    task = await _call(ProductionService(db, project_id).submit_review(sequence_id, prompt_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/review/apply", response_model=ApiResponse[WorkspaceRead], operation_id="directing_apply_review")
async def apply_review(project_id: str, sequence_id: str, body: ApplyDesignRequest, db: AsyncSession = Depends(get_db)):
    """保存实际审稿结论供用户查看、修改方案或选择执行。"""
    service = ProductionService(db, project_id)
    await _call(service.apply_review(sequence_id, body.task_id))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/shoot", response_model=ApiResponse[TaskAccepted], operation_id="directing_shoot")
async def shoot(project_id: str, sequence_id: str, body: ShootRequest, db: AsyncSession = Depends(get_db)):
    """确认固定输入并开始单元试拍，重复请求返回同一任务。"""
    task = await _call(ProductionService(db, project_id).shoot(sequence_id, prompt_id=body.prompt_revision_id,
                                                             review_id=body.review_revision_id, request_id=body.request_id))
    return success_response(TaskAccepted(task_id=task.id))


@router.put("/sequences/{sequence_id}/takes/{take_id}", response_model=ApiResponse[WorkspaceRead], operation_id="directing_annotate_take")
async def annotate_take(project_id: str, sequence_id: str, take_id: str, body: TakeReviewWrite, db: AsyncSession = Depends(get_db)):
    """保存过保修废、实际覆盖和保留区间。"""
    service = ProductionService(db, project_id)
    await _call(service.take(take_id, sequence_id=sequence_id))
    await _call(service.annotate_take(take_id, expected_version=body.expected_version, annotation=body.annotation.model_dump(mode="json")))
    return success_response(await _call(service.workspace(sequence_id)))


@router.get("/sequences/{sequence_id}/takes/{take_id}/media", response_model=ApiResponse[MediaRead], operation_id="directing_take_media")
async def take_media(project_id: str, sequence_id: str, take_id: str, db: AsyncSession = Depends(get_db)):
    """返回经归属校验的播放器地址，前端不自行拼接后端接口。"""
    service = ProductionService(db, project_id)
    take = await _call(service.take(take_id, sequence_id=sequence_id))
    file = await require_available_file(db, file_id=take.file_id, lock=False, expected_type="video")
    return success_response(MediaRead(take_id=take.id, file_id=file.id,
                                     url=f"/api/v1/studio/files/{file.id}/download", duration_ms=file.duration_ms))


@router.post("/sequences/{sequence_id}/reviews/{review_id}/resolve", response_model=ApiResponse[WorkspaceRead], operation_id="directing_resolve_review")
async def resolve_review(project_id: str, sequence_id: str, review_id: str, body: ReviewDecisionRequest, db: AsyncSession = Depends(get_db)):
    """派生保留人工取舍的审稿版本，原报告保持不变。"""
    service = ProductionService(db, project_id)
    await _call(service.resolve_review(sequence_id, review_id, role=body.role, occurrence_id=body.occurrence_id, reason=body.reason))
    return success_response(await _call(service.workspace(sequence_id)))


@router.get("/tasks/{task_id}", response_model=ApiResponse[DirectingTaskRead], operation_id="directing_task")
async def task_detail(project_id: str, task_id: str, db: AsyncSession = Depends(get_db)):
    """读取当前项目的导演建议和错误，保持业务结果在场次面板。"""
    return success_response(await _call(ProductionService(db, project_id).read_task(task_id)))
