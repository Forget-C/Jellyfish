"""独立生成画布 HTTP 适配，仅负责收参与响应。"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.dependencies import get_db
from app.schemas.common import ApiResponse, empty_response, success_response
from app.schemas.generation_canvas import CanvasCreate, CanvasRead, CanvasSave, CanvasSaved, CanvasError, CanvasModelCapability, CanvasCompiledInput
from app.services.generation_canvas.store import CanvasStore
from app.services.generation_canvas.capabilities import model_capability

router = APIRouter()


@router.get('/{project_id}', response_model=ApiResponse[list[CanvasRead]], operation_id='canvas_list')
async def list_canvases(project_id: str, db: AsyncSession = Depends(get_db)):
    """列出项目画布。"""
    return success_response(await CanvasStore(db, project_id).list())


@router.post('/{project_id}', response_model=ApiResponse[CanvasRead], operation_id='canvas_create')
async def create_canvas(project_id: str, body: CanvasCreate, db: AsyncSession = Depends(get_db)):
    """创建空画布。"""
    return success_response(await CanvasStore(db, project_id).create(body.name))


@router.get('/{project_id}/{canvas_id}', response_model=ApiResponse[CanvasRead], operation_id='canvas_get')
async def get_canvas(project_id: str, canvas_id: str, db: AsyncSession = Depends(get_db)):
    """读取当前文档。"""
    return success_response(await CanvasStore(db, project_id).get(canvas_id))


@router.put('/{project_id}/{canvas_id}', response_model=ApiResponse[CanvasSaved], operation_id='canvas_save',
            responses={409: {'model': CanvasError}, 422: {'model': CanvasError}})
async def save_canvas(project_id: str, canvas_id: str, body: CanvasSave, db: AsyncSession = Depends(get_db)):
    """CAS 保存完整文档并返回持久原回执。"""
    return success_response(await CanvasStore(db, project_id).save(canvas_id, body))


@router.delete('/{project_id}/{canvas_id}', response_model=ApiResponse[None], operation_id='canvas_delete')
async def delete_canvas(project_id: str, canvas_id: str, db: AsyncSession = Depends(get_db)):
    """删除无运行的画布。"""
    await CanvasStore(db, project_id).delete(canvas_id)
    return empty_response()


@router.get('/{project_id}/{canvas_id}/models/{model_id}/capability', response_model=ApiResponse[CanvasModelCapability],
            operation_id='canvas_model_capability')
async def get_model_capability(project_id: str, canvas_id: str, model_id: str, db: AsyncSession = Depends(get_db)):
    """核实画布归属后返回所选模型的真实输入与参数能力。"""
    await CanvasStore(db, project_id).get(canvas_id)
    return success_response(await model_capability(db, model_id))


@router.get('/{project_id}/{canvas_id}/cards/{card_id}/compile', response_model=ApiResponse[CanvasCompiledInput],
            operation_id='canvas_compile')
async def compile_canvas_card(project_id: str, canvas_id: str, card_id: str, db: AsyncSession = Depends(get_db)):
    """读取已保存文档的单次编译预览，不提交执行也不虚构模型输出。"""
    return success_response(await CanvasStore(db, project_id).compile_input(canvas_id, card_id))


from app.schemas.generation_canvas import (CanvasPrecheckRequest, CanvasPrecheck, CanvasRunSubmit,
    CanvasRunAccepted, CanvasSnapshot, CanvasRuntimeEvent, CanvasStreamConnection)
from app.services.generation_canvas.runtime import CanvasRuntime


@router.post('/{project_id}/{canvas_id}/precheck', response_model=ApiResponse[CanvasPrecheck], operation_id='canvas_precheck')
async def precheck_canvas(project_id: str, canvas_id: str, body: CanvasPrecheckRequest, db: AsyncSession = Depends(get_db)):
    """核实已保存单卡的实际输入、模型及配置，返回短期预检凭据。"""
    return success_response(await CanvasRuntime(db, project_id).precheck(canvas_id, body))


@router.post('/{project_id}/{canvas_id}/runs', response_model=ApiResponse[CanvasRunAccepted], operation_id='canvas_run_submit')
async def submit_canvas_run(project_id: str, canvas_id: str, body: CanvasRunSubmit, db: AsyncSession = Depends(get_db)):
    """原子受理并返回原或新运行；不在 HTTP 请求中调用供应商。"""
    return success_response(await CanvasRuntime(db, project_id).submit(canvas_id, body))


@router.get('/{project_id}/{canvas_id}/runtime', response_model=ApiResponse[CanvasSnapshot], operation_id='canvas_runtime')
async def get_canvas_runtime(project_id: str, canvas_id: str, db: AsyncSession = Depends(get_db)):
    """读取运行、累计正文和当前输出的一致切点。"""
    return success_response(await CanvasRuntime(db, project_id).snapshot(canvas_id))


@router.get('/{project_id}/{canvas_id}/events/connection', response_model=ApiResponse[CanvasStreamConnection], operation_id='canvas_stream_connection')
async def canvas_stream_connection(project_id: str, canvas_id: str, db: AsyncSession = Depends(get_db)):
    """提供 generated client 可获取的公共流连接地址。"""
    await CanvasStore(db, project_id).get(canvas_id)
    return success_response(CanvasStreamConnection(url=f'/api/v1/studio/generation-canvases/{project_id}/{canvas_id}/events'))


@router.get('/{project_id}/{canvas_id}/events', response_model=CanvasRuntimeEvent, operation_id='canvas_events')
async def canvas_events(project_id: str, canvas_id: str, cursor: int | None = None, db: AsyncSession = Depends(get_db)):
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


@router.post('/{project_id}/{canvas_id}/runs/{run_id}/cancel', response_model=ApiResponse[CanvasRunRead], operation_id='canvas_cancel_run')
async def cancel_canvas_run(project_id: str, canvas_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    """取消明确的一轮运行，返回真实节点状态而非提前宣告终态。"""
    return success_response(await CanvasRuntime(db, project_id).cancel(canvas_id, run_id))


@router.post('/{project_id}/{canvas_id}/runs/{run_id}/nodes/{node_id}/cancel', response_model=ApiResponse[CanvasRunRead], operation_id='canvas_cancel_node')
async def cancel_canvas_node(project_id: str, canvas_id: str, run_id: str, node_id: str, db: AsyncSession = Depends(get_db)):
    """仅请求取消目标节点，终态由 TaskService 确认。"""
    return success_response(await CanvasRuntime(db, project_id).cancel(canvas_id, run_id, node_id))


from app.schemas.generation_canvas import TextContentCard, ImageContentCard, VideoContentCard


@router.get('/{project_id}/{canvas_id}/runs/{run_id}/nodes/{node_id}/outputs/{position}/content', response_model=ApiResponse[TextContentCard | ImageContentCard | VideoContentCard], operation_id='canvas_output_content')
async def canvas_output_content(project_id: str, canvas_id: str, run_id: str, node_id: str, position: int, db: AsyncSession = Depends(get_db)):
    """准备独立内容卡；调用方通过已有文档保存队列显式持久化。"""
    return success_response(await CanvasRuntime(db, project_id).content(canvas_id, run_id, node_id, position))
