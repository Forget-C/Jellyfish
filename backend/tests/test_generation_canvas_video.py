"""Video purpose compilation through the public canvas compiler."""
from app.schemas.generation_canvas import CanvasDocument, CanvasModelCapability
from app.services.generation_canvas.compiler import compile_card


def document(segments):
    return CanvasDocument.model_validate({'id': 'c', 'project_id': 'p', 'name': 'Video', 'cards': [
        {'id': source, 'type': 'content.image', 'file_id': source} for source in ['a', 'b', 'unused']
    ] + [{'id': 'v', 'type': 'model.video', 'config': {'ratio': '16:9'}, 'prompt': {'segments': segments}}],
        'edges': [{'id': source, 'source_card': source, 'source_port': 'image', 'target_card': 'v', 'target_port': 'subject_image'} for source in ['unused', 'b', 'a']],
        'input_order': {'v': {'subject_image': ['unused', 'b', 'a']}}})


def ref(source, suffix=''):
    return {'kind': 'reference', 'id': source + suffix, 'source': {'canvas_id': 'c', 'card_id': source, 'port_id': 'image', 'position': 0}}


def instruction(command, sources, name=None, suffix=''):
    return {'kind': 'instruction', 'id': command + suffix, 'command': command, 'parameters': {'name': name} if name is not None else {}, 'references': [ref(source, command + suffix) for source in sources]}


def test_video_purposes_preserve_frame_order_and_do_not_require_body_references():
    from app.services.generation_canvas.compiler import video_media
    doc = document([instruction('首帧参考', ['a']), instruction('尾帧参考', ['b']), instruction('关键帧参考', ['a', 'b'])])
    compiled = compile_card(doc, 'v')
    media = video_media(doc, 'v', compiled)
    assert media.model_dump() == {'frames': {'first': {'file_id': 'a', 'media_kind': 'image', 'ordinal': 0},
        'last': {'file_id': 'b', 'media_kind': 'image', 'ordinal': 0}, 'keys': [
            {'file_id': 'a', 'media_kind': 'image', 'ordinal': 0}, {'file_id': 'b', 'media_kind': 'image', 'ordinal': 1}]}, 'subjects': []}
    assert compiled.can_run
    assert [item.file_id for item in compiled.media] == ['b', 'a']


def test_unique_named_subject_preserves_body_and_same_name_coalesces():
    from app.services.generation_canvas.compiler import video_media
    doc = document([{'id': 'before', 'kind': 'text', 'text': '让 '}, ref('a', 'body'),
        {'id': 'after', 'kind': 'text', 'text': ' 中的人物转身。'}, instruction('主体参考', ['a'], '张三'), instruction('主体参考', ['b'], '张三', 'again')])
    compiled = compile_card(doc, 'v')
    assert compiled.text == '让 @张三 中的人物转身。'
    assert [(item.name, [ref.file_id for ref in item.media]) for item in video_media(doc, 'v', compiled).subjects] == [('张三', ['a', 'b'])]


def test_implicit_and_multiple_group_material_keeps_actual_media_alias():
    from app.services.generation_canvas.compiler import video_media
    doc = document([ref('a', 'body'), ref('b', 'body'), instruction('主体参考', ['a'], '甲'), instruction('主体参考', ['a'], '乙', 'second')])
    compiled = compile_card(doc, 'v')
    assert compiled.text == '@media2@media1'
    assert [(item.name, [ref.file_id for ref in item.media]) for item in video_media(doc, 'v', compiled).subjects] == [('甲', ['a']), ('乙', ['a']), ('media1', ['b']), ('media2', ['a'])]


def test_frame_subject_combination_and_group_limits_locate_stable_instruction():
    doc = document([instruction('首帧参考', ['a']), instruction('主体参考', ['b', 'a'], '张三')])
    cap = CanvasModelCapability(model_id='m', modality='video', input_ports=['text', 'first_frame', 'subject_image'], ratios=['16:9'], max_images_per_subject=1)
    compiled = compile_card(doc, 'v', capability=cap)
    assert not compiled.can_run
    assert {(item.code, item.target['segment_id']) for item in compiled.diagnostics} >= {('UNSUPPORTED_REFERENCE_COMBINATION', '主体参考'), ('SUBJECT_LIMIT_EXCEEDED', '主体参考')}
