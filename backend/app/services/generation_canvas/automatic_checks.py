"""Freeze automatic checks at admission and dispatch only completed result sets."""
from sqlalchemy import select

from app.core.contracts.generation import FrozenGenerationConfig
from app.core.contracts.task import TaskStatus
from app.models.generation_canvas import CanvasCheckReport, CanvasRun, CanvasRunNode
from app.models.task import Task
from app.schemas.generation_canvas import CanvasAutomaticCheckEstimate, CanvasDocument, CheckCard
from app.services.generation_canvas.checks import CanvasChecks
from app.services.generation_canvas.execution_basis import digest
from app.services.generation_canvas.post_checks import CanvasPostChecks, is_check_product, estimate_product_calls
from app.services.generation_canvas.store import CanvasStore
from app.services.task_service import AUTO_CHECK_DISPATCH, TaskService


async def automatic_check_plan(db, canvas, nodes):
    """Resolve selected check routes while the generation precheck/admission sees this saved revision."""
    document = CanvasDocument.model_validate(canvas.document)
    cards = {card.id: card for card in document.cards if isinstance(card, CheckCard) and card.auto_post_check}
    revisions = canvas.check_edge_revisions or {}
    checks = CanvasChecks(db, canvas.project_id)
    plans, estimates = {}, []
    for edge in document.edges:
        if edge.target_port != 'check_basis' or edge.target_card not in cards or edge.source_card not in nodes:
            continue
        card = cards[edge.target_card]
        node = nodes[edge.source_card]
        generation = node['basis']['card']
        modality = generation['type'].removeprefix('model.')
        count = generation['config']['count'] if modality == 'image' else 1
        model, unavailable = await checks.check_model(card)
        method, calls, reason = estimate_product_calls(node['compiled'], modality, card, model, unavailable,
                                                      generation=generation, canvas_id=canvas.id)
        plans.setdefault(edge.source_card, []).append({
            'edge_id': edge.id, 'edge_revision': revisions.get(card.id),
            'card': card.model_dump(mode='json', include={'id', 'type', 'check_model_id', 'post_check_categories', 'disabled_items', 'auto_post_check'}),
            'execution_config': model.model_dump(mode='json') if model else None,
            'reason': unavailable, 'count': count,
        })
        estimates.append(CanvasAutomaticCheckEstimate(check_card_id=card.id, target_card_id=edge.source_card,
            product_count=count, observation_method=method, estimated_calls=count * calls,
            reason=reason or ('当前所选范围没有可执行的产物检查项' if not calls else None)))
    return plans, estimates


async def enqueue_automatic_checks(db, node: CanvasRunNode, project_id: str) -> None:
    """Record a durable dispatch only on the generation Task's successful settlement."""
    plans = (node.execution_snapshot or {}).get('automatic_checks')
    if node.result_set_id and plans and all(len(node.outputs) == plan['count'] for plan in plans):
        await TaskService(db).submit(kind=AUTO_CHECK_DISPATCH, project_id=project_id,
            target_type='canvas_result_set', target_id=node.result_set_id, title='分派生成后自动检查',
            snapshot={'canvas_id': node.canvas_id, 'node_id': node.id})


async def dispatch_automatic_checks(db, task: Task) -> None:
    """Serialize dispatch with document saves, outside generation's Task/event-head locks."""
    snapshot = task.input_snapshot
    canvas = await CanvasStore(db, task.project_id).get(snapshot['canvas_id'], lock=True)
    service = TaskService(db)
    locked = await db.scalar(select(Task).where(Task.id == task.id).with_for_update().execution_options(populate_existing=True))
    if locked is None or locked.status != TaskStatus.running:
        return
    if locked.cancel_requested_at:
        await service.finish(task.id, cancelled=True)
        return
    node = await db.scalar(select(CanvasRunNode).where(CanvasRunNode.id == snapshot['node_id'],
        CanvasRunNode.canvas_id == canvas.id, CanvasRunNode.status == TaskStatus.succeeded,
        CanvasRunNode.result_set_id == task.target_id))
    if node:
        await _write_automatic_reports(db, canvas, node)
    await service.finish(task.id)


async def _write_automatic_reports(db, canvas, node):
    document = CanvasDocument.model_validate(canvas.document)
    edges = {edge.target_card: edge for edge in document.edges if edge.target_port == 'check_basis'}
    revisions = canvas.check_edge_revisions or {}
    run = await db.get(CanvasRun, node.run_id)
    service = CanvasPostChecks(db, canvas.project_id)
    for plan in node.execution_snapshot['automatic_checks']:
        card = CheckCard.model_validate(plan['card'])
        edge = edges.get(card.id)
        if (not edge or edge.id != plan['edge_id'] or edge.source_card != node.card_id
                or revisions.get(card.id) != plan['edge_revision']):
            continue
        model = FrozenGenerationConfig.model_validate(plan['execution_config']) if plan['execution_config'] else None
        for position, output in enumerate(node.outputs):
            if not is_check_product(output):
                continue
            report_id = digest({'result_set_id': node.result_set_id, 'check_card_id': card.id, 'position': position})
            if await db.get(CanvasCheckReport, report_id):
                continue
            preview, requirements = await service.prepare_product(
                node, position, run.revision, run.revision, card, model, plan['reason'], lock_files=True)
            await service.write_product_report(canvas.id, card, preview, requirements, model,
                                               report_id=report_id, automatic=True)
