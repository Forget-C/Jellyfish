"""按 ``asset_type`` 分流的回归测试：模板 / 画幅 / 结果类型标签，且**不许混用一套**。

用户口径（2026-09，硬要求）：

| 类型 | 生成结果 | 结果类型标签 | 画幅 |
|---|---|---|---|
| character | 人物参考图 / 设定图（进「人物参考图库」选一张定版） | ``characterReference`` / 人物参考图 | **固定 16:9** |
| scene | 场景资产图 | ``sceneAssetImage`` / 场景资产图 | 自己的既有口径 |
| prop | 道具资产图 | ``propAssetImage`` / 道具资产图 | 自己的既有口径 |
| costume | 服装设定图 | ``costumeDesignImage`` / 服装设定图 | 自己的既有口径 |

本文件钉住：

1. 两条出图链路（``/submit`` 的 ``build_targets`` 与 ``/reference-regenerate``）**走同一张分流表**；
2. **人物参考图固定 16:9**，且**不是**项目最终视频画幅（项目 ``default_video_ratio``
   与显式传入的其它比例都不会被采用 —— 后者必须如实报警告，不许静默改口）；
3. 场景/道具/服装**按各自既有口径**（显式传的画幅照旧生效，不会被顺手改成 16:9），
   请求体与响应里**绝不出现** ``characterReference``；
4. **「按定版参考图批量出图」只对人物开放**：非人物走这条路时明确忽略 + 如实回报。

零真实出网：出网通道全是 ``httpx.MockTransport``。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider, ProviderStatus
from app.models.studio import (
    Character,
    CharacterImage,
    Costume,
    CostumeImage,
    FileItem,
    Project,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    PropImage,
    Scene,
    SceneImage,
)
from app.schemas.studio.image_pipeline import ReferenceRegenerateRequest
from app.services.studio.image_pipeline import asset_strategies as strategies
from app.services.studio.image_pipeline import reference_preflight
from app.services.studio.image_pipeline.image_pipeline import build_targets
from app.services.studio.image_pipeline.reference_regenerate import (
    clear_regenerate_registry,
    regenerate_with_existing_reference,
)
from tests.llm_orchestration_fixtures import build_session

DRY_RUN_ENV = "JELLYFISH_DRY_RUN"
CONFIRM_ENV = "JELLYFISH_REAL_LLM_CONFIRMED"
POLL_INTERVAL_ENV = "JELLYFISH_APIMART_IMAGE_POLL_INTERVAL"
SUBMIT_URL = "/api/v1/studio/image-pipeline/submit"
PREVIEW_URL = "/api/v1/studio/image-pipeline/plan/preview"

PROJECT_ID = "proj-1"

#: 已保存的提示词（**必须带资产特征**：只有资产名 + 通用摄影词的内容会被
#: 「旧提示词质量关卡」排除出批量出图，见 ``test_asset_workbench`` 的同名用例）
CHARACTER_SAVED_PROMPT = "林晓：齐耳短发，深色职业套装，白衬衫黑西裤，正面展示"
SCENE_SAVED_PROMPT = "破庙内：塌陷屋顶透下月光，青砖地面散落碎瓦，歪斜供桌，冷蓝色调"

#: (asset_type, asset_id, 名称, 提示词槽位, 结果类型标签, 结果中文标签)
DISPATCH_CASES = [
    ("character", "char-1", "林晓", "character_image_front", "characterReference", "人物参考图"),
    ("scene", "scene-1", "破庙夜景", "scene_image_front", "sceneAssetImage", "场景资产图"),
    ("prop", "prop-1", "青铜剑", "prop_image_front", "propAssetImage", "道具资产图"),
    ("costume", "costume-1", "玄色长袍", "costume_image_front", "costumeDesignImage", "服装设定图"),
]


@pytest.fixture(autouse=True)
def _no_real_storage_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """`with TestClient(app)` 会跑 lifespan：把对象存储初始化换掉，保证零真实出网。"""
    import app.main as main_module

    monkeypatch.setattr(main_module, "init_storage", lambda: None)


@pytest.fixture(autouse=True)
def _reset_registry() -> None:
    clear_regenerate_registry()


# ---------------------------------------------------------------------------
# 桩与种子
# ---------------------------------------------------------------------------


def _apimart_transport(*, bodies: list[dict]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            bodies.append(json.loads(request.content or b"{}"))
            return httpx.Response(200, json={"code": 200, "data": {"task_id": "task_t", "status": "submitted"}})
        return httpx.Response(
            200,
            json={"code": 200, "data": {"status": "completed", "images": [{"url": "https://cdn.example.com/x.png"}]}},
        )

    return httpx.MockTransport(handler)


def _ok_preflight():
    async def _preflight(candidates, *, hint=""):  # type: ignore[no-untyped-def]
        return await reference_preflight.preflight_or_raise(
            candidates, hint=hint, transport=httpx.MockTransport(lambda _r: httpx.Response(200))
        )

    return _preflight


async def _seed_llm(db: AsyncSession) -> None:
    db.add(
        Provider(
            id="prov-1",
            name="apimart",
            base_url="https://api.apimart.ai/v1",
            api_key="test-key-not-real",
            description="测试种子",
            status=ProviderStatus.active,
            created_by="test",
        )
    )
    await db.flush()
    db.add(
        Model(
            id="model-1",
            name="gpt-image-2",
            category=ModelCategoryKey.image,
            provider_id="prov-1",
            params={},
            description="测试种子",
            created_by="test",
        )
    )
    await db.flush()
    db.add(ModelSettings(id=1, default_image_model_id="model-1"))
    await db.flush()


async def _seed_project(db: AsyncSession, *, default_video_ratio: str = "") -> None:
    db.add(
        Project(
            id=PROJECT_ID,
            name="测试项目",
            description="",
            style="真人古装",
            visual_style="现实",
            default_video_ratio=default_video_ratio,
        )
    )
    await db.flush()


async def _seed_asset(
    db: AsyncSession,
    *,
    asset_type: str,
    asset_id: str,
    name: str,
    saved_prompt: str = "",
    with_primary_image: bool = True,
) -> None:
    """种一个资产：自己的表 + 项目关联（场景/道具/服装走关联表）。"""
    slot = dict(zip((case[0] for case in DISPATCH_CASES), (case[3] for case in DISPATCH_CASES)))[asset_type]
    prompts = {slot: saved_prompt} if saved_prompt else {}
    if asset_type == "character":
        db.add(
            Character(
                id=asset_id,
                project_id=PROJECT_ID,
                name=name,
                description="",
                style="真人古装",
                image_prompts=prompts,
            )
        )
    elif asset_type == "scene":
        db.add(Scene(id=asset_id, name=name, description="", style="真人古装", view_count=1, tags=[], image_prompts=prompts))
    elif asset_type == "prop":
        db.add(Prop(id=asset_id, name=name, description="", style="真人古装", view_count=1, tags=[], image_prompts=prompts))
    else:
        db.add(Costume(id=asset_id, name=name, description="", style="真人古装", view_count=1, tags=[], image_prompts=prompts))
    await db.flush()

    ref_url = f"https://oss.example.com/refs/{asset_id}-front.png"
    if with_primary_image:
        file_id = f"file-{asset_id}"
        db.add(FileItem(id=file_id, type="image", name=f"{name}.png", thumbnail=ref_url, storage_key=ref_url))
        await db.flush()
    else:
        file_id = None

    if asset_type == "character":
        db.add(
            CharacterImage(
                id=1, character_id=asset_id, file_id=file_id, is_primary=with_primary_image,
                view_angle="FRONT", quality_level="HIGH",
            )
        )
    elif asset_type == "scene":
        db.add(SceneImage(id=1, scene_id=asset_id, file_id=file_id, is_primary=with_primary_image, view_angle="FRONT", quality_level="HIGH"))
        db.add(ProjectSceneLink(id=1, project_id=PROJECT_ID, shot_id=None, scene_id=asset_id))
    elif asset_type == "prop":
        db.add(PropImage(id=1, prop_id=asset_id, file_id=file_id, is_primary=with_primary_image, view_angle="FRONT", quality_level="HIGH"))
        db.add(ProjectPropLink(id=1, project_id=PROJECT_ID, prop_id=asset_id))
    else:
        db.add(CostumeImage(id=1, costume_id=asset_id, file_id=file_id, is_primary=with_primary_image, view_angle="FRONT", quality_level="HIGH"))
        db.add(ProjectCostumeLink(id=1, project_id=PROJECT_ID, costume_id=asset_id))
    await db.flush()


# ---------------------------------------------------------------------------
# A) 分流表本身
# ---------------------------------------------------------------------------


def test_strategy_table_covers_four_types_with_their_own_kind_and_label() -> None:
    """四种类型各有各的结果类型标签 / 中文标签 / 提示词模板，**没有混用一套**。"""
    assert strategies.SUPPORTED_ASSET_TYPES == ("character", "scene", "prop", "costume")

    kinds = {case[0]: case[4] for case in DISPATCH_CASES}
    labels = {case[0]: case[5] for case in DISPATCH_CASES}
    for asset_type, _asset_id, _name, slot, kind, label in DISPATCH_CASES:
        strategy = strategies.strategy_for(asset_type)
        assert strategy.result_kind == kinds[asset_type]
        assert strategy.result_label == labels[asset_type]
        assert strategy.prompt_slot.value == slot
        assert strategy.prompt_template, "每个类型都必须有自己的模板名"
        assert strategy.to_read()["result_kind"] == kind

    # 模板名两两不同 → 确实是按类型分流，不是共用一套
    templates = [strategies.strategy_for(case[0]).prompt_template for case in DISPATCH_CASES]
    assert len(set(templates)) == len(DISPATCH_CASES)


def test_character_reference_is_the_only_character_only_kind() -> None:
    """``characterReference`` 是**人物专属**标签；别的类型一律不许用。"""
    assert strategies.is_character_only_kind(strategies.KIND_CHARACTER_REFERENCE) is True
    for asset_type in ("scene", "prop", "costume"):
        strategy = strategies.strategy_for(asset_type)
        assert strategy.result_kind != strategies.KIND_CHARACTER_REFERENCE
        assert strategies.is_character_only_kind(strategy.result_kind) is False
        # 该类型的口径描述里不许出现人物内部类型标签 / 人物 stage 名
        blob = json.dumps(strategy.to_read(), ensure_ascii=False)
        assert "characterReference" not in blob
        assert "characterVariant" not in blob
        assert "character_sheet" not in blob


def test_character_ratio_is_written_as_a_constant_not_from_project() -> None:
    """人物画幅是**写死的常量** 16:9；分流表里不读任何项目/镜头视频比例。"""
    assert strategies.CHARACTER_REFERENCE_RATIO == "16:9"
    assert "不是项目最终视频画幅" in strategies.CHARACTER_REFERENCE_RATIO_NOTE
    character = strategies.strategy_for("character")
    assert character.fixed_aspect_ratio == "16:9"
    assert character.ratio_note == strategies.CHARACTER_REFERENCE_RATIO_NOTE
    # 其它类型不是「固定」口径（按各自既有口径）
    for asset_type in ("scene", "prop", "costume"):
        assert strategies.strategy_for(asset_type).fixed_aspect_ratio is None


def test_resolve_aspect_ratio_per_type() -> None:
    """人物：一律 16:9（传入别的值被忽略 + 如实回报）；道具/场景：按**类型映射**取默认画幅。

    需求清单第 2 条把画幅改成按类型分开（人物 16:9 / 场景 16:9 / 道具 1:1），
    所以"没传比例"时的来源从管线默认（``default``）变成类型映射（``asset_type_default``）。
    """
    fixed = strategies.resolve_aspect_ratio("character", "")
    assert (fixed.ratio, fixed.source, fixed.warning) == ("16:9", "character_reference_fixed", "")

    overridden = strategies.resolve_aspect_ratio("character", "9:16")
    assert overridden.ratio == "16:9"
    assert overridden.source == "character_reference_fixed"
    assert "9:16" in overridden.warning and "16:9" in overridden.warning

    # 场景：类型映射里就是 16:9（与管线默认同值，但来源要如实说成"类型映射"）
    default_scene = strategies.resolve_aspect_ratio("scene", "")
    assert default_scene.ratio == strategies.DEFAULT_ASPECT_RATIO
    assert default_scene.source == "asset_type_default"

    # 道具：需求清单第 2 条要求 **1:1 方图**（此前它跟场景一起落到 16:9）
    default_prop = strategies.resolve_aspect_ratio("prop", "")
    assert (default_prop.ratio, default_prop.source) == ("1:1", "asset_type_default")

    requested_scene = strategies.resolve_aspect_ratio("scene", "4:3")
    assert (requested_scene.ratio, requested_scene.source) == ("4:3", "request")
    for asset_type in ("prop", "costume"):
        assert strategies.resolve_aspect_ratio(asset_type, "3:4").ratio == "3:4"


def test_batch_reference_is_allowed_for_character_only() -> None:
    assert strategies.supports_batch_reference("character") is True
    for asset_type in ("scene", "prop", "costume"):
        assert strategies.supports_batch_reference(asset_type) is False
        message = strategies.describe_batch_reference_refusal(asset_type)
        assert "只对**人物**开放" in message
        assert strategies.strategy_for(asset_type).result_label in message


def test_unknown_asset_type_is_rejected_not_treated_as_character() -> None:
    """不认识的类型明确报错，绝不静默按人物处理。"""
    with pytest.raises(ValueError) as exc_info:
        strategies.strategy_for("actor")
    assert "不会按人物处理" in str(exc_info.value)


# ---------------------------------------------------------------------------
# B) /submit 链路：模板 / 画幅 / 结果类型
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("asset_type", "asset_id", "name", "slot", "kind", "label"),
    DISPATCH_CASES[:3],  # /submit 不支持 costume（上游契约），服装在 C) 段用新端点验证
    ids=[case[0] for case in DISPATCH_CASES[:3]],
)
@pytest.mark.asyncio
async def test_submit_plan_dispatches_template_and_kind_per_type(
    asset_type: str,
    asset_id: str,
    name: str,
    slot: str,
    kind: str,
    label: str,
) -> None:
    """``build_targets`` 按类型给出各自的模板 / 结果类型 / 画幅来源。"""
    db, engine = await build_session()
    async with db:
        await _seed_project(db)
        # 故意不种已保存提示词 → 走确定性模板，才能验证「模板选择」本身
        await _seed_asset(db, asset_type=asset_type, asset_id=asset_id, name=name, saved_prompt="")

        targets, warnings = await build_targets(
            db, project_id=PROJECT_ID, asset_type=asset_type, stage="character_sheet"
        )
    await engine.dispose()

    target = targets[0]
    strategy = strategies.strategy_for(asset_type)
    assert target.result_kind == kind
    assert target.result_label == label
    assert target.prompt_template == strategy.prompt_template
    assert target.prompt_source == "template"
    assert kind != "characterReference" or asset_type == "character"
    target_blob = json.dumps(target.to_read().model_dump(), ensure_ascii=False)
    if asset_type == "character":
        assert target_blob.count("characterReference") == 1  # 人物专属标签只对人物出现
    else:
        assert "characterReference" not in target_blob

    # 模板确实按类型选：确定性提示词里必须出现**该类型**的动作姿态提示词
    hint_by_type = {
        # 需求清单第 2 条：人物版式由「正面全身参考图」改为「角色设定图（左面部大特写 + 右全身三视图）」
        "character": "16:9 横版角色设定图，画面分左右两块",
        "scene": "广角建立镜头，空间结构清晰",
        # 道具的**正式槽位**已补进 llm_orchestration.registry（PromptCategory.prop_image_front），
        # 所以这里取的是槽位规格里的 view_hint，不再走 asset_strategies 的兜底文案。
        "prop": "道具正面清晰展示，完整入画，干净背景",
    }
    assert hint_by_type[asset_type] in target.prompt
    for other_type, hint in hint_by_type.items():
        if other_type != asset_type:
            assert hint not in target.prompt, f"{asset_type} 的模板串到了 {other_type}"

    # 画幅来源：人物写死 16:9，其它类型按自己的口径
    if asset_type == "character":
        assert (target.aspect_ratio, target.aspect_ratio_source) == ("16:9", "character_reference_fixed")
    else:
        assert target.aspect_ratio_source in {"default", "request", "asset_type_default"}
    assert warnings  # 图片模型提示等既有信息仍在（只增不删）

    # 场景/道具的 generation_type 也不是人物那一档
    if asset_type != "character":
        assert target.generation_type != "character_sheet"


@pytest.mark.asyncio
async def test_submit_plan_character_ratio_is_not_the_project_video_ratio() -> None:
    """人物参考图 16:9：项目 ``default_video_ratio=9:16`` 也不许泄漏进去。"""
    db, engine = await build_session()
    async with db:
        await _seed_project(db, default_video_ratio="9:16")
        await _seed_asset(db, asset_type="character", asset_id="char-1", name="林晓", saved_prompt=CHARACTER_SAVED_PROMPT)
        targets, _warnings = await build_targets(
            db, project_id=PROJECT_ID, asset_type="character", stage="character_sheet"
        )
    await engine.dispose()

    target = targets[0]
    assert target.aspect_ratio == "16:9"
    assert target.aspect_ratio_source == "character_reference_fixed"
    assert target.to_generation_payload()["aspect_ratio"] == "16:9"
    assert "9:16" not in json.dumps(target.to_read().model_dump(), ensure_ascii=False)


@pytest.mark.asyncio
async def test_batch_reference_mode_refuses_non_character_but_keeps_character() -> None:
    """参考图批量只对人物开放：场景**有定版图也不带**，且如实回报；人物照旧带。"""
    db, engine = await build_session()
    async with db:
        await _seed_project(db)
        await _seed_asset(db, asset_type="character", asset_id="char-1", name="林晓", saved_prompt=CHARACTER_SAVED_PROMPT)
        await _seed_asset(db, asset_type="scene", asset_id="scene-1", name="破庙夜景", saved_prompt=SCENE_SAVED_PROMPT)

        char_targets, char_warnings = await build_targets(
            db, project_id=PROJECT_ID, asset_type="character", stage="reference_batch"
        )
        scene_targets, scene_warnings = await build_targets(
            db, project_id=PROJECT_ID, asset_type="scene", stage="reference_batch"
        )
    await engine.dispose()

    assert char_targets[0].reference_image.endswith("char-1-front.png")
    assert not any("只对**人物**开放" in w for w in char_warnings)

    # 场景：即使有定版图也不带参考图，并且**明确说明**（不是静默当人物处理）
    assert scene_targets[0].reference_image == ""
    assert any("只对**人物**开放" in w for w in scene_warnings)
    assert scene_targets[0].result_kind == "sceneAssetImage"


@pytest.mark.asyncio
async def test_submit_rejects_costume_as_before_and_strategy_still_covers_it() -> None:
    """上游契约仍不支持 costume（``/submit`` 明确报错），但分流表本身覆盖它（新端点可用）。"""
    db, engine = await build_session()
    async with db:
        await _seed_project(db)
        with pytest.raises(ValueError) as exc_info:
            await build_targets(db, project_id=PROJECT_ID, asset_type="costume", stage="character_sheet")
        assert "只支持 asset_type" in str(exc_info.value)
    await engine.dispose()

    costume = strategies.strategy_for("costume")
    assert costume.result_kind == "costumeDesignImage"
    assert costume.fixed_aspect_ratio is None


# ---------------------------------------------------------------------------
# C) /reference-regenerate 链路：同一张分流表
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("asset_type", "asset_id", "name", "slot", "kind", "label"),
    DISPATCH_CASES,
    ids=[case[0] for case in DISPATCH_CASES],
)
@pytest.mark.asyncio
async def test_regenerate_exposes_kind_and_ratio_per_type(
    monkeypatch: pytest.MonkeyPatch,
    asset_type: str,
    asset_id: str,
    name: str,
    slot: str,
    kind: str,
    label: str,
) -> None:
    """重生成端点按类型暴露结果类型 / 画幅，非人物的请求体与响应都不含 ``characterReference``。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        await _seed_project(db)
        await _seed_asset(
            db, asset_type=asset_type, asset_id=asset_id, name=name, saved_prompt=f"{name}，资产参考图"
        )
        await _seed_llm(db)
        data = await regenerate_with_existing_reference(
            db,
            body=ReferenceRegenerateRequest.model_validate(
                {"project_id": PROJECT_ID, "asset_type": asset_type, "asset_id": asset_id}
            ),
            transport=_apimart_transport(bodies=bodies),
            preflight=_ok_preflight(),
        )
    await engine.dispose()

    strategy = strategies.strategy_for(asset_type)
    assert data.result_kind == kind and data.result_label == label
    assert data.prompt_template == strategy.prompt_template
    assert data.results[0].result_kind == kind
    assert data.results[0].result_label == label
    assert data.results[0].aspect_ratio == data.aspect_ratio
    assert data.results[0].aspect_ratio_source == data.aspect_ratio_source

    if asset_type == "character":
        assert (data.aspect_ratio, data.aspect_ratio_source) == ("16:9", "character_reference_fixed")
    else:
        assert data.aspect_ratio_source in {"default", "request", "asset_type_default"}
        assert data.aspect_ratio != "" and data.aspect_ratio == bodies[0]["size"]

    assert len(bodies) == 1
    assert bodies[0]["image_urls"] == [f"https://oss.example.com/refs/{asset_id}-front.png"]

    blob = json.dumps(data.model_dump(), ensure_ascii=False)
    request_blob = json.dumps(bodies[0], ensure_ascii=False)
    if asset_type == "character":
        assert "characterReference" in blob  # 人物专属标签只对人物出现
    else:
        assert "characterReference" not in blob, f"{asset_type} 的响应不得出现 characterReference"
        assert "characterReference" not in request_blob, f"{asset_type} 的请求体不得出现 characterReference"
        assert "characterVariant" not in blob and "characterVariant" not in request_blob


