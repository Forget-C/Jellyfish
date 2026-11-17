"""章节原意解释的校验与有效依据；不改变原文范围身份。"""
from hashlib import sha256
import json

from fastapi import HTTPException
from app.schemas.source_explanations import chapter_basis_version


def source_version(text: str) -> str:
    """与章节现有正文版本计算保持一致。"""
    return sha256(text.encode()).hexdigest()


def validate_explanations(items: list[dict], text: str) -> None:
    """允许保留旧版本待复核解释，当前版本的片段必须可唯一定位。"""
    identities = [item['id'] for item in items]
    if len(identities) != len(set(identities)):
        raise HTTPException(422, '原文解释身份不能重复')
    version = source_version(text)
    for item in items:
        if not item['text'].strip():
            raise HTTPException(422, '原文解释不能为空')
        excerpt = item['excerpt']
        if item['source_version'] != version:
            continue
        start, end = item.get('start'), item.get('end')
        if start is not None or end is not None:
            if start is None or end is None or not excerpt or not 0 <= start < end <= len(text) or text[start:end] != excerpt:
                raise HTTPException(422, '解释范围与当前原文摘录不匹配')
        elif excerpt and text.count(excerpt) != 1:
            raise HTTPException(422, '重复摘录请明确选择原文位置')


def explanation_basis(chapter) -> dict:
    """任务固定有效解释及独立摘要，不读取或改写历史任务。"""
    version = source_version(chapter.raw_text)
    items = [item for item in (chapter.source_explanations or []) if item['source_version'] == version]
    encoded = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return {'items': items, 'version': source_version(encoded)}



async def lock_explanation_update(db, chapter_id: str, expected: str):
    """保存解释前锁定章节并核对读取基线。"""
    from sqlalchemy import select
    from app.models.studio import Chapter
    chapter = await db.scalar(select(Chapter).where(Chapter.id == chapter_id).with_for_update().execution_options(populate_existing=True))
    if chapter is None:
        raise HTTPException(404, '章节不存在')
    if chapter_basis_version(chapter.raw_text, chapter.source_explanations) != expected:
        raise HTTPException(409, '章节原文或解释已更新，请重新读取后保存')
    return chapter
