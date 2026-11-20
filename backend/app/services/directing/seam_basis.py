"""旧迁移使用的接缝审查依据。"""
from app.services.directing.review_basis_key import review_basis_key


def scene_seam_bases(content):
    """一次排序保留直接相接的真实采用；绝对位置不进入比较依据。"""
    items = sorted(content.timeline.items, key=lambda item: (item.timeline_start_ms, item.id))
    return {(left.id, right.id): {'output_aspect_ratio': content.output_aspect_ratio,
        'left': left.model_dump(mode='json', exclude={'timeline_start_ms'}),
        'right': right.model_dump(mode='json', exclude={'timeline_start_ms'})}
        for left, right in zip(items, items[1:])
        if left.kind == right.kind == 'media' and left.timeline_start_ms +
        left.media_range.source_out_ms - left.media_range.source_in_ms == right.timeline_start_ms}


def scene_seam_basis(content, left_id, right_id):
    """替换、区间、构图或相接关系变化使原结论待复核，整体平移仍适用。"""
    return scene_seam_bases(content).get((left_id, right_id))


def seam_review_basis_key(content, left_id, right_id):
    """只索引原接缝两侧的固定依据；整体平移与无关片段不改变适用性。"""
    basis = scene_seam_basis(content, left_id, right_id)
    if basis is None:
        raise ValueError('固定接缝依据无效，请核对原记录')
    return review_basis_key(basis)
