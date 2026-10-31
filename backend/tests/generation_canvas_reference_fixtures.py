"""模型映射回归共用的图片内容来源，避免测试继续依赖已退役的参考卡直接导入。"""


def reference_image_sources(document):
    """为独立文件参考补显式图片内容卡与来源边，保留原卡片顺序及对象身份。"""
    for card in list(document['cards']):
        image = card.get('image_binding')
        if not card['type'].startswith('reference.') or not image or image.get('source'):
            continue
        source_id = card['id'] + '-picture'
        if not any(value['id'] == source_id for value in document['cards']):
            document['cards'].append({'id': source_id, 'type': 'content.image', 'file_id': image['file_id']})
        edge_id = card['id'] + '-picture-edge'
        if not any(edge['id'] == edge_id for edge in document.setdefault('edges', [])):
            document['edges'].append({'id': edge_id, 'source_card': source_id, 'source_port': 'image', 'target_card': card['id'], 'target_port': 'image_source'})
            document.setdefault('input_order', {}).setdefault(card['id'], {}).setdefault('image_source', []).append(edge_id)
        image['source'] = {'canvas_id': document['id'], 'card_id': source_id, 'port_id': 'image', 'position': 0}
    return document
