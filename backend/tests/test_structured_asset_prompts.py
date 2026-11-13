"""实际资产提示词、参考用途和覆盖边界的回归测试。"""

import pytest
import pytest_asyncio
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.contracts.asset_prompts import AssetPromptOptions, AssetPromptReference
from app.models.studio import Actor, ActorImage, Scene, SceneImage, FileItem, FileType, AssetViewAngle, ProjectStyle, ProjectVisualStyle, PromptTemplate, PromptCategory
from app.schemas.studio.cast_images import ActorImageUpdate
from app.services.studio.generation.asset_image.build_base import build_actor_image_base_draft, build_asset_image_base_draft
from app.services.studio.generation.asset_image.prompt_rules import resolve_prompt_references


@pytest_asyncio.fixture
async def asset_db(monkeypatch):
    """隔离数据库及参考文件元数据，不调用图片供应商。"""
    async def available_file(**kwargs):
        """使用本地替身验证引用逻辑，不访问对象存储。"""
        return None
    monkeypatch.setattr("app.services.studio.generation.asset_image.prompt_rules.storage.get_file_info", available_file)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as db:
        db.add(Actor(id="actor", name="小林", age_appearance="约30岁", hair="黑色短发", supplementary_info="左眉疤痕", style=ProjectStyle.real_people_city,
                     references=[{"file_id": "front", "role": "identity"}]))
        db.add_all([FileItem(id=key, name=key, type=FileType.image, storage_key=key + ".png") for key in ("front", "replacement")])
        await db.flush()
        db.add_all([
            ActorImage(id=1, actor_id="actor", view_angle=AssetViewAngle.front, file_id="front"),
            ActorImage(id=2, actor_id="actor", view_angle=AssetViewAngle.back),
        ])
        await db.flush()
        yield db
    await engine.dispose()


@pytest.mark.asyncio
async def test_reference_replacement_and_removal_affect_prompt(asset_db):
    """最终输入与引用说明必须同时变更，空列表不能回退到推荐图。"""
    default = await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=2)
    assert default.default_images == ["front"]
    assert "图 1：身份参考" in default.prompt
    replaced = await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=2, options=AssetPromptOptions(
        references=[AssetPromptReference(file_id="replacement", role="style")],
    ))
    assert replaced.default_images == ["replacement"]
    assert "图 1：画风参考" in replaced.prompt
    assert "图 1：身份参考" not in replaced.prompt
    cleared = await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=2, options=AssetPromptOptions(references=[]))
    assert cleared.default_images == []
    assert "图 1" not in cleared.prompt
    assert "外观年龄：约30岁" in cleared.prompt and "左眉疤痕" in cleared.prompt
    assert "正后方，展示主体背面" in cleared.prompt


@pytest.mark.asyncio
async def test_reference_dedup_preserves_roles_and_invalid_files_fail(asset_db):
    """同文件多用途合并说明，引用顺序与最终媒体集合一致。"""
    refs, instruction = await resolve_prompt_references(asset_db, [
        AssetPromptReference(file_id="replacement", role="style"),
        AssetPromptReference(file_id="front", role="identity"),
        AssetPromptReference(file_id="replacement", role="costume"),
    ])
    assert refs == ["replacement", "front"]
    assert instruction.startswith("图 1：画风参考")
    assert "服装参考" in instruction.split("\n")[0]
    assert instruction.split("\n")[1].startswith("图 2：身份参考")
    with pytest.raises(HTTPException, match="参考图不可用"):
        await resolve_prompt_references(asset_db, [AssetPromptReference(file_id="missing", role="identity")])


@pytest.mark.asyncio
async def test_display_overrides_and_supplement_remain_scoped(asset_db):
    """单次展示参数覆盖图片默认值，但不改写主体或保存到资产。"""
    row = await asset_db.get(ActorImage, 2)
    row.prompt_overrides = {"lighting_instruction": "柔光"}
    draft = await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=2, options=AssetPromptOptions(
        lighting_instruction="均匀日光", additional_instruction="留出上方空间",
    ))
    assert draft.merged_variables["lighting_instruction"] == "均匀日光"
    assert "留出上方空间" in draft.prompt
    assert row.prompt_overrides == {"lighting_instruction": "柔光"}
    assert (await asset_db.get(Actor, "actor")).supplementary_info == "左眉疤痕"
    with pytest.raises(ValidationError):
        ActorImageUpdate(prompt_overrides={"description": "换一张脸"})
    with pytest.raises(ValidationError):
        AssetPromptOptions(view_angle="FRONT")


@pytest.mark.asyncio
async def test_scene_uses_spatial_defaults_and_rejects_incomplete_template(asset_db):
    """场景不会误用人像纯背景，自定义模板不能漏掉已确认事实。"""
    asset_db.add(Scene(id="scene", name="书房", spatial_layout="窗在左侧", style=ProjectStyle.real_people_city))
    await asset_db.flush()
    asset_db.add(SceneImage(id=1, scene_id="scene", view_angle=AssetViewAngle.front))
    await asset_db.flush()
    draft = await build_asset_image_base_draft(asset_db, asset_type="scene", asset_id="scene", image_id=1)
    assert "窗在左侧" in draft.prompt
    assert "不替换为棚拍纯色背景" in draft.prompt
    asset_db.add(PromptTemplate(id="bad", name="遗漏主体", category=PromptCategory.actor_image, content="{{ name }}", variables=["name"], variable_defaults={}, is_default=True))
    await asset_db.flush()
    with pytest.raises(HTTPException, match="模板变量契约不完整"):
        await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=1)


