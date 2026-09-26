"""服装（costume）生产链路：提示词槽位 → 单项生成 → 混合批量路由 → 结果卡片 → 采纳 → 定版。

用户口径：「补齐服装生产链路：服装正式图片提示词槽位；单项生成服装设计图；混合批量任务按
``costume`` 类型路由；服装结果卡片、保存、采纳和设为定版；**不得套用人物参考图或场景模板**。
完成后人物、场景、道具、服装四个页签都支持『资料 → 提示词 → 生成 → 结果 → 定版』。」

本文件钉住的就是这件事，**全程零出网、零付费**：

- 提示词：服装槽位是图片提示词链路的一等公民，用**服装设计口径**（款式/颜色/材质/配饰/
  穿着人物/身份时代/使用场合），且不出现人物参考图模板 / 场景模板的特征串；
- 生成：服装走 Jellyfish 自己的 **APIMart 图片通道**（上游出图服务契约里没有 costume），
  DRY_RUN 下返回 ``costumeDesignImage`` 占位结果且一个字节都不出网；
- 路由：一次提交里同时含四类资产时**逐项按 asset_type** 选通道与模板，逐条如实回报；
- 结果卡片 / 采纳 / 定版：结果对象能表达服装项，采纳写进 ``costume_images``，
  已有定版图默认不动、显式 ``confirm_replace_primary=true`` 才替换。
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.contracts.image_generation import ImageGenerationResult, ImageItem
from app.core.integrations.apimart.images import ApimartImageError
from app.dependencies import get_db
from app.main import app
from app.models.llm import Model, ModelCategoryKey, ModelSettings, Provider, ProviderStatus
from app.models.studio import (
    Character,
    Costume,
    CostumeImage,
    FileItem,
    Project,
    ProjectCostumeLink,
    ProjectPropLink,
    ProjectSceneLink,
    Prop,
    Scene,
)
from app.models.types import PromptCategory
from app.schemas.studio.llm_orchestration import EntityProfileInput, ImagePromptPreviewRequest
from app.services.studio.image_pipeline import asset_strategies as strategies
from app.services.studio.image_pipeline import channel_submit, costume_channel
from app.services.studio.image_pipeline import external_image_client as image_client
from app.services.studio.image_pipeline.image_pipeline import summarize_results
from app.services.studio.image_pipeline.reference_regenerate import clear_regenerate_registry
from app.services.studio.llm_orchestration import dry_run
from app.services.studio.llm_orchestration import image_prompt as image_prompt_service
from app.services.studio.llm_orchestration.registry import (
    DEFAULT_IMAGE_PROMPT_CATEGORIES,
    DEFAULT_STYLE_WORDS,
    IMAGE_PROMPT_SLOT_BY_CATEGORY,
    SLOT_NEGATIVE_EXTRA,
    SLOT_STYLE_RULES,
    STYLE_WORDS_BY_ASSET_TYPE,
    base_style_words,
    slot_design_brief,
)
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

DRY_RUN_ENV = "JELLYFISH_DRY_RUN"
CONFIRM_ENV = "JELLYFISH_REAL_LLM_CONFIRMED"

SUBMIT_URL = "/api/v1/studio/image-pipeline/submit"
PREVIEW_URL = "/api/v1/studio/image-pipeline/plan/preview"
STATUS_URL = "/api/v1/studio/image-pipeline/status"
ADOPT_URL = "/api/v1/studio/image-pipeline/adopt"
IMAGE_PROMPT_PREVIEW_URL = "/api/v1/studio/llm/image-prompt/preview"

PROJECT_ID = "proj-1"
COSTUME_ID = "costume-1"
COSTUME_NAME = "玄色长袍"
#: 服装结构化资料（就是「服装设计口径」那七个维度）
COSTUME_PROFILE = (
    "穿着人物：林晓；身份时代：架空古代·将军府；款式：交领右衽、宽袖长袍；"
    "颜色：玄色；材质：织锦；配饰：玉带扣；使用场合：夜宴"
)

#: 服装提示词里**一个都不许出现**的特征串：人物参考图模板 / 场景模板
CHARACTER_TEMPLATE_MARKERS = (
    "正面全身参考图",
    "full body character reference sheet",
    "clean white background",
    "character_reference_sheet",
    "real human actor",
)
SCENE_TEMPLATE_MARKERS = (
    "广角建立镜头",
    "空间结构清晰",
    "wide establishing shot",
    "empty scene, no people",
    "cinematic live-action environment",
    "scene_asset_image",
)
#: 服装设计口径的七个维度（提示词/口径里必须逐项出现）
COSTUME_CALIBER_WORDS = ("穿着人物", "身份时代", "款式", "颜色", "材质", "配饰", "使用场合")


# ---------------------------------------------------------------------------
# 桩：两条出图通道都换成假的（零出网）
# ---------------------------------------------------------------------------


class _FakeVendorService:
    """上游出图服务通道的假实现（只记录调用，不出网）。"""

    def __init__(self, *, fail_asset_types: tuple[str, ...] = ()) -> None:
        self.calls: list[dict[str, object]] = []
        self.fail_asset_types = fail_asset_types

    async def __call__(self, **kwargs: object) -> image_client.ServiceTaskResult:
        asset = kwargs.get("asset") or {}
        asset_type = str(asset.get("asset_type") or "")  # type: ignore[union-attr]
        self.calls.append({"asset_type": asset_type, "asset": asset})
        if asset_type in self.fail_asset_types:
            raise image_client.ImageServiceError(f"假上游服务失败：{asset_type}（测试桩）")
        asset_id = str(kwargs.get("source_asset_id") or "")
        return image_client.ServiceTaskResult(
            ok=True,
            service_task_id=f"svc-{asset_id}",
            source_task_id=str(kwargs.get("source_task_id") or ""),
            status="completed",
            message="ok",
        )


class _FakeApimartAdapter:
    """APIMart 通道的假适配器：记录下来请求**实际会被送出去的东西**（不出网）。"""

    def __init__(self, *, error: Exception | None = None) -> None:
        self.inputs: list[object] = []
        self.configs: list[object] = []
        self.error = error

    async def generate(self, *, cfg: object, inp: object, timeout_s: float) -> ImageGenerationResult:
        self.inputs.append(inp)
        self.configs.append(cfg)
        if self.error is not None:
            raise self.error
        return ImageGenerationResult(
            images=[ImageItem(url="https://cdn.example.com/costume.png")],
            provider="apimart",
            provider_task_id="task-costume-1",
            status="succeeded",
            provider_notes=["测试桩：未出网"],
        )


@pytest.fixture(autouse=True)
def _no_real_storage_probe(monkeypatch: pytest.MonkeyPatch) -> None:
    """``with TestClient(app)`` 会跑 lifespan：把对象存储初始化换掉，保证零真实出网/落盘。"""
    import app.main as main_module

    monkeypatch.setattr(main_module, "init_storage", lambda: None)


@pytest.fixture(autouse=True)
def _reset_regenerate_registry() -> None:
    """清空进程内幂等登记，避免上一个用例的"同一轮"影响下一个。"""
    clear_regenerate_registry()


@pytest.fixture(autouse=True)
def _forbid_any_outbound(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """**任何** httpx 出站都直接失败：本文件的所有用例都必须零网络。"""
    hits: list[str] = []

    async def _forbidden(self, method, url, *args, **kwargs):  # type: ignore[no-untyped-def]
        hits.append(f"{method} {url}")
        raise AssertionError(f"测试不允许任何出站：{method} {url}")

    monkeypatch.setattr(httpx.AsyncClient, "request", _forbidden, raising=True)
    return hits


# ---------------------------------------------------------------------------
# 种子与路由脚手架（内存库，绝不碰 jellyfish.db）
# ---------------------------------------------------------------------------


def _seed(db: AsyncSession) -> None:
    """种一个项目 + 四类资产（服装/场景/道具走项目关联表），全部带结构化资料。"""
    db.add(Project(id=PROJECT_ID, name="测试项目", description="", style="真人古装", visual_style="现实"))
    db.add(Character(id="char-1", project_id=PROJECT_ID, name="林晓", description="十六岁少女，乌黑直发",
                     style="真人古装"))
    db.add(Costume(id=COSTUME_ID, name=COSTUME_NAME, description=COSTUME_PROFILE, style="真人古装",
                   view_count=1, tags=[]))
    db.add(Scene(id="scene-1", name="破庙夜景", description="荒废古庙，青砖地面",
                 style="真人古装", view_count=1, tags=[]))
    db.add(Prop(id="prop-1", name="青铜剑", description="青铜剑身，剑格有兽纹",
                style="真人古装", view_count=1, tags=[]))


def _link_assets(db: AsyncSession) -> None:
    db.add(ProjectCostumeLink(id=1, project_id=PROJECT_ID, costume_id=COSTUME_ID))
    db.add(ProjectSceneLink(id=1, project_id=PROJECT_ID, shot_id=None, scene_id="scene-1"))
    db.add(ProjectPropLink(id=1, project_id=PROJECT_ID, prop_id="prop-1"))


def _seed_llm(db: AsyncSession, *, provider: str = "apimart") -> None:
    """种一个图片供应商 + 默认图片模型（默认为 APIMart；可换成别的供应商做负例）。"""
    db.add(
        Provider(
            id="prov-1",
            name=provider,
            base_url="https://api.apimart.ai/v1" if provider == "apimart" else "https://api.openai.com/v1",
            api_key="test-key-not-real",
            description="测试种子",
            status=ProviderStatus.active,
            created_by="test",
        )
    )
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
    db.add(ModelSettings(id=1, default_image_model_id="model-1"))


def _build_route_harness():
    """内存库 + 依赖覆盖（与既有 image_pipeline 路由测试同一套做法）。"""
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


def _seed_route(factory: async_sessionmaker[AsyncSession], *, with_llm: bool = False) -> None:
    async def run() -> None:
        async with factory() as db:
            _seed(db)
            await db.flush()
            _link_assets(db)
            if with_llm:
                _seed_llm(db)
            await db.commit()

    asyncio.run(run())


@pytest.fixture
def route_client() -> AsyncGenerator[TestClient, None]:
    """带内存库覆盖的 TestClient（DRY_RUN；不触真实数据库）。"""
    factory, engine = _build_route_harness()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        _seed_route(factory)
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def _markers_in(text: str, markers: tuple[str, ...]) -> list[str]:
    return [marker for marker in markers if marker in text]


# ---------------------------------------------------------------------------
# A) 服装正式图片提示词槽位
# ---------------------------------------------------------------------------


def test_costume_prompt_slots_are_first_class_with_costume_design_caliber() -> None:
    """服装槽位在图片提示词链路里是**一等公民**，且有**服装设计口径**。"""
    assert "costume_image_front" in {str(category.value) for category in DEFAULT_IMAGE_PROMPT_CATEGORIES}
    spec = IMAGE_PROMPT_SLOT_BY_CATEGORY["costume_image_front"]
    assert spec.label == "服装正面图片"
    assert spec.entity_type == "costume"
    assert spec.view_hint, "槽位必须有视角说明（view_hint），否则模板会退到硬编码兜底"
    assert spec.subject_source == "服装画像卡"

    brief = slot_design_brief("costume_image_front")
    for word in COSTUME_CALIBER_WORDS:
        assert word in brief, f"服装设计口径缺少维度：{word}"
    assert slot_design_brief("scene_image_front") == "", "本次只补服装口径，不动其它三类"

    # 服装槽位有自己的风格词 / 负面词（此前负面词一条都没有）
    assert "isolated costume reference" in SLOT_STYLE_RULES["costume_image_front"]
    assert "real person portrait" in SLOT_NEGATIVE_EXTRA["costume_image_front"]

    # 基础风格词按类型分流：服装不是人物短剧画面口径，人物口径**逐字不变**
    assert "real human actor" not in base_style_words("costume")
    assert STYLE_WORDS_BY_ASSET_TYPE["costume"] == base_style_words("costume")
    assert base_style_words("character") == DEFAULT_STYLE_WORDS


@pytest.mark.asyncio
async def test_costume_prompt_preview_uses_costume_caliber_not_other_templates() -> None:
    """服装槽位预览：质量门禁字段齐全、用的是服装口径，**不出现**人物/场景模板特征串。"""
    db, engine = await build_session()
    prompts: list[str] = []

    def _stub(categories: list[PromptCategory]):
        async def _call(prompt: str) -> str:
            prompts.append(prompt)
            return json.dumps(
                {
                    "slots": [
                        {
                            "category": str(category.value),
                            "subject": f"{COSTUME_NAME}（服装）：{COSTUME_PROFILE}",
                            "action_pose": "平铺展示整套服装",
                            "environment": "干净背景",
                            "camera_language": "正视角平视",
                            "style": "写实服装参考",
                            "quality": "高清锐利",
                        }
                        for category in categories
                    ]
                },
                ensure_ascii=False,
            )

        return _call

    async with db:
        await seed_project_chapter_shot(db)
        result = await image_prompt_service.preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                project_id=PROJECT_ID,
                entity_profiles=[
                    EntityProfileInput(name=COSTUME_NAME, entity_type="costume", profile=COSTUME_PROFILE)
                ],
                categories=[PromptCategory.costume_image_front, PromptCategory.costume_image_other],
            ),
            llm_caller=_stub([PromptCategory.costume_image_front, PromptCategory.costume_image_other]),
        )
    await engine.dispose()

    by_category = {str(slot.category.value): slot for slot in result.slots}
    assert set(by_category) == {"costume_image_front", "costume_image_other"}

    front = by_category["costume_image_front"]
    assert front.entity_name == COSTUME_NAME
    assert front.design_brief and "款式" in front.design_brief
    assert front.savable is True and front.quality_issues == []
    assert front.structured_source == "asset_description"
    assert "isolated costume reference" in front.layers["style"]
    assert "real person portrait" in front.negative_prompt
    for word in ("款式", "颜色", "材质", "配饰"):
        assert word in front.prompt, f"服装提示词缺少服装设计口径维度：{word}"

    # 模型收到的提示词里带**服装设计口径**（而不是人物参考图 / 场景模板那一套）
    assert prompts, "必须真的组装过一次提示词"
    sent = prompts[0]
    assert "服装设计口径" in sent
    for marker in (*CHARACTER_TEMPLATE_MARKERS, *SCENE_TEMPLATE_MARKERS):
        assert marker not in sent, f"服装提示词模板串到了别的类型：{marker}"

    # 生成的提示词本身也不许出现别的类型的特征串
    for slot in result.slots:
        assert _markers_in(slot.prompt, CHARACTER_TEMPLATE_MARKERS) == []
        assert _markers_in(slot.prompt, SCENE_TEMPLATE_MARKERS) == []


def test_costume_image_prompt_preview_route_returns_quality_gate_fields(
    route_client: TestClient,
) -> None:
    """HTTP 层的服装槽位预览：四类资产**同构**（savable / quality_issues / structured_source ...）。"""
    response = route_client.post(
        IMAGE_PROMPT_PREVIEW_URL,
        json={
            "project_id": PROJECT_ID,
            "categories": ["costume_image_front", "character_image_front"],
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    by_category = {slot["category"]: slot for slot in data["slots"]}
    assert set(by_category) == {"costume_image_front", "character_image_front"}

    costume = by_category["costume_image_front"]
    for field in ("savable", "quality_issues", "structured_source", "design_brief", "negative_prompt", "layers"):
        assert field in costume, f"服装槽位缺少既有字段：{field}"
    assert costume["label"] == "服装正面图片"
    assert costume["entity_name"] == COSTUME_NAME
    assert costume["structured_source"] == "asset_description"
    assert costume["design_brief"]
    for word in COSTUME_CALIBER_WORDS:
        assert word in costume["design_brief"]
    # 与人物槽位**同构**：DRY_RUN 占位都过不了质量门禁，原因码一致（不是只对服装特殊）
    character = by_category["character_image_front"]
    assert costume["savable"] == character["savable"] is False
    assert costume["quality_issues"][0]["code"] == character["quality_issues"][0]["code"] == "vague_filler"

    blob = json.dumps(costume, ensure_ascii=False)
    assert _markers_in(blob, CHARACTER_TEMPLATE_MARKERS) == []
    assert _markers_in(blob, SCENE_TEMPLATE_MARKERS) == []


def test_status_route_reports_channel_per_asset_type(route_client: TestClient) -> None:
    """状态接口如实回报「哪一类走哪条通道」——页面不必自己硬编码服装的特例。"""
    response = route_client.get(STATUS_URL)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["channels"] == {
        "character": "vendor_service",
        "scene": "vendor_service",
        "prop": "vendor_service",
        "costume": "apimart",
    }
    # 上游服务契约本身没变（仍然只有三类）
    assert data["service_asset_types"] == ["character", "scene", "prop"]
    assert any("服装" in note and "APIMart" in note for note in data["channel_notes"])


def test_costume_prompt_save_then_generation_uses_the_saved_prompt(
    route_client: TestClient,
) -> None:
    """保存链路：服装提示词能存进 ``image_prompts``，且出图**优先用这份已保存的提示词**。"""
    saved_prompt = (
        "玄色长袍：交领右衽宽袖，玄色织锦，玉带扣，夜宴场合；"
        "平铺展示整套服装，干净背景，正视角平视，柔和主光，高清锐利。"
    )
    save = route_client.post(
        f"/api/v1/studio/projects/{PROJECT_ID}/asset-image-prompts",
        json={
            "items": [
                {
                    "asset_type": "costume",
                    "asset_id": COSTUME_ID,
                    "image_prompts": {"costume_image_front": saved_prompt},
                }
            ]
        },
    )
    assert save.status_code == 200, save.text
    payload = save.json()["data"]
    assert payload["saved"][0]["asset_type"] == "costume"
    assert payload["saved"][0]["saved_slots"] == ["costume_image_front"]
    assert payload["summary"]["slot_saved"] == 1

    preview = route_client.post(
        PREVIEW_URL,
        json={"project_id": PROJECT_ID, "asset_type": "costume", "asset_ids": [COSTUME_ID]},
    )
    assert preview.status_code == 200, preview.text
    target = preview.json()["data"]["targets"][0]
    assert target["prompt_source"] == "saved"
    assert target["prompt"] == saved_prompt
    assert target["result_kind"] == "costumeDesignImage"
    assert target["channel"] == "apimart"


# ---------------------------------------------------------------------------
# B) 单项生成服装设计图（APIMart 通道）
# ---------------------------------------------------------------------------


def test_costume_submit_dry_run_returns_placeholder_and_never_goes_out(
    route_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    _forbid_any_outbound: list[str],
) -> None:
    """DRY_RUN：占位结果齐全、不发任何请求（httpx 与上游出图服务两端都证明）。"""
    vendor_calls: list[object] = []

    async def _forbidden_vendor(**kwargs: object):  # type: ignore[no-untyped-def]
        vendor_calls.append(kwargs)
        raise AssertionError("服装不得走上游出图服务通道（那正是套用人物/场景模板）")

    monkeypatch.setattr(image_client, "create_asset_image_task", _forbidden_vendor, raising=True)
    dry_run.clear_audit_log()

    response = route_client.post(
        SUBMIT_URL,
        json={"project_id": PROJECT_ID, "asset_type": "costume", "asset_ids": [COSTUME_ID]},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]

    assert data["asset_type"] == "costume"
    assert data["channel"] == "apimart"
    assert data["channel_label"] == "Jellyfish APIMart 图片通道"
    assert any("APIMart" in note for note in data["channel_notes"])
    assert data["outcome"] == "dry_run"
    assert data["results"][0]["result_kind"] == "costumeDesignImage"
    assert data["results"][0]["result_label"] == "服装设定图"
    assert data["results"][0]["outcome"] == "dry_run"
    assert data["results"][0]["dry_run"] is True
    assert data["results"][0]["oss_url"] == "" and data["results"][0]["oss_ready"] is False
    assert data["results"][0]["image_url"].startswith("https://dry-run.invalid/")
    assert data["results"][0]["detail"]["prompt_template"] == strategies.TEMPLATE_COSTUME_DESIGN_IMAGE
    assert data["results"][0]["detail"]["reference_image_url"] == ""
    assert data["results"][0]["aspect_ratio_source"] in {"default", "request"}
    assert data["results"][0]["channel"] == "apimart"
    # 幂等键沿用 build_source_task_id（同一轮重复点击不会重复付费）
    assert data["results"][0]["source_task_id"].startswith(
        f"jellyfish:{PROJECT_ID}:costume:{COSTUME_ID}:"
    )
    assert ":r" not in data["results"][0]["source_task_id"]

    retry = route_client.post(
        SUBMIT_URL,
        json={
            "project_id": PROJECT_ID,
            "asset_type": "costume",
            "asset_ids": [COSTUME_ID],
            "attempt": 1,
        },
    )
    assert retry.status_code == 200, retry.text
    retried_key = retry.json()["data"]["results"][0]["source_task_id"]
    assert retried_key.endswith(":r1"), "重试（attempt+1）必须拿到**新的**幂等键"
    assert retried_key != data["results"][0]["source_task_id"]

    # 整数计数（绝不 0/0）
    summary = data["summary"]
    assert summary["total"] == 1
    assert summary["by_channel"] == {"apimart": 1}
    assert summary["dry_run_count"] == 1
    assert summary["failed_count"] == 0 and summary["ok_count"] == 0

    # 目标里**没有参考图**（服装不套用人物参考图）
    assert data["groups"][0]["channel"] == "apimart"
    assert data["groups"][0]["result_kind"] == "costumeDesignImage"
    # 目标里**没有参考图**（服装不套用人物参考图）
    assert [result["stage"] for result in data["results"]] == ["character_sheet"]
    assert vendor_calls == [] and _forbid_any_outbound == []
    assert [entry for entry in dry_run.audit_log() if entry["action"] == "allowed_real"] == []


@pytest.mark.asyncio
async def test_costume_channel_real_mode_posts_prompt_only_to_apimart(
    monkeypatch: pytest.MonkeyPatch,
    _forbid_any_outbound: list[str],
) -> None:
    """真实模式（守卫已放开）：只向 APIMart 发**纯提示词**请求，体里没有 image_urls。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    db, engine = await build_session()
    adapter = _FakeApimartAdapter()
    async with db:
        _seed(db)
        await db.flush()
        _link_assets(db)
        _seed_llm(db)
        await db.flush()
        groups, warnings = await channel_submit.build_channel_groups(
            db,
            project_id=PROJECT_ID,
            items=[{"asset_type": "costume", "asset_ids": [COSTUME_ID], "prompt_overrides": {}}],
            stage="character_sheet",
        )
        results = await channel_submit.submit_channel_groups(
            db, groups, adapter=adapter, isolate_errors=False
        )
    await engine.dispose()

    assert len(adapter.inputs) == 1
    sent = adapter.inputs[0]
    assert sent.images == [], "服装通道**不带参考图**（image_urls 不会出现）"
    assert sent.target_ratio == "16:9"
    assert "款式" in sent.prompt and "穿着人物" in sent.prompt
    assert _markers_in(sent.prompt, CHARACTER_TEMPLATE_MARKERS) == []

    result = results[0]
    assert result.asset_type == "costume"
    assert result.channel == "apimart"
    assert result.result_kind == "costumeDesignImage"
    assert result.outcome == "ok" and result.ok is True
    assert result.image_url == "https://cdn.example.com/costume.png"
    assert result.detail["provider"] == "apimart"
    assert result.detail["reference_image_url"] == ""
    assert any("APIMart" in warning for warning in warnings)
    assert _forbid_any_outbound == [], "真实模式也不许真出网（适配器被替换成假实现）"


