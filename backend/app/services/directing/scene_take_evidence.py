"""固定素材复核的共享比较与有界查询；调用方提供已鉴权快照。"""
from sqlalchemy import func, or_, select, tuple_

from app.core.contracts.directing.scene_timeline import SceneTimeline
from app.core.contracts.directing.scene_version import SceneVersionContent
from app.models.directing import SceneCopyOrigin, SceneTakeReviewRecord


def take_review_matches(fixed, current, take_kind, take_id):
    """保持原复核语义：忽略剪辑，仅保留所审素材的当前判断。"""
    current = current.model_copy(update={'take_judgments': [item for item in current.take_judgments
        if (item.take_kind, item.take_id) == (take_kind, take_id)], 'timeline': SceneTimeline()})
    return fixed.model_copy(update={'timeline': SceneTimeline()}) == current


async def latest_take_reviews(db, version_id, current):
    """数据库先选每个复合素材最新记录，再读取其固定正文；复制只消费显式继承身份。"""
    origin = await db.get(SceneCopyOrigin, version_id)
    inherited = origin.review_ids.get('take', []) if origin else []
    ranked = select(SceneTakeReviewRecord.id, SceneTakeReviewRecord.take_kind, SceneTakeReviewRecord.take_id,
        func.row_number().over(partition_by=(SceneTakeReviewRecord.take_kind, SceneTakeReviewRecord.take_id),
        order_by=(SceneTakeReviewRecord.created_at.desc(), SceneTakeReviewRecord.id.desc())).label('position')).where(or_(
            SceneTakeReviewRecord.version_id == version_id, SceneTakeReviewRecord.id.in_(inherited))).subquery()
    result = {}
    unresolved = None
    offset = 0
    while unresolved is None or unresolved:
        query = select(SceneTakeReviewRecord).join(ranked, ranked.c.id == SceneTakeReviewRecord.id).where(
            ranked.c.position > offset, ranked.c.position <= offset + 32).order_by(ranked.c.position)
        if unresolved is not None:
            query = query.where(tuple_(ranked.c.take_kind, ranked.c.take_id).in_(unresolved))
        rows = list(await db.scalars(query))
        if not rows:
            break
        candidates = set()
        for row in rows:
            key = (row.take_kind, row.take_id)
            candidates.add(key)
            if key in result and any(match for _, match in result[key]):
                continue
            fixed = SceneVersionContent.model_validate(row.content)
            matches = take_review_matches(fixed, current, *key)
            if key not in result:
                result[key] = [(row, matches)]
            elif matches:
                result[key].append((row, True))
        unresolved = {key for key in candidates if not any(match for _, match in result[key])}
        offset += 32
    return result
