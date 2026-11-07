"""历史成果另存与来源真实性；使用调用方事务，不保存卡片或修改文件保护。"""
from uuid import uuid4
from sqlalchemy import select
from app.models.generation_canvas import CanvasCurrentOutput, CanvasResultSet, CanvasRunNode
from app.services.generation_canvas.errors import diagnostic
from app.services.generation_canvas.events import TERMINAL
from app.services.generation_canvas.store import CanvasStore


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

    async def validate_origin(self, canvas_id: str, card, previous: dict | None) -> None:
        """首次声明须匹配固定成果；已有卡只保护来源，内容允许独立编辑。

        调用方在原逐卡校验阶段执行，文件可用性仍由后续保存阶段核实。
        """
        origin = getattr(card, 'origin', None)
        if previous and previous.get('origin') != (origin.model_dump() if origin else None):
            raise diagnostic('IMMUTABLE_ORIGIN', '已保存内容的历史来源不可修改', {'card_id': card.id, 'path': ['origin']})
        if origin and not previous:
            if origin.canvas_id != canvas_id:
                raise diagnostic('INVALID_ORIGIN', '历史来源必须属于当前画布', {'card_id': card.id})
            node = await self._output_node(canvas_id, origin.run_id, origin.node_id, origin.position)
            output = node.outputs[origin.position]
            if origin.incomplete != (node.status != 'succeeded') or card.type != 'content.' + output['modality'] or (
                output['modality'] == 'text' and card.text != output.get('text')) or (
                output['modality'] != 'text' and card.file_id != output.get('file_id')):
                raise diagnostic('INVALID_ORIGIN', '另存内容须与固定成果及完成状态一致', {'card_id': card.id})


    async def validate_detached_results(self, document, previous, saved_card_types):
        """固定记录必须来自同一模型正式交付的结果，并与独立内容来源一致。"""
        from app.schemas.generation_canvas import ModelCard
        cards = {card.id: card for card in document.cards}
        prior = {card.id: card for card in previous.cards}
        for model in document.cards:
            if not isinstance(model, ModelCard):
                continue
            for result in model.detached_results:
                fixed = cards.get(result.content_card_id)
                if (result in getattr(prior.get(model.id), 'detached_results', ())
                        and (fixed is None or fixed.id in prior)):
                    continue
                output = None
                origin = getattr(fixed, 'origin', None)
                if origin and not origin.incomplete:
                    node = await self._output_node(document.id, origin.run_id, origin.node_id, origin.position)
                    if node.status == 'succeeded' and node.result_set_id == result.result_set_id and node.card_id == model.id:
                        output = node.outputs[origin.position].get('source', {})
                elif fixed is None and model.id not in prior and saved_card_types.get(model.id) == model.type:
                    # 撤销删除模型时，独立内容可以已经删除。用持久卡片身份和正式批次校验其历史位置。
                    published = await self.db.get(CanvasResultSet, result.result_set_id)
                    if published and published.canvas_id == document.id and published.card_id == model.id:
                        output = next((item['source'] for item in published.outputs
                                       if item['source']['position'] == result.position
                                       and saved_card_types.get(result.content_card_id) == 'content.' + item['modality']), None)
                target = {'card_id': model.id, 'position': result.position, 'path': ['detached_results']}
                if not output or output.get('position') != result.position or output.get('port_id') not in model.output_ports:
                    raise diagnostic('INVALID_DETACHED_RESULT', '固定记录必须对应此模型的正式输出与独立内容来源', target)
                if any(edge.source_card == model.id and edge.source_port == output['port_id']
                       and edge.includes_position(result.position) for edge in document.edges):
                    current = await self.db.get(CanvasCurrentOutput, (document.id, model.id))
                    if (fixed and fixed.id not in prior) or (current and current.result_set_id == result.result_set_id):
                        raise diagnostic('INVALID_DETACHED_RESULT', '固定结果时必须同时移除原结果连接范围', target)