@pytest.mark.asyncio
async def test_costume_channel_rejects_non_apimart_provider_with_structured_error(
    monkeypatch: pytest.MonkeyPatch,
    _forbid_any_outbound: list[str],
) -> None:
    """图片模型不是 APIMart 供应商 → 结构化 409，如实说明并给出改法（不静默换通道）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    db, engine = await build_session()
    async with db:
        _seed(db)
        await db.flush()
        _link_assets(db)
        _seed_llm(db, provider="openai")
        await db.flush()
        groups, _warnings = await channel_submit.build_channel_groups(
            db,
            project_id=PROJECT_ID,
            items=[{"asset_type": "costume", "asset_ids": [COSTUME_ID], "prompt_overrides": {}}],
            stage="character_sheet",
        )
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await channel_submit.submit_channel_groups(db, groups, adapter=_FakeApimartAdapter())
    await engine.dispose()

    assert exc_info.value.status_code == 409
    detail = exc_info.value.detail
    assert detail["code"] == costume_channel.ERROR_PROVIDER_NOT_APIMART
    assert detail["paid_call_made"] is False
    assert "APIMart" in detail["message"] and detail["how_to_fix"]
    assert _forbid_any_outbound == []


@pytest.mark.asyncio
async def test_costume_ratio_out_of_apimart_contract_is_rejected_not_silently_changed() -> None:
    """画幅不在 APIMart 支持的三个比例内 → 明确报错，**不偷偷改成 16:9**。"""
    db, engine = await build_session()
    async with db:
        _seed(db)
        await db.flush()
        _link_assets(db)
        with pytest.raises(ValueError) as exc_info:
            await costume_channel.build_costume_targets(
                db, project_id=PROJECT_ID, asset_ids=[COSTUME_ID], aspect_ratio="4:3"
            )
    await engine.dispose()
    assert "只支持这些比例" in str(exc_info.value) and "4:3" in str(exc_info.value)


# ---------------------------------------------------------------------------
# C) 混合批量：逐项按 asset_type 路由
# ---------------------------------------------------------------------------

MIXED_ITEMS = [
    {"asset_type": "character", "asset_ids": ["char-1"]},
    {"asset_type": "scene", "asset_ids": ["scene-1"]},
    {"asset_type": "prop", "asset_ids": ["prop-1"]},
    {"asset_type": "costume", "asset_ids": [COSTUME_ID]},
]

EXPECTED_KINDS = {
    "character": "characterReference",
    "scene": "sceneAssetImage",
    "prop": "propAssetImage",
    "costume": "costumeDesignImage",
}
EXPECTED_CHANNELS = {
    "character": "vendor_service",
    "scene": "vendor_service",
    "prop": "vendor_service",
    "costume": "apimart",
}


def test_mixed_batch_preview_routes_each_type_to_its_own_channel(route_client: TestClient) -> None:
    """计划预览（不触网）：四类混在一起时逐项给出通道与模板。"""
    response = route_client.post(
        PREVIEW_URL, json={"project_id": PROJECT_ID, "items": MIXED_ITEMS}
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]

    assert data["asset_type"] == "mixed"
    assert data["channel"] == "mixed"
    assert data["summary"]["by_channel"] == {"vendor_service": 3, "apimart": 1}
    assert data["summary"]["target_count"] == 4
    assert data["strategy"] == {}, "混合批量没有单一策略：逐组口径在 groups 里"
    assert [(group["asset_type"], group["channel"]) for group in data["groups"]] == [
        ("character", "vendor_service"),
        ("scene", "vendor_service"),
        ("prop", "vendor_service"),
        ("costume", "apimart"),
    ]
    by_type = {target["asset_type"]: target for target in data["targets"]}
    assert set(by_type) == set(EXPECTED_KINDS)
    for asset_type, kind in EXPECTED_KINDS.items():
        assert by_type[asset_type]["result_kind"] == kind
        assert by_type[asset_type]["channel"] == EXPECTED_CHANNELS[asset_type]
    assert by_type["costume"]["prompt_template"] == strategies.TEMPLATE_COSTUME_DESIGN_IMAGE
    assert by_type["costume"]["reference_image"] == ""
    assert by_type["character"]["prompt_template"] == strategies.TEMPLATE_CHARACTER_REFERENCE_SHEET
    assert data["dry_run"] is True


def test_mixed_batch_submit_dry_run_reports_route_per_item(
    route_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    _forbid_any_outbound: list[str],
) -> None:
    """混合批量提交（DRY_RUN）：逐条通道正确、整数计数、零出站。"""
    vendor_calls: list[object] = []

    async def _forbidden_vendor(**kwargs: object):  # type: ignore[no-untyped-def]
        vendor_calls.append(kwargs)
        raise AssertionError("DRY_RUN 下不得提交上游出图服务")

    monkeypatch.setattr(image_client, "create_asset_image_task", _forbidden_vendor, raising=True)

    response = route_client.post(SUBMIT_URL, json={"project_id": PROJECT_ID, "items": MIXED_ITEMS})
    assert response.status_code == 200, response.text
    data = response.json()["data"]

    assert data["asset_type"] == "mixed" and data["channel"] == "mixed"
    assert data["outcome"] == "dry_run"
    assert [result["asset_type"] for result in data["results"]] == [
        "character",
        "scene",
        "prop",
        "costume",
    ]
    for result in data["results"]:
        assert result["channel"] == EXPECTED_CHANNELS[result["asset_type"]]
        assert result["result_kind"] == EXPECTED_KINDS[result["asset_type"]]
        assert result["outcome"] == "dry_run" and result["dry_run"] is True
        assert result["oss_url"] == ""
    assert data["summary"]["total"] == 4
    assert data["summary"]["by_channel"] == {"vendor_service": 3, "apimart": 1}
    assert data["summary"]["failed_count"] == 0
    assert vendor_calls == [] and _forbid_any_outbound == []


@pytest.mark.asyncio
async def test_mixed_batch_real_mode_uses_both_channels_per_item(
    monkeypatch: pytest.MonkeyPatch,
    _forbid_any_outbound: list[str],
) -> None:
    """真实模式：人物/场景/道具 → 上游通道；服装 → APIMart 通道（逐项分流确实落地）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    db, engine = await build_session()
    vendor = _FakeVendorService()
    adapter = _FakeApimartAdapter()
    monkeypatch.setattr(image_client, "create_asset_image_task", vendor, raising=True)
    async with db:
        _seed(db)
        await db.flush()
        _link_assets(db)
        _seed_llm(db)
        await db.flush()
        groups, _warnings = await channel_submit.build_channel_groups(
            db,
            project_id=PROJECT_ID,
            items=[
                {"asset_type": item["asset_type"], "asset_ids": item["asset_ids"], "prompt_overrides": {}}
                for item in MIXED_ITEMS
            ],
            stage="character_sheet",
        )
        results = await channel_submit.submit_channel_groups(
            db, groups, adapter=adapter, isolate_errors=True
        )
    await engine.dispose()

    assert [call["asset_type"] for call in vendor.calls] == ["character", "scene", "prop"]
    assert len(adapter.inputs) == 1
    assert adapter.inputs[0].images == []

    by_type = {result.asset_type: result for result in results}
    assert set(by_type) == set(EXPECTED_KINDS)
    for asset_type, kind in EXPECTED_KINDS.items():
        assert by_type[asset_type].result_kind == kind
        assert by_type[asset_type].channel == EXPECTED_CHANNELS[asset_type]
        assert by_type[asset_type].outcome == "ok"
    assert channel_submit.channel_counts(results) == {"vendor_service": 3, "apimart": 1}
    assert _forbid_any_outbound == []


