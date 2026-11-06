"""节点终态的事务收尾；调用方负责终态判定、成果登记及运行推进。"""
from sqlalchemy import delete
from app.models.generation_canvas import CanvasScopeOccupancy
from app.schemas.generation_canvas import CanvasNodeRead
from app.services.generation_canvas.events import append_event


async def finish_node(db, node, head, *, payload=None):
    """事件头已锁且节点已进入终态；释放占用并写事件，不提交或推进运行。"""
    await db.execute(delete(CanvasScopeOccupancy).where(CanvasScopeOccupancy.node_id == node.id))
    await db.flush()
    await append_event(db, head, 'node.finished', node=node,
        payload={**(payload or {}), 'node': CanvasNodeRead.model_validate(node).model_dump()})
