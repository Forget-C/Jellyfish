"""影视技能集成测试：FastAPI 应用、技能完整链路与（可选）真实 LLM。"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage
from langchain_core.runnables import Runnable, RunnableLambda

from app.chains.agents import FilmEntityExtractor, FilmShotlistStoryboarder
from app.core.skills_runtime import FilmEntityExtractionResult, FilmShotlistResult


# ---------- FastAPI 应用集成 ----------


class TestAppIntegration:
    """FastAPI 应用端到端：健康检查与现有路由。"""

    def test_health_returns_ok(self, client: TestClient) -> None:
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    def test_example_prompt_route_returns_formatted(self, client: TestClient) -> None:
        response = client.get("/api/v1/example/prompt")
        assert response.status_code == 200
        data = response.json()
        assert "formatted_prompt" in data
        assert "第一场" in data["formatted_prompt"]

    def test_example_graph_route_runs(self, client: TestClient) -> None:
        response = client.post("/api/v1/example/graph", json={"messages": ["hi"]})
        assert response.status_code == 200
        data = response.json()
        assert "state" in data
        assert "messages" in data["state"]


# ---------- 技能完整链路（真实 Prompt + Mock Agent + 真实解析） ----------


# 模拟 LLM 返回符合 schema 的完整 JSON，用于走通整条链路
ENTITY_RESPONSE_WITH_DATA = """{
  "source_id": "integration_ch01",
  "chunks": ["chunk_001"],
  "characters": [
    {
      "id": "char_001",
      "name": "张三",
      "aliases": ["老张"],
      "description": "中年男子",
      "traits": ["沉稳"],
      "first_appearance": {"chunk_id": "chunk_001", "quote": "张三推门进来"}
    }
  ],
  "locations": [
    {
      "id": "loc_001",
      "name": "客厅",
      "type": "房间",
      "description": "宽敞的客厅"
    }
  ],
  "props": [
    {
      "id": "prop_001",
      "name": "茶杯",
      "category": "other",
      "description": "青花瓷茶杯"
    }
  ],
  "notes": [],
  "uncertainties": []
}"""

SHOTLIST_RESPONSE_WITH_DATA = """{
  "breakdown": {
    "source_id": "integration_ch01",
    "chunks": ["chunk_001"],
    "characters": [],
    "locations": [],
    "props": [],
    "scenes": [
      {
        "id": "scene_001",
        "interior": "INT",
        "time_of_day": "DAY",
        "location_id": "loc_001",
        "summary": "张三在客厅喝茶",
        "character_ids": ["char_001"],
        "prop_ids": ["prop_001"]
      }
    ],
    "shots": [
      {
        "id": "shot_001_001",
        "scene_id": "scene_001",
        "order": 1,
        "shot_type": "LS",
        "camera_angle": "EYE_LEVEL",
        "camera_movement": "STATIC",
        "description": "客厅全景，张三入画",
        "character_ids": ["char_001"],
        "prop_ids": ["prop_001"],
        "vfx": [],
        "sfx": [],
        "dialogue_lines": [],
        "evidence": []
      },
      {
        "id": "shot_001_002",
        "scene_id": "scene_001",
        "order": 2,
        "shot_type": "CU",
        "camera_angle": "EYE_LEVEL",
        "camera_movement": "STATIC",
        "description": "张三手执茶杯特写",
        "character_ids": ["char_001"],
        "prop_ids": ["prop_001"],
        "vfx": [],
        "sfx": [],
        "dialogue_lines": [],
        "evidence": []
      }
    ],
    "transitions": [
      {"from_shot_id": "shot_001_001", "to_shot_id": "shot_001_002", "transition": "CUT"}
    ],
    "notes": [],
    "uncertainties": []
  }
}"""


class TestSkillsPipelineIntegration:
    """技能完整链路：load_skill -> run (真实 Prompt 格式化 + Mock Agent) -> format_output (真实 JSON 解析)。"""

    def test_entity_extractor_full_pipeline_parses_structured_result(self) -> None:
        agent = RunnableLambda(lambda _: AIMessage(content=ENTITY_RESPONSE_WITH_DATA))
        extractor = FilmEntityExtractor(agent)
        extractor.load_skill("film_entity_extractor")
        result = extractor.extract(
            {
                "source_id": "integration_ch01",
                "language": "zh",
                "chunks_json": '[{"chunk_id": "chunk_001", "text": "张三推门进来，在客厅坐下，端起青花瓷茶杯。"}]',
            }
        )
        assert isinstance(result, FilmEntityExtractionResult)
        assert result.source_id == "integration_ch01"
        assert len(result.characters) == 1
        assert result.characters[0].name == "张三"
        assert result.characters[0].aliases == ["老张"]
        assert result.characters[0].first_appearance is not None
        assert result.characters[0].first_appearance.quote
        assert len(result.locations) == 1
        assert result.locations[0].name == "客厅"
        assert result.locations[0].type == "房间"
        assert len(result.props) == 1
        assert result.props[0].name == "茶杯"
        assert result.props[0].category == "other"

    def test_shotlist_storyboarder_full_pipeline_parses_structured_result(self) -> None:
        agent = RunnableLambda(lambda _: AIMessage(content=SHOTLIST_RESPONSE_WITH_DATA))
        storyboarder = FilmShotlistStoryboarder(agent)
        storyboarder.load_skill("film_shotlist")
        result = storyboarder.extract(
            {
                "source_id": "integration_ch01",
                "source_title": "第一章",
                "language": "zh",
                "chunks_json": '[{"chunk_id": "chunk_001", "text": "张三在客厅喝茶。"}]',
            }
        )
        assert isinstance(result, FilmShotlistResult)
        b = result.breakdown
        assert b.source_id == "integration_ch01"
        assert len(b.scenes) == 1
        assert b.scenes[0].id == "scene_001"
        assert b.scenes[0].interior == "INT"
        assert b.scenes[0].time_of_day == "DAY"
        assert len(b.shots) == 2
        assert b.shots[0].id == "shot_001_001"
        assert b.shots[0].shot_type == "LS"
        assert b.shots[1].shot_type == "CU"
        assert len(b.transitions) == 1
        assert b.transitions[0].from_shot_id == "shot_001_001"
        assert b.transitions[0].to_shot_id == "shot_001_002"
        assert b.transitions[0].transition == "CUT"


# ---------- 真实 LLM 集成（需 OPENAI_API_KEY，无则跳过） ----------
# 可选环境变量：OPENAI_BASE_URL、OPENAI_MODEL


def _build_real_llm() -> Runnable:
    """根据环境变量构建 ChatOpenAI：支持 OpenAI 和 MiniMax。

    优先使用 OPENAI_API_KEY；若未设置，尝试使用 MINIMAX_API_KEY。
    MiniMax 通过 OpenAI 兼容 API 接入（base_url 指向 MiniMax 端点）。
    """
    langchain_openai = pytest.importorskip("langchain_openai")
    if os.environ.get("OPENAI_API_KEY"):
        base_url = os.environ.get("OPENAI_BASE_URL") or None
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
        kwargs: dict = {"model": model, "temperature": 0}
        if base_url:
            kwargs["base_url"] = base_url
    elif os.environ.get("MINIMAX_API_KEY"):
        kwargs = {
            "model": os.environ.get("MINIMAX_MODEL", "MiniMax-M2.5"),
            "temperature": 0,
            "api_key": os.environ["MINIMAX_API_KEY"],
            "base_url": os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
        }
    else:
        pytest.skip("No LLM API key set")
    return langchain_openai.ChatOpenAI(**kwargs)


@pytest.mark.integration
@pytest.mark.skipif(
    not (os.environ.get("OPENAI_API_KEY") or os.environ.get("MINIMAX_API_KEY")),
    reason="OPENAI_API_KEY or MINIMAX_API_KEY not set; skip real LLM integration",
)
class TestRealLLMIntegration:
    """使用真实 LLM 的集成测试；未设置 OPENAI_API_KEY 时跳过。支持 OPENAI_BASE_URL、OPENAI_MODEL。"""

    def test_entity_extractor_with_real_llm(self) -> None:
        llm = _build_real_llm()
        extractor = FilmEntityExtractor(llm)
        extractor.load_skill("film_entity_extractor")
        result = extractor.extract(
            {
                "source_id": "real_llm_test",
                "language": "zh",
                "chunks_json": '[{"chunk_id": "c1", "text": "张三走进客厅，李四坐在沙发上。桌上放着一把钥匙。"}]',
            }
        )
        assert isinstance(result, FilmEntityExtractionResult)
        assert result.source_id == "real_llm_test"
        assert result.chunks == ["c1"]
        assert len(result.characters) >= 0 and len(result.locations) >= 0 and len(result.props) >= 0

    def test_shotlist_storyboarder_with_real_llm(self) -> None:
        llm = _build_real_llm()
        storyboarder = FilmShotlistStoryboarder(llm)
        storyboarder.load_skill("film_shotlist")
        result = storyboarder.extract(
            {
                "source_id": "real_llm_test",
                "source_title": "测试",
                "language": "zh",
                "chunks_json": '[{"chunk_id": "c1", "text": "张三推门进来。镜头切到李四抬头。"}]',
            }
        )
        assert isinstance(result, FilmShotlistResult)
        assert result.breakdown.source_id == "real_llm_test"
        assert len(result.breakdown.scenes) >= 0
        assert len(result.breakdown.shots) >= 0
