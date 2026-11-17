"""显式清理旧项目自由画布；保留文件、通用任务与其他业务引用。"""
import argparse
import asyncio
from sqlalchemy import select
from app.core.db import async_session_maker, engine
from app.models.generation_canvas import GenerationCanvas, CanvasScopeOccupancy
from app.services.generation_canvas.store import CanvasStore
from app.services.generation_canvas.errors import diagnostic


async def retire(db, *, apply=False):
    """先锁定并检查所有目标，发现活动任务则整批拒绝；默认只列出 ID。"""
    canvases = list(await db.scalars(select(GenerationCanvas).where(
        GenerationCanvas.kind == 'free', GenerationCanvas.project_id.is_not(None))
        .order_by(GenerationCanvas.id).with_for_update()))
    ids = [canvas.id for canvas in canvases]
    from app.services.generation_canvas.runtime import active_canvas_task
    active = await active_canvas_task(db, ids)
    occupied = await db.scalar(select(CanvasScopeOccupancy.node_id).where(
        CanvasScopeOccupancy.canvas_id.in_(ids)).limit(1)) if ids else None
    if active or occupied:
        raise diagnostic('RUN_SCOPE_BUSY', '旧自由画布仍有活动任务，请等待任务结束', {}, status=409)
    if apply:
        for canvas in canvases:
            await CanvasStore(db, canvas.project_id).delete_record(canvas, expected_revision=canvas.revision)
    return ids


async def main(apply):
    """迁移后、API 与 Worker 停止时由维护者显式调用。"""
    try:
        async with async_session_maker.begin() as db:
            ids = await retire(db, apply=apply)
            print({'apply': apply, 'canvas_ids': ids})
    finally:
        await engine.dispose()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    asyncio.run(main(parser.parse_args().apply))
