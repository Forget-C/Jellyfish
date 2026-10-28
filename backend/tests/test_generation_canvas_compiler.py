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


def test_binding_order_preserves_identity_and_same_file_is_two_inputs_with_missing_placeholder():
    document = CanvasDocument.model_validate({'id': 'canvas', 'project_id': 'p', 'name': 'Test', 'cards': [
        {'id': 'a', 'type': 'content.image', 'file_id': 'same'}, {'id': 'b', 'type': 'content.image', 'file_id': 'same'},
        {'id': 'target', 'type': 'model.image', 'prompt': {'segments': [
            {'id': name, 'kind': 'reference', 'source': {'canvas_id': 'canvas', 'card_id': source, 'port_id': 'image', 'position': 0}}
            for name, source in [('one', 'a'), ('again', 'a'), ('two', 'b')]]}}],
        'edges': [{'id': source, 'source_card': source, 'source_port': 'image', 'target_card': 'target', 'target_port': 'image'} for source in ['a', 'b']],
        'input_order': {'target': {'image': ['b', 'a']}}})
    result = compile_card(document, 'target')
    assert result.text == '[media:1][media:1][media:2]'
    assert [item.source.card_id for item in result.media] == ['a', 'b']
    document.cards[0].file_id = None
    missing = compile_card(document, 'target')
    assert [(item.code, item.target['segment_id']) for item in missing.diagnostics] == [('OUTPUT_MISSING', 'one'), ('OUTPUT_MISSING', 'again')]
    document.cards[0].file_id = 'restored'
    assert compile_card(document, 'target').can_run


def test_instruction_structure_is_located_and_used_in_capability_validation():
    from app.schemas.generation_canvas import CanvasModelCapability
    document = CanvasDocument.model_validate({'id': 'canvas', 'project_id': 'p', 'name': 'Test', 'cards': [
        {'id': 'source', 'type': 'content.image', 'file_id': 'file'},
        {'id': 'target', 'type': 'model.video', 'config': {'ratio': '16:9'}, 'prompt': {'segments': [
            {'id': 'instruction', 'kind': 'instruction', 'command': '首帧参考', 'references': [
                {'id': 'ref', 'kind': 'reference', 'source': {'canvas_id': 'canvas', 'card_id': 'source', 'port_id': 'image', 'position': 0}}]}]}}],
        'edges': [{'id': 'edge', 'source_card': 'source', 'source_port': 'image', 'target_card': 'target', 'target_port': 'first_frame'}],
        'input_order': {'target': {'first_frame': ['edge']}}})
    supported = CanvasModelCapability(model_id='video', modality='video', input_ports=['text', 'first_frame'], ratios=['16:9'])
    assert compile_card(document, 'target', capability=supported).can_run
    unsupported = supported.model_copy(update={'input_ports': ['text']})
    result = compile_card(document, 'target', capability=unsupported)
    assert not result.can_run
    assert any(item.code == 'UNSUPPORTED_INPUT' for item in result.diagnostics)
    document.cards[1].prompt.segments = []
    document.cards[1].input_bindings = []
    result = compile_card(document, 'target', capability=unsupported)
    assert result.can_run
    assert [(item.code, item.severity, item.blocks) for item in result.diagnostics] == [('UNUSED_INCOMPATIBLE_INPUT', 'warning', [])]


def test_only_referenced_media_subset_maps_positions_and_empty_output_is_not_offered():
    from app.services.generation_canvas.compiler import resolve_outputs
    document = CanvasDocument.model_validate({'id': 'canvas', 'project_id': 'p', 'name': 'Test', 'cards': [
        *[{'id': source, 'type': 'content.image', 'file_id': source} for source in ['a', 'b', 'c']],
        {'id': 'empty', 'type': 'content.image'}, {'id': 'future', 'type': 'model.image'},
        {'id': 'target', 'type': 'model.image', 'prompt': {'segments': [
            {'id': 'literal', 'kind': 'text', 'text': '图片3 '},
            {'id': 'ref', 'kind': 'reference', 'source': {'canvas_id': 'canvas', 'card_id': 'c', 'port_id': 'image', 'position': 0}}]}}],
        'edges': [{'id': source, 'source_card': source, 'source_port': 'image', 'target_card': 'target', 'target_port': 'image'} for source in ['a', 'b', 'c', 'empty', 'future']],
        'input_order': {'target': {'image': ['a', 'b', 'c', 'empty', 'future']}}})
    assert [item.token for item in resolve_outputs(document, 'target')] == ['@图片1', '@图片2', '@图片3']
    result = compile_card(document, 'target')
    assert result.text == '图片3 [media:1]'
    assert [(item.token, item.file_id) for item in result.media] == [('@图片3', 'c')]
    document.cards[-1].prompt.segments[-1].source.card_id = 'empty'
    missing = compile_card(document, 'target')
    assert not missing.can_run
    assert missing.diagnostics[0].code == 'OUTPUT_MISSING'