@pytest.mark.asyncio
async def test_regenerate_character_ratio_ignores_requested_other_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """人物参考图：显式传 1:1 也不采用（写死 16:9），且如实回报被忽略的原值。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        await _seed_project(db)
        await _seed_asset(db, asset_type="character", asset_id="char-1", name="林晓", saved_prompt=CHARACTER_SAVED_PROMPT)
        await _seed_llm(db)
        data = await regenerate_with_existing_reference(
            db,
            body=ReferenceRegenerateRequest.model_validate(
                {
                    "project_id": PROJECT_ID,
                    "asset_type": "character",
                    "asset_id": "char-1",
                    "target_ratio": "1:1",
                }
            ),
            transport=_apimart_transport(bodies=bodies),
            preflight=_ok_preflight(),
        )
    await engine.dispose()

    assert bodies[0]["size"] == "16:9"
    assert data.aspect_ratio == "16:9"
    assert any("16:9" in w and "1:1" in w for w in data.warnings), "忽略传入比例必须如实回报"


@pytest.mark.asyncio
async def test_regenerate_non_character_keeps_its_own_ratio(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """场景按自己的口径：显式传 1:1 照旧生效（**不会**被顺手改成 16:9）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")
    monkeypatch.setenv(POLL_INTERVAL_ENV, "0.05")

    db, engine = await build_session()
    bodies: list[dict] = []
    async with db:
        await _seed_project(db)
        await _seed_asset(db, asset_type="scene", asset_id="scene-1", name="破庙夜景", saved_prompt=SCENE_SAVED_PROMPT)
        await _seed_llm(db)
        data = await regenerate_with_existing_reference(
            db,
            body=ReferenceRegenerateRequest.model_validate(
                {"project_id": PROJECT_ID, "asset_type": "scene", "asset_id": "scene-1", "target_ratio": "1:1"}
            ),
            transport=_apimart_transport(bodies=bodies),
            preflight=_ok_preflight(),
        )
    await engine.dispose()

    assert bodies[0]["size"] == "1:1"
    assert data.aspect_ratio == "1:1" and data.aspect_ratio_source == "request"
    assert data.result_kind == "sceneAssetImage"


