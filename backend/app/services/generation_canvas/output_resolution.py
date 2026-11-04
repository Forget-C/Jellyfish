"""单次解析操作的结构上下文；动态出口、文件状态与诊断不缓存。"""
from app.schemas.generation_canvas import (
    CanvasDocument, CanvasResolvedOutput, ModelCard, OutputIdentity, PromptReference, PromptInstruction,
    NamedImageReferenceCard, PerformanceDirectionCard, SoundDirectionCard, ObjectDescriptionCard,
)
from app.services.generation_canvas.outputs import card_outputs
from app.services.generation_canvas.reference_rules import reference_name_issue

LABELS = {'text': '文本', 'image': '图片', 'video': '视频', 'audio': '音频'}


def identity_key(source: OutputIdentity) -> tuple:
    """身份包含来源卡和结果位置，文件 ID 不参与身份。"""
    return source.canvas_id, source.card_id, source.port_id, source.object_id or source.position


def prompt_references(card: ModelCard):
    """正文和指令共享实际引用遍历，返回稳定字段路径。"""
    mentioned = set()
    for segment in card.prompt.segments:
        if isinstance(segment, PromptReference):
            mentioned.add(segment.binding_id)
            yield segment, ['prompt', 'segments', segment.id]
        elif isinstance(segment, PromptInstruction):
            for reference in segment.references:
                mentioned.add(reference.binding_id)
                yield reference, ['prompt', 'segments', segment.id, 'references', reference.id]
    for binding in card.input_bindings:
        if binding.id not in mentioned:
            yield PromptReference(id=binding.id, kind='reference', binding_id=binding.id, source=binding.source), ['input_bindings', binding.id]


class CanvasOutputContext:
    """绑定一份已验证且使用期间不再修改的文档；每个输出视图和草稿模式显式传入。"""

    def __init__(self, document: CanvasDocument):
        """只建立结构索引，入边沿用文档顺序；不读取数据库或产生出口。"""
        self.document = document
        self.cards = {card.id: card for card in document.cards}
        self.edges = {edge.id: edge for edge in document.edges}
        self.incoming = {}
        for edge in document.edges:
            self.incoming.setdefault(edge.target_card, []).append(edge)

    def published_outputs(self, card_id, *, model_outputs, allow_reference_drafts=False, reference_tokens=None):
        """仅把已采用的直接对象出口交给本卡处理器，按 DAG 逐层解析。"""
        document = self.document
        card = self.cards[card_id]
        if isinstance(card, NamedImageReferenceCard) and (issue := reference_name_issue(document, card)):
            if not allow_reference_drafts or issue[0] not in ('DUPLICATE_REFERENCE_NAME', 'REFERENCE_NAME_REQUIRED'):
                return []
        adopted = []
        if isinstance(card, (PerformanceDirectionCard, SoundDirectionCard)):
            for binding in card.input_bindings:
                if any(edge.source_card == binding.source.card_id and edge.source_port == binding.source.port_id
                       and edge.target_card == card_id and edge.target_port == binding.input_port for edge in self.incoming.get(card_id, ())):
                    adopted.extend(item for item in self.published_outputs(binding.source.card_id, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts)
                        if identity_key(item.source) == identity_key(binding.source))
        from app.services.generation_canvas.design_references import REFERENCE_DESIGN_TYPES, resolve_design_card
        media, issues, reference_current = [], [], True
        if card.type in REFERENCE_DESIGN_TYPES:
            card, media, issues, reference_current = resolve_design_card(self, card, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts, reference_tokens=reference_tokens)
        outputs = card_outputs(document.id, card, adopted_inputs=tuple(adopted),
                               published_results=tuple((model_outputs or {}).get(card_id, [])))
        for output in outputs:
            if output.payload and output.payload.kind == 'design':
                output.basis_current = reference_current
                output.payload.material_references = media
                output.payload.reference_issues = issues
        from app.schemas.generation_canvas import CompositionCard
        if isinstance(card, CompositionCard) and card.frame_target:
            from app.services.generation_canvas.composition import resolve_frame_target
            target = resolve_frame_target(card, self, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts)
            outputs = [item.model_copy(update={'basis_current': item.basis_current and all(ref.basis_current for ref in target.dependencies),
                'payload': item.payload.model_copy(update={'frame_target_state': target})}) for item in outputs]
        if isinstance(card, ObjectDescriptionCard) and not card.name.strip() and not allow_reference_drafts:
            return [item for item in outputs if item.source.port_id != 'object']
        return outputs


    def resolve_outputs(self, card_id: str, *,
                        model_outputs: dict[str, list[CanvasResolvedOutput]] | None, allow_reference_drafts=False) -> list[CanvasResolvedOutput]:
        """按端口顺序解析候选；保存校验可核对草稿的稳定对象身份；公开候选和运行仍要求名称就绪。"""
        document = self.document
        cards = self.cards
        receiver = cards.get(card_id)
        from app.services.generation_canvas.design_references import design_field_references
        retained = [ref.source for ref, _ in prompt_references(receiver)] if isinstance(receiver, ModelCard) else [ref.source for ref, _, _ in design_field_references(receiver)]
        result, seen, counts = [], set(), {}
        edges = self.edges
        for order in document.input_order.get(card_id, {}).values():
            for edge_id in order:
                edge = edges[edge_id]
                source = cards[edge.source_card]
                outputs = [item for item in self.published_outputs(source.id, model_outputs=model_outputs, allow_reference_drafts=allow_reference_drafts) if item.source.port_id == edge.source_port]
                positions = {item.source.position for item in outputs}
                outputs = list(outputs) + [CanvasResolvedOutput(source=ref, modality=edge.source_port if edge.source_port in ('image', 'video', 'audio') else 'text', available=False)
                    for ref in retained if ref.canvas_id == document.id and ref.card_id == source.id and ref.port_id == edge.source_port and ref.position not in positions]
                for item in sorted(outputs, key=lambda value: value.source.position):
                    key = identity_key(item.source)
                    if key in seen:
                        continue
                    seen.add(key)
                    counts[item.modality] = counts.get(item.modality, 0) + 1
                    result.append(item.model_copy(update={'token': '@' + LABELS[item.modality] + str(counts[item.modality])}))
        return result
