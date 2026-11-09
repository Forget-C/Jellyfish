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
from app.core.contracts.directing.workbench_management import ChapterWorkbenchManagement
from app.services.directing.workbench_management import WorkbenchManagementService
from app.core.contracts.directing.scene_canvas import SceneCanvasCreate, SceneCanvasesRead
from app.schemas.generation_canvas import CanvasRead
from app.core.contracts.directing.scene_storyboard import StoryboardApplication, StoryboardDiff, StoryboardReextractRequest, StoryboardRequest, StoryboardRestore, StoryboardRetry, StoryboardTaskRead, StoryboardTaskSummary
from app.services.directing.scene_storyboard import SceneStoryboardService
from app.services.directing.scene_canvas import SceneCanvasService
from app.core.contracts.directing.scene_objects import ObjectExtractionRequest, SceneObjectChoice, SceneObjectsRead, SceneObjectTaskRead
from app.services.directing.scene_objects import SceneObjectService
from app.core.contracts.directing.division_history import DivisionAnalysisDetail, DivisionHistoryPage, DivisionReceiptDetail, DivisionVersionDetail
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
from app.services.directing.store import DirectingStore, RevisionConflict
from app.core.contracts.directing.scene_delivery import SceneDeliveryCreate, SceneDeliveryRead, ChapterDeliveriesRead
from app.services.directing.scene_delivery import SceneDeliveryService
from app.services.directing.scene_take import SceneTakeService
from app.core.contracts.directing.scene_take_library import SceneTakeLibraryRead
from app.core.contracts.directing.scene_end_frame import SceneEndFrameCreate, SceneEndFrameRead
from app.services.directing.scene_end_frame import SceneEndFrameService
from app.core.contracts.directing.scene_seam_review import SceneSeamReviewCreate, SceneSeamReviewRead
from app.services.directing.scene_seam_review import SceneSeamReviewService
from app.core.contracts.directing.scene_cut_review import SceneCutReviewCreate, SceneCutReviewRead
from app.services.directing.scene_cut_review import SceneCutReviewService
from app.core.contracts.directing.scene_take_review import SceneTakeReviewRead, SceneTakeReviewConfirm
from app.core.contracts.directing.scene_instruction import SceneInstructionApply, SceneInstructionRequest, SceneInstructionPreview, SceneInstructionSuggestionRead
from app.services.directing.scene_instruction import SceneInstructionService
from app.core.contracts.directing.instruction_check import InstructionCheckRequest, InstructionCheckRead, InstructionCheckComparison, InstructionCheckConfirmation
from app.core.contracts.directing.scene_video import SceneVideoRetryRequest, SceneVideoPrepareRequest, SceneVideoPreparation, SceneVideoSubmitRequest, SceneVideoRead, SceneVideoSaveRequest, SceneVideoSaveResult
from app.services.directing.scene_video import SceneVideoService
from app.services.directing.instruction_check import InstructionCheckService
from app.services.directing.instruction_basis import InstructionBasisService
from app.core.contracts.directing.instruction_basis import InstructionBasisConfirm, InstructionBasisRead
from app.core.contracts.directing.scene_copy import SceneVersionCopy, SceneCopyReadiness
from app.services.directing.scene_copy import SceneCopyService
from app.core.contracts.directing.scene_export import SceneExportRequest, SceneExportRead, SceneExportRetry, SceneExportInspect, SceneExportInspection
from app.services.directing.scene_export import SceneExportService
from app.core.contracts.directing.scene_version import SceneIdentityCleanup, SceneVersionCreate, SceneVersionRead, SceneVersionSave, SceneVersionContent, SceneUnitCanvasPreview
from app.core.contracts.directing.canvas_graph import UnitCanvasGraph
from app.core.contracts.directing.scene_design import SceneDesignRequest, SceneDesignPreviewRequest, SceneDesignPreview, SceneDesignSuggestionRead
from app.services.directing.scene_design import SceneDesignService
from app.services.directing.scene_unit_design import SceneUnitDesignService
from app.core.contracts.directing.scene_unit_design import SceneUnitDesignRequest, SceneUnitDesignPreviewRequest, SceneUnitDesignSuggestionRead, SceneUnitDesignPreview
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


@router.get("/chapters/{chapter_id}/sequences/{sequence_id}/canvases",
            response_model=ApiResponse[SceneCanvasesRead], operation_id="directing_scene_canvases")
