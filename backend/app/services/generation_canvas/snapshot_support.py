"""拒绝已退出的历史执行输入；只检测原始快照，不转换或改写历史。"""
from fastapi import HTTPException
from pydantic import ValidationError
from app.core.contracts.generation_canvas import DesignFieldDocument

RETIRED_EXAMPLE_TYPES = {'direction.event', 'direction.activity', 'direction.guidance', 'direction.fact', 'direction.narrative', 'direction.beat', 'direction.criterion', 'direction.shot', 'direction.creative_control', 'direction.environment', 'direction.continuity', 'direction.performance', 'direction.situation', 'direction.space_rule', 'direction.blocking', 'direction.performance_rule'}
RETIRED_OBJECT_TYPES = {'direction.criterion', 'direction.sound', 'direction.situation', 'direction.performance', 'direction.activity', 'direction.camera', 'direction.lighting', 'direction.focus', 'direction.composition', 'direction.movement', 'direction.creative_control', 'direction.guidance', 'direction.fact', 'direction.performance_rule', 'direction.narrative', 'direction.event', 'direction.space_rule', 'direction.anchor'}
VISUAL_DESIGNS = {'direction.style', 'direction.composition', 'direction.movement', 'direction.camera', 'direction.lighting', 'direction.focus'}


def _criterion_field_reference(value, criteria):
    """仅检查合法字段文档内的验收引用；损坏字段仍交由原结构校验拒绝。"""
    if isinstance(value, list):
        return any(_criterion_field_reference(item, criteria) for item in value)
    if not isinstance(value, dict):
        return False
    document = value.get('document')
    if isinstance(document, dict):
        try:
            field = DesignFieldDocument.model_validate(document)
        except ValidationError:
            return False
        if any(part.kind == 'reference' and part.source.card_id in criteria for part in field.segments):
            return True
    return any(_criterion_field_reference(item, criteria) for key, item in value.items() if key != 'document')


def require_supported_snapshot(snapshot):
    """Worker 与历史等待节点共用；沿用示例、验收、摄影诊断优先级，拒绝旧对象及参考结构。"""
    document = snapshot.get('document', {})
    cards = document.get('cards', [])
    by_id = {card.get('id'): card for card in cards}
    retired_examples = {card.get('id') for card in cards if card.get('type') in RETIRED_EXAMPLE_TYPES}
    edges = document.get('edges', [])
    if any(card.get('id') in retired_examples and card.get('examples') for card in cards) or any(
            edge.get('target_card') in retired_examples and edge.get('target_port') in ('image_example', 'video_example', 'audio_example') for edge in edges):
        raise HTTPException(422, {'code': 'LEGACY_DESIGN_SNAPSHOT', 'message': '旧示例功能已移除，请从当前画布重新提交'})
    criteria = {card.get('id') for card in cards if card.get('type') == 'direction.criterion'}
    for card in cards:
        bindings = card.get('input_bindings', [])
        if card.get('type') in RETIRED_OBJECT_TYPES and any(b.get('input_port') == 'effect_object' for b in bindings):
            raise HTTPException(422, {'code': 'LEGACY_ACCEPTANCE_SNAPSHOT', 'message': '旧验收或通用对象用途已退出，请使用当前画布重新提交'})
        if card.get('type', '').startswith('direction.') and (
                any(b.get('source', {}).get('card_id') in criteria and b.get('source', {}).get('port_id') == 'text' for b in bindings)
                or _criterion_field_reference(card, criteria)):
            raise HTTPException(422, {'code': 'LEGACY_ACCEPTANCE_SNAPSHOT', 'message': '旧验收或通用对象用途已退出，请使用当前画布重新提交'})
    for edge in edges:
        receiver = by_id.get(edge.get('target_card'), {})
        if receiver.get('type') in RETIRED_OBJECT_TYPES and edge.get('target_port') == 'effect_object':
            raise HTTPException(422, {'code': 'LEGACY_ACCEPTANCE_SNAPSHOT', 'message': '旧验收或通用对象用途已退出，请使用当前画布重新提交'})
        if edge.get('source_card') in criteria and receiver.get('type', '').startswith('direction.'):
            bound = any(b.get('input_port') == 'acceptance_basis' and b.get('source', {}).get('card_id') == edge.get('source_card') for b in receiver.get('input_bindings', []))
            if edge.get('source_port') == 'text' or not bound:
                raise HTTPException(422, {'code': 'LEGACY_ACCEPTANCE_SNAPSHOT', 'message': '旧验收或通用对象用途已退出，请使用当前画布重新提交'})
    if any(card.get('type') == 'direction.photography' or card.get('type') in VISUAL_DESIGNS and card.get('examples') or any('photography_scope' in b for b in card.get('input_bindings', [])) for card in cards):
        raise HTTPException(422, {'code': 'LEGACY_DESIGN_SNAPSHOT', 'message': '旧画面设计固定依据已不受支持，请使用当前独立设计重新提交'})
    if document.get('schema_version', 2) != 2 or any(card.get('type') == 'content.object' or (
            card.get('type', '').startswith('reference.') and (card.get('type_version', 2) != 2 or any(key in card for key in ('title', 'objects', 'input_bindings', 'positions')))) for card in cards):
        raise HTTPException(422, {'code': 'LEGACY_DESIGN_SNAPSHOT', 'message': '旧对象或参考格式已不受支持，请使用当前画布重新提交'})