# ---------------------------------------------------------------------------
# D) 路由层：只增字段真的暴露出来了
# ---------------------------------------------------------------------------


def _build_route_harness():
    import app.models  # noqa: F401

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def create_all() -> None:
        from app.core.db import Base

        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(create_all())
    return factory, engine


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


def _seed_route(factory: async_sessionmaker[AsyncSession]) -> None:
    async def run() -> None:
        async with factory() as db:
            await _seed_project(db, default_video_ratio="9:16")
            await _seed_asset(db, asset_type="character", asset_id="char-1", name="林晓", saved_prompt=CHARACTER_SAVED_PROMPT)
            await _seed_asset(db, asset_type="scene", asset_id="scene-1", name="破庙夜景", saved_prompt=SCENE_SAVED_PROMPT)
            await db.commit()

    asyncio.run(run())


def test_preview_and_submit_expose_strategy_fields() -> None:
    """计划预览与提交结果都带上「本次结果类型 / 本类型画幅」（只增字段）。"""
    factory, engine = _build_route_harness()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        _seed_route(factory)
        with TestClient(app) as client:
            preview = client.post(PREVIEW_URL, json={"project_id": PROJECT_ID, "asset_type": "character"})
            assert preview.status_code == 200, preview.text
            payload = preview.json()["data"]
            assert payload["strategy"]["result_kind"] == "characterReference"
            assert payload["strategy"]["result_label"] == "人物参考图"
            assert payload["strategy"]["aspect_ratio"] == "16:9"
            assert payload["strategy"]["aspect_ratio_fixed"] is True
            assert payload["strategy"]["batch_reference_allowed"] is True
            assert payload["targets"][0]["result_kind"] == "characterReference"
            assert payload["targets"][0]["aspect_ratio_source"] == "character_reference_fixed"
            # 项目 default_video_ratio=9:16 一点都没泄漏进来
            assert "9:16" not in json.dumps(payload["strategy"], ensure_ascii=False)

            scene_preview = client.post(PREVIEW_URL, json={"project_id": PROJECT_ID, "asset_type": "scene"})
            assert scene_preview.status_code == 200, scene_preview.text
            scene_payload = scene_preview.json()["data"]
            assert scene_payload["strategy"]["result_kind"] == "sceneAssetImage"
            assert scene_payload["strategy"]["batch_reference_allowed"] is False
            blob = json.dumps(scene_payload, ensure_ascii=False)
            assert "characterReference" not in blob
            assert "characterVariant" not in blob

            submit = client.post(
                SUBMIT_URL, json={"project_id": PROJECT_ID, "asset_type": "character", "asset_ids": ["char-1"]}
            )
            assert submit.status_code == 200, submit.text
            result = submit.json()["data"]["results"][0]
            assert result["result_kind"] == "characterReference"
            assert result["result_label"] == "人物参考图"
            assert result["aspect_ratio"] == "16:9"
            assert result["aspect_ratio_source"] == "character_reference_fixed"
            assert result["dry_run"] is True
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())
