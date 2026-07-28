"""给 Celery worker 使用的同步任务执行服务。"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.chains.agents import ElementExtractorAgent, ScriptDividerAgent
from app.chains.agents import (
    CharacterPortraitAnalysisAgent,
    ConsistencyCheckerAgent,
    CostumeInfoAnalysisAgent,
    PropInfoAnalysisAgent,
    SceneInfoAnalysisAgent,
    ScriptOptimizerAgent,
    ScriptSimplifierAgent,
)
from app.chains.agents.script_processing_agents import (
    ScriptConsistencyCheckResult,
    ScriptDivisionResult,
    ScriptOptimizationResult,
    ScriptSimplificationResult,
)
from app.core.db_sync import sync_session_maker
from app.services.script_extraction_cache import (
    build_script_extract_cache_key,
    get_cached_script_extract,
    set_cached_script_extract,
)
from app.services.llm.runtime import build_default_text_llm_sync
from app.services.studio.script_division import write_division_result_to_chapter_sync
from app.services.studio.shot_extracted_candidates import (
    sync_from_extraction_draft_sync as sync_shot_extracted_candidates_from_draft_sync,
)
from app.services.studio.shot_extracted_dialogue_candidates import (
    sync_from_extraction_draft_sync as sync_shot_extracted_dialogue_candidates_from_draft_sync,
)
from app.services.studio.shot_semantic_defaults import apply_shot_semantic_defaults_from_draft_sync
from app.services.worker.task_executor import (
    AbstractLLMResultGenerator,
    AbstractWorkerTaskExecutor,
    WorkerTaskContext,
)


logger = logging.getLogger(__name__)


class DivideResultGenerator(AbstractLLMResultGenerator):
    thinking = False

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> ScriptDivisionResult:
        agent = ScriptDividerAgent(llm)
        return agent.divide_script(script_text=str(run_args.get("script_text") or ""))


class _ScriptProcessingTaskExecutor(AbstractWorkerTaskExecutor):
    """剧本任务执行基类：只消费统一提交时冻结的 command/snapshot。"""

    def load_run_args(self, ctx: WorkerTaskContext) -> dict[str, Any]:
        """拒绝非文本 Agent 命令，避免新任务重新依赖可变的路由入参。"""

        payload = dict(ctx.task.payload or {})
        command = payload.get("command")
        snapshot = payload.get("snapshot")
        if not isinstance(command, dict) or not isinstance(snapshot, dict):
            raise RuntimeError("script task command and snapshot are required")
        if command.get("operation") != "text_agent":
            raise RuntimeError("script task command must use text_agent")
        run_args = snapshot.get("run_args")
        if not isinstance(run_args, dict):
            raise RuntimeError("script task snapshot.run_args is required")
        return dict(run_args)


class ExtractResultGenerator(AbstractLLMResultGenerator):
    thinking = False

    def generate(self, db: Session, run_args: dict[str, Any]) -> tuple[Any, bool]:
        return generate_extraction_result(
            db=db,
            project_id=str(run_args.get("project_id") or ""),
            chapter_id=str(run_args.get("chapter_id") or ""),
            script_division=dict(run_args.get("script_division") or {}),
            consistency=dict(run_args.get("consistency") or {}) if run_args.get("consistency") else None,
            refresh_cache=bool(run_args.get("refresh_cache")),
        )

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> Any:  # pragma: no cover - 不直接走这里
        raise NotImplementedError


class ConsistencyResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> ScriptConsistencyCheckResult:
        agent = ConsistencyCheckerAgent(llm)
        return agent.extract(script_text=str(run_args.get("script_text") or ""))


class CharacterPortraitResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> Any:
        agent = CharacterPortraitAnalysisAgent(llm)
        return agent.analyze_character_description(
            character_context=run_args.get("character_context"),
            character_description=str(run_args.get("character_description") or ""),
        )


class PropInfoResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> Any:
        agent = PropInfoAnalysisAgent(llm)
        return agent.analyze_prop_description(
            prop_context=run_args.get("prop_context"),
            prop_description=str(run_args.get("prop_description") or ""),
        )


class SceneInfoResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> Any:
        agent = SceneInfoAnalysisAgent(llm)
        return agent.analyze_scene_description(
            scene_context=run_args.get("scene_context"),
            scene_description=str(run_args.get("scene_description") or ""),
        )


class CostumeInfoResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> Any:
        agent = CostumeInfoAnalysisAgent(llm)
        return agent.analyze_costume_description(
            costume_context=run_args.get("costume_context"),
            costume_description=str(run_args.get("costume_description") or ""),
        )


class ScriptOptimizationResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> ScriptOptimizationResult:
        agent = ScriptOptimizerAgent(llm)
        return agent.extract(
            script_text=str(run_args.get("script_text") or ""),
            consistency_json=json.dumps(dict(run_args.get("consistency") or {}), ensure_ascii=False),
        )


class ScriptSimplificationResultGenerator(AbstractLLMResultGenerator):
    thinking = True

    def generate_with_llm(self, llm, run_args: dict[str, Any]) -> ScriptSimplificationResult:
        agent = ScriptSimplifierAgent(llm)
        return agent.extract(script_text=str(run_args.get("script_text") or ""))


class DivideTaskExecutor(_ScriptProcessingTaskExecutor):
    task_kind = "script_divide"
    timeout_seconds = 1800.0

    def __init__(self) -> None:
        super().__init__(session_maker=sync_session_maker)
        self._generator = DivideResultGenerator()

    def execute(self, ctx: WorkerTaskContext, run_args: dict[str, Any]) -> ScriptDivisionResult:
        return self._generator.generate(ctx.db, run_args)

    def should_apply(self, ctx: WorkerTaskContext, run_args: dict[str, Any], result: ScriptDivisionResult) -> bool:  # noqa: ARG002
        return bool(run_args.get("write_to_db"))

    def apply_result(self, ctx: WorkerTaskContext, run_args: dict[str, Any], result: ScriptDivisionResult) -> None:
        chapter_id = str(run_args.get("chapter_id") or "")
        if not chapter_id:
            raise HTTPException(status_code=400, detail="chapter_id is required for write_to_db=true")
        apply_division_result(ctx.db, chapter_id=chapter_id, result=result)


class ExtractTaskExecutor(_ScriptProcessingTaskExecutor):
    task_kind = "script_extract"
    timeout_seconds = 1800.0

    def __init__(self) -> None:
        super().__init__(session_maker=sync_session_maker)
        self._generator = ExtractResultGenerator()

    def execute(self, ctx: WorkerTaskContext, run_args: dict[str, Any]) -> tuple[Any, bool]:
        return self._generator.generate(ctx.db, run_args)

    def serialize_result(self, result: tuple[Any, bool]) -> dict[str, Any]:
        draft, from_cache = result
        return {
            "draft": draft.model_dump(),
            "from_cache": from_cache,
        }

    def should_apply(self, ctx: WorkerTaskContext, run_args: dict[str, Any], result: tuple[Any, bool]) -> bool:  # noqa: ARG002
        return True

    def apply_result(self, ctx: WorkerTaskContext, run_args: dict[str, Any], result: tuple[Any, bool]) -> None:
        draft, _from_cache = result
        chapter_id = str(run_args.get("chapter_id") or "")
        apply_extraction_result(ctx.db, chapter_id=chapter_id, draft=draft)


class ConsistencyTaskExecutor(_ScriptProcessingTaskExecutor):
    task_kind = "script_consistency"
    succeeded_progress = 100
    timeout_seconds = 900.0

    def __init__(self) -> None:
        super().__init__(session_maker=sync_session_maker)
        self._generator = ConsistencyResultGenerator()

    def execute(self, ctx: WorkerTaskContext, run_args: dict[str, Any]) -> ScriptConsistencyCheckResult:
        return self._generator.generate(ctx.db, run_args)


class _SimpleLLMTaskExecutor(_ScriptProcessingTaskExecutor):
    succeeded_progress = 100
    timeout_seconds = 900.0
    generator_class: type[AbstractLLMResultGenerator]

    def __init__(self) -> None:
        super().__init__(session_maker=sync_session_maker)
        self._generator = self.generator_class()

    def execute(self, ctx: WorkerTaskContext, run_args: dict[str, Any]) -> Any:
        return self._generator.generate(ctx.db, run_args)


class CharacterPortraitTaskExecutor(_SimpleLLMTaskExecutor):
    task_kind = "script_character_portrait"
    generator_class = CharacterPortraitResultGenerator


class PropInfoTaskExecutor(_SimpleLLMTaskExecutor):
    task_kind = "script_prop_info"
    generator_class = PropInfoResultGenerator


class SceneInfoTaskExecutor(_SimpleLLMTaskExecutor):
    task_kind = "script_scene_info"
    generator_class = SceneInfoResultGenerator


class CostumeInfoTaskExecutor(_SimpleLLMTaskExecutor):
    task_kind = "script_costume_info"
    generator_class = CostumeInfoResultGenerator


class ScriptOptimizationTaskExecutor(_SimpleLLMTaskExecutor):
    task_kind = "script_optimize"
    generator_class = ScriptOptimizationResultGenerator


class ScriptSimplificationTaskExecutor(_SimpleLLMTaskExecutor):
    task_kind = "script_simplify"
    generator_class = ScriptSimplificationResultGenerator


def generate_division_result(
    *,
    db: Session,
    script_text: str,
) -> ScriptDivisionResult:
    llm = build_default_text_llm_sync(db, thinking=False)
    agent = ScriptDividerAgent(llm)
    return agent.divide_script(script_text=script_text)


def apply_division_result(
    db: Session,
    *,
    chapter_id: str,
    result: ScriptDivisionResult,
) -> None:
    write_division_result_to_chapter_sync(db, chapter_id=chapter_id, result=result)


def generate_extraction_result(
    *,
    db: Session,
    project_id: str,
    chapter_id: str,
    script_division: dict[str, Any],
    consistency: dict[str, Any] | None,
    refresh_cache: bool,
) -> tuple[Any, bool]:
    cache_key = build_script_extract_cache_key(
        project_id=project_id,
        chapter_id=chapter_id,
        script_division=script_division,
        consistency=consistency,
    )

    result = None
    from_cache = False
    if not refresh_cache:
        result = get_cached_script_extract(cache_key)
        from_cache = result is not None

    if result is None:
        llm = build_default_text_llm_sync(db, thinking=False)
        agent = ElementExtractorAgent(llm)
        result = agent.extract(
            project_id=project_id,
            chapter_id=chapter_id,
            script_division_json=json.dumps(script_division, ensure_ascii=False),
            consistency_json=json.dumps(consistency or {}, ensure_ascii=False),
        )
        set_cached_script_extract(cache_key, result)

    return result, from_cache


def apply_extraction_result(
    db: Session,
    *,
    chapter_id: str,
    draft: Any,
) -> None:
    """将提取草稿同步为候选与镜头语言默认值。"""

    sync_shot_extracted_candidates_from_draft_sync(db, chapter_id=chapter_id, draft=draft)
    sync_shot_extracted_dialogue_candidates_from_draft_sync(db, chapter_id=chapter_id, draft=draft)
    apply_shot_semantic_defaults_from_draft_sync(db, chapter_id=chapter_id, draft=draft)


def run_divide_task_sync(task_id: str) -> None:
    DivideTaskExecutor().run(task_id)


def run_extract_task_sync(task_id: str) -> None:
    ExtractTaskExecutor().run(task_id)


def run_consistency_task_sync(task_id: str) -> None:
    ConsistencyTaskExecutor().run(task_id)


def run_character_portrait_task_sync(task_id: str) -> None:
    CharacterPortraitTaskExecutor().run(task_id)


def run_prop_info_task_sync(task_id: str) -> None:
    PropInfoTaskExecutor().run(task_id)


def run_scene_info_task_sync(task_id: str) -> None:
    SceneInfoTaskExecutor().run(task_id)


def run_costume_info_task_sync(task_id: str) -> None:
    CostumeInfoTaskExecutor().run(task_id)


def run_script_optimization_task_sync(task_id: str) -> None:
    ScriptOptimizationTaskExecutor().run(task_id)


def run_script_simplification_task_sync(task_id: str) -> None:
    ScriptSimplificationTaskExecutor().run(task_id)
