"""分类资产当前图片仅展示已保存的生成快照，不补录或暴露执行配置。"""

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.models.studio import Actor, ActorImage, Scene, SceneImage, Prop, PropImage, Costume, CostumeImage, Character, CharacterImage
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import Task, TaskOutput


@pytest.mark.parametrize("kind,parent,image_model", [("character", Character, CharacterImage), ("actor", Actor, ActorImage), ("scene", Scene, SceneImage), ("prop", Prop, PropImage), ("costume", Costume, CostumeImage)])
@pytest.mark.asyncio
async def test_asset_image_saved_parameters_are_read_only_and_match_output(kind, parent, image_model):
    """按当前文件关联同类对象的来源任务，错误归属及上传不猜参数。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def test_db():
        async with sessions() as db:
            yield db

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = test_db
    try:
        async with sessions() as db:
            db.add_all([parent(id="a", name="演员", style="realistic", **({"project_id": "p"} if kind == "character" else {})), parent(id="other", name="其他演员", style="realistic", **({"project_id": "p"} if kind == "character" else {})),
                        FileItem(id="generated", name="图片", type="image", storage_key="image"),
                        FileItem(id="upload", name="上传", type="image", storage_key="upload")])
            await db.flush()
            db.add_all([image_model(id=1, **{f"{kind}_id": "a"}, file_id="generated", view_angle="FRONT"),
                        image_model(id=2, **{f"{kind}_id": "a"}, file_id="upload", view_angle="FRONT")])
            db.add(Task(id="origin", kind="image_generation", status="succeeded", target_type=f"{kind}_image_slot", target_id="old-slot",
                        input_snapshot={"target_parent_id": "a", "model_name": "当时的模型", "execution_prompt": "已保存提示词", "provider_key": "private", "execution_config": {"secret": "never"},
                                        "asset_prompt_audit": {"variables": {"view_angle": "正面", "lighting_instruction": "柔光", "unknown": "hidden"}, "reference_file_ids": ["ref"]}}))
            await db.flush()
            db.add(TaskOutput(task_id="origin", ordinal=0, file_id="generated"))
            await db.commit()
        statements = []

        def record(_connection, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        event.listen(engine.sync_engine, "before_cursor_execute", record)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get(f"/api/v1/film/tasks/asset-images/{kind}/a/1/parameters")
            assert response.status_code == 200
            if kind == "actor":
                legacy = await client.get("/api/v1/film/tasks/actor-images/a/1/parameters")
                assert legacy.json() == response.json()
            assert (await client.get("/api/v1/film/tasks/asset-images/unsupported/a/1/parameters")).status_code == 422
            data = response.json()["data"]
            assert data["model_name"] == "当时的模型"
            assert data["view_angle"] == "正面"
            assert data["reference_count"] == 1
            assert data["parameters"] == {"lighting_instruction": "柔光"}
            assert data["execution_prompt"] == "已保存提示词"
            assert "private" not in response.text and "secret" not in response.text and "unknown" not in response.text
            assert (await client.get(f"/api/v1/film/tasks/asset-images/{kind}/a/2/parameters")).json()["data"] is None
            assert (await client.get(f"/api/v1/film/tasks/asset-images/{kind}/other/1/parameters")).status_code == 404
        assert not any(sql.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for sql in statements)
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        await engine.dispose()