@pytest.mark.asyncio
async def test_mixed_batch_one_item_failure_does_not_poison_others(
    monkeypatch: pytest.MonkeyPatch,
    _forbid_any_outbound: list[str],
) -> None:
    """服装那一项失败时，人物/场景/道具的结论照常返回（逐项隔离 + 整数计数）。"""
    monkeypatch.setenv(DRY_RUN_ENV, "0")
    monkeypatch.setenv(CONFIRM_ENV, "1")

    db, engine = await build_session()
    vendor = _FakeVendorService()
    failing_adapter = _FakeApimartAdapter(error=ApimartImageError("APIMart 返回 500：上游图片队列不可用"))
    monkeypatch.setattr(image_client, "create_asset_image_task", vendor, raising=True)
    async with db:
        _seed(db)
        await db.flush()
        _link_assets(db)
        _seed_llm(db)
        await db.flush()
        groups, _warnings = await channel_submit.build_channel_groups(
            db,
            project_id=PROJECT_ID,
            items=[
                {"asset_type": item["asset_type"], "asset_ids": item["asset_ids"], "prompt_overrides": {}}
                for item in MIXED_ITEMS
            ],
            stage="character_sheet",
        )
        results = await channel_submit.submit_channel_groups(
            db, groups, adapter=failing_adapter, isolate_errors=True
        )
    await engine.dispose()

    by_type = {result.asset_type: result for result in results}
    assert by_type["costume"].outcome == "failed"
    assert by_type["costume"].ok is False
    assert by_type["costume"].channel == "apimart"
    assert "APIMart 服装设定图生成失败" in by_type["costume"].error_message
    for asset_type in ("character", "scene", "prop"):
        assert by_type[asset_type].outcome == "ok", f"{asset_type} 被别人的失败污染了"

    summary = summarize_results(results)
    assert summary["total"] == 4
    assert summary["ok_count"] == 3
    assert summary["failed_count"] == 1
    assert summary["by_channel"] == {"vendor_service": 3, "apimart": 1}
    assert summary["outcome"] == "partial_failed"
    assert _forbid_any_outbound == []


