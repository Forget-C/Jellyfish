"""Public compilation preserves independent orders and operation-local state."""
from copy import deepcopy
import pytest
from app.services.generation_canvas.compiler import compile_card
from app.services.generation_canvas.output_resolution import CanvasOutputContext
from app.services.generation_canvas.execution_basis import build_basis, CanvasModelContext
from tests.test_generation_canvas_video import document, instruction


@pytest.mark.parametrize('acceptance,dependencies', [(True, True), (True, False), (False, False)])
def test_video_preparation_keeps_orders_and_does_not_mutate_inputs(acceptance, dependencies):
    doc = document([instruction('关键帧参考', ['a', 'b'])])
    bindings = doc.cards[-1].input_bindings
    bindings.insert(1, bindings[0].model_copy(update={'id': 'repeat-a'}))
    before = deepcopy(doc.model_dump())
    context = CanvasOutputContext(doc, whole_designs=dependencies)
    options = {'context': context, 'include_acceptance': acceptance, 'include_dependencies': dependencies}
    first = compile_card(doc, 'v', **options)
    assert [item.file_id for item in first.media] == ['b', 'a']
    assert [(item.file_id, item.ordinal) for item in first.video_media.frames.keys] == [('a', 0), ('a', 1), ('b', 2)]
    assert first.diagnostics == []
    assert compile_card(doc, 'v', **options).model_dump() == first.model_dump()
    assert doc.model_dump() == before
    basis = build_basis(doc, 'v', {}, revision=1, model_context=CanvasModelContext(), **options)
    assert basis.compiled.media == first.media
    assert basis.to_snapshot()['include_dependencies'] == dependencies
    assert basis.to_snapshot()['include_acceptance'] == acceptance


def mixed_document(kind):
    """Two adopted designs share a direct image and carry another identity."""
    from app.schemas.generation_canvas import CanvasDocument
    raw = document([instruction('关键帧参考', ['a', 'b'])]).model_dump()
    target = raw['cards'][-1]
    target.update(type=kind, config={}, prompt={'segments': []})
    if kind == 'model.image':
        target.pop('design_media_uses', None)
        for binding in target['input_bindings']:
            binding['input_port'] = 'image'
    port = 'image' if kind == 'model.image' else 'key_frame'
    for edge in raw['edges']:
        edge['target_port'] = port
    raw['input_order']['v'] = {port: ['unused', 'b', 'a']}
    for index, source in enumerate(['a', 'unused']):
        design_id = 'design' + str(index)
        identity = {'canvas_id': 'c', 'card_id': source, 'port_id': 'image', 'position': 0}
        raw['cards'].insert(-1, {'id': design_id, 'type': 'direction.style', 'fields': {'direction': {
            'state': 'proposal', 'document': {'segments': [{'kind': 'reference', 'id': 'ref', 'source': identity}]}}}})
        raw['edges'].extend([
            {'id': design_id, 'source_card': design_id, 'source_port': 'text', 'target_card': 'v', 'target_port': 'text'},
            {'id': 'image-' + design_id, 'source_card': source, 'source_port': 'image', 'target_card': design_id, 'target_port': 'image'}])
        raw['input_order'][design_id] = {'image': ['image-' + design_id]}
        raw['input_order']['v'].setdefault('text', []).append(design_id)
        target['input_bindings'].append({'id': design_id, 'input_port': 'text', 'source': {
            'canvas_id': 'c', 'card_id': design_id, 'port_id': 'text', 'position': 0}})
    from app.services.generation_canvas.graph import validate_graph
    result = CanvasDocument.model_validate(raw)
    validate_graph(result)
    return result


@pytest.mark.parametrize('kind', ['model.image', 'model.video'])
@pytest.mark.parametrize('acceptance,dependencies', [(True, True), (True, False), (False, False)])
def test_mixed_design_compilation_preserves_recorded_output_and_basis(kind, acceptance, dependencies):
    from app.services.generation_canvas.execution_basis import digest
    doc = mixed_document(kind)
    before = deepcopy(doc.model_dump())
    basis = build_basis(doc, 'v', {}, revision=1, model_context=CanvasModelContext(),
                        include_acceptance=acceptance, include_dependencies=dependencies)
    key = (kind, acceptance, dependencies)
    assert (digest(basis.compiled.model_dump()), basis.basis_hash) == EXPECTED[key]
    assert doc.model_dump() == before


# Recorded from the pre-refactor public compiler at ef9ac259.
EXPECTED = {('model.image', False, False): ('d683dfc26cfb97f2a6967d3eccc28778b3abb4b15ce81135748f35dda973619f',
                                 '0862364d53ab366d36f35138896f5a77fb138b7537f4a1c1b70b59fb0338ac6e'),
 ('model.image', True, False): ('d683dfc26cfb97f2a6967d3eccc28778b3abb4b15ce81135748f35dda973619f',
                                '0862364d53ab366d36f35138896f5a77fb138b7537f4a1c1b70b59fb0338ac6e'),
 ('model.image', True, True): ('e25f35f8f86f2a6416c9cda794ab291aff276f089fe4bf26ccb29e7b30cbdffe',
                               '27a2784e57a69722eae5ceaefc79653ba804a754edab4d1daf9ad0cd40f36051'),
 ('model.video', False, False): ('4a3498ae8ba91c8234468c5b754a221ec80fa26fc03bec16d62e5c364f349ff7',
                                 '1e71185b82b83118dac2420d86c7810080f890557a29419dc51d351bc59dabd8'),
 ('model.video', True, False): ('4a3498ae8ba91c8234468c5b754a221ec80fa26fc03bec16d62e5c364f349ff7',
                                '1e71185b82b83118dac2420d86c7810080f890557a29419dc51d351bc59dabd8'),
 ('model.video', True, True): ('9adcc8aabcbdd5c7ed57021d1cd89244b1c8c16a051b4bcaa1646aadbab425f6',
                               '3a74e4679f9516cd2a668552f2f3156aee9bab2ada0726d8fb0f190baf77bb3c')}


