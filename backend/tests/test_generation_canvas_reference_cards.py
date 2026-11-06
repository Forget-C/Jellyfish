"""单对象参考卡的草稿、名称命名空间和直接图片来源契约。"""
from copy import deepcopy
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.schemas.generation_canvas import CanvasDocument
from app.services.generation_canvas.compiler import compile_card, published_card_outputs
from app.services.generation_canvas.graph import validate_graph


def document(cards, edges=None, orders=None):
    return CanvasDocument.model_validate({'id': 'canvas', 'project_id': 'p', 'name': '参考',
        'cards': cards, 'edges': edges or [], 'input_order': orders or {}})


def reference(identity, category='character', name='小雪'):
    return {'id': identity, 'type': f'reference.{category}', 'name': name,
            'image_binding': {'file_id': 'picture'}}


def test_single_reference_name_is_trimmed_and_published_as_one_object():
    doc = document([reference('ref', name=' 小雪 ')])
    outputs = published_card_outputs(doc, 'ref')
    assert outputs[0].payload.name == '小雪'
    assert len(outputs[0].payload.objects) == 1
    assert outputs[0].payload.objects[0].object_id == 'ref'
    assert outputs[0].payload.objects[0].category == 'character'


@pytest.mark.parametrize('names', [('', '其他'), ('小雪', ' 小雪 ')])
def test_empty_and_duplicate_names_are_saved_drafts_without_outputs(names):
    doc = document([reference('one', name=names[0]), reference('two', name=names[1])])
    assert published_card_outputs(doc, 'one') == []
    if names[0]:
        assert published_card_outputs(doc, 'two') == []


def test_cross_category_names_compile_with_namespaces_and_invalid_names_block_run():
    model = {'id': 'model', 'type': 'model.image', 'input_bindings': [
        {'id': name, 'input_port': 'image', 'source': {'canvas_id': 'canvas', 'card_id': name,
         'port_id': 'image', 'position': 0}} for name in ['person', 'costume']]}
    edges = [{'id': name, 'source_card': name, 'source_port': 'image', 'target_card': 'model',
              'target_port': 'image'} for name in ['person', 'costume']]
    doc = document([reference('person', name='雨燕'), reference('costume', 'costume', '雨燕'), model],
                   edges, {'model': {'image': ['person', 'costume']}})
    result = compile_card(doc, 'model')
    assert result.can_run
    assert '人物·雨燕 = image 1（正面）' in result.text
    assert '服装·雨燕 = image 2（正面）' in result.text
    doc.cards[0].name = ''
    assert not compile_card(doc, 'model').can_run


@pytest.mark.parametrize('category', ['character', 'place', 'prop', 'costume'])
def test_reference_images_of_other_categories_cannot_be_connected(category):
    doc = document([reference('person'), reference('other', category)], [
        {'id': 'edge', 'source_card': 'other', 'source_port': 'image', 'target_card': 'person',
         'target_port': 'image_source'}], {'person': {'image_source': ['edge']}})
    with pytest.raises(HTTPException) as error:
        validate_graph(doc)
    assert error.value.detail['code'] == 'INVALID_REFERENCE_SOURCE'


def test_legacy_reference_is_rejected_without_mutation():
    raw = {'id': 'canvas', 'project_id': 'p', 'name': '旧画布', 'cards': [
        {'id': 'person', 'type': 'content.object', 'object_id': 'alice', 'name': '小雪'},
        {'id': 'ref', 'type': 'reference.character', 'title': '旧标题', 'input_bindings': [
            {'id': 'binding', 'input_port': 'name', 'source': {'canvas_id': 'canvas',
             'card_id': 'person', 'port_id': 'object', 'position': 0, 'object_id': 'alice'}}]}],
        'edges': [{'id': 'edge', 'source_card': 'person', 'source_port': 'object',
                   'target_card': 'ref', 'target_port': 'name'}], 'input_order': {'ref': {'name': ['edge']}}}
    original = deepcopy(raw)
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CanvasDocument.model_validate(raw)
    assert raw == original


@pytest.mark.parametrize('name', [None, '名' * 256])
def test_reference_name_rejects_invalid_type_and_excessive_length(name):
    with pytest.raises(ValidationError):
        document([reference('ref', name=name)])


def test_reference_unique_key_includes_trimmed_angle():
    doc = document([reference('front'), {**reference('side'), 'angle': '侧面'}])
    assert published_card_outputs(doc, 'front') and published_card_outputs(doc, 'side')
    doc.cards[1].angle = ' 正面 '
    assert published_card_outputs(doc, 'front') == published_card_outputs(doc, 'side') == []
