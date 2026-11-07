"""Only successful result sets establish positions for model candidate connections."""
from sqlalchemy import select
from app.models.generation_canvas import CanvasResultSet


async def known_result_positions(db, canvas_id: str, card_ids: set[str]) -> dict[tuple[str, str], set[int]]:
    """Collect published positions, including positions missing from the current set."""
    positions: dict[tuple[str, str], set[int]] = {}
    if not card_ids:
        return positions
    rows = await db.execute(select(CanvasResultSet.card_id, CanvasResultSet.outputs).where(
        CanvasResultSet.canvas_id == canvas_id, CanvasResultSet.card_id.in_(card_ids)))
    for card_id, outputs in rows:
        for output in outputs:
            source = output['source']
            positions.setdefault((card_id, source['port_id']), set()).add(source['position'])
    return positions
