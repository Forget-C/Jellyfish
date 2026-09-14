"""剧本生成的纯计算函数；不管理任务状态或持有网络请求期间的数据库会话。"""

from __future__ import annotations

import json
from typing import Any

from app.chains.agents import ElementExtractorAgent, ScriptDividerAgent
from app.chains.agents import (
    CharacterPortraitAnalysisAgent,
    ConsistencyCheckerAgent,
    CostumeInfoAnalysisAgent,
    EntityMergerAgent,
    PropInfoAnalysisAgent,
    SceneInfoAnalysisAgent,
    ScriptOptimizerAgent,
    ScriptSimplifierAgent,
    VariantAnalyzerAgent,
)
from app.chains.agents.script_processing_agents import (
    EntityMergeResult,
    ScriptConsistencyCheckResult,
    ScriptDivisionResult,
    ScriptOptimizationResult,
    ScriptSimplificationResult,
    VariantAnalysisResult,
)


def _divide(llm, run_args: dict[str, Any]) -> ScriptDivisionResult:
    """执行 divide 的冻结输入，只返回生成结果。"""
    agent = ScriptDividerAgent(llm)
    return agent.divide_script(script_text=str(run_args.get("script_text") or ""))


def _consistency(llm, run_args: dict[str, Any]) -> ScriptConsistencyCheckResult:
    """执行 consistency 的冻结输入，只返回生成结果。"""
    agent = ConsistencyCheckerAgent(llm)
    return agent.extract(script_text=str(run_args.get("script_text") or ""))


def _merge(llm, run_args: dict[str, Any]) -> EntityMergeResult:
    """执行 merge 的冻结输入，只返回生成结果。"""
    agent = EntityMergerAgent(llm)
    return agent.extract(
        all_extractions_json=json.dumps(run_args.get("all_shot_extractions") or [], ensure_ascii=False),
        historical_library_json=json.dumps(run_args.get("historical_library") or {}, ensure_ascii=False),
        script_division_json=json.dumps(run_args.get("script_division") or {}, ensure_ascii=False),
        previous_merge_json=json.dumps(run_args.get("previous_merge") or {}, ensure_ascii=False),
        conflict_resolutions_json=json.dumps(run_args.get("conflict_resolutions") or [], ensure_ascii=False),
    )


def _variant(llm, run_args: dict[str, Any]) -> VariantAnalysisResult:
    """执行 variant 的冻结输入，只返回生成结果。"""
    agent = VariantAnalyzerAgent(llm)
    return agent.extract(
        merged_library_json=json.dumps(run_args.get("merged_library") or {}, ensure_ascii=False),
        all_extractions_json=json.dumps(run_args.get("all_shot_extractions") or [], ensure_ascii=False),
        script_division_json=json.dumps(run_args.get("script_division") or {}, ensure_ascii=False),
    )


def _character_portrait(llm, run_args: dict[str, Any]) -> Any:
    """执行 character_portrait 的冻结输入，只返回生成结果。"""
    agent = CharacterPortraitAnalysisAgent(llm)
    return agent.analyze_character_description(
        character_context=run_args.get("character_context"),
        character_description=str(run_args.get("character_description") or ""),
    )


def _prop_info(llm, run_args: dict[str, Any]) -> Any:
    """执行 prop_info 的冻结输入，只返回生成结果。"""
    agent = PropInfoAnalysisAgent(llm)
    return agent.analyze_prop_description(
        prop_context=run_args.get("prop_context"),
        prop_description=str(run_args.get("prop_description") or ""),
    )


def _scene_info(llm, run_args: dict[str, Any]) -> Any:
    """执行 scene_info 的冻结输入，只返回生成结果。"""
    agent = SceneInfoAnalysisAgent(llm)
    return agent.analyze_scene_description(
        scene_context=run_args.get("scene_context"),
        scene_description=str(run_args.get("scene_description") or ""),
    )


def _costume_info(llm, run_args: dict[str, Any]) -> Any:
    """执行 costume_info 的冻结输入，只返回生成结果。"""
    agent = CostumeInfoAnalysisAgent(llm)
    return agent.analyze_costume_description(
        costume_context=run_args.get("costume_context"),
        costume_description=str(run_args.get("costume_description") or ""),
    )


def _optimize(llm, run_args: dict[str, Any]) -> ScriptOptimizationResult:
    """执行 optimize 的冻结输入，只返回生成结果。"""
    agent = ScriptOptimizerAgent(llm)
    return agent.extract(
        script_text=str(run_args.get("script_text") or ""),
        consistency_json=json.dumps(dict(run_args.get("consistency") or {}), ensure_ascii=False),
    )


def _simplify(llm, run_args: dict[str, Any]) -> ScriptSimplificationResult:
    """执行 simplify 的冻结输入，只返回生成结果。"""
    agent = ScriptSimplifierAgent(llm)
    return agent.extract(script_text=str(run_args.get("script_text") or ""))


def generate_script_result(kind: str, llm, run_args: dict[str, Any]) -> Any:
    """在有界线程池中调用同步 Agent；调用方负责先退出数据库会话。"""
    if kind.startswith("directing_"):
        from app.services.directing.ai import generate_directing_result
        return generate_directing_result(kind, llm, run_args)
    required = {
        "script_consistency": {"script_text": str},
        "script_merge": {"all_shot_extractions": list},
        "script_variant": {"merged_library": dict, "all_shot_extractions": list},
    }
    for field, value_type in required.get(kind, {}).items():
        value = run_args.get(field)
        if not isinstance(value, value_type) or (value_type is str and not value.strip()):
            raise ValueError(f"missing or invalid script input: {field}")
    if kind == "script_extract":
        return ElementExtractorAgent(llm).extract(
            project_id=str(run_args.get("project_id") or ""), chapter_id=str(run_args.get("chapter_id") or ""),
            script_division_json=json.dumps(run_args.get("script_division") or {}, ensure_ascii=False),
            consistency_json=json.dumps(run_args.get("consistency") or {}, ensure_ascii=False),
        )
    generators = {
        "script_divide": _divide,
        "script_consistency": _consistency,
        "script_merge": _merge,
        "script_variant": _variant,
        "script_character_portrait": _character_portrait,
        "script_prop_info": _prop_info,
        "script_scene_info": _scene_info,
        "script_costume_info": _costume_info,
        "script_optimize": _optimize,
        "script_simplify": _simplify,
    }
    return generators[kind](llm, run_args)


async def apply_script_result(db, *, kind: str, run_args: dict, result: Any) -> None:
    """在 TaskService 成功交付事务中应用剧本结果，不产生网络 I/O。"""
    chapter_id = str(run_args.get("chapter_id") or "")
    if kind == "script_divide" and run_args.get("write_to_db"):
        from app.services.studio.script_division import write_division_result_to_chapter_sync
        await db.run_sync(lambda session: write_division_result_to_chapter_sync(session, chapter_id=chapter_id, result=result))
    elif kind == "script_extract":
        from app.services.studio.shot_extracted_candidates import sync_from_extraction_draft_sync as sync_assets
        from app.services.studio.shot_extracted_dialogue_candidates import sync_from_extraction_draft_sync as sync_dialogue
        from app.services.studio.shot_semantic_defaults import apply_shot_semantic_defaults_from_draft_sync
        await db.run_sync(lambda session: sync_assets(session, chapter_id=chapter_id, draft=result))
        await db.run_sync(lambda session: sync_dialogue(session, chapter_id=chapter_id, draft=result))
        await db.run_sync(lambda session: apply_shot_semantic_defaults_from_draft_sync(session, chapter_id=chapter_id, draft=result))
