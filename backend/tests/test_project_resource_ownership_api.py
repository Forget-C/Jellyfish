"""通过公开 API 验证项目专属资源与共享资产的隔离。"""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.dependencies import get_db
from app.main import app
from app.core import storage
from app.models.llm import Model, Provider, ModelCategoryKey


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["actor", "scene", "prop", "costume"])
async def test_project_created_resource_is_private_and_library_names_are_independent(kind, monkeypatch):
    stored = {}

    async def upload(*, key, data, **_kwargs):
        stored[key] = data if isinstance(data, bytes) else data.read()

    async def download(*, key):
        return stored[key]

    async def info(*, key):
        return storage.StoredFileInfo(key=key, url=f"http://test/{key}", size=len(stored[key]))

    monkeypatch.setattr(storage, "upload_file", upload)
    monkeypatch.setattr(storage, "download_file", download)
    monkeypatch.setattr(storage, "get_file_info", info)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        session.add(Provider(id="test-provider", provider_key='openai', name="OpenAI", base_url="https://example.test/v1", api_key="test-key"))
        await session.flush()
        session.add(Model(id="test-image-model", name="gpt-image-1", provider_id="test-provider", category=ModelCategoryKey.image))
        await session.commit()

    async def database():
        async with sessions() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = database
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            project = await client.post("/api/v1/studio/projects", json={
                "id": "project-a", "name": "项目 A", "style": "真人都市",
            })
            assert project.status_code == 201, project.text
            private = await client.post(f"/api/v1/studio/entities/{kind}", json={
                "id": "private-actor", "name": "同名演员", "project_id": "project-a",
            })
            assert private.status_code == 201, private.text
            assert private.json()["data"]["project_id"] == "project-a"
            shared = await client.post(f"/api/v1/studio/entities/{kind}", json={
                "id": "shared-actor", "name": "同名演员",
            })
            assert shared.status_code == 201, shared.text
            library = await client.get(f"/api/v1/studio/entities/{kind}")
            assert [item["id"] for item in library.json()["data"]["items"]] == ["shared-actor"]
            project_resources = await client.get(
                f"/api/v1/studio/entities/{kind}", params={"project_id": "project-a"},
            )
            assert [item["id"] for item in project_resources.json()["data"]["items"]] == ["private-actor"]
            second_project = await client.post("/api/v1/studio/projects", json={
                "id": "project-b", "name": "项目 B", "style": "真人都市",
            })
            assert second_project.status_code == 201
            forbidden = await client.post(f"/api/v1/studio/project-assets/{kind}", json={
                "project_id": "project-b", "asset_id": "private-actor",
            })
            assert forbidden.status_code == 400, forbidden.text
            uploaded = await client.post("/api/v1/studio/files/upload", files={
                "file": ("original.png", b"independent image contents", "image/png"),
            })
            assert uploaded.status_code == 201, uploaded.text
            file_id = uploaded.json()["data"]["id"]
            images = await client.get(f"/api/v1/studio/entities/{kind}/private-actor/images")
            slot_id = images.json()["data"]["items"][0]["id"]
            invalid_main = await client.patch(f"/api/v1/studio/entities/{kind}/private-actor/images/{slot_id}", json={"is_primary": None})
            assert invalid_main.status_code == 422
            invalid_new_main = await client.post(f"/api/v1/studio/entities/{kind}/private-actor/images", json={"is_primary": None})
            assert invalid_new_main.status_code == 422
            assigned = await client.patch(
                f"/api/v1/studio/entities/{kind}/private-actor/images/{slot_id}",
                json={"file_id": file_id},
            )
            assert assigned.status_code == 200, assigned.text
            assert assigned.json()["data"]["is_primary"] is True
            another = await client.post(
                f"/api/v1/studio/entities/{kind}/private-actor/images",
                json={"file_id": file_id, "view_angle": "FRONT"},
            )
            assert another.status_code == 201, another.text
            assert another.json()["data"]["is_primary"] is False
            selected_main = await client.patch(
                f"/api/v1/studio/entities/{kind}/private-actor/images/{another.json()['data']['id']}",
                json={"is_primary": True},
            )
            assert selected_main.json()["data"]["is_primary"] is True
            removed_main = await client.delete(f"/api/v1/studio/entities/{kind}/private-actor/images/{another.json()['data']['id']}")
            assert removed_main.status_code == 200
            remaining = await client.get(f"/api/v1/studio/entities/{kind}/private-actor/images")
            assert next(item for item in remaining.json()["data"]["items"] if item["id"] == slot_id)["is_primary"] is True
            published = await client.post(
                f"/api/v1/studio/entities/{kind}/private-actor/publish-to-library",
                json={"name": "入库副本"},
            )
            assert published.status_code == 201, published.text
            copy = published.json()["data"]
            assert copy["id"] != "private-actor"
            assert copy["project_id"] is None
            copied_images = await client.get(f"/api/v1/studio/entities/{kind}/{copy['id']}/images")
            copied_file = copied_images.json()["data"]["items"][0]["file_id"]
            assert copied_file != file_id
            image_bytes = await client.get(f"/api/v1/studio/files/{copied_file}/download")
            assert image_bytes.content == b"independent image contents"
            retry = await client.post(
                f"/api/v1/studio/entities/{kind}/private-actor/publish-to-library",
                json={"name": "入库副本"},
            )
            assert retry.json()["data"]["id"] == copy["id"]
            edited = await client.patch(f"/api/v1/studio/entities/{kind}/private-actor", json={"name": "项目内改名"})
            assert edited.status_code == 200, edited.text
            independent = await client.get(f"/api/v1/studio/entities/{kind}/{copy['id']}")
            assert independent.json()["data"]["name"] == "入库副本"
            reference = {"file_id": copied_file, "source_kind": kind, "source_id": copy["id"],
                         "role": "identity" if kind == "actor" else "design", "source_image_id": copied_images.json()["data"]["items"][0]["id"], "view_angle": "FRONT"}
            wrong_purpose = await client.patch(f"/api/v1/studio/entities/{kind}/private-actor", json={
                "references": [{**reference, "role": "costume" if kind != "costume" else "identity"}],
            })
            assert wrong_purpose.status_code == 400
            saved_reference = await client.patch(f"/api/v1/studio/entities/{kind}/private-actor", json={
                "references": [reference],
            })
            assert saved_reference.status_code == 200, saved_reference.text
            assert [{key: value for key, value in item.items() if value is not None} for item in saved_reference.json()["data"]["references"]] == [reference]
            rendered = await client.post(
                f"/api/v1/studio/generation-prompts/assets/{kind}/private-actor/slots/{slot_id}/render",
                json={},
            )
            assert rendered.status_code == 200, rendered.text
            assert rendered.json()["data"]["recommended_media"]["references"][0]["file_id"] == copied_file
            draft_preview = await client.post("/api/v1/studio/generation-prompts/assets/draft/render", json={
                "asset_type": kind, "resource": {"id": "draft-only", "name": "未创建草稿",
                    "project_id": "project-a", "supplementary_info": "草稿自身设定", "references": [reference]},
                "view_angle": "TOP", "additional_instruction": "保留草稿要求",
            })
            assert draft_preview.status_code == 200, draft_preview.text
            assert "草稿自身设定" in draft_preview.json()["data"]["execution_prompt"]
            assert "保留草稿要求" in draft_preview.json()["data"]["execution_prompt"]
            absent = await client.get(f"/api/v1/studio/entities/{kind}/draft-only")
            assert absent.status_code == 404
            variables = ["purpose", "name", "description", "visual_style", "style", "view_angle", "reference_instruction", "additional_instruction", "background_instruction"]
            custom_template = await client.post("/api/v1/studio/prompts", json={
                "category": "scene_image_front" if kind == "scene" else f"{kind}_image", "name": "自定义预览模板",
                "content": "自定义模板标记\n" + "\n".join("{{ " + value + " }}" for value in variables), "variables": variables,
            })
            assert custom_template.status_code == 201, custom_template.text
            template_id = custom_template.json()["data"]["id"]
            await client.patch(f"/api/v1/studio/entities/{kind}/private-actor", json={"prompt_template_id": template_id})
            await client.patch(f"/api/v1/studio/entities/{kind}/private-actor/images/{slot_id}", json={"prompt_overrides": {"background_instruction": "图片专属背景"}})
            edit_options = {"mode": "edit", "edit_instruction": "改为柔光", "references": [{"file_id": file_id, "role": "design"}]}
            actual_preview = await client.post(f"/api/v1/studio/generation-prompts/assets/{kind}/private-actor/slots/{slot_id}/render", json=edit_options)
            draft_edit = await client.post("/api/v1/studio/generation-prompts/assets/draft/render", json={
                **edit_options, "asset_type": kind, "image_id": slot_id, "view_angle": "FRONT",
                "resource": {"id": "private-actor", "name": "项目内改名", "project_id": "project-a", "references": [reference]},
            })
            assert draft_edit.status_code == 200, draft_edit.text
            assert draft_edit.json()["data"]["execution_prompt"] == actual_preview.json()["data"]["execution_prompt"]
            assert "自定义模板标记" in draft_edit.json()["data"]["execution_prompt"]
            assert "图片专属背景" in draft_edit.json()["data"]["execution_prompt"]
            invalid_reference = await client.patch(f"/api/v1/studio/entities/{kind}/{copy['id']}", json={
                "references": [{**reference, "file_id": file_id, "source_id": "private-actor"}],
            })
            assert invalid_reference.status_code == 403, invalid_reference.text
            adopted = await client.post(f"/api/v1/studio/entities/{kind.upper()}/private-actor/adopt-reference-main", json={"reference": reference})
            assert adopted.status_code == 200, adopted.text
            assert adopted.json()["data"]["file_id"] != copied_file
            assert adopted.json()["data"]["is_primary"] is True
            adopted_again = await client.post(f"/api/v1/studio/entities/{kind}/private-actor/adopt-reference-main", json={"reference": reference})
            assert adopted_again.json()["data"]["id"] == adopted.json()["data"]["id"]
            create_adopted = await client.post(f"/api/v1/studio/entities/{kind}", json={
                "id": "adopted-at-create", "name": "仅创建并采用主体", "project_id": "project-a",
                "references": [reference], "adopt_reference": reference,
            })
            assert create_adopted.status_code == 201, create_adopted.text
            adopted_at_create_images = await client.get(f"/api/v1/studio/entities/{kind}/adopted-at-create/images")
            main = next(image for image in adopted_at_create_images.json()["data"]["items"] if image["is_primary"])
            assert main["file_id"] != copied_file
            shared_image = await client.post(f"/api/v1/studio/entities/{kind}/shared-actor/images", json={"file_id": file_id})
            assert shared_image.status_code == 201, shared_image.text
            temporary = {**reference, "file_id": file_id, "source_id": "shared-actor", "source_image_id": shared_image.json()["data"]["id"]}
            preview = await client.post(
                f"/api/v1/studio/generation-prompts/assets/{kind}/private-actor/slots/{slot_id}/render",
                json={"references": [temporary]},
            )
            assert preview.status_code == 200, preview.text
            before_submit = await client.get(f"/api/v1/studio/entities/{kind}", params={"project_id": "project-a"})
            assert "shared-actor" not in [item["id"] for item in before_submit.json()["data"]["items"]]
            fresh = await client.post(f"/api/v1/studio/entities/{kind}/private-actor/images", json={"view_angle": "FRONT"})
            slot_id = fresh.json()["data"]["id"]
            task_path = f"actors/private-actor" if kind == "actor" else f"assets/{kind}/private-actor"
            submitted = await client.post(f"/api/v1/studio/generation-tasks/{task_path}/slots/{slot_id}/tasks", json={
                "model_id": "test-image-model", "execution_prompt": preview.json()["data"]["execution_prompt"],
                "asset_references": [temporary], "media": {"references": [{"file_id": file_id, "media_kind": "image", "ordinal": 0}]},
                "operation_input": {"kind": "image_generation"},
            })
            assert submitted.status_code == 201, submitted.text
            duplicate = await client.post(f"/api/v1/studio/generation-tasks/{task_path}/slots/{slot_id}/tasks", json={
                "model_id": "test-image-model", "execution_prompt": "重复提交",
                "operation_input": {"kind": "image_generation"},
            })
            assert duplicate.status_code == 409, duplicate.text
            after_submit = await client.get(f"/api/v1/studio/entities/{kind}", params={"project_id": "project-a"})
            assert "shared-actor" not in [item["id"] for item in after_submit.json()["data"]["items"]]
            if kind == "actor":
                role = await client.post("/api/v1/studio/entities/character", json={
                    "id": "role-a", "project_id": "project-a", "name": "故事角色",
                    "description": "角色原始设定",
                })
                assert role.status_code == 201, role.text
                missing = await client.post("/api/v1/studio/entities/character/role-a/publish-to-library", json={})
                assert missing.status_code == 422, missing.text
                role_image = await client.post("/api/v1/studio/entities/character/role-a/images", json={"file_id": file_id})
                assert role_image.status_code == 201, role_image.text
                converted = await client.post("/api/v1/studio/entities/CHARACTER/role-a/publish-to-library", json={})
                assert converted.status_code == 201, converted.text
                actor_id = converted.json()["data"]["id"]
                assert converted.json()["data"]["source_id"] == "role-a"
                assert converted.json()["data"]["origin"] == "project"
                rejected = await client.patch(f"/api/v1/studio/entities/actor/{actor_id}", json={"hair": "新发型"})
                assert rejected.status_code == 403, rejected.text
                rejected_image = await client.post(f"/api/v1/studio/entities/actor/{actor_id}/images", json={"file_id": file_id})
                assert rejected_image.status_code == 201, rejected_image.text
                converted_images = await client.get(f"/api/v1/studio/entities/actor/{actor_id}/images")
                converted_slot = converted_images.json()["data"]["items"][0]["id"]
                rejected_generation = await client.post(
                    f"/api/v1/studio/generation-tasks/actors/{actor_id}/slots/{converted_slot}/tasks",
                    json={"execution_prompt": "尝试修改只读资产", "operation_input": {"kind": "image_generation"}},
                )
                assert rejected_generation.status_code == 409, rejected_generation.text
                linked = await client.post("/api/v1/studio/project-assets/actor", json={"project_id": "project-a", "asset_id": actor_id})
                assert linked.status_code == 400, linked.text
                await client.patch("/api/v1/studio/entities/actor/shared-actor", json={"supplementary_info": "不应继承的演员文字"})
                role_references = [{"file_id": file_id, "role": "identity", "source_kind": "actor", "source_id": "shared-actor", "source_image_id": shared_image.json()["data"]["id"]}]
                for source_kind in ("costume", "prop"):
                    source_id = f"reference-{source_kind}"
                    source = await client.post(f"/api/v1/studio/entities/{source_kind}", json={
                        "id": source_id, "name": source_id, "supplementary_info": "不应继承的来源文字"})
                    assert source.status_code == 201
                    picture = await client.post(f"/api/v1/studio/entities/{source_kind}/{source_id}/images", json={"file_id": file_id})
                    assert picture.status_code == 201
                    role_references.append({"file_id": file_id, "role": source_kind, "source_kind": source_kind, "source_id": source_id, "source_image_id": picture.json()["data"]["id"]})
                configured = await client.patch("/api/v1/studio/entities/character/role-a", json={"references": role_references})
                assert configured.status_code == 200, configured.text
                role_render = await client.post(
                    f"/api/v1/studio/generation-prompts/assets/character/role-a/slots/{role_image.json()['data']['id']}/render", json={})
                assert role_render.status_code == 200, role_render.text
                role_preview = await client.post("/api/v1/studio/generation-prompts/assets/draft/render", json={
                    "asset_type": "character", "resource": {"id": "role-a", "name": "故事角色", "project_id": "project-a", "description": "角色原始设定", "references": role_references},
                    "view_angle": "FRONT",
                })
                assert role_preview.status_code == 200, role_preview.text
                assert role_preview.json()["data"]["execution_prompt"] == role_render.json()["data"]["execution_prompt"]
                prompt = role_render.json()["data"]["execution_prompt"]
                assert "角色原始设定" in prompt
                assert "不应继承" not in prompt
                assert all(purpose in prompt for purpose in ("身份参考", "服装参考", "道具参考"))
                deleted_copy = await client.delete(f"/api/v1/studio/entities/ACTOR/{actor_id}")
                assert deleted_copy.status_code == 200, deleted_copy.text
                original_role = await client.get("/api/v1/studio/entities/character/role-a")
                assert original_role.json()["data"]["library_copy_id"] is None

    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
