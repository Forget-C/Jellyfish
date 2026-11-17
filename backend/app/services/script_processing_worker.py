"""剧本生成的纯计算函数；不管理任务状态或持有网络请求期间的数据库会话。"""

from __future__ import annotations

import json
from difflib import SequenceMatcher
from typing import Any

from app.chains.agents import (
    CharacterPortraitAnalysisAgent,
    ConsistencyCheckerAgent,
    CostumeInfoAnalysisAgent,
    PropInfoAnalysisAgent,
    SceneInfoAnalysisAgent,
    ScriptOptimizerAgent,
    ScriptSimplifierAgent,
)
from app.services.chapters.explanations import source_version, validate_explanations
from app.schemas.skills.script_processing import (
    ScriptConsistencyCheckResult,
    ScriptOptimizationResult,
    ScriptSimplificationResult,
)


def _consistency(llm, run_args: dict[str, Any]) -> ScriptConsistencyCheckResult:
    """执行 consistency 的冻结输入，只返回生成结果。"""
    agent = ConsistencyCheckerAgent(llm)
    text = str(run_args.get("script_text") or "")
    explanations = run_args.get('source_explanations') or []
    validate_explanations(explanations, text)
    valid = [item for item in explanations if item['source_version'] == source_version(text)]
    result = agent.extract(script_text=text, explanations=json.dumps(valid, ensure_ascii=False))
    result.check_scope = 'source_consistency'
    result.source_version = source_version(text)
    result.explanation_version = source_version(json.dumps(valid, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    return result


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
    result = agent.extract(
        script_text=str(run_args.get("script_text") or ""),
        consistency_json=json.dumps(dict(run_args.get("consistency") or {}), ensure_ascii=False),
        explanations=json.dumps(run_args.get("source_explanations") or [], ensure_ascii=False),
    )

    consistency = run_args.get('consistency') or {}
    source = run_args['script_text']
    if consistency.get('check_scope') == 'source_consistency':
        spans = []
        for issue in consistency.get('issues', []):
            excerpt = issue.get('excerpt', '')
            if not excerpt or source.count(excerpt) != 1:
                raise ValueError('修复问题须包含可唯一定位的原文摘录，请重新检查')
            start = source.index(excerpt)
            spans.append((start, start + len(excerpt)))
        merged = []
        for left, right in sorted(spans):
            if merged and left <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(right, merged[-1][1]))
            else:
                merged.append((left, right))
        for tag, start, end, _, _ in SequenceMatcher(None, source, result.optimized_script_text, autojunk=False).get_opcodes():
            if tag != 'equal' and not any(left <= start <= end <= right for left, right in merged):
                raise ValueError('修改涉及未选问题的原文，整批建议未采用')
    result.source_text = source
    result.explanation_version = consistency.get('explanation_version')
    return result


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
    }
    for field, value_type in required.get(kind, {}).items():
        value = run_args.get(field)
        if not isinstance(value, value_type) or (value_type is str and not value.strip()):
            raise ValueError(f"missing or invalid script input: {field}")
    generators = {
        "script_consistency": _consistency,
        "script_character_portrait": _character_portrait,
        "script_prop_info": _prop_info,
        "script_scene_info": _scene_info,
        "script_costume_info": _costume_info,
        "script_optimize": _optimize,
        "script_simplify": _simplify,
    }
    return generators[kind](llm, run_args)
