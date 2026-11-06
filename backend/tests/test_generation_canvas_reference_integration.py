"""混合设计角色的原始存量经 Store 读取后保持不变。"""
import pytest
from tests.test_generation_canvas_api import canvas_client, canvas_file_store  # noqa: F401


@pytest.mark.asyncio
async def test_store_reads_mixed_design_roles_without_rewriting(canvas_client, canvas_file_store):
    from app.models.generation_canvas import GenerationCanvas
    client = canvas_client
    canvas = (await client.post('/canvases/p', json={'name': '混合25类设计'})).json()['data']
    url = f"/canvases/p/{canvas['id']}"
    retired = ['criterion', 'creative_control', 'guidance', 'fact', 'performance_rule', 'situation', 'performance', 'activity',
               'narrative', 'event', 'space_rule', 'anchor', 'camera', 'lighting', 'composition', 'movement', 'focus', 'sound']
    retained = ['style', 'blocking', 'environment', 'dialogue', 'beat', 'shot', 'continuity']
    source = {'canvas_id': canvas['id'], 'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'person'}
    cards = [{'id': 'person', 'type': 'content.character', 'object_id': 'person', 'name': '甲', 'text': '完整人物描述'}]
    cards += [{'id': kind, 'type': 'direction.' + kind} for kind in retired + retained]
    by_id = {card['id']: card for card in cards}
    by_id['criterion'].update(name='清晰可见', criterion_id='visible', standard={'text': '手部必须清晰'})
    by_id['dialogue'].update(dialogue_id='dialogue', version=1)
    edges, order = [], {}

    def connect(ident, target, port):
        edges.append({'id': ident, 'source_card': 'person', 'source_port': 'object', 'target_card': target, 'target_port': port})
        order.setdefault(target, {}).setdefault(port, []).append(ident)

    for kind in retired:
        by_id[kind]['input_bindings'] = [{'id': 'legacy-' + kind, 'input_port': 'effect_object', 'source': source}]
        connect('legacy-' + kind, kind, 'effect_object')
    roles = [('situation', 'participant'), ('performance', 'participant'), ('activity', 'participant'), ('blocking', 'participant'),
             ('dialogue', 'speaker'), ('continuity', 'participant'), ('focus', 'attention_object'), ('focus', 'focus_object')]
    for kind, role in roles:
        ident = kind + '-' + role
        by_id[kind].setdefault('input_bindings', []).append({'id': ident, 'input_port': role, 'source': source})
        connect(ident, kind, role)
    doc = {**canvas['document'], 'cards': cards, 'edges': edges, 'input_order': order}
    # Seed the legacy document, then inspect Store reads and persisted values directly.
    async with canvas_file_store['sessions'].begin() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        row.document = doc
    from copy import deepcopy
    from app.services.generation_canvas.store import CanvasStore
    async with canvas_file_store['sessions']() as db:
        row = await db.get(GenerationCanvas, canvas['id'])
        before = (deepcopy(row.document), deepcopy(row.card_types), row.revision)
        store = CanvasStore(db, 'p')
        await store.get(canvas['id'])
        await store.get(canvas['id'])
        await store.list()
        await db.refresh(row)
        assert (row.document, row.card_types, row.revision) == before
        assert not db.dirty
