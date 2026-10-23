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
    from fastapi import HTTPException
    from app.schemas.generation_canvas import CanvasDocument, ModelCard
    from app.services.generation_canvas.compiler import compile_card
    canvas = await CanvasStore(db, project_id).get(canvas_id)
    document = CanvasDocument.model_validate(canvas.document)
    card = next((card for card in document.cards if card.id == card_id), None)
    if not isinstance(card, ModelCard):
        raise HTTPException(404, 'Model card not found')
    capability = await model_capability(db, card.model_id) if card.model_id else None
    result = compile_card(document, card_id, capability=capability)
    if not card.model_id:
        from app.schemas.generation_canvas import CanvasDiagnostic
        result.diagnostics.append(CanvasDiagnostic(code='MODEL_REQUIRED', message='请选择模型', target={'card_id': card_id, 'path': ['model_id']}, blocks=['run']))
        result.can_run = False
    return success_response(result)
