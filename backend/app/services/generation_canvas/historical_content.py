"""历史成果另存与来源真实性；使用调用方事务，不保存卡片或修改文件保护。"""
from uuid import uuid4
from sqlalchemy import select
from app.models.generation_canvas import CanvasRunNode
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.events import TERMINAL
from app.services.generation_canvas.store import CanvasStore


def _matches_proof(proof, model_id, result_set_id, position):
    return proof is not None and (proof['model_id'], proof['result_set_id'], proof['position']) == (
        model_id, result_set_id, position
    )


class CanvasHistoricalContent:
    """集中历史定位、首次内容匹配与已保存来源不可变规则。"""
    def __init__(self, db, project_id: str):
        self.db, self.project_id = db, project_id

    async def prepare_content(self, canvas_id: str, run_id: str, node_id: str, position: int):
        """返回一次明确另存的独立内容；文档仍通过普通 CAS 队列保存。"""
        from app.schemas.generation_canvas import CanvasContentOrigin, TextContentCard, ImageContentCard, VideoContentCard
        node = await self._output_node(canvas_id, run_id, node_id, position)
        output = node.outputs[position]
        origin = CanvasContentOrigin(canvas_id=canvas_id, run_id=run_id, node_id=node_id,
                                     position=position, incomplete=node.status != 'succeeded')
        if output['modality'] == 'text':
            return TextContentCard(id=uuid4().hex, text=output['text'], origin=origin)
        from app.services.studio.files import require_available_file
        await require_available_file(self.db, file_id=output['file_id'], expected_type=output['modality'])
        kind = ImageContentCard if output['modality'] == 'image' else VideoContentCard
        return kind(id=uuid4().hex, file_id=output['file_id'], origin=origin)

    async def _output_node(self, canvas_id: str, run_id: str, node_id: str, position: int):
        """按项目和画布校验历史输出；运行中内容不伪装成固定成果。"""
        await CanvasStore(self.db, self.project_id).get(canvas_id)
        node = await self.db.scalar(select(CanvasRunNode).where(CanvasRunNode.id == node_id,
            CanvasRunNode.canvas_id == canvas_id, CanvasRunNode.run_id == run_id))
        if node is None or node.status not in TERMINAL or position < 0 or position >= len(node.outputs):
            raise diagnostic('OUTPUT_NOT_AVAILABLE', '历史成果不存在或尚未完成', {'node_id': node_id, 'position': position}, status=422)
        return node

    async def validate_origin(self, canvas_id: str, card, previous: dict | None, proof=None) -> None:
        """首次声明须匹配固定成果；已有卡只保护来源，内容允许独立编辑。

        调用方在原逐卡校验阶段执行，文件可用性仍由后续保存阶段核实。
        """
        origin = getattr(card, 'origin', None)
        if (previous and previous.get('origin') != (origin.model_dump() if origin else None)) or (proof and not origin):
            raise diagnostic('IMMUTABLE_ORIGIN', '已保存内容的历史来源不可修改', {'card_id': card.id, 'path': ['origin']})
        if origin and not previous:
            if origin.canvas_id != canvas_id:
                raise diagnostic('INVALID_ORIGIN', '历史来源必须属于当前画布', {'card_id': card.id})
            node = await self._output_node(canvas_id, origin.run_id, origin.node_id, origin.position)
            output = node.outputs[origin.position]
            restored = _matches_proof(proof, node.card_id, node.result_set_id, output.get('source', {}).get('position'))
            matches_content = (getattr(card, 'text', None) == output.get('text') if output['modality'] == 'text'
                               else getattr(card, 'file_id', None) == output.get('file_id'))
            if (origin.incomplete != (node.status != 'succeeded') or card.type != 'content.' + output['modality']
                    or (not restored if proof else not matches_content)):
                raise diagnostic('INVALID_ORIGIN', '另存内容须与固定成果及完成状态一致', {'card_id': card.id})

    async def validate_detached_results(self, document, previous, saved_proofs):
        """校验固定来源与排序，返回私有证明及可迁移既有用途的来源。"""
        from app.schemas.generation_canvas import ModelCard
        cards = {card.id: card for card in document.cards}
        prior = {card.id: card for card in previous.cards}
        proofs = {key: dict(proof) for key, proof in (saved_proofs or {}).items()}
        # 兼容升级前仍在已保存文档中的固定记录；新请求不能自行补写证明。
        for model in previous.cards:
            if isinstance(model, ModelCard):
                for result in model.detached_results:
                    proofs.setdefault(result.content_card_id, {
                        'model_id': model.id, 'result_set_id': result.result_set_id, 'position': result.position, 'routes': [],
                    })
        sources = {}
        moved = {}

        async def formal_source(card_id):
            if card_id not in sources:
                origin = getattr(cards.get(card_id), 'origin', None)
                result = None
                if origin and not origin.incomplete:
                    node = await self._output_node(document.id, origin.run_id, origin.node_id, origin.position)
                    if node.status == 'succeeded' and node.result_set_id:
                        result = (node.result_set_id, node.outputs[origin.position].get('source', {}))
                sources[card_id] = result
            return sources[card_id]

        for model in document.cards:
            if not isinstance(model, ModelCard):
                continue
            for result in model.detached_results:
                fixed = cards.get(result.content_card_id)
                recorded = proofs.get(result.content_card_id)
                trusted = _matches_proof(recorded, model.id, result.result_set_id, result.position)
                if trusted and (fixed is None or (
                    fixed.id in prior and result in getattr(prior.get(model.id), 'detached_results', ())
                )):
                    continue
                target = {'card_id': model.id, 'position': result.position, 'path': ['detached_results']}
                formal = await formal_source(result.content_card_id)
                result_set, output = formal if formal else (None, {})
                if (recorded and not trusted or result_set != result.result_set_id or output.get('card_id') != model.id
                        or output.get('position') != result.position or output.get('port_id') not in model.output_ports):
                    raise diagnostic('INVALID_DETACHED_RESULT', '固定记录必须对应此模型的正式输出与独立内容来源', target)
                if not trusted and any(edge.source_card == model.id and edge.source_port == output['port_id']
                                       and edge.includes_position(result.position) for edge in document.edges):
                    raise diagnostic('INVALID_DETACHED_RESULT', '固定结果时必须同时移除原结果连接范围', target)
                if not trusted:
                    proofs[result.content_card_id] = {
                        'model_id': model.id, 'result_set_id': result.result_set_id, 'position': result.position, 'routes': [],
                    }
                moved[result.content_card_id] = output

        edges = {edge.id: edge for edge in document.edges}
        for edge in document.edges:
            if not edge.order_anchor:
                continue
            original = edges[edge.order_anchor.edge_id]  # 结构校验已确认端点和用途。
            formal = await formal_source(edge.source_card)
            output = formal[1] if formal else {}
            if (output.get('card_id'), output.get('port_id'), output.get('position')) != (
                original.source_card, original.source_port, edge.order_anchor.position
            ):
                raise diagnostic('INVALID_RESULT_ORDER', '排序锚点必须对应固定内容的原模型和输出位置',
                                 {'edge_id': edge.id, 'card_id': edge.target_card, 'port_id': edge.target_port})
        return proofs, moved