def test_direct_and_carried_subjects_merge_casefolded_names_without_losing_body_alias():
    from app.schemas.generation_canvas import CanvasDocument
    from app.services.generation_canvas.graph import validate_graph
    raw = mixed_document('model.video').model_dump()
    card = raw['cards'][-1]
    bindings = card['input_bindings']
    for binding in bindings[:2]:
        binding.update(input_port='subject_image', subject_name='Hero' if binding['source']['card_id'] == 'a' else 'Media2')
    card['prompt'] = {'segments': [{'id': 'body', 'kind': 'reference', 'binding_id': bindings[0]['id']}]}
    card['design_media_uses'] = [
        {'id': 'same', 'source': bindings[0]['source'], 'input_port': 'subject_image', 'subject_name': ' hErO '},
        {'id': 'other', 'source': bindings[0]['source'], 'input_port': 'subject_image', 'subject_name': 'Other'},
        {'id': 'carried', 'source': {**bindings[0]['source'], 'card_id': 'unused'}, 'input_port': 'subject_image', 'subject_name': 'Hero'}]
    for edge in raw['edges'][:3]:
        edge['target_port'] = 'subject_image'
    raw['input_order']['v']['subject_image'] = raw['input_order']['v'].pop('key_frame')
    doc = CanvasDocument.model_validate(raw)
    validate_graph(doc)
    before = deepcopy(doc.model_dump())
    compiled = compile_card(doc, 'v')
    assert compiled.diagnostics == []
    assert [item.file_id for item in compiled.media] == ['b', 'a', 'unused']
    assert [(group.name, [item.file_id for item in group.media]) for group in compiled.video_media.subjects] == [
        ('Hero', ['a', 'unused']), ('Media2', ['b']), ('Other', ['a']), ('media3', ['a'])]
    assert '@Hero / @Other' in compiled.text
    assert compiled.text.endswith('模型正文 · 补充说明\n@media3')
    assert [(item.source.card_id, item.media_position) for item in compiled.mapping if item.media_position] == [('b', 1), ('a', 2), ('unused', 3)]
    assert doc.model_dump() == before


@pytest.mark.parametrize('acceptance,dependencies,expected', [
    (True, True, {'design0', 'criterion', 'source'}),
    (True, False, {'design0', 'criterion'}),
    (False, False, {'design0'}),
])
def test_acceptance_modes_keep_real_requirement_and_its_dependency_separate(acceptance, dependencies, expected):
    from app.schemas.generation_canvas import CanvasDocument
    from app.services.generation_canvas.graph import validate_graph
    raw = {'id': 'c', 'project_id': 'p', 'name': '验收模式', 'cards': [
        {'id': 'design0', 'type': 'direction.shot', 'shot_id': 'shot', 'name': '镜头', 'input_bindings': []},
        {'id': 'v', 'type': 'model.text', 'input_bindings': [{'id': 'design', 'input_port': 'text',
         'source': {'canvas_id': 'c', 'card_id': 'design0', 'port_id': 'text', 'position': 0}}]}],
        'edges': [{'id': 'design', 'source_card': 'design0', 'source_port': 'text', 'target_card': 'v', 'target_port': 'text'}],
        'input_order': {'v': {'text': ['design']}, 'design0': {}}}
    source = {'canvas_id': 'c', 'card_id': 'source', 'port_id': 'text', 'position': 0}
    raw['cards'].extend([
        {'id': 'source', 'type': 'content.text', 'text': '验收来源正文'},
        {'id': 'criterion', 'type': 'direction.criterion', 'criterion_id': 'criterion-id', 'name': '验收标准',
         'standard': {'state': 'fact', 'document': {'segments': [{'id': 'requirement', 'kind': 'reference', 'source': source}]}}}])
    design = next(card for card in raw['cards'] if card['id'] == 'design0')
    design['input_bindings'].append({'id': 'accept', 'input_port': 'acceptance_basis', 'source': {
        'canvas_id': 'c', 'card_id': 'criterion', 'port_id': 'criterion', 'position': 0, 'object_id': 'criterion-id'}})
    raw['edges'].extend([
        {'id': 'accept', 'source_card': 'criterion', 'source_port': 'criterion', 'target_card': 'design0', 'target_port': 'acceptance_basis'},
        {'id': 'source', 'source_card': 'source', 'source_port': 'text', 'target_card': 'criterion', 'target_port': 'text'}])
    raw['input_order']['design0']['acceptance_basis'] = ['accept']
    raw['input_order']['criterion'] = {'text': ['source']}
    doc = CanvasDocument.model_validate(raw)
    validate_graph(doc)
    before = deepcopy(doc.model_dump())
    basis = build_basis(doc, 'v', {}, revision=1, model_context=CanvasModelContext(),
                        include_acceptance=acceptance, include_dependencies=dependencies)
    assert {item.source.card_id for item in basis.compiled.used if item.modality == 'text'} == expected
    assert ('验收来源正文' in basis.compiled.text) == acceptance
    assert basis.compiled.diagnostics == []
    assert doc.model_dump() == before
