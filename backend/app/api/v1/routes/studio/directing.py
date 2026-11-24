"""场次工作区 API；业务校验由领域服务负责，事务必须在响应发送前提交。"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.workspace import (
    RegroupRequest, ExtractFrameRequest, ExtractedFrame, AssetSummary, AssetCreateRequest, VisualRequest, AIRequest, ApplyDesignRequest, ChapterOverview, ChapterSequences, RevisionWrite, SequenceCreate, SequenceRead,
    CompileRequest, CompileResult, ReviewRequest, ShootRequest, TakeReviewWrite, MediaRead, ReviewDecisionRequest, DirectingTaskRead,
    SequenceUpdate, TaskAccepted, VersionRequest, WorkspaceRead,
)
from app.core.contracts.directing.division import DivisionDraft, DivisionPreview, DivisionSave, DivisionSaved
from app.services.directing.division import DivisionService
from app.services.directing.shooting_preparation import ShootingPreparationService
from app.core.contracts.directing.shooting_preparation import ShootingExplanationSave, ShootingExplanationRead, ShootingCheckRequest, ShootingCheckRead
from app.core.contracts.directing.workbench_management import ChapterWorkbenchManagement
from app.services.directing.workbench_management import WorkbenchManagementService
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate, SceneCanvasesRead
from app.schemas.generation_canvas import CanvasRead
from app.core.contracts.directing.scene_storyboard import (StoryboardApplication, StoryboardBasis, StoryboardCheckRequest, StoryboardDiff,
    StoryboardReextractRequest, StoryboardRequest, StoryboardRestore, StoryboardRetry, StoryboardRetryBasis,
    StoryboardTaskRead, StoryboardTaskSummary)
from app.services.directing.scene_storyboard import SceneStoryboardService
from app.services.generation_canvas.generation_inputs import storyboard_generation_inputs
from app.services.generation_canvas.lifecycle import scene_canvas_lifecycle
from app.core.contracts.directing.scene_objects import (
    ObjectExtractionRequest, SceneObjectCandidateApplication, SceneObjectCandidateReceipt, SceneObjectCandidateReview,
    SceneObjectChoice, SceneObjectsRead, SceneObjectTaskRead,
)
from app.services.directing.scene_objects import SceneObjectService
from app.core.contracts.directing.division_history import DivisionAnalysisDetail, DivisionHistoryPage, DivisionVersionDetail
from app.services.directing.division_history import DivisionHistoryService
from app.core.contracts.directing.style import ProjectStyleRevision, StyleWrite
from app.core.contracts.video_generation import VideoReferenceCapabilities
from app.dependencies import get_db
from app.schemas.common import ApiResponse, created_response, success_response
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
from app.core.contracts.directing.feedback import FeedbackRead, FeedbackWrite, RepairPlanRequest
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


@router.get("/chapters/{chapter_id}/shooting-checks", response_model=ApiResponse[ShootingCheckRead | None],
            operation_id="directing_shooting_check_latest")
async def shooting_check_latest(project_id: str, chapter_id: str, source_version: str = Query(min_length=1, max_length=64),
                                 db: AsyncSession = Depends(get_db, scope="function")):
    """按原文版本读取最近一次整章检查。"""
    return success_response(await _call(ShootingPreparationService(db, project_id).latest_check(chapter_id, source_version)))


@router.post("/chapters/{chapter_id}/shooting-checks", response_model=ApiResponse[ShootingCheckRead],
             operation_id="directing_shooting_check_submit")
async def shooting_check_submit(project_id: str, chapter_id: str, body: ShootingCheckRequest,
                                 db: AsyncSession = Depends(get_db, scope="function")):
    """检查整章原文及其拍摄解释。"""
    return success_response(await _call(ShootingPreparationService(db, project_id).submit_check(chapter_id, body)))


@router.get("/chapters/{chapter_id}/shooting-checks/{task_id}", response_model=ApiResponse[ShootingCheckRead],
            operation_id="directing_shooting_check_read")
async def shooting_check_read(project_id: str, chapter_id: str, task_id: str,
                               db: AsyncSession = Depends(get_db, scope="function")):
    """读取当前或历史检查的原始结果。"""
    return success_response(await _call(ShootingPreparationService(db, project_id).read_check(chapter_id, task_id)))


@router.get("/chapters/{chapter_id}/shooting-explanations",
            response_model=ApiResponse[ShootingExplanationRead], operation_id="directing_shooting_explanations")
async def shooting_explanations(project_id: str, chapter_id: str, source_version: str = Query(min_length=1, max_length=64),
                                db: AsyncSession = Depends(get_db, scope="function")):
    """读取当前选择的原文版本的拍摄解释。"""
    return success_response(await _call(ShootingPreparationService(db, project_id).read_preparation(chapter_id, source_version)))


@router.put("/chapters/{chapter_id}/shooting-explanations",
            response_model=ApiResponse[ShootingExplanationRead], operation_id="directing_shooting_explanations_save")
async def save_shooting_explanations(project_id: str, chapter_id: str,
                                     body: ShootingExplanationSave, db: AsyncSession = Depends(get_db, scope="function")):
    """独立保存拍摄解释。"""
    return success_response(await _call(ShootingPreparationService(db, project_id).save_preparation(chapter_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/canvases",
            response_model=ApiResponse[SceneCanvasesRead], operation_id="directing_scene_canvases")
async def scene_canvases(project_id: str, chapter_id: str, sequence_id: str,
                         db: AsyncSession = Depends(get_db, scope="function")):
    """读取场次准备页的原文摘要与独立画布。"""
    return success_response(await scene_canvas_lifecycle(db, project_id).read_canvases(chapter_id, sequence_id))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/canvases",
             response_model=ApiResponse[CanvasRead], operation_id="directing_scene_canvas_create")
async def create_scene_canvas(project_id: str, chapter_id: str, sequence_id: str, body: SceneCanvasCreate,
                              db: AsyncSession = Depends(get_db, scope="function")):
    """建立本场空白画布及固定原文依据。"""
    return created_response(await _call(scene_canvas_lifecycle(db, project_id).create_canvas(chapter_id, sequence_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/objects",
            response_model=ApiResponse[SceneObjectsRead], operation_id="directing_scene_objects")
async def scene_objects(project_id: str, chapter_id: str, sequence_id: str,
                        db: AsyncSession = Depends(get_db, scope="function")):
    """读取当前对象候选、准备图片及最近的提取任务。"""
    return success_response(await SceneObjectService(db, project_id).read_objects(chapter_id, sequence_id))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions",
             response_model=ApiResponse[SceneObjectTaskRead], operation_id="directing_scene_object_extract")
async def extract_scene_objects(project_id: str, chapter_id: str, sequence_id: str, body: ObjectExtractionRequest,
                                db: AsyncSession = Depends(get_db, scope="function")):
    """明确启动场次对象提取，不提交媒体或分镜。"""
    return success_response(await _call(SceneObjectService(db, project_id).submit_extraction(chapter_id, sequence_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions/{task_id}/candidate",
            response_model=ApiResponse[SceneObjectCandidateReview], operation_id="directing_scene_object_candidate")
async def read_scene_object_candidate(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                                      db: AsyncSession = Depends(get_db, scope="function")):
    """读取指定对象提取任务，可用时返回冻结对象和当前准备的整批差异。"""
    return success_response(await SceneObjectService(db, project_id).read_candidate(chapter_id, sequence_id, task_id))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions/{task_id}/discard",
             response_model=ApiResponse[SceneObjectTaskRead], operation_id="directing_scene_object_candidate_discard")
async def discard_scene_object_candidate(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                                         db: AsyncSession = Depends(get_db, scope="function")):
    """忽略本次未应用候选，保留已保存的对象与资源引用。"""
    return success_response(await _call(SceneObjectService(db, project_id).discard_candidate(chapter_id, sequence_id, task_id)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/objects/extractions/{task_id}/apply",
             response_model=ApiResponse[SceneObjectCandidateReceipt], operation_id="directing_scene_object_candidate_apply")
async def apply_scene_object_candidate(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                                       body: SceneObjectCandidateApplication, db: AsyncSession = Depends(get_db, scope="function")):
    """确认应用已核对的整批对象，响应未知可用相同命令核实。"""
    return success_response(await _call(SceneObjectService(db, project_id).apply_candidate(chapter_id, sequence_id, task_id, body)))


@router.put("/chapters/{chapter_id}/sequences/{sequence_id}/objects/{object_id}",
            response_model=ApiResponse[SceneObjectsRead], operation_id="directing_scene_object_choose")
async def choose_scene_object_reference(project_id: str, chapter_id: str, sequence_id: str, object_id: str,
                                        body: SceneObjectChoice, db: AsyncSession = Depends(get_db, scope="function")):
    """只保存本场对象候选的资产和参考图片选择。"""
    return success_response(await _call(SceneObjectService(db, project_id).save_choice(chapter_id, sequence_id, object_id, body)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards",
             response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_storyboard_submit")
async def submit_storyboard(project_id: str, chapter_id: str, sequence_id: str, body: StoryboardRequest,
                            db: AsyncSession = Depends(get_db, scope="function")):
    """显式建立目标画布并提交文本分镜任务。"""
    return created_response(await _call(SceneStoryboardService(db, project_id).submit_storyboard(chapter_id, sequence_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/basis",
            response_model=ApiResponse[StoryboardBasis], operation_id="directing_storyboard_basis")
async def storyboard_basis(project_id: str, chapter_id: str, sequence_id: str,
                           db: AsyncSession = Depends(get_db, scope="function")):
    """读取创建分镜画布前用户可核对的实际依据。"""
    return success_response(await _call(storyboard_generation_inputs(db, project_id).read_storyboard_basis(chapter_id, sequence_id)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/storyboards/candidate",
            response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_storyboard_candidate")
async def read_canvas_candidate(project_id: str, chapter_id: str, sequence_id: str, canvas_id: str,
                                task_id: str | None = None, db: AsyncSession = Depends(get_db, scope="function")):
    """为共同工作区读取同一目标画布的待应用候选。"""
    return success_response(await SceneStoryboardService(db, project_id).read_canvas_candidate(
        chapter_id, sequence_id, canvas_id, task_id))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/storyboards",
             response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_storyboard_reextract")
async def reextract_storyboard(project_id: str, chapter_id: str, sequence_id: str, canvas_id: str,
                               body: StoryboardReextractRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """针对既有场次画布创建可核对的重新提取任务。"""
    return created_response(await _call(SceneStoryboardService(db, project_id).reextract_storyboard(
        chapter_id, sequence_id, canvas_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards",
            response_model=ApiResponse[list[StoryboardTaskSummary]], operation_id="directing_storyboard_list")
async def list_storyboards(project_id: str, chapter_id: str, sequence_id: str, canvas_id: str | None = None,
                           db: AsyncSession = Depends(get_db, scope="function")):
    """读取本场或本画布近期任务的真实状态。"""
    return success_response(await _call(SceneStoryboardService(db, project_id).list_storyboards(chapter_id, sequence_id, canvas_id)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/retry",
             response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_storyboard_retry")
async def retry_storyboard(project_id: str, chapter_id: str, sequence_id: str, task_id: str, body: StoryboardRetry,
                           db: AsyncSession = Depends(get_db, scope="function")):
    """在同一画布恢复失败任务，原任务及已保存内容保持可查。"""
    return created_response(await _call(SceneStoryboardService(db, project_id).retry_storyboard(chapter_id, sequence_id, task_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/continuity-check",
            response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_saved_storyboard_check_get")
async def read_saved_storyboard_check(project_id: str, chapter_id: str, sequence_id: str, canvas_id: str,
                                      db: AsyncSession = Depends(get_db, scope="function")):
    """Read the latest explicit check without starting work."""
    return success_response(await _call(SceneStoryboardService(db, project_id).saved_check(chapter_id, sequence_id, canvas_id)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/canvases/{canvas_id}/continuity-check",
             response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_saved_storyboard_check_submit")
async def submit_saved_storyboard_check(project_id: str, chapter_id: str, sequence_id: str, canvas_id: str, body: StoryboardCheckRequest,
                                        db: AsyncSession = Depends(get_db, scope="function")):
    """Review the saved design only after explicit admission."""
    return created_response(await _call(SceneStoryboardService(db, project_id).saved_check(chapter_id, sequence_id, canvas_id, body)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/retry/basis",
            response_model=ApiResponse[StoryboardRetryBasis], operation_id="directing_storyboard_retry_basis")
async def storyboard_retry_basis(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                                 db: AsyncSession = Depends(get_db, scope="function")):
    """读取重试原画布时实际采用的原文、对象参考和模型。"""
    return success_response(await _call(storyboard_generation_inputs(db, project_id).read_storyboard_retry_basis(
        chapter_id, sequence_id, task_id)))


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}",
            response_model=ApiResponse[StoryboardTaskRead], operation_id="directing_storyboard_get")
async def read_storyboard(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                          db: AsyncSession = Depends(get_db, scope="function")):
    """读取当前任务状态、候选和应用基线。"""
    return success_response(await _call(SceneStoryboardService(db, project_id).read_storyboard(chapter_id, sequence_id, task_id)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/diff",
             response_model=ApiResponse[StoryboardDiff], operation_id="directing_storyboard_diff")
async def preview_storyboard_application(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                                         body: StoryboardApplication, db: AsyncSession = Depends(get_db, scope="function")):
    """核对当前修订的卡片差异及保留影响。"""
    return success_response(await _call(SceneStoryboardService(db, project_id).apply_storyboard(
        chapter_id, sequence_id, task_id, body, preview=True)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/apply",
             response_model=ApiResponse[CanvasRead], operation_id="directing_storyboard_apply")
async def apply_storyboard(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                           body: StoryboardApplication, db: AsyncSession = Depends(get_db, scope="function")):
    """明确应用本场候选，原子保存已核对的共同文档。"""
    return success_response(await _call(SceneStoryboardService(db, project_id).apply_storyboard(
        chapter_id, sequence_id, task_id, body)))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/storyboards/{task_id}/restore",
             response_model=ApiResponse[CanvasRead], operation_id="directing_storyboard_restore")
async def restore_storyboard(project_id: str, chapter_id: str, sequence_id: str, task_id: str,
                              body: StoryboardRestore, db: AsyncSession = Depends(get_db, scope="function")):
    """在真实应用回执约束下撤销或重做同一批次。"""
    return success_response(await _call(SceneStoryboardService(db, project_id).restore_storyboard(
        chapter_id, sequence_id, task_id, body)))


@router.get("/chapters/{chapter_id}/workbench-management", response_model=ApiResponse[ChapterWorkbenchManagement],
            operation_id="directing_chapter_workbench_management")
async def chapter_workbench_management(project_id: str, chapter_id: str,
                                       db: AsyncSession = Depends(get_db, scope="function")):
    """读取章节工作台管理的轻量摘要。"""
    return success_response(await _call(WorkbenchManagementService(db, project_id).chapter_management(chapter_id)))


@router.get("/chapters/{chapter_id}/overview", response_model=ApiResponse[ChapterOverview], operation_id="directing_chapter_overview")
async def chapter_overview(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """返回有序场次的整场计数与已确认采用身份。"""
    return success_response(await _call(ProductionService(db, project_id).chapter_overview(chapter_id)))


@router.get("/chapters/{chapter_id}/history", response_model=ApiResponse[list[SequenceRead]], operation_id="directing_chapter_history")
async def chapter_history(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """按需列出历史场次，不参与当前数量与章节组合。"""
    return success_response(await _call(DivisionService(db, project_id).historical_sequences(chapter_id)))


@router.get("/chapters/{chapter_id}/division/history", response_model=ApiResponse[DivisionHistoryPage], operation_id="directing_division_history")
async def division_history(project_id: str, chapter_id: str, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), db: AsyncSession = Depends(get_db, scope="function")):
    """分页列出保存版本及未关联的分析记录，不加载所有历史正文。"""
    return success_response(await _call(DivisionHistoryService(db, project_id).history(chapter_id, page=page, page_size=page_size)))


@router.get("/chapters/{chapter_id}/division/versions/{version_id}", response_model=ApiResponse[DivisionVersionDetail], operation_id="directing_division_version")
async def division_version(project_id: str, chapter_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """按需读取保存时的完整快照；查看不切换当前版本。"""
    return success_response(await _call(DivisionHistoryService(db, project_id).version_detail(chapter_id, version_id)))


@router.get("/chapters/{chapter_id}/division/analyses/{task_id}", response_model=ApiResponse[DivisionAnalysisDetail], operation_id="directing_division_analysis")
async def division_analysis(project_id: str, chapter_id: str, task_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """展开分析时按需读取业务快照与资料缺失说明。"""
    return success_response(await _call(DivisionHistoryService(db, project_id).analysis_detail(chapter_id, task_id)))


@router.post("/chapters/{chapter_id}/division/preview", response_model=ApiResponse[DivisionPreview], operation_id="directing_preview_division")
async def preview_division(project_id: str, chapter_id: str, body: DivisionDraft, db: AsyncSession = Depends(get_db, scope="function")):
    """校验最终范围和完整集合，返回实际影响及阻塞；不写正式场次。"""
    return success_response(await _call(DivisionService(db, project_id).preview_division(chapter_id, body)))


@router.put("/chapters/{chapter_id}/division", response_model=ApiResponse[DivisionSaved], operation_id="directing_save_division")
async def save_division(project_id: str, chapter_id: str, body: DivisionSave, db: AsyncSession = Depends(get_db, scope="function")):
    """确认预览后原子保存；同请求同内容重试返回回执，不重复创建。"""
    return success_response(await _call(DivisionService(db, project_id).save_division(chapter_id, body)))


@router.get("/chapters/{chapter_id}/division/receipts/{request_id}", response_model=ApiResponse[DivisionSaved | None], operation_id="directing_division_receipt")
async def division_receipt(project_id: str, chapter_id: str, request_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """响应丢失后核对回执；不存在返回 null，不能据此更换请求身份盲目重放。"""
    return success_response(await _call(DivisionService(db, project_id).division_receipt(chapter_id, request_id)))


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