async def scene_canvases(project_id: str, chapter_id: str, sequence_id: str,
                         db: AsyncSession = Depends(get_db, scope="function")):
    """读取场次准备页的原文摘要与独立画布。"""
    return success_response(await SceneCanvasService(db, project_id).read_canvases(chapter_id, sequence_id))


@router.post("/chapters/{chapter_id}/sequences/{sequence_id}/canvases",
             response_model=ApiResponse[CanvasRead], operation_id="directing_scene_canvas_create")
async def create_scene_canvas(project_id: str, chapter_id: str, sequence_id: str, body: SceneCanvasCreate,
                              db: AsyncSession = Depends(get_db, scope="function")):
    """建立本场空白画布及固定原文依据。"""
    return created_response(await _call(SceneCanvasService(db, project_id).create_canvas(chapter_id, sequence_id, body)))


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


@router.get("/chapters/{chapter_id}/division/history/receipts/{request_id}", response_model=ApiResponse[DivisionReceiptDetail], operation_id="directing_division_legacy_receipt")
async def division_legacy_receipt(project_id: str, chapter_id: str, request_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """只读查看尚未接入的旧保存记录，缺失数据保留说明。"""
    return success_response(await _call(DivisionHistoryService(db, project_id).receipt_detail(chapter_id, request_id)))


@router.get("/chapters/{chapter_id}/division/analyses/{task_id}", response_model=ApiResponse[DivisionAnalysisDetail], operation_id="directing_division_analysis")
async def division_analysis(project_id: str, chapter_id: str, task_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """展开分析时读取业务快照，旧资料缺失不冒充完整版本。"""
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


@router.get('/sequences/{sequence_id}/versions', response_model=ApiResponse[list[SceneVersionRead]], operation_id='directing_scene_versions')
async def scene_versions(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """浏览已存在方案；当前可编辑版本在投影前受控整理已保存的身份参考。"""
    return success_response(await _call(DirectingStore(db, project_id).open_scene_versions(sequence_id)))


@router.post('/sequences/{sequence_id}/versions', response_model=ApiResponse[SceneVersionRead], operation_id='directing_create_scene_version')
async def create_scene_version(project_id: str, sequence_id: str, body: SceneVersionCreate, db: AsyncSession = Depends(get_db, scope='function')):
    """显式创建空方案，历史执行记录不变。"""
    return success_response(await _call(DirectingStore(db, project_id).create_scene_version(sequence_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}', response_model=ApiResponse[SceneVersionRead], operation_id='directing_scene_version')
async def scene_version(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """打开方案；当前可编辑版本在投影前受控整理已保存的身份参考。"""
    return success_response(await _call(DirectingStore(db, project_id).open_scene_version(sequence_id, version_id)))


@router.put('/sequences/{sequence_id}/versions/{version_id}', response_model=ApiResponse[SceneVersionRead], operation_id='directing_save_scene_version')
async def save_scene_version(project_id: str, sequence_id: str, version_id: str, body: SceneVersionSave, db: AsyncSession = Depends(get_db, scope='function')):
    """更新同一版本，保存并不确认设计或发起执行。"""
    return success_response(await _call(DirectingStore(db, project_id).save_scene_version(sequence_id, version_id, body)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/unit-canvas/preview', response_model=ApiResponse[UnitCanvasGraph], operation_id='directing_preview_unit_canvas')
async def preview_unit_canvas(project_id: str, sequence_id: str, version_id: str, body: SceneUnitCanvasPreview, db: AsyncSession = Depends(get_db, scope='function')):
    """只读投影当前编辑的单元卡片，不保存版本或创建任务。"""
    return success_response(await _call(DirectingStore(db, project_id).preview_unit_canvas(sequence_id, version_id, body)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/identity-references/cleanup', response_model=ApiResponse[SceneVersionRead], operation_id='directing_cleanup_identity_references')
async def cleanup_identity_references(project_id: str, sequence_id: str, version_id: str, body: SceneIdentityCleanup, db: AsyncSession = Depends(get_db, scope='function')):
    """受控整理已保存的可编辑身份参考；业务范围和 CAS 由存储层核实。"""
    return success_response(await _call(DirectingStore(db, project_id).cleanup_identity_references(sequence_id, version_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/copy-readiness', response_model=ApiResponse[SceneCopyReadiness], operation_id='directing_scene_copy_readiness')
async def scene_copy_readiness(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """核实当前关联任务，取消请求与终态分别表达。"""
    return success_response(await _call(SceneCopyService(db, project_id).copy_readiness(sequence_id, version_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/copy', response_model=ApiResponse[SceneVersionRead], operation_id='directing_copy_scene_version')
async def copy_scene_version(project_id: str, sequence_id: str, version_id: str, body: SceneVersionCopy, db: AsyncSession = Depends(get_db, scope='function')):
    """复制点击时完整内容，事务内重新核验，不预先保存原版本。"""
    return success_response(await _call(SceneCopyService(db, project_id).copy_version(sequence_id, version_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/take-library', response_model=ApiResponse[list[SceneTakeLibraryRead]], operation_id='directing_scene_take_library')
async def scene_take_library(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """浏览同场次素材及其原生产依据，不复制或写入判断。"""
    return success_response(await _call(SceneTakeService(db, project_id).list_scene_takes(sequence_id, version_id)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/take-reviews', response_model=ApiResponse[list[SceneTakeReviewRead]], operation_id='directing_scene_take_reviews')
async def scene_take_reviews(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """只读查看当前版本的固定素材审片记录。"""
    return success_response(await _call(SceneTakeService(db, project_id).list_take_reviews(sequence_id, version_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/take-reviews', response_model=ApiResponse[SceneTakeReviewRead], operation_id='directing_confirm_scene_take_review')
async def confirm_scene_take_review(project_id: str, sequence_id: str, version_id: str, body: SceneTakeReviewConfirm, db: AsyncSession = Depends(get_db, scope='function')):
    """明确复核当前已保存判断，或核实同一保存修订的既有复核记录。"""
    return success_response(await _call(SceneTakeService(db, project_id).confirm_take_review(sequence_id, version_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/cut-reviews', response_model=ApiResponse[list[SceneCutReviewRead]], operation_id='directing_scene_cut_reviews')
async def scene_cut_reviews(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """查看固定整场验收及当前适用性，不更新既有记录。"""
    return success_response(await _call(SceneCutReviewService(db, project_id).list_cut_reviews(sequence_id, version_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/cut-reviews', response_model=ApiResponse[SceneCutReviewRead], operation_id='directing_create_scene_cut_review')
async def create_scene_cut_review(project_id: str, sequence_id: str, version_id: str, body: SceneCutReviewCreate, db: AsyncSession = Depends(get_db, scope='function')):
    """明确记录已保存剪辑的人工结论，或核实原请求结果。"""
    return success_response(await _call(SceneCutReviewService(db, project_id).create_cut_review(sequence_id, version_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/end-frames', response_model=ApiResponse[list[SceneEndFrameRead]], operation_id='directing_scene_end_frames')
async def scene_end_frames(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取原素材实际落幅及其当前适用性。"""
    return success_response(await _call(SceneEndFrameService(db, project_id).list_end_frames(sequence_id, version_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/end-frames', response_model=ApiResponse[SceneEndFrameRead], operation_id='directing_create_scene_end_frame')
async def create_scene_end_frame(project_id: str, sequence_id: str, version_id: str, body: SceneEndFrameCreate, db: AsyncSession = Depends(get_db, scope='function')):
    """显式提取保存采用的真实边界，不替换依赖或启动生成。"""
    return success_response(await _call(SceneEndFrameService(db, project_id).create_end_frame(sequence_id, version_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/seam-reviews', response_model=ApiResponse[list[SceneSeamReviewRead]], operation_id='directing_scene_seam_reviews')
async def scene_seam_reviews(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """查看固定接缝审查及当前适用性，不更新既有记录。"""
    return success_response(await _call(SceneSeamReviewService(db, project_id).list_seam_reviews(sequence_id, version_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/seam-reviews', response_model=ApiResponse[SceneSeamReviewRead], operation_id='directing_create_scene_seam_review')
async def create_scene_seam_review(project_id: str, sequence_id: str, version_id: str, body: SceneSeamReviewCreate, db: AsyncSession = Depends(get_db, scope='function')):
    """明确记录已保存真实接缝的人工结论，或核实原请求结果。"""
    return success_response(await _call(SceneSeamReviewService(db, project_id).create_seam_review(sequence_id, version_id, body)))


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


@router.get("/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions", response_model=ApiResponse[list[SceneUnitDesignSuggestionRead]], operation_id="directing_scene_unit_design_suggestions")
async def scene_unit_design_suggestions(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """读取本版本的单元组织任务和只读结果。"""
    return success_response(await _call(SceneUnitDesignService(db, project_id).list_unit_design(sequence_id, version_id)))


@router.post("/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions", response_model=ApiResponse[TaskAccepted], operation_id="directing_scene_unit_design_suggest")
async def scene_unit_design_suggest(project_id: str, sequence_id: str, version_id: str, body: SceneUnitDesignRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """明确目标视频模型后冻结本次组织请求。"""
    task = await _call(SceneUnitDesignService(db, project_id).submit_unit_design(sequence_id, version_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions/{task_id}/preview", response_model=ApiResponse[SceneUnitDesignPreview], operation_id="directing_scene_unit_design_preview")
async def scene_unit_design_preview(project_id: str, sequence_id: str, version_id: str, task_id: str, body: SceneUnitDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """整份核对建议；不保存或采用任何单元。"""
    return success_response(await _call(SceneUnitDesignService(db, project_id).preview_unit_design(sequence_id, version_id, task_id, body.content)))


@router.get("/sequences/{sequence_id}/versions/{version_id}/design-suggestions", response_model=ApiResponse[list[SceneDesignSuggestionRead]], operation_id="directing_scene_design_suggestions")
async def scene_design_suggestions(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope="function")):
    """读取本版本的建议任务和固定依据，历史版本也可查看。"""
    return success_response(await _call(SceneDesignService(db, project_id).list_design(sequence_id, version_id)))


@router.post("/sequences/{sequence_id}/versions/{version_id}/design-suggestions", response_model=ApiResponse[TaskAccepted], operation_id="directing_scene_design_suggest")
async def scene_design_suggest(project_id: str, sequence_id: str, version_id: str, body: SceneDesignRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """冻结本版本明确选择的原文与整场设计，提交只生成建议。"""
    task = await _call(SceneDesignService(db, project_id).submit_design(sequence_id, version_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.post("/sequences/{sequence_id}/versions/{version_id}/design-suggestions/{task_id}/preview", response_model=ApiResponse[SceneDesignPreview], operation_id="directing_scene_design_preview")
async def scene_design_preview(project_id: str, sequence_id: str, version_id: str, task_id: str, body: SceneDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """重新核对当前输入与建议，不保存、不创建业务版本。"""
    return success_response(await _call(SceneDesignService(db, project_id).preview_design(sequence_id, version_id, task_id, body.content)))


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


@router.get('/chapters/{chapter_id}/deliveries', response_model=ApiResponse[ChapterDeliveriesRead], operation_id='directing_chapter_deliveries')
async def chapter_deliveries(project_id: str, chapter_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取章节明确使用的固定场次内容。"""
    return success_response(await _call(SceneDeliveryService(db, project_id).chapter_deliveries(chapter_id)))


@router.get('/sequences/{sequence_id}/deliveries', response_model=ApiResponse[list[SceneDeliveryRead]], operation_id='directing_scene_deliveries')
async def scene_deliveries(project_id: str, sequence_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取原场次的全部固定交付来源。"""
    return success_response(await _call(SceneDeliveryService(db, project_id).list_deliveries(sequence_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/deliveries', response_model=ApiResponse[SceneDeliveryRead], operation_id='directing_create_scene_delivery')
async def create_scene_delivery(project_id: str, sequence_id: str, version_id: str, body: SceneDeliveryCreate, db: AsyncSession = Depends(get_db, scope='function')):
    """明确更新章节使用，重复核实不重新激活旧交付。"""
    return success_response(await _call(SceneDeliveryService(db, project_id).create_delivery(sequence_id, version_id, body)))


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


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions', response_model=ApiResponse[TaskAccepted], operation_id='directing_scene_instruction_suggest')
async def scene_instruction_suggest(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: SceneInstructionRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """固定本次输入，仅提交当前单元的指令建议。"""
    task = await _call(SceneInstructionService(db, project_id).submit_instruction(sequence_id, version_id, unit_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.get('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions', response_model=ApiResponse[list[SceneInstructionSuggestionRead]], operation_id='directing_scene_instruction_suggestions')
async def scene_instruction_suggestions(project_id: str, sequence_id: str, version_id: str, unit_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取本单元指令任务的真实状态、固定输入与结果。"""
    return success_response(await _call(SceneInstructionService(db, project_id).list_instructions(sequence_id, version_id, unit_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions/{task_id}/preview', response_model=ApiResponse[SceneInstructionPreview], operation_id='directing_scene_instruction_preview')
async def scene_instruction_preview(project_id: str, sequence_id: str, version_id: str, unit_id: str, task_id: str, body: SceneDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """重新核对原单元及输入后返回整份建议，不保存或生成视频。"""
    return success_response(await _call(SceneInstructionService(db, project_id).preview_instruction(sequence_id, version_id, unit_id, task_id, body.content)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-basis', response_model=ApiResponse[InstructionBasisRead], operation_id='directing_instruction_basis')
async def instruction_basis(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: SceneDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """比较当前正文的已确认依据，不保存或发起生成。"""
    return success_response(await _call(InstructionBasisService(db, project_id).basis_status(sequence_id, version_id, unit_id, body.content)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-basis/confirm', response_model=ApiResponse[InstructionBasisRead], operation_id='directing_confirm_instruction_basis')
async def confirm_instruction_basis(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: InstructionBasisConfirm, db: AsyncSession = Depends(get_db, scope='function')):
    """用户明确确认已核对正文，建立独立回执；并不等同于检查通过。"""
    return success_response(await _call(InstructionBasisService(db, project_id).confirm_basis(sequence_id, version_id, unit_id, body)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-suggestions/{task_id}/apply', response_model=ApiResponse[SceneInstructionApply], operation_id='directing_scene_instruction_apply')
async def scene_instruction_apply(project_id: str, sequence_id: str, version_id: str, unit_id: str, task_id: str, body: SceneDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """明确采用建议，返回一起应用的正文与依据；不保存版本或生成视频。"""
    return success_response(await _call(InstructionBasisService(db, project_id).apply_instruction(sequence_id, version_id, unit_id, task_id, body.content)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks', response_model=ApiResponse[TaskAccepted], operation_id='directing_instruction_check')
async def instruction_check(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: InstructionCheckRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """明确提交本单元检查，不自动应用结论。"""
    task = await _call(InstructionCheckService(db, project_id).submit_check(sequence_id, version_id, unit_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.get('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks', response_model=ApiResponse[list[InstructionCheckRead]], operation_id='directing_instruction_checks')
async def instruction_checks(project_id: str, sequence_id: str, version_id: str, unit_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取固定检查输入及真实状态，查看不构成生成授权。"""
    return success_response(await _call(InstructionCheckService(db, project_id).list_checks(sequence_id, version_id, unit_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks/{task_id}/compare', response_model=ApiResponse[InstructionCheckComparison], operation_id='directing_instruction_check_compare')
async def instruction_check_compare(project_id: str, sequence_id: str, version_id: str, unit_id: str, task_id: str, body: SceneDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """核对当前正文与检查原输入，比较不授权生成。"""
    return success_response(await _call(InstructionCheckService(db, project_id).compare_check(sequence_id, version_id, unit_id, task_id, body.content)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/instruction-checks/{task_id}/confirm', response_model=ApiResponse[InstructionCheckConfirmation], operation_id='directing_instruction_check_confirm')
async def instruction_check_confirm(project_id: str, sequence_id: str, version_id: str, unit_id: str, task_id: str, body: SceneDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """用户明确核对检查结果后返回可绑定身份，不保存或执行视频。"""
    return success_response(await _call(InstructionCheckService(db, project_id).confirm_check(sequence_id, version_id, unit_id, task_id, body.content)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video/prepare', response_model=ApiResponse[SceneVideoPreparation], operation_id='directing_scene_video_prepare')
async def scene_video_prepare(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: SceneVideoPrepareRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """按原保存修订核验实际视频输入，不创建任务。"""
    return success_response(await _call(SceneVideoService(db, project_id).prepare_video(sequence_id, version_id, unit_id, body)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video', response_model=ApiResponse[TaskAccepted], operation_id='directing_scene_video_submit')
async def scene_video_submit(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: SceneVideoSubmitRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """按明确保存内容提交视频；历史场次仅可核实已受理的同一原请求。"""
    task = await _call(SceneVideoService(db, project_id).submit_video(sequence_id, version_id, unit_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.get('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video', response_model=ApiResponse[list[SceneVideoRead]], operation_id='directing_scene_videos')
async def scene_videos(project_id: str, sequence_id: str, version_id: str, unit_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """查看原单元固定执行和真实候选素材。"""
    return success_response(await _call(DirectingStore(db, project_id).read_scene_videos(sequence_id, version_id, unit_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video/save-and-submit', response_model=ApiResponse[SceneVideoSaveResult], operation_id='directing_scene_video_save_submit')
async def scene_video_save_submit(project_id: str, sequence_id: str, version_id: str, unit_id: str, body: SceneVideoSaveRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """保存原内容后核验并提交；历史场次仅核实既有执行，不再次保存。"""
    return success_response(await _call(SceneVideoService(db, project_id).save_and_submit_video(sequence_id, version_id, unit_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/takes/{take_id}/media', response_model=ApiResponse[MediaRead], operation_id='directing_scene_take_media')
async def scene_take_media(project_id: str, sequence_id: str, version_id: str, unit_id: str, take_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取经原执行归属校验的候选播放地址和实测时长，查看不采用。"""
    return success_response(await _call(DirectingStore(db, project_id).scene_take_media(sequence_id, version_id, unit_id, take_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/units/{unit_id}/video/{execution_id}/retry', response_model=ApiResponse[TaskAccepted], operation_id='directing_scene_video_retry')
async def scene_video_retry(project_id: str, sequence_id: str, version_id: str, unit_id: str, execution_id: str, body: SceneVideoRetryRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """重新核验原失败／取消执行的固定输入，创建关联原任务的新执行。"""
    task = await _call(SceneVideoService(db, project_id).retry_video(sequence_id, version_id, unit_id, execution_id, body))
    return success_response(TaskAccepted(task_id=task.id))


@router.post('/sequences/{sequence_id}/versions/{version_id}/exports', response_model=ApiResponse[SceneExportRead], operation_id='directing_submit_scene_export')
async def submit_scene_export(project_id: str, sequence_id: str, version_id: str, body: SceneExportRequest, db: AsyncSession = Depends(get_db, scope='function')):
    """导出指定保存修订，响应丢失后使用同一请求核实。"""
    return success_response(await _call(SceneExportService(db, project_id).submit_export(sequence_id, version_id, body)))


@router.get('/sequences/{sequence_id}/versions/{version_id}/exports', response_model=ApiResponse[list[SceneExportRead]], operation_id='directing_list_scene_exports')
async def list_scene_exports(project_id: str, sequence_id: str, version_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """读取固定导出记录及成功文件入口。"""
    return success_response(await _call(SceneExportService(db, project_id).list_exports(sequence_id, version_id)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/exports/{task_id}/retry', response_model=ApiResponse[SceneExportRead], operation_id='directing_retry_scene_export')
async def retry_scene_export(project_id: str, sequence_id: str, version_id: str, task_id: str, body: SceneExportRetry, db: AsyncSession = Depends(get_db, scope='function')):
    """明确重试失败或取消的固定输入，不采用当前编辑。"""
    return success_response(await _call(SceneExportService(db, project_id).retry_export(sequence_id, version_id, task_id, body)))


@router.post('/sequences/{sequence_id}/versions/{version_id}/export-inspection', response_model=ApiResponse[SceneExportInspection], operation_id='directing_inspect_scene_export')
async def inspect_scene_export(project_id: str, sequence_id: str, version_id: str, body: SceneExportInspect, db: AsyncSession = Depends(get_db, scope='function')):
    """读取真实媒体的有效画面与缩放需求，不保存当前编辑或提交任务。"""
    return success_response(await _call(SceneExportService(db, project_id).inspect_export(sequence_id, version_id, body)))


@router.delete('/sequences/{sequence_id}/versions/{version_id}/exports/{task_id}/file', response_model=ApiResponse[SceneExportRead], operation_id='directing_delete_scene_export_file')
async def delete_scene_export_file(project_id: str, sequence_id: str, version_id: str, task_id: str, db: AsyncSession = Depends(get_db, scope='function')):
    """明确删除单份导出成果，保留成功事实并复用业务引用保护。"""
    return success_response(await _call(SceneExportService(db, project_id).delete_export_file(sequence_id, version_id, task_id)))


@router.post("/sequences/{sequence_id}/versions/{version_id}/unit-design-suggestions/{task_id}/apply", response_model=ApiResponse[SceneVersionContent], operation_id="directing_scene_unit_design_apply")
async def scene_unit_design_apply(project_id: str, sequence_id: str, version_id: str, task_id: str, body: SceneUnitDesignPreviewRequest, db: AsyncSession = Depends(get_db, scope="function")):
    """明确确认后返回当前编辑内容，持久化仍走原保存入口。"""
    return success_response(await _call(SceneUnitDesignService(db, project_id).apply_unit_design(sequence_id, version_id, task_id, body.content)))