@pytest.mark.asyncio
async def test_local_edit_requires_one_source_and_explicit_change(asset_db):
    """局部修改只能基于单张图，并明确修改项与保持项。"""
    draft = await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=1, options=AssetPromptOptions(
        mode="edit", edit_instruction="将展示背景改为浅灰", preserve_instruction="人物五官与黑色短发",
    ))
    assert draft.default_images == ["front"]
    assert "仅改变：将展示背景改为浅灰" in draft.prompt
    assert "保持：人物五官与黑色短发" in draft.prompt
    with pytest.raises(HTTPException, match="一张待修改图片"):
        await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=2, options=AssetPromptOptions(mode="edit", edit_instruction="更改背景"))
    with pytest.raises(HTTPException, match="修改的对象"):
        await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=1, options=AssetPromptOptions(mode="edit"))


def test_submission_rejects_preview_media_mismatch():
    """提交不能携带与实际媒体不一致的预览审计信息。"""
    from app.core.contracts.generation import GenerationSubmitRequest
    with pytest.raises(ValidationError, match="预览与提交"):
        GenerationSubmitRequest.model_validate({
            "execution_prompt": "预览提示词", "operation_input": {"kind": "image_generation"},
            "media": {"references": []},
            "asset_prompt_audit": {
                "render_id": "preview", "variables": {}, "execution_prompt": "预览提示词",
                "reference_file_ids": ["front"],
            },
        })


@pytest.mark.asyncio
async def test_candidate_publisher_does_not_replace_asset_image(asset_db):
    """局部修改结果只归档为候选，不自动改写当前图。"""
    from app.core.contracts.generation import ResolvedGenerationSnapshot, GenerationTarget, GenerationTargetKind, ImageGenerationOperationInput
    from app.models.task import TaskOutput
    from app.services.generation.publishers.asset_image import AssetImagePublisher
    artifact = TaskOutput(task_id="candidate-task", ordinal=0, file_id="replacement")
    snapshot = ResolvedGenerationSnapshot(
        model_id="model", canonical_target=GenerationTarget(kind=GenerationTargetKind.asset_image_slot, asset_type="actor", entity_id="actor", slot_id="1"),
        expected_version_id=1, operation_input=ImageGenerationOperationInput(save_as_candidate=True), execution_prompt="修改背景",
    )
    await AssetImagePublisher().publish_terminal(asset_db, snapshot=snapshot, artifacts=[artifact])
    assert (await asset_db.get(ActorImage, 1)).file_id == "front"
    assert artifact.delivery_status == "skipped"
    assert artifact.delivery_reason == "awaiting_user_adoption"


@pytest.mark.asyncio
async def test_same_numeric_slot_id_cannot_cross_asset_categories(asset_db):
    """不同资产表的数字 ID 重合时，门禁和写回都必须使用目标类别。"""
    from app.services.generation.gate import GenerationEntityGate
    from app.services.generation.publishers.asset_image import AssetImagePublisher
    from app.core.contracts.generation import GenerationTarget, ResolvedGenerationSnapshot, ImageGenerationOperationInput
    asset_db.add(Scene(id="scene", name="书房", spatial_layout="窗在左侧", style=ProjectStyle.real_people_city))
    await asset_db.flush()
    row = SceneImage(id=1, scene_id="scene", view_angle=AssetViewAngle.front)
    asset_db.add(row)
    await asset_db.flush()
    gate = GenerationEntityGate()
    assert await gate._asset_slot_belongs_to(asset_db, slot_id="1", entity_id="scene", asset_type="scene")
    assert not await gate._asset_slot_belongs_to(asset_db, slot_id="1", entity_id="actor", asset_type="scene")
    snapshot = ResolvedGenerationSnapshot(
        model_id="test", canonical_target=GenerationTarget(kind="asset_image_slot", asset_type="scene", entity_id="scene", slot_id="1"),
        expected_version_id=row.version_id, operation_input=ImageGenerationOperationInput(),
    )
    assert await AssetImagePublisher()._publish_file(asset_db, snapshot=snapshot, file_id="replacement", expected_version_id=row.version_id)
    await asset_db.refresh(row)
    assert row.file_id == "replacement"
    assert (await asset_db.get(ActorImage, 1)).file_id == "front"


@pytest.mark.asyncio
async def test_invalid_stored_template_returns_actionable_error(asset_db):
    """保存的模板语法错误应返回可修正提示，不泄漏为内部服务器错误。"""
    asset_db.add(PromptTemplate(id="invalid", name="无效语法", category=PromptCategory.actor_image, content="{% if %}", variables=[], variable_defaults={}, is_default=True))
    await asset_db.flush()
    with pytest.raises(HTTPException, match="模板语法无效") as error:
        await build_actor_image_base_draft(asset_db, actor_id="actor", image_id=1)
    assert error.value.status_code == 400
