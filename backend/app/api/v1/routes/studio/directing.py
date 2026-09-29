"""场次工作区 API；业务校验由领域服务负责，事务必须在响应发送前提交。"""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.workspace import (
    RegroupRequest, ExtractFrameRequest, ExtractedFrame, AssetSummary, AssetCreateRequest, VisualRequest, AIRequest, ApplyDesignRequest, ChapterOverview, ChapterSequences, RevisionWrite, SequenceCreate, SequenceRead,
    CompileRequest, CompileResult, ReviewRequest, ShootRequest, TakeReviewWrite, MediaRead, ReviewDecisionRequest, DirectingTaskRead,
    SequenceUpdate, TaskAccepted, VersionRequest, WorkspaceRead,
)
from app.core.contracts.directing.style import ProjectStyleRevision, StyleWrite
from app.core.contracts.video_generation import VideoReferenceCapabilities
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response
from app.services.directing.production import ProductionService
from app.services.directing.review_revision import ReviewRevisionService
from app.core.contracts.directing.review_revision import ReviewRevisionRequest, ApplyReviewRevisionRequest, ReviewRevisionApplication, EditableRevisionFields
from app.services.directing.batch import BatchService
from app.services.directing.continuity import ContinuityService
from app.core.contracts.directing.continuity import ContinuityRead, CutFrameRequest, CutFrameRead, SeamReviewRequest
from app.core.contracts.directing.batch import BatchPrepare, BatchRead
from app.services.studio.files import require_available_file
from app.services.directing.store import RevisionConflict
from app.services.directing.provenance import ProvenanceService
from app.core.contracts.directing.provenance import SourceRead, SourceResolveRequest

from app.services.directing.feedback import FeedbackService
from app.core.contracts.directing.feedback import FeedbackRead, FeedbackWrite, ChapterAssemblyRead, TransitionWrite, RepairPlanRequest
from app.core.contracts.directing.ledger import LedgerRead

router = APIRouter(prefix="/projects/{project_id}/directing", tags=["studio/directing"])


async def _call(awaitable):
    """统一翻译领域错误；不把具体业务规则放到路由。"""
    try:
        return await awaitable
    except RevisionConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/video-models/{model_id}/reference-capabilities", response_model=ApiResponse[VideoReferenceCapabilities], operation_id="directing_reference_capabilities")