def test_duplicate_asset_type_items_are_rejected(route_client: TestClient) -> None:
    """同一类型被拆成两个 item → 400 明确拒绝（避免同一资产重复提交、重复计费）。"""
    response = route_client.post(
        SUBMIT_URL,
        json={
            "project_id": PROJECT_ID,
            "items": [
                {"asset_type": "costume", "asset_ids": [COSTUME_ID]},
                {"asset_type": "costume", "asset_ids": [COSTUME_ID]},
            ],
        },
    )
    assert response.status_code == 400, response.text
    message = response.json()["meta"]["error"]["message"]
    assert "出现多次" in message and "重复计费" in message


def test_single_type_request_keeps_legacy_shape(route_client: TestClient) -> None:
    """回归：旧的单类型形态（asset_type + asset_ids）行为不变，四类都能提交。"""
    for asset_type, asset_id, kind in (
        ("character", "char-1", "characterReference"),
        ("scene", "scene-1", "sceneAssetImage"),
        ("prop", "prop-1", "propAssetImage"),
        ("costume", COSTUME_ID, "costumeDesignImage"),
    ):
        response = route_client.post(
            SUBMIT_URL,
            json={"project_id": PROJECT_ID, "asset_type": asset_type, "asset_ids": [asset_id]},
        )
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["asset_type"] == asset_type
        assert data["channel"] == EXPECTED_CHANNELS[asset_type]
        assert data["results"][0]["result_kind"] == kind
        assert data["results"][0]["outcome"] == "dry_run"
        assert data["summary"]["total"] == 1


