"""旧迁移使用的素材复核依据。"""
from app.services.directing.review_basis_key import review_basis_key

from app.core.contracts.directing.scene_timeline import SceneTimeline


def take_review_basis_key(content, take_kind=None, take_id=None):
    """固定内容仅有一个判断；当前内容按指定复合身份过滤，忽略剪辑。"""
    judgments = content.take_judgments if take_kind is None else [item for item in content.take_judgments
        if (item.take_kind, item.take_id) == (take_kind, take_id)]
    return review_basis_key(content.model_copy(update={'timeline': SceneTimeline(), 'take_judgments': judgments}).model_dump(mode='json'))
