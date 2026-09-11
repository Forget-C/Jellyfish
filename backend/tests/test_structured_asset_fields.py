"""分类设定、派生描述与局部写入契约的集成测试。"""

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.studio import Actor, Scene, Prop, Costume
from app.schemas.studio.cast import ActorCreate, ActorUpdate
from app.schemas.studio.assets import SceneCreate, PropCreate, CostumeCreate
from app.services.studio.entity_crud import create_entity, update_entity, list_entities_paginated


@pytest.mark.parametrize("schema,field", [
    (ActorCreate, "hair"), (SceneCreate, "spatial_layout"),
    (PropCreate, "shape"), (CostumeCreate, "structure"),
])
def test_category_contract_rejects_description_and_unrelated_fields(schema, field):
    """旧描述及未知键必须明确拒绝，不能静默丢失输入。"""
    assert getattr(schema(id="asset", name="资产", **{field: "已确认"}), field) == "已确认"
    for extra in ({"description": "旧描述"}, {"unrelated": "错误"}):
        with pytest.raises(ValidationError):
            schema(id="asset", name="资产", **extra)


def test_optional_patch_and_limits():
    """未传、清空及过长值分别产生明确行为。"""
    assert ActorUpdate().model_dump(exclude_unset=True) == {}
    assert ActorUpdate(hair=None, supplementary_info="").model_dump(exclude_unset=True) == {
        "hair": None, "supplementary_info": "",
    }
    with pytest.raises(ValidationError):
        ActorUpdate(age_appearance="年" * 201)
    with pytest.raises(ValidationError):
        ActorUpdate(supplementary_info=None)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,model,facts,expected", [
    ("actor", Actor, {"age_appearance": "约30岁", "hair": "黑色短发"}, "外观年龄：约30岁\n发型发色：黑色短发"),
    ("scene", Scene, {"scene_type": "室内", "materials": "木质"}, "场所类型：室内\n主要材质：木质"),
    ("prop", Prop, {"shape": "圆形", "colors": "蓝色"}, "外形结构：圆形\n颜色：蓝色"),
    ("costume", Costume, {"structure": "双层", "materials": "棉布"}, "款式层次：双层\n材质：棉布"),
])
async def test_crud_description_search_and_patch(kind, model, facts, expected):
    """真实数据库验证创建、摘要搜索、字段更新及清空的一致性。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            payload = await create_entity(db, entity_type=kind, body={
                "id": "asset", "name": "测试", "supplementary_info": "不要文字", **facts,
            })
            assert payload["description"] == expected + "\n不要文字"
            assert all(payload[key] == value for key, value in facts.items())
            rows, total = await list_entities_paginated(
                db, entity_type=kind, q="不要文字", style=None, visual_style=None,
                order=None, is_desc=False, page=1, page_size=10,
            )
            assert total == 1 and rows[0]["description"] == payload["description"]
            assert (await db.execute(select(model.description))).scalar_one() == payload["description"]
            first = next(iter(facts))
            updated = await update_entity(db, entity_type=kind, entity_id="asset", body={first: None})
            assert updated[first] is None
            assert updated["supplementary_info"] == "不要文字"
            remaining = next(key for key in facts if key != first)
            updated = await update_entity(db, entity_type=kind, entity_id="asset", body={
                remaining: "不适用", "supplementary_info": "",
            })
            assert updated["description"] == ""
            assert "description" not in model.__table__.columns
    finally:
        await engine.dispose()
