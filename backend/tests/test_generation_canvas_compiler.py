"""Public compiler rules use actual content, independent of provider adapters."""
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.compiler import compile_card


def test_text_expands_only_at_stable_reference_and_never_recursively():
    document = CanvasDocument.model_validate({
        'id': 'canvas', 'project_id': 'p', 'name': 'Test',
        'cards': [{'id': 'source', 'type': 'content.text', 'text': '@图片1 /首帧参考'},
                  {'id': 'target', 'type': 'model.text', 'prompt': {'segments': [
                      {'id': 'before', 'kind': 'text', 'text': 'before '},
                      {'id': 'ref', 'kind': 'reference', 'source': {'canvas_id': 'canvas', 'card_id': 'source', 'port_id': 'text', 'position': 0}},
                      {'id': 'after', 'kind': 'text', 'text': ' literal @文本1 \\@图片1'}]}}],
        'edges': [{'id': 'edge', 'source_card': 'source', 'source_port': 'text', 'target_card': 'target', 'target_port': 'text'}],
        'input_order': {'target': {'text': ['edge']}}})
    result = compile_card(document, 'target')
    assert result.text == 'before @图片1 /首帧参考 literal @文本1 @图片1'
    assert [item.source.card_id for item in result.used] == ['source']


def test_reorder_preserves_identity_and_same_file_is_two_inputs_with_missing_placeholder():
    document = CanvasDocument.model_validate({'id': 'canvas', 'project_id': 'p', 'name': 'Test', 'cards': [
        {'id': 'a', 'type': 'content.image', 'file_id': 'same'}, {'id': 'b', 'type': 'content.image', 'file_id': 'same'},
        {'id': 'target', 'type': 'model.image', 'prompt': {'segments': [
            {'id': name, 'kind': 'reference', 'source': {'canvas_id': 'canvas', 'card_id': source, 'port_id': 'image', 'position': 0}}
            for name, source in [('one', 'a'), ('again', 'a'), ('two', 'b')]]}}],
        'edges': [{'id': source, 'source_card': source, 'source_port': 'image', 'target_card': 'target', 'target_port': 'image'} for source in ['a', 'b']],
        'input_order': {'target': {'image': ['b', 'a']}}})
    result = compile_card(document, 'target')
    assert result.text == '[media:2][media:2][media:1]'
    assert [item.source.card_id for item in result.media] == ['b', 'a']
    document.cards[0].file_id = None
    missing = compile_card(document, 'target')
    assert [(item.code, item.target['segment_id']) for item in missing.diagnostics] == [('OUTPUT_MISSING', 'one'), ('OUTPUT_MISSING', 'again')]
    document.cards[0].file_id = 'restored'
    assert compile_card(document, 'target').can_run
