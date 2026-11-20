"""按类别替换默认模板，提交边界由请求会话统一管理。"""

from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.llm import ModelSettings
from app.models.studio import PromptCategory, PromptTemplate
from app.schemas.studio.prompts import PromptTemplateCreate
from app.services.common import entity_not_found


async def _lock_default_selection(db: AsyncSession) -> None:
    """锁定初始化时建立的全局设置行，使首次选择（该类别尚无模板）也能串行。"""
    if db.get_bind().dialect.name == "mysql":
        # 单行 upsert 取得排他锁；库刚迁移时也能初始化这条设置，不覆盖现有配置。
        await db.execute(mysql_insert(ModelSettings).values(id=1).on_duplicate_key_update(id=1))
    else:
        # SQLite 的写事务串行化，即使单例尚未初始化也会取得写锁。
        await db.execute(update(ModelSettings).where(ModelSettings.id == 1).values(id=ModelSettings.id))


async def _replace_default(db: AsyncSession, category: PromptCategory, template_id: str) -> None:
    """调用方已锁定选择；在同一事务中撤销其余默认。"""
    await db.execute(update(PromptTemplate).where(
        PromptTemplate.category == category, PromptTemplate.is_default.is_(True),
        PromptTemplate.id != template_id,
    ).values(is_default=False))


async def create_template(db: AsyncSession, body: PromptTemplateCreate) -> PromptTemplate:
    """创建默认模板时在同一事务撤销本类别的旧选择。"""
    template_id = str(uuid4())
    if body.is_default:
        await _lock_default_selection(db)
        await _replace_default(db, body.category, template_id)
    obj = PromptTemplate(id=template_id, is_system=False, version=1, **body.model_dump())
    db.add(obj)
    await db.flush()
    await db.refresh(obj)
    return obj


async def editable_template(db: AsyncSession, template_id: str) -> PromptTemplate:
    """锁定后读取最新选择，避免并发取消或删除刚被选中的模板。"""
    obj = await db.scalar(select(PromptTemplate).where(PromptTemplate.id == template_id).with_for_update())
    if obj is None:
        raise HTTPException(404, entity_not_found("PromptTemplate"))
    return obj


async def apply_template_changes(db: AsyncSession, template_id: str, changes: dict) -> PromptTemplate:
    """选择只影响下次生成；只有模板编辑才变更内容版本。"""
    if changes.get("is_default") is True:
        await _lock_default_selection(db)
    obj = await editable_template(db, template_id)
    if obj.is_system and set(changes) != {"is_default"}:
        raise HTTPException(403, "系统预置提示词不可修改")
    if "is_default" in changes:
        selected = changes.pop("is_default")
        if selected is None:
            raise HTTPException(422, "是否为默认提示词必须是布尔值")
        if obj.is_default and not selected:
            raise HTTPException(409, "请先将同类别的其他模板设为默认")
        if selected and not obj.is_default:
            await _replace_default(db, obj.category, template_id)
            obj.is_default = True
    if any(getattr(obj, key) != value for key, value in changes.items()):
        obj.version += 1
        for key, value in changes.items():
            setattr(obj, key, value)
    if db.is_modified(obj):
        await db.flush()
        await db.refresh(obj, ["updated_at"])
    return obj
