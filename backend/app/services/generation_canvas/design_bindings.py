"""设计卡保存时的直接绑定检查；业务资格及诊断仍由具体卡片决定。"""
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from app.core.contracts.generation_canvas import InputBinding
from app.schemas.generation_canvas import CardDefinition, CanvasDocument, CanvasResolvedOutput


@dataclass(frozen=True)
class DesignBindingCheck:
    """声明合法性与来源可用性分开，供调用方保留原有诊断阶段。"""
    binding: InputBinding
    binding_valid: bool
    output: CanvasResolvedOutput | None


def inspect_design_bindings(document: CanvasDocument, card: CardDefinition,
                            bindings: Sequence[InputBinding],
                            published: dict[str, list[CanvasResolvedOutput]]) -> Iterator[DesignBindingCheck]:
    """按传入顺序检查直接绑定，不产生业务诊断。

    保存沿用草稿身份解析；ID 去重只覆盖本次传入集合。输出须同时满足
    直接连线、稳定身份匹配和可用性，重复候选仍取原先的首个匹配项。
    """
    from app.services.generation_canvas.compiler import resolve_outputs, identity_key
    candidates = {}
    for item in resolve_outputs(document, card.id, published, allow_reference_drafts=True):
        candidates.setdefault(identity_key(item.source), item)
    connections = {(edge.source_card, edge.source_port, edge.target_port)
                   for edge in document.edges if edge.target_card == card.id}
    ids = set()
    for binding in bindings:
        binding_valid = binding.id not in ids and binding.input_port in card.input_ports
        ids.add(binding.id)
        item = candidates.get(identity_key(binding.source))
        connected = (binding.source.card_id, binding.source.port_id, binding.input_port) in connections
        yield DesignBindingCheck(binding, binding_valid, item if connected and item and item.available else None)