def test_character_reference_batch_still_character_only(route_client: TestClient) -> None:
    """回归：参考图批量**只对人物开放**，服装/场景走上这条路时明确忽略并如实回报。"""
    response = route_client.post(
        PREVIEW_URL,
        json={
            "project_id": PROJECT_ID,
            "items": [
                {"asset_type": "character", "asset_ids": ["char-1"]},
                {"asset_type": "costume", "asset_ids": [COSTUME_ID]},
            ],
            "stage": "reference_batch",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    by_type = {target["asset_type"]: target for target in data["targets"]}
    assert by_type["costume"]["reference_image"] == ""
    assert any("只对**人物**开放" in warning for warning in data["warnings"])


# ---------------------------------------------------------------------------
# D) 结果卡片 / 采纳 / 设为定版
# ---------------------------------------------------------------------------


@pytest.fixture
def _fake_download(monkeypatch: pytest.MonkeyPatch) -> None:
    """把「下载远端图片 + 上传存储」替换掉：采纳路径也不出网、不落盘。"""
    import uuid

    async def _fake(session, *, url=None, b64_data=None, name=None, prefix="files", **kwargs):  # type: ignore[no-untyped-def]
        item = FileItem(
            id=str(uuid.uuid4()),
            type="image",
            name=name or "generated",
            storage_key=f"{prefix}/{uuid.uuid4()}.png",
        )
        session.add(item)
        await session.flush()
        return item

    monkeypatch.setattr("app.services.studio.image_pipeline.adopt.create_file_from_url_or_b64", _fake)


def _seed_costume_with_primary(factory: async_sessionmaker[AsyncSession]) -> None:
    async def run() -> None:
        async with factory() as db:
            _seed(db)
            await db.flush()
            _link_assets(db)
            db.add(
                FileItem(
                    id="file-old",
                    type="image",
                    name="旧的服装定版.png",
                    thumbnail="https://oss.example.com/old-costume.png",
                    storage_key="https://oss.example.com/old-costume.png",
                )
            )
            await db.flush()
            db.add(
                CostumeImage(
                    id=1,
                    costume_id=COSTUME_ID,
                    file_id="file-old",
                    is_primary=True,
                    view_angle="FRONT",
                    quality_level="HIGH",
                )
            )
            await db.commit()

    asyncio.run(run())


def test_costume_adoption_writes_into_costume_images(
    route_client: TestClient,
    _fake_download: None,
) -> None:
    """采纳服装结果：写进 ``costume_images``（刷新后仍在），不静默设版。"""
    response = route_client.post(
        ADOPT_URL,
        json={
            "entity_type": "costume",
            "entity_id": COSTUME_ID,
            "url": "https://oss.example.com/generated/costume-front.png",
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["entity_type"] == "costume"
    assert data["entity_id"] == COSTUME_ID
    assert data["image_id"] and data["file_id"]
    assert data["is_primary"] is False, "采纳默认不设版（不静默替换定版）"
    assert data["replaced_primary"] is None


def test_costume_adopt_protects_existing_primary_and_needs_confirmation(
    _fake_download: None,
) -> None:
    """已有定版图时：默认不动（结构化 409），显式 ``confirm_replace_primary=true`` 才替换。"""
    factory, engine = _build_route_harness()
    app.dependency_overrides[get_db] = _override(factory)
    try:
        _seed_costume_with_primary(factory)
        with TestClient(app) as client:
            payload = {
                "entity_type": "costume",
                "entity_id": COSTUME_ID,
                "url": "https://oss.example.com/generated/costume-new.png",
                "image_id": 1,
                "set_primary": True,
            }
            blocked = client.post(ADOPT_URL, json=payload)
            assert blocked.status_code == 409, blocked.text
            error = blocked.json()["meta"]["error"]
            assert error["code"] == "primary_image_replace_required"
            assert error["existing_primary"]["image_id"] == 1
            assert error["confirm_field"] == "confirm_replace_primary"

            # 409 时库里一行都没改
            async def _read() -> tuple[str, bool]:
                async with factory() as db:
                    row = await db.get(CostumeImage, 1)
                    assert row is not None
                    return str(row.file_id), bool(row.is_primary)

            assert asyncio.run(_read()) == ("file-old", True)

            confirmed = client.post(ADOPT_URL, json={**payload, "confirm_replace_primary": True})
            assert confirmed.status_code == 200, confirmed.text
            data = confirmed.json()["data"]
            assert data["replaced_primary"]["image_id"] == 1
            assert data["is_primary"] is True
            assert asyncio.run(_read()) == (data["file_id"], True)
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


def test_costume_columns_exist_in_model_and_migration() -> None:
    """迁移核实：``costume_images.is_primary`` 与服装资产的 ``image_prompts`` 列都已补齐。

    只读核实（模型 + 迁移清单 + 内存库 PRAGMA），**不动正式库、不跑迁移脚本**。
    """
    from scripts._llm_pipeline_columns import COLUMNS

    declared = {(item.table, item.column) for item in COLUMNS}
    assert ("costumes", "image_prompts") in declared
    assert ("costume_images", "is_primary") in declared

    assert "image_prompts" in Costume.__table__.columns
    assert "is_primary" in CostumeImage.__table__.columns

    async def _pragma() -> tuple[set[str], set[str]]:
        import app.models  # noqa: F401

        from app.core.db import Base

        engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with engine.connect() as conn:
            costumes = {row[1] for row in (await conn.exec_driver_sql("PRAGMA table_info(costumes)")).all()}
            images = {row[1] for row in (await conn.exec_driver_sql("PRAGMA table_info(costume_images)")).all()}
        await engine.dispose()
        return costumes, images

    costumes, images = asyncio.run(_pragma())
    assert "image_prompts" in costumes
    assert "is_primary" in images


# ---------------------------------------------------------------------------
# E) 结果卡片的口径（服装项能被表达出来）
# ---------------------------------------------------------------------------


def test_summary_can_express_costume_result_cards(route_client: TestClient) -> None:
    """结果卡片口径：``costumeDesignImage`` /「服装设定图」+ 通道 + 整数计数。"""
    response = route_client.post(
        SUBMIT_URL,
        json={"project_id": PROJECT_ID, "items": [MIXED_ITEMS[3], MIXED_ITEMS[0]]},
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    costume = next(item for item in data["results"] if item["asset_type"] == "costume")
    assert costume["result_kind"] == "costumeDesignImage"
    assert costume["result_label"] == "服装设定图"
    assert costume["channel"] == "apimart"
    assert costume["detail"]["result_label"] == "服装设定图"
    assert data["summary"]["by_channel"] == {"apimart": 1, "vendor_service": 1}
    assert data["summary"]["total"] == data["summary"]["ok_count"] + data["summary"]["failed_count"] + (
        data["summary"]["dry_run_count"]
    )
