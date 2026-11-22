"""独立生成画布 HTTP 适配，仅负责收参与响应。"""
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.dependencies import get_db
from app.schemas.canvas_assistant import (CanvasAssistantApprovalSetting, CanvasAssistantExchange, CanvasAssistantHistory, CanvasAssistantMessage,
                                          CanvasAssistantModelSelection)
from app.schemas.canvas_assistant_draft import CanvasDraftSave, CanvasDraftSaved, DraftAssistantMessage
from app.services.generation_canvas.assistant_draft import DraftCanvasAssistant
from app.schemas.common import PaginatedData, paginated_response, ApiResponse, created_response, empty_response, success_response
from app.schemas.generation_canvas import CanvasRename, CanvasSummary, CanvasCreate, CanvasRead, CanvasSave, CanvasSaved, CanvasError, CanvasModelCapability, CanvasCompiledInput
from app.services.generation_canvas.store import CanvasStore
from app.services.generation_canvas.capabilities import model_capability
from app.schemas.canvas_assistant_edit import CanvasAssistantProposalDecision, CanvasAssistantProposalResult
from app.services.generation_canvas.assistant import CanvasAssistant
from app.services.generation_canvas.assistant_generation import decide_assistant_generation_edit

router = APIRouter()


@router.get('', response_model=ApiResponse[PaginatedData[CanvasSummary]], operation_id='canvas_list')
async def list_canvases(q: str = '', page: int = Query(1, ge=1), page_size: int = Query(24, ge=1, le=100),
                        db: AsyncSession = Depends(get_db, scope='function')):
    """分页读取独立画布摘要。"""
    items, total = await CanvasStore(db, None).summaries(q=q, page=page, page_size=page_size)
    return paginated_response(items, page=page, page_size=page_size, total=total)


@router.post('', response_model=ApiResponse[CanvasRead], operation_id='canvas_create')
async def create_canvas(body: CanvasCreate, db: AsyncSession = Depends(get_db, scope='function')):
    """创建不依赖项目的自由画布。"""
    return created_response(await CanvasStore(db, None).create(body.name))


@router.get('/drafts/{canvas_id}', response_model=ApiResponse[CanvasRead], operation_id='canvas_draft_read')
async def read_free_draft(canvas_id: UUID, db: AsyncSession = Depends(get_db, scope='function')):
    """读取独立草稿，修订 -1 表示尚未创建。"""
    return success_response(await CanvasStore(db, None).read_free_draft(str(canvas_id)))


@router.put('/drafts/{canvas_id}', response_model=ApiResponse[CanvasDraftSaved], operation_id='canvas_draft_save',
            responses={409: {'model': CanvasError}, 422: {'model': CanvasError}})
async def save_free_draft(canvas_id: UUID, body: CanvasDraftSave, db: AsyncSession = Depends(get_db, scope='function')):
    """原子创建并保存首份有效内容；未知结果可重放原请求。"""
    return success_response(await CanvasStore(db, None).save_free_draft(str(canvas_id), body))


@router.post('/drafts/{canvas_id}/assistant', response_model=ApiResponse[CanvasAssistantExchange],
             operation_id='canvas_draft_assistant_send')
async def send_draft_assistant_message(canvas_id: UUID, body: DraftAssistantMessage,
                                       db: AsyncSession = Depends(get_db, scope='function')):
    """Reply to a browser-owned free canvas conversation without saving it."""
    return success_response(await DraftCanvasAssistant(db, '').reply_to_draft(str(canvas_id), body))


@router.patch('/{canvas_id}/name', response_model=ApiResponse[CanvasRead], operation_id='canvas_rename')
async def rename_canvas(canvas_id: str, body: CanvasRename, db: AsyncSession = Depends(get_db, scope='function')):
    """按修订重命名独立画布，复用完整保存校验。"""
    return success_response(await CanvasStore(db, None).rename(canvas_id, body.name, body.expected_revision))