async def reference_capabilities(project_id: str, model_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回当前视频适配范围，实际提交仍由服务校验文件与组合。"""
    return success_response(await _call(ProductionService(db, project_id).reference_capabilities(model_id)))


@router.get("/chapters/{chapter_id}", response_model=ApiResponse[ChapterSequences], operation_id="directing_chapter")
async def chapter(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回章节原文和有序场次。"""
    return success_response(await _call(ProductionService(db, project_id).list_sequences(chapter_id)))


@router.get("/chapters/{chapter_id}/overview", response_model=ApiResponse[ChapterOverview], operation_id="directing_chapter_overview")
async def chapter_overview(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回有序场次的整场计数与已确认采用身份。"""
    return success_response(await _call(ProductionService(db, project_id).chapter_overview(chapter_id)))


@router.post("/chapters/{chapter_id}/sequences", response_model=ApiResponse[SequenceRead], operation_id="directing_create_sequence")
async def create_sequence(project_id: str, chapter_id: str, body: SequenceCreate, db: AsyncSession = Depends(get_db, scope="function")):
    """确认非空连续原文为正式场次；与同版本已有场次重叠时返回冲突。"""
    return success_response(await _call(ProductionService(db, project_id).write_sequence(chapter_id, body)))


@router.put("/chapters/{chapter_id}/sequences/{sequence_id}", response_model=ApiResponse[SequenceRead], operation_id="directing_update_sequence")
async def update_sequence(project_id: str, chapter_id: str, sequence_id: str, body: SequenceUpdate, db: AsyncSession = Depends(get_db, scope="function")):
    """比较版本修改名称/顺序；仅显式提交 span 才核对来源，新范围不得重叠。"""
    return success_response(await _call(ProductionService(db, project_id).write_sequence(chapter_id, body, sequence_id)))


@router.get("/sequences/{sequence_id}", response_model=ApiResponse[WorkspaceRead], operation_id="directing_workspace")
async def workspace(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """三视图读取同一份场次上下文。"""
    return success_response(await _call(ProductionService(db, project_id).workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/sources/resolve", response_model=ApiResponse[list[SourceRead]], operation_id="directing_resolve_sources")
async def resolve_sources(project_id: str, sequence_id: str, body: SourceResolveRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """批量只读解析来源，归属与历史匹配规则由领域服务维护。"""
    return success_response(await _call(ProvenanceService(db, project_id).resolve_sources(sequence_id, body.sources)))


@router.post("/sequences/{sequence_id}/revisions", response_model=ApiResponse[WorkspaceRead], operation_id="directing_save_revision")
async def save_revision(project_id: str, sequence_id: str, body: RevisionWrite, db: AsyncSession = Depends(get_db, scope="function")):
    """保存设计、计划或粗剪草稿。"""
    service = ProductionService(db, project_id)
    await _call(service.save_workspace_revision(sequence_id, body))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/revisions/{revision_id}/confirm", response_model=ApiResponse[WorkspaceRead], operation_id="directing_confirm_revision")
async def confirm_revision(project_id: str, sequence_id: str, revision_id: str, body: VersionRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """登记本地单用户工作台的显式确认动作。"""
    service = ProductionService(db, project_id)
    await _call(service.revision(revision_id, sequence_id=sequence_id))
    await _call(service.confirm_revision(revision_id, expected_version=body.expected_version, actor_id="local-user"))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/chapters/{chapter_id}/analyze", response_model=ApiResponse[TaskAccepted], operation_id="directing_analyze_chapter")
async def analyze(project_id: str, chapter_id: str, body: AIRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """提交原文划场建议，结果通过通用任务查询。"""
    task = await _call(ProductionService(db, project_id).submit_ai(kind="directing_divide", body=body, chapter_id=chapter_id))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/design", response_model=ApiResponse[TaskAccepted], operation_id="directing_generate_design")
async def design(project_id: str, sequence_id: str, body: AIRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """提交带起始版本的六岗导演设计建议。"""
    task = await _call(ProductionService(db, project_id).submit_ai(kind="directing_design", body=body, sequence_id=sequence_id))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/design/apply", response_model=ApiResponse[WorkspaceRead], operation_id="directing_apply_design")
async def apply_design(project_id: str, sequence_id: str, body: ApplyDesignRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """显式采用已完成任务建议，迟到结果保留为独立草稿。"""
    service = ProductionService(db, project_id)
    await _call(service.apply_design(sequence_id, body.task_id))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/compile", response_model=ApiResponse[CompileResult], operation_id="directing_compile")
async def compile_unit(project_id: str, sequence_id: str, body: CompileRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """明确授权编译所选单元，生成不可变提示词。"""
    service = ProductionService(db, project_id)
    prompt = await _call(service.compile_unit(sequence_id, body.plan_revision_id, body.unit_id, request_id=body.request_id))
    workspace = await _call(service.workspace(sequence_id))
    if not any(row.id == prompt.id for row in workspace.prompts):
        workspace.prompts.append(await _call(service.read_revision(prompt.id, for_update=True)))
    return success_response(CompileResult(**workspace.model_dump(), compiled_prompt_revision_id=prompt.id))


@router.post("/sequences/{sequence_id}/prompts/{prompt_id}/review", response_model=ApiResponse[TaskAccepted], operation_id="directing_review")
async def review(project_id: str, sequence_id: str, prompt_id: str, body: ReviewRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """对固定提示词提交六岗联合审查。"""
    task = await _call(ProductionService(db, project_id).submit_review(sequence_id, prompt_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/review/apply", response_model=ApiResponse[WorkspaceRead], operation_id="directing_apply_review")
async def apply_review(project_id: str, sequence_id: str, body: ApplyDesignRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """保存实际审稿结论供用户查看、修改方案或选择执行。"""
    service = ProductionService(db, project_id)
    await _call(service.apply_review(sequence_id, body.task_id))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post("/sequences/{sequence_id}/shoot", response_model=ApiResponse[TaskAccepted], operation_id="directing_shoot")
async def shoot(project_id: str, sequence_id: str, body: ShootRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """确认固定输入并开始单元试拍，重复请求返回同一任务。"""
    task = await _call(ProductionService(db, project_id).shoot(sequence_id, prompt_id=body.prompt_revision_id,
                                                             review_id=body.review_revision_id, request_id=body.request_id))
    return success_response(TaskAccepted(task_id=task.id))


@router.put("/sequences/{sequence_id}/takes/{take_id}", response_model=ApiResponse[WorkspaceRead], operation_id="directing_annotate_take")
async def annotate_take(project_id: str, sequence_id: str, take_id: str, body: TakeReviewWrite, db: AsyncSession = Depends(get_db, scope="function")):
    """保存过保修废、实际覆盖和保留区间。"""
    service = ProductionService(db, project_id)
    await _call(service.take(take_id, sequence_id=sequence_id))
    await _call(service.annotate_take(take_id, expected_version=body.expected_version, annotation=body.annotation.model_dump(mode="json")))
    return success_response(await _call(service.workspace(sequence_id)))


@router.get("/sequences/{sequence_id}/takes/{take_id}/media", response_model=ApiResponse[MediaRead], operation_id="directing_take_media")
async def take_media(project_id: str, sequence_id: str, take_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回经归属校验的播放器地址，前端不自行拼接后端接口。"""
    service = ProductionService(db, project_id)
    take = await _call(service.take(take_id, sequence_id=sequence_id))
    file = await require_available_file(db, file_id=take.file_id, lock=False, expected_type="video")
    return success_response(MediaRead(take_id=take.id, file_id=file.id,
                                     url=f"/api/v1/studio/files/{file.id}/download", duration_ms=file.duration_ms,
                                     thumbnail_url=f"/api/v1/studio/projects/{project_id}/directing/sequences/{sequence_id}/takes/{take.id}/thumbnail"))


@router.get("/sequences/{sequence_id}/takes/{take_id}/thumbnail", response_class=Response,
            responses={200: {"content": {"image/png": {"schema": {"type": "string", "format": "binary"}}}}},
            operation_id="directing_take_thumbnail")
async def take_thumbnail(project_id: str, sequence_id: str, take_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """读取同等归属保护的真实视频缩略图，派生缓存由服务处理。"""
    content = await _call(ProductionService(db, project_id).take_thumbnail(sequence_id, take_id))
    return Response(content, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/sequences/{sequence_id}/reviews/{review_id}/resolve", response_model=ApiResponse[WorkspaceRead], operation_id="directing_resolve_review")
async def resolve_review(project_id: str, sequence_id: str, review_id: str, body: ReviewDecisionRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """派生保留人工取舍的审稿版本，原报告保持不变。"""
    service = ProductionService(db, project_id)
    await _call(service.resolve_review(sequence_id, review_id, role=body.role, occurrence_id=body.occurrence_id, reason=body.reason))
    return success_response(await _call(service.workspace(sequence_id)))


@router.get("/tasks/{task_id}", response_model=ApiResponse[DirectingTaskRead], operation_id="directing_task")
async def task_detail(project_id: str, task_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """读取当前项目的导演建议和错误，保持业务结果在场次面板。"""
    return success_response(await _call(ReviewRevisionService(db, project_id).read_task(task_id)))


@router.get("/styles", response_model=ApiResponse[list[ProjectStyleRevision]], operation_id="directing_styles")
async def styles(project_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """读取项目的候选与确认风格版本。"""
    return success_response(await _call(ProductionService(db, project_id).list_styles()))


@router.post("/styles", response_model=ApiResponse[list[ProjectStyleRevision]], operation_id="directing_save_style")
async def save_style(project_id: str, body: StyleWrite, db: AsyncSession = Depends(get_db, scope="function")):
    """保存或派生风格草稿，不自动启用。"""
    service = ProductionService(db, project_id)
    await _call(service.save_style(body))
    return success_response(await _call(service.list_styles()))


@router.post("/styles/{revision_id}/confirm", response_model=ApiResponse[list[ProjectStyleRevision]], operation_id="directing_confirm_style")
async def confirm_style(project_id: str, revision_id: str, body: VersionRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """记录人工确认的项目风格版本。"""
    service = ProductionService(db, project_id)
    await _call(service.confirm_style(revision_id, expected_version=body.expected_version, actor_id="local-user"))
    return success_response(await _call(service.list_styles()))


@router.post("/sequences/{sequence_id}/images", response_model=ApiResponse[TaskAccepted], operation_id="directing_generate_visual")
async def generate_visual(project_id: str, sequence_id: str, body: VisualRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """提交基于已确认设计的验证图，产物保留为候选。"""
    task = await _call(ProductionService(db, project_id).generate_visual(sequence_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.get("/assets", response_model=ApiResponse[list[AssetSummary]], operation_id="directing_assets")
async def assets(project_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回当前项目内可关联的角色、场所与道具。"""
    return success_response(await _call(ProductionService(db, project_id).assets()))


@router.post("/sequences/{sequence_id}/assets", response_model=ApiResponse[AssetSummary], operation_id="directing_create_asset")
async def create_asset(project_id: str, sequence_id: str, body: AssetCreateRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """返回本次创建的精确资产身份；请求可重试，设计关联仍须另行保存。"""
    return success_response(await _call(ProductionService(db, project_id).create_asset(sequence_id, body)))


@router.post("/sequences/{sequence_id}/takes/{take_id}/frame", response_model=ApiResponse[ExtractedFrame], operation_id="directing_extract_frame")
async def extract_frame(project_id: str, sequence_id: str, take_id: str, body: ExtractFrameRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """从已归档 Take 的真实位置提取连续性参考图。"""
    return success_response(await _call(ProductionService(db, project_id).extract_take_frame(sequence_id, take_id, body.at_ms)))


@router.post("/sequences/{sequence_id}/batches/prepare", response_model=ApiResponse[BatchRead], operation_id="directing_prepare_batch")
async def prepare_batch(project_id: str, sequence_id: str, body: BatchPrepare, db: AsyncSession = Depends(get_db, scope="function")):
    """固定本轮选择并返回逐项预检，不执行模型请求。"""
    return success_response(await _call(BatchService(db, project_id).prepare_batch(sequence_id, body)))


@router.get("/sequences/{sequence_id}/batches", response_model=ApiResponse[list[BatchRead]], operation_id="directing_batches")
async def batches(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """恢复本场固定批次及各项通用任务状态。"""
    return success_response(await _call(BatchService(db, project_id).list_batches(sequence_id)))


@router.post("/sequences/{sequence_id}/batches/{batch_id}/submit", response_model=ApiResponse[BatchRead], operation_id="directing_submit_batch")
async def submit_batch(project_id: str, sequence_id: str, batch_id: str, body: VersionRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """显式受理已预检批次，重复请求不会新增任务。"""
    return success_response(await _call(BatchService(db, project_id).submit_batch(sequence_id, batch_id, expected_version=body.expected_version)))


@router.post("/sequences/{sequence_id}/regroup", response_model=ApiResponse[WorkspaceRead], operation_id="directing_regroup_units")
async def regroup_units(project_id: str, sequence_id: str, body: RegroupRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """显式拆分/组合产生新计划草稿，原计划和已有素材保持不变。"""
    service = ProductionService(db, project_id)
    await _call(service.regroup_units(sequence_id, body))
    return success_response(await _call(service.workspace(sequence_id)))


@router.get("/sequences/{sequence_id}/continuity", response_model=ApiResponse[ContinuityRead], operation_id="directing_continuity")
async def continuity(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回当前真实连续性与局部失效状态。"""
    return success_response(await _call(ContinuityService(db, project_id).continuity(sequence_id)))


@router.post("/sequences/{sequence_id}/cut-frames", response_model=ApiResponse[CutFrameRead], operation_id="directing_cut_frame")
async def cut_frame(project_id: str, sequence_id: str, body: CutFrameRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """从已确认采用区间提帧并固定来源。"""
    return success_response(await _call(ContinuityService(db, project_id).extract_cut_frame(sequence_id, body)))


@router.post("/sequences/{sequence_id}/seam-reviews", response_model=ApiResponse[ContinuityRead], operation_id="directing_review_seam")
async def review_seam(project_id: str, sequence_id: str, body: SeamReviewRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """保存针对真实相邻片段的人工接缝结论。"""
    return success_response(await _call(ContinuityService(db, project_id).review_seam(sequence_id, body)))


@router.get('/sequences/{sequence_id}/feedback', response_model=ApiResponse[FeedbackRead], operation_id='directing_feedback')
async def feedback(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """返回当前验收、返工与经验候选的持久版本。"""
    return success_response(await _call(FeedbackService(db, project_id).feedback(sequence_id)))


@router.post('/sequences/{sequence_id}/feedback', response_model=ApiResponse[FeedbackRead], operation_id='directing_save_feedback')
async def save_feedback(project_id: str, sequence_id: str, body: FeedbackWrite, db: AsyncSession = Depends(get_db, scope='function')):
    """保存强类型反馈草稿，艺术判断由其来源承担。"""
    service = FeedbackService(db, project_id)
    await _call(service.write_feedback(sequence_id, body))
    return success_response(await _call(service.feedback(sequence_id)))


@router.post('/sequences/{sequence_id}/feedback/{revision_id}/confirm', response_model=ApiResponse[FeedbackRead], operation_id='directing_confirm_feedback')
async def confirm_feedback(project_id: str, sequence_id: str, revision_id: str, body: VersionRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """显式确认当前反馈草稿，旧采用上的审片不能成为当前验收。"""
    service = FeedbackService(db, project_id)
    row = await _call(service.revision(revision_id, sequence_id=sequence_id))
    if row.kind not in ('cut_review', 'repair', 'knowledge'):
        raise HTTPException(status_code=422, detail='不是反馈记录')
    await _call(service.confirm_revision(revision_id, expected_version=body.expected_version, actor_id='local-user'))
    return success_response(await _call(service.feedback(sequence_id)))


@router.get('/sequences/{sequence_id}/ledger', response_model=ApiResponse[LedgerRead], operation_id='directing_ledger')
async def ledger(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """只读汇总三本账，不提供第二份台账编辑入口。"""
    return success_response(await _call(FeedbackService(db, project_id).ledger(sequence_id)))


@router.get('/chapters/{chapter_id}/assembly', response_model=ApiResponse[ChapterAssemblyRead], operation_id='directing_chapter_assembly')
async def chapter_assembly(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """查询章节顺序播放依据、验收缺口与跨场审查。"""
    return success_response(await _call(FeedbackService(db, project_id).chapter_assembly(chapter_id)))


@router.post('/chapters/{chapter_id}/transitions', response_model=ApiResponse[ChapterAssemblyRead], operation_id='directing_review_transition')
async def review_transition(project_id: str, chapter_id: str, body: TransitionWrite, db: AsyncSession = Depends(get_db, scope='function')):
    """保存人工跨场审查，校验相邻顺序及实际边界。"""
    return success_response(await _call(FeedbackService(db, project_id).review_transition(chapter_id, body)))


@router.post('/sequences/{sequence_id}/knowledge/{revision_id}/style', response_model=ApiResponse[list[ProjectStyleRevision]], operation_id='directing_knowledge_style')
async def knowledge_style(project_id: str, sequence_id: str, revision_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """从已确认经验显式准备项目风格草稿，未自动确认或应用。"""
    service = FeedbackService(db, project_id)
    await _call(service.propose_style(sequence_id, revision_id))
    return success_response(await _call(service.list_styles()))


@router.post('/sequences/{sequence_id}/repairs/{revision_id}/plan', response_model=ApiResponse[WorkspaceRead], operation_id='directing_prepare_repair_plan')
async def prepare_repair_plan(project_id: str, sequence_id: str, revision_id: str, body: RepairPlanRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """从确认的返工单创建显式局部生产草稿，继续走正常确认、编译和执行。"""
    service = FeedbackService(db, project_id)
    await _call(service.prepare_repair_plan(sequence_id, revision_id, body))
    return success_response(await _call(service.workspace(sequence_id)))


@router.post('/sequences/{sequence_id}/review-revisions', response_model=ApiResponse[TaskAccepted], operation_id='directing_generate_review_revision')
async def generate_review_revision(project_id: str, sequence_id: str, body: ReviewRevisionRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """冻结检查和方向并生成局部候选，不写入设计。"""
    task = await _call(ReviewRevisionService(db, project_id).generate_revision(sequence_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.post('/sequences/{sequence_id}/review-revisions/apply', response_model=ApiResponse[ReviewRevisionApplication], operation_id='directing_apply_review_revision')
async def apply_review_revision(project_id: str, sequence_id: str, body: ApplyReviewRevisionRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """采用已展示修改并恢复编译与重新检查，绝不提交拍摄。"""
    return success_response(await _call(ReviewRevisionService(db, project_id).apply_revision(sequence_id, body)))


@router.get('/sequences/{sequence_id}/review-revisions/fields', response_model=ApiResponse[EditableRevisionFields], operation_id='directing_revision_fields')
async def revision_fields(project_id: str, sequence_id: str, prompt_revision_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取当前指令允许修改的字段。"""
    return success_response(await _call(ReviewRevisionService(db, project_id).editable_fields(sequence_id, prompt_revision_id)))


@router.post('/sequences/{sequence_id}/review-revisions/preview', response_model=ApiResponse[TaskAccepted], operation_id='directing_preview_review_revision')
async def preview_review_revision(project_id: str, sequence_id: str, body: ReviewRevisionRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """直接编辑生成可恢复的同步预览，不调用 AI。"""
    task = await _call(ReviewRevisionService(db, project_id).preview_revision(sequence_id, body))
    return success_response(TaskAccepted(task_id=task.id))