@router.get('/{canvas_id}', response_model=ApiResponse[CanvasRead], operation_id='canvas_get')
async def get_canvas(canvas_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """读取当前文档。"""
    return success_response(await CanvasStore(db, project_id).read(canvas_id))


@router.get('/{canvas_id}/assistant', response_model=ApiResponse[CanvasAssistantHistory],
            operation_id='canvas_assistant_history')
async def get_assistant_history(canvas_id: str, project_id: str = '',
                                db: AsyncSession = Depends(get_db, scope='function')):
    """Read the saved conversation for the requested canvas."""
    return success_response(await CanvasAssistant(db, project_id).history(canvas_id))


@router.post('/{canvas_id}/assistant', response_model=ApiResponse[CanvasAssistantExchange],
             operation_id='canvas_assistant_send')
async def send_assistant_message(canvas_id: str, body: CanvasAssistantMessage, project_id: str = '',
                                 db: AsyncSession = Depends(get_db, scope='function')):
    """Send a turn, replaying the receipt when the request already succeeded."""
    return success_response(await CanvasAssistant(db, project_id).send(canvas_id, body))


@router.patch('/{canvas_id}/assistant/model', response_model=ApiResponse[CanvasAssistantModelSelection],
              operation_id='canvas_assistant_set_model')
async def set_assistant_model(canvas_id: str, body: CanvasAssistantModelSelection, project_id: str = '',
                              db: AsyncSession = Depends(get_db, scope='function')):
    """Set the assistant model for this canvas independently of card generation."""
    return success_response(await CanvasAssistant(db, project_id).set_model(canvas_id, body))


@router.patch('/{canvas_id}/assistant/approval', response_model=ApiResponse[CanvasAssistantApprovalSetting],
              operation_id='canvas_assistant_set_approval')
async def set_assistant_approval(canvas_id: str, body: CanvasAssistantApprovalSetting, project_id: str = '',
                                 db: AsyncSession = Depends(get_db, scope='function')):
    """Set the assistant approval mode for this canvas."""
    return success_response(await CanvasAssistant(db, project_id).set_approval(canvas_id, body))


@router.post('/{canvas_id}/assistant/turns/{source_id}/stop', response_model=ApiResponse[CanvasAssistantExchange],
             operation_id='canvas_assistant_stop')
async def stop_assistant_turn(canvas_id: str, source_id: str, project_id: str = '',
                              db: AsyncSession = Depends(get_db, scope='function')):
    """Stop the remaining assistant work without canceling any accepted runs."""
    return success_response(await CanvasAssistant(db, project_id).stop(canvas_id, source_id))


@router.post('/{canvas_id}/assistant/proposals/{source_id}', response_model=ApiResponse[CanvasAssistantProposalResult],
             operation_id='canvas_assistant_decide_proposal')
async def decide_assistant_proposal(canvas_id: str, source_id: str, body: CanvasAssistantProposalDecision,
                                    project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Approve a saved preview through the existing canvas save transaction, or reject it."""
    return success_response(await decide_assistant_generation_edit(db, project_id, canvas_id, source_id, body))


@router.put('/{canvas_id}', response_model=ApiResponse[CanvasSaved], operation_id='canvas_save',
            responses={409: {'model': CanvasError}, 422: {'model': CanvasError}})
async def save_canvas(canvas_id: str, body: CanvasSave, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """CAS 保存完整文档并返回持久原回执。补齐同源兼容候选，新建来源须满足接收模型能力。"""
    return success_response(await CanvasStore(db, project_id).save(canvas_id, body))


@router.delete('/{canvas_id}', response_model=ApiResponse[None], operation_id='canvas_delete',
               responses={409: {'model': CanvasError}})
async def delete_canvas(canvas_id: str, expected_revision: Annotated[int, Query(ge=0)],
                        project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """仅删除已核对修订且没有活动任务的画布。"""
    await CanvasStore(db, project_id).delete(canvas_id, expected_revision=expected_revision)
    return empty_response()


@router.get('/{canvas_id}/models/{model_id}/capability', response_model=ApiResponse[CanvasModelCapability],
            operation_id='canvas_model_capability')
async def get_model_capability(canvas_id: str, model_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """核实画布归属后返回所选模型的真实输入与参数能力。"""
    await CanvasStore(db, project_id).get(canvas_id)
    return success_response(await model_capability(db, model_id))


@router.get('/{canvas_id}/cards/{card_id}/compile', response_model=ApiResponse[CanvasCompiledInput],
            operation_id='canvas_compile')
async def compile_canvas_card(canvas_id: str, card_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """读取已保存文档的单次编译预览，不提交执行也不虚构模型输出。"""
    return success_response(await CanvasStore(db, project_id).compile_input(canvas_id, card_id))


from app.schemas.generation_canvas import (CanvasPrecheckRequest, CanvasPrecheck, CanvasRunSubmit,
    CanvasRunAccepted, CanvasSnapshot, CanvasRuntimeEvent, CanvasStreamConnection)
from app.services.generation_canvas.runtime import CanvasRuntime


@router.post('/{canvas_id}/precheck', response_model=ApiResponse[CanvasPrecheck], operation_id='canvas_precheck')
async def precheck_canvas(canvas_id: str, body: CanvasPrecheckRequest, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """核实已保存单卡的实际输入、模型及配置，返回短期预检凭据。"""
    return success_response(await CanvasRuntime(db, project_id).precheck(canvas_id, body))


@router.post('/{canvas_id}/runs', response_model=ApiResponse[CanvasRunAccepted], operation_id='canvas_run_submit')
async def submit_canvas_run(canvas_id: str, body: CanvasRunSubmit, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """原子受理并返回原或新运行；不在 HTTP 请求中调用供应商。"""
    return success_response(await CanvasRuntime(db, project_id).submit(canvas_id, body))


@router.get('/{canvas_id}/runtime', response_model=ApiResponse[CanvasSnapshot], operation_id='canvas_runtime')
async def get_canvas_runtime(canvas_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """读取运行、累计正文和当前输出的一致切点。"""
    return success_response(await CanvasRuntime(db, project_id).snapshot(canvas_id))


@router.get('/{canvas_id}/events/connection', response_model=ApiResponse[CanvasStreamConnection], operation_id='canvas_stream_connection')
async def canvas_stream_connection(canvas_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """提供 generated client 可获取的公共流连接地址。"""
    await CanvasStore(db, project_id).get(canvas_id)
    return success_response(CanvasStreamConnection(url=f'/api/v1/studio/generation-canvases/{canvas_id}/events' + (f'?project_id={project_id}' if project_id else '')))


@router.get('/{canvas_id}/events', response_model=CanvasRuntimeEvent, operation_id='canvas_events')
async def canvas_events(canvas_id: str, cursor: int | None = None, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """多运行 SSE；读取事务仅持续一次数据库追读，不随连接存活。"""
    from fastapi.responses import StreamingResponse
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.services.generation_canvas.stream import stream_events
    await CanvasStore(db, project_id).get(canvas_id)
    sessions = async_sessionmaker(db.bind, expire_on_commit=False)
    await db.commit()
    return StreamingResponse(stream_events(sessions, project_id, canvas_id, cursor), media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


from app.schemas.generation_canvas import CanvasRunRead


@router.post('/{canvas_id}/runs/{run_id}/cancel', response_model=ApiResponse[CanvasRunRead], operation_id='canvas_cancel_run')
async def cancel_canvas_run(canvas_id: str, run_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """取消明确的一轮运行，返回真实节点状态而非提前宣告终态。"""
    return success_response(await CanvasRuntime(db, project_id).cancel(canvas_id, run_id))


@router.post('/{canvas_id}/runs/{run_id}/nodes/{node_id}/cancel', response_model=ApiResponse[CanvasRunRead], operation_id='canvas_cancel_node')
async def cancel_canvas_node(canvas_id: str, run_id: str, node_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """仅请求取消目标节点，终态由 TaskService 确认。"""
    return success_response(await CanvasRuntime(db, project_id).cancel(canvas_id, run_id, node_id))


from app.schemas.generation_canvas import TextContentCard, ImageContentCard, VideoContentCard, CanvasVideoFrameRequest


@router.get('/{canvas_id}/runs/{run_id}/nodes/{node_id}/outputs/{position}/content', response_model=ApiResponse[TextContentCard | ImageContentCard | VideoContentCard], operation_id='canvas_output_content')
async def canvas_output_content(canvas_id: str, run_id: str, node_id: str, position: int, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """准备独立内容卡；调用方通过已有文档保存队列显式持久化。"""
    from app.services.generation_canvas.historical_content import CanvasHistoricalContent
    return success_response(await CanvasHistoricalContent(db, project_id).prepare_content(canvas_id, run_id, node_id, position))


@router.post('/{canvas_id}/video-frames', response_model=ApiResponse[ImageContentCard], operation_id='canvas_prepare_video_frame')
async def prepare_video_frame(canvas_id: str, body: CanvasVideoFrameRequest,
                              project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """准备视频选帧素材，调用方可和采用关系一起保存。"""
    from app.services.generation_canvas.video_frames import CanvasVideoFrames
    return success_response(await CanvasVideoFrames(db, project_id).prepare(canvas_id, body))


from app.schemas.generation_canvas import CanvasCardOutputs


@router.get('/{canvas_id}/cards/{card_id}/outputs', response_model=ApiResponse[CanvasCardOutputs],
            operation_id='canvas_card_outputs')
async def get_card_outputs(canvas_id: str, card_id: str,
                           project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """展示已保存修订的明确出口及直接候选，不修改绑定。"""
    return success_response(await CanvasStore(db, project_id).card_outputs(canvas_id, card_id))


from app.core.contracts.canvas_catalog import CanvasCatalog
from app.services.generation_canvas.catalog import canvas_catalog


@router.get('/catalog/free', response_model=ApiResponse[CanvasCatalog], operation_id='free_canvas_catalog')
async def get_free_canvas_catalog():
    """新建独立画布使用与已有独立画布相同的卡片目录。"""
    return success_response(canvas_catalog(kind='free'))


@router.get('/{canvas_id}/catalog', response_model=ApiResponse[CanvasCatalog], operation_id='canvas_catalog')
async def get_canvas_catalog(canvas_id: str, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """核实画布归属后提供卡片、兼容用途、采用策略及单值输入约束。"""
    canvas = await CanvasStore(db, project_id).get(canvas_id)
    return success_response(canvas_catalog(kind=canvas.kind))


from app.schemas.canvas_checks import CanvasCheckPreview, CanvasCheckReportRead, CanvasCheckRequest
from app.services.generation_canvas.checks import CanvasChecks


@router.get('/{canvas_id}/checks/{card_id}', response_model=ApiResponse[CanvasCheckPreview],
            operation_id='canvas_check_preview')
async def preview_canvas_check(canvas_id: str, card_id: str,
                               project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """查看该检查卡连接的已保存模型及可用项目。"""
    return success_response(await CanvasChecks(db, project_id).preview(canvas_id, card_id))


@router.post('/{canvas_id}/checks/{card_id}/runs', response_model=ApiResponse[CanvasCheckReportRead],
             operation_id='canvas_check_run', responses={409: {'model': CanvasError}, 422: {'model': CanvasError}})
async def run_canvas_check(canvas_id: str, card_id: str, body: CanvasCheckRequest,
                           project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """执行用户选择的检查范围，写入独立报告。"""
    return success_response(await CanvasChecks(db, project_id).run(canvas_id, card_id, body))


@router.get('/{canvas_id}/checks/{card_id}/reports', response_model=ApiResponse[list[CanvasCheckReportRead]],
            operation_id='canvas_check_reports')
async def get_canvas_check_reports(canvas_id: str, card_id: str,
                                   project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """按原检查卡身份读取该项目画布内的报告。"""
    return success_response(await CanvasChecks(db, project_id).reports(canvas_id, card_id))


from app.schemas.canvas_checks import CanvasCheckProduct, CanvasPostCheckPreview, CanvasPostCheckRequest
from app.services.generation_canvas.post_checks import CanvasPostChecks


@router.get('/{canvas_id}/checks/{card_id}/products', response_model=ApiResponse[list[CanvasCheckProduct]],
            operation_id='canvas_check_products')
async def canvas_check_products(canvas_id: str, card_id: str,
                                project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """List retained text outputs for the saved observation target."""
    return success_response(await CanvasPostChecks(db, project_id).products(canvas_id, card_id))


@router.get('/{canvas_id}/checks/{card_id}/products/{run_id}/{node_id}/{position}',
            response_model=ApiResponse[CanvasPostCheckPreview], operation_id='canvas_post_check_preview')
async def canvas_post_check_preview(canvas_id: str, card_id: str, run_id: str, node_id: str, position: int,
                                    project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Show one pinned product, original basis and estimated model calls."""
    return success_response(await CanvasPostChecks(db, project_id).preview(canvas_id, card_id, run_id, node_id, position))


@router.post('/{canvas_id}/checks/{card_id}/products/{run_id}/{node_id}/{position}/runs',
             response_model=ApiResponse[CanvasCheckReportRead], operation_id='canvas_post_check_run',
             responses={409: {'model': CanvasError}, 422: {'model': CanvasError}})
async def canvas_post_check_run(canvas_id: str, card_id: str, run_id: str, node_id: str, position: int,
                                body: CanvasPostCheckRequest, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Admit an explicit historical product inspection."""
    return success_response(await CanvasPostChecks(db, project_id).run(canvas_id, card_id, run_id, node_id, position, body))

@router.post('/{canvas_id}/checks/{card_id}/reports/{report_id}/cancel',
             response_model=ApiResponse[CanvasCheckReportRead], operation_id='canvas_check_cancel')
async def cancel_canvas_check(canvas_id: str, card_id: str, report_id: str,
                              project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """请求停止该报告尚未完成的检查任务，并返回当前执行事实。"""
    return success_response(await CanvasChecks(db, project_id).cancel(canvas_id, card_id, report_id))


@router.get('/{canvas_id}/check-reports/archived', response_model=ApiResponse[list[CanvasCheckReportRead]],
            operation_id='canvas_check_archived_reports')
async def get_archived_canvas_check_reports(canvas_id: str,
                                            project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """读取当前画布中已删检查卡留下的原报告。"""
    return success_response(await CanvasChecks(db, project_id).archived_reports(canvas_id))


from app.schemas.canvas_checks import CanvasCheckRecheckRequest
from app.services.generation_canvas.check_rechecks import CanvasCheckRechecks


@router.post('/{canvas_id}/checks/{card_id}/reports/{report_id}/recheck',
             response_model=ApiResponse[CanvasCheckReportRead], operation_id='canvas_check_recheck',
             responses={422: {'model': CanvasError}})
async def recheck_canvas_report(canvas_id: str, card_id: str, report_id: str,
                                body: CanvasCheckRecheckRequest, project_id: str = '', db: AsyncSession = Depends(get_db, scope='function')):
    """Run one completed finding against the evidence of its original report."""
    return success_response(await CanvasCheckRechecks(db, project_id).run(canvas_id, card_id, report_id, body))
