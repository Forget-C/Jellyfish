"""脚本处理 API 接口：分镜、信息提取、实体合并、变体分析、一致性检查、输出编译。"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.chains.agents import (
    CharacterPortraitAnalysisAgent,
    CostumeInfoAnalysisAgent,
    ScriptDividerAgent,
    ElementExtractorAgent,
    EntityMergerAgent,
    VariantAnalyzerAgent,
    ConsistencyCheckerAgent,
    PropInfoAnalysisAgent,
    SceneInfoAnalysisAgent,
)
from app.chains.agents.script_processing_agents import (
    ScriptDivisionResult,
    EntityMergeResult,
    VariantAnalysisResult,
    ScriptConsistencyCheckResult,
    StudioScriptExtractionDraft,
)
from app.dependencies import get_db, get_llm, get_nothinking_llm
from app.schemas.common import ApiResponse, success_response
from app.schemas.skills.character_portrait import CharacterPortraitAnalysisResult
from app.schemas.skills.costume_info_analysis import CostumeInfoAnalysisResult
from app.schemas.skills.prop_info_analysis import PropInfoAnalysisResult
from app.schemas.skills.scene_info_analysis import SceneInfoAnalysisResult
from app.services.common import required_field
from app.services.script_processing_tasks import (
    create_consistency_task,
    create_costume_info_task,
    create_divide_task,
    create_extract_task,
    create_character_portrait_task,
    create_merge_task,
    create_prop_info_task,
    create_scene_info_task,
    create_script_optimization_task,
    create_script_simplification_task,
    create_variant_task,
    pick_consistency_relation_entity_id,
    pick_merge_relation_entity_id,
    pick_analysis_relation_entity_id,
    pick_variant_relation_entity_id,
    spawn_consistency_task,
    spawn_costume_info_task,
    spawn_divide_task,
    spawn_extract_task,
    spawn_character_portrait_task,
    spawn_merge_task,
    spawn_prop_info_task,
    spawn_scene_info_task,
    spawn_script_optimization_task,
    spawn_script_simplification_task,
    spawn_variant_task,
)
from app.services.script_extraction_cache import (
    build_script_extract_cache_key,
    get_cached_script_extract,
    set_cached_script_extract,
)
from app.services.studio.script_division import write_division_result_to_chapter
from app.services.studio import (
    sync_shot_extracted_candidates_from_draft,
    sync_shot_extracted_dialogue_candidates_from_draft,
)
from app.services.studio.shot_semantic_defaults import apply_shot_semantic_defaults_from_draft
from app.api.v1.routes.film.common import AsyncTaskCreateRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/script-processing", tags=["script-processing"])


# ============================================================================
# 1. ScriptDividerAgent - 剧本分镜
# ============================================================================

class ScriptDividerRequest(BaseModel):
    """剧本分镜请求。"""
    script_text: str = Field(..., description="完整剧本文本", min_length=1)
    write_to_db: bool = Field(False, description="是否将分镜写入数据库（AI Studio shots 表）")
    chapter_id: str | None = Field(
        None,
        description="章节 ID（write_to_db=true 时必填）",
        min_length=1,
    )


@router.post(
    "/divide-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步将剧本分割为多个镜头",
    description="创建章节分镜提取任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def divide_script_async(
    request: ScriptDividerRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    if not request.chapter_id:
        raise HTTPException(status_code=400, detail=required_field("chapter_id", when="divide-async"))

    task_info = await create_divide_task(
        db,
        chapter_id=request.chapter_id,
        script_text=request.script_text,
        write_to_db=request.write_to_db,
    )
    await db.commit()
    if not task_info.reused:
        spawn_divide_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/divide",
    response_model=ApiResponse[ScriptDivisionResult],
    summary="将剧本分割为多个镜头",
    description=(
        "输入完整剧本文本，输出分镜列表（index/start_line/end_line/script_excerpt/"
        "shot_name/time_of_day）。"
        "注意：此阶段不强制稳定ID，角色以“称呼/名字”弱信息输出，稳定ID在合并阶段统一分配。"
        "当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 divide-async。"
    )
)
async def divide_script(
    request: ScriptDividerRequest,
    llm: BaseChatModel = Depends(get_nothinking_llm),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ScriptDivisionResult]:
    """
    将完整剧本文本自动分割为多个镜头。
    
    请求体：
    - script_text: 完整剧本文本
    
    返回：ScriptDivisionResult
    - shots: 分镜列表，包含每个镜头的 index、起止行号、shot_name、script_excerpt、time_of_day
    - total_shots: 总镜头数
    - notes: 拆分说明（可选）
    """
    try:
        agent = ScriptDividerAgent(llm)
        result = agent.divide_script(script_text=request.script_text)

        if request.write_to_db:
            if not request.chapter_id:
                raise HTTPException(status_code=400, detail=required_field("chapter_id", when="write_to_db=true"))
            await write_division_result_to_chapter(
                db,
                chapter_id=request.chapter_id,
                result=result,
            )

        return success_response(data=result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Script dividing failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to divide script: {str(e)}"
        )


# ============================================================================
# 2. EntityMergerAgent - 实体合并
# ============================================================================

class EntityMergerRequest(BaseModel):
    """实体合并请求。"""
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    all_shot_extractions: list[dict[str, Any]] = Field(
        ...,
        description="所有镜头提取结果（ShotElementExtractionResult 的序列化形式）"
    )
    historical_library: dict[str, Any] | None = Field(
        None,
        description="历史实体库（可选，用于增量合并）"
    )
    script_division: dict[str, Any] | None = Field(
        None,
        description="脚本分镜结果（可选；ScriptDivisionResult 序列化），用于定位与统计",
    )
    previous_merge: dict[str, Any] | None = Field(
        None,
        description="上一次合并结果（可选；EntityMergeResult 序列化），用于冲突重试合并",
    )
    conflict_resolutions: list[dict[str, Any]] | None = Field(
        None,
        description="冲突解决建议列表（可选；用于冲突重试合并）",
    )


@router.post(
    "/merge-entities-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步合并多镜头的实体信息",
    description="创建实体合并任务并立即返回 task_id；当前保留为预备能力，尚无真实前端入口。",
)
async def merge_entities_async(
    request: EntityMergerRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_merge_relation_entity_id(
        chapter_id=request.chapter_id,
        project_id=request.project_id,
    )
    task_info = await create_merge_task(
        db,
        relation_entity_id=relation_entity_id,
        all_shot_extractions=request.all_shot_extractions,
        historical_library=request.historical_library,
        script_division=request.script_division,
        previous_merge=request.previous_merge,
        conflict_resolutions=request.conflict_resolutions,
    )
    await db.commit()
    if not task_info.reused:
        spawn_merge_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/merge-entities",
    response_model=ApiResponse[EntityMergeResult],
    summary="合并多镜头的实体信息",
    description=(
        "输入全部分镜提取结果（可选带上脚本分镜与历史实体库），输出合并后的实体库："
        "角色库/地点库/场景库/道具库（静态画像 + 变体列表）。"
        "该步骤会统一分配稳定ID（如 char_001/loc_001/prop_001/scene_001）。"
        "当提供 previous_merge 与 conflict_resolutions 时，将进行冲突重试合并，优先消解 conflicts 并尽量保持 ID 稳定。"
        "当前接口保留为预备能力，尚无真实前端入口。"
    )
)
async def merge_entities(
    request: EntityMergerRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[EntityMergeResult]:
    """
    将多个镜头的提取结果合并，统一实体定义。
    
    请求体：
    - all_shot_extractions: 所有镜头的提取结果
    - historical_library: 历史实体库（可选，用于增量更新）
    - script_division: 脚本分镜结果（可选，用于定位与统计）
    - previous_merge: 上一次合并结果（可选；用于冲突重试合并）
    - conflict_resolutions: 冲突解决建议列表（可选；用于冲突重试合并）
    
    返回：EntityMergeResult
    - merged_library: 合并后的实体库（characters/locations/scenes/props，含 variants）
    - merge_stats: 合并统计信息
    - conflicts: 发现的冲突/待处理项
    - notes: 合并说明（可选）
    """
    try:
        agent = EntityMergerAgent(llm)
        result = agent.extract(
            all_extractions_json=json.dumps(request.all_shot_extractions, ensure_ascii=False),
            historical_library_json=json.dumps(request.historical_library or {}, ensure_ascii=False),
            script_division_json=json.dumps(request.script_division or {}, ensure_ascii=False),
            previous_merge_json=json.dumps(request.previous_merge or {}, ensure_ascii=False),
            conflict_resolutions_json=json.dumps(request.conflict_resolutions or [], ensure_ascii=False),
        )
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Entity merging failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to merge entities: {str(e)}"
        )


# ============================================================================
# 4. VariantAnalyzerAgent - 变体分析
# ============================================================================

class VariantAnalysisRequest(BaseModel):
    """变体分析请求。"""
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    merged_library: dict[str, Any] = Field(
        ...,
        description="合并后的实体库（EntityLibrary 的序列化形式；来自 EntityMerger 输出的 merged_library）"
    )
    all_shot_extractions: list[dict[str, Any]] = Field(
        ...,
        description="所有镜头提取结果"
    )
    script_division: dict[str, Any] | None = Field(
        None,
        description="脚本分镜结果（可选；ScriptDivisionResult 序列化），用于章节/段落分组",
    )


@router.post(
    "/analyze-variants-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步分析服装/外形变体",
    description="创建变体分析任务并立即返回 task_id；当前保留为预备能力，尚无真实前端入口。",
)
async def analyze_variants_async(
    request: VariantAnalysisRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_variant_relation_entity_id(
        chapter_id=request.chapter_id,
        project_id=request.project_id,
    )
    task_info = await create_variant_task(
        db,
        relation_entity_id=relation_entity_id,
        merged_library=request.merged_library,
        all_shot_extractions=request.all_shot_extractions,
        script_division=request.script_division,
    )
    await db.commit()
    if not task_info.reused:
        spawn_variant_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/analyze-variants",
    response_model=ApiResponse[VariantAnalysisResult],
    summary="分析服装/外形变体",
    description="检测角色服装/外形变化，构建演变时间线，生成章节变体建议列表与变体建议。当前接口保留为预备能力，尚无真实前端入口。"
)
async def analyze_variants(
    request: VariantAnalysisRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[VariantAnalysisResult]:
    """
    分析实体的变体（特别是角色服装变化）。
    
    请求体：
    - merged_library: 合并后的实体库
    - all_shot_extractions: 所有镜头提取结果
    - script_division: 脚本分镜结果（可选，用于章节/段落分组）
    
    返回：VariantAnalysisResult
    - costume_timelines: 各角色的服装演变时间线
    - variant_suggestions: 变体建议列表
    - chapter_variants: 按章节整理的变体信息
    - notes: 分析说明（可选）
    """
    try:
        agent = VariantAnalyzerAgent(llm)
        result = agent.extract(
            merged_library_json=json.dumps(request.merged_library, ensure_ascii=False),
            all_extractions_json=json.dumps(request.all_shot_extractions, ensure_ascii=False),
            script_division_json=json.dumps(request.script_division or {}, ensure_ascii=False),
        )
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Variant analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze variants: {str(e)}"
        )


# ============================================================================
# 5. ConsistencyCheckerAgent - 一致性检查（新流程：基于原文）
# ============================================================================

class ScriptConsistencyCheckRequest(BaseModel):
    """一致性检查请求（角色混淆）。"""
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    script_text: str = Field(..., description="完整剧本文本", min_length=1)


@router.post(
    "/check-consistency-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步检查角色混淆一致性（基于原文）",
    description="创建一致性检查任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def check_consistency_async(
    request: ScriptConsistencyCheckRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_consistency_relation_entity_id(
        chapter_id=request.chapter_id,
        project_id=request.project_id,
    )
    task_info = await create_consistency_task(
        db,
        relation_entity_id=relation_entity_id,
        script_text=request.script_text,
    )
    await db.commit()
    if not task_info.reused:
        spawn_consistency_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/check-consistency",
    response_model=ApiResponse[ScriptConsistencyCheckResult],
    summary="检查角色混淆一致性（基于原文）",
    description="检测同一角色在不同段落/镜头被赋予不同身份/行为主体导致混淆，并给出修改建议。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 check-consistency-async。"
)
async def check_consistency(
    request: ScriptConsistencyCheckRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[ScriptConsistencyCheckResult]:
    """
    检查实体定义与分镜内容的一致性。
    
    请求体：
    - script_text: 完整剧本文本
    
    返回：ScriptConsistencyCheckResult
    - issues: 角色混淆问题列表（含 description/suggestion/affected_lines）
    - has_issues: 是否发现问题
    - summary: 总结（可选）
    """
    try:
        agent = ConsistencyCheckerAgent(llm)
        result = agent.extract(script_text=request.script_text)
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Consistency checking failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check consistency: {str(e)}"
        )


# ============================================================================
# 5b. CharacterPortraitAnalysisAgent - 人物画像缺失信息分析
# ============================================================================
class CharacterPortraitAnalysisRequest(BaseModel):
    """人物画像缺失信息分析请求。"""

    relation_entity_id: str | None = Field(None, description="任务关联实体 ID（资产页恢复任务可选）")
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    character_context: str | None = Field(
        None,
        description="原文人物上下文（可为空；用于提供额外背景，帮助判断缺失信息）",
    )
    character_description: str = Field(..., description="原文人物描述", min_length=1)


@router.post(
    "/analyze-character-portrait-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步分析人物画像缺失信息",
    description="创建人物画像分析任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def analyze_character_portrait_async(
    request: CharacterPortraitAnalysisRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_analysis_relation_entity_id(
        relation_entity_id=request.relation_entity_id,
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        endpoint="analyze-character-portrait-async",
    )
    task_info = await create_character_portrait_task(
        db,
        relation_entity_id=relation_entity_id,
        character_context=request.character_context,
        character_description=request.character_description,
    )
    await db.commit()
    if not task_info.reused:
        spawn_character_portrait_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/analyze-character-portrait",
    response_model=ApiResponse[CharacterPortraitAnalysisResult],
    summary="分析人物画像缺失信息",
    description="根据原文人物上下文与人物描述，判断缺少哪些关键信息，并给出优化后的人物画像描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-character-portrait-async。",
)
async def analyze_character_portrait(
    request: CharacterPortraitAnalysisRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[CharacterPortraitAnalysisResult]:
    try:
        agent = CharacterPortraitAnalysisAgent(llm)
        result = agent.analyze_character_description(
            character_context=request.character_context,
            character_description=request.character_description,
        )
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Character portrait analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze character portrait: {str(e)}",
        )


# ============================================================================
# 5c. PropInfoAnalysisAgent - 道具信息缺失分析
# ============================================================================
class PropInfoAnalysisRequest(BaseModel):
    """道具信息缺失分析请求。"""

    relation_entity_id: str | None = Field(None, description="任务关联实体 ID（资产页恢复任务可选）")
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    prop_context: str | None = Field(
        None,
        description="原文道具上下文（可为空；用于提供额外背景，帮助判断缺失信息）",
    )
    prop_description: str = Field(..., description="原文道具描述", min_length=1)


@router.post(
    "/analyze-prop-info-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步分析道具信息缺失项",
    description="创建道具信息分析任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def analyze_prop_info_async(
    request: PropInfoAnalysisRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_analysis_relation_entity_id(
        relation_entity_id=request.relation_entity_id,
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        endpoint="analyze-prop-info-async",
    )
    task_info = await create_prop_info_task(
        db,
        relation_entity_id=relation_entity_id,
        prop_context=request.prop_context,
        prop_description=request.prop_description,
    )
    await db.commit()
    if not task_info.reused:
        spawn_prop_info_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/analyze-prop-info",
    response_model=ApiResponse[PropInfoAnalysisResult],
    summary="分析道具信息缺失项",
    description="根据原文道具上下文与道具描述，判断缺少哪些关键信息，并给出优化后的可生成道具描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-prop-info-async。",
)
async def analyze_prop_info(
    request: PropInfoAnalysisRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[PropInfoAnalysisResult]:
    try:
        agent = PropInfoAnalysisAgent(llm)
        result = agent.analyze_prop_description(
            prop_context=request.prop_context,
            prop_description=request.prop_description,
        )
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Prop info analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze prop info: {str(e)}",
        )


# ============================================================================
# 5d. SceneInfoAnalysisAgent - 场景信息缺失分析
# ============================================================================
class SceneInfoAnalysisRequest(BaseModel):
    """场景信息缺失分析请求。"""

    relation_entity_id: str | None = Field(None, description="任务关联实体 ID（资产页恢复任务可选）")
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    scene_context: str | None = Field(
        None,
        description="原文场景上下文（可为空；用于提供额外背景，帮助判断缺失信息）",
    )
    scene_description: str = Field(..., description="原文场景描述", min_length=1)


@router.post(
    "/analyze-scene-info-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步分析场景信息缺失项",
    description="创建场景信息分析任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def analyze_scene_info_async(
    request: SceneInfoAnalysisRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_analysis_relation_entity_id(
        relation_entity_id=request.relation_entity_id,
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        endpoint="analyze-scene-info-async",
    )
    task_info = await create_scene_info_task(
        db,
        relation_entity_id=relation_entity_id,
        scene_context=request.scene_context,
        scene_description=request.scene_description,
    )
    await db.commit()
    if not task_info.reused:
        spawn_scene_info_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/analyze-scene-info",
    response_model=ApiResponse[SceneInfoAnalysisResult],
    summary="分析场景信息缺失项",
    description="根据原文场景上下文与场景描述，判断缺少哪些关键信息，并给出优化后的可生成场景描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-scene-info-async。",
)
async def analyze_scene_info(
    request: SceneInfoAnalysisRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[SceneInfoAnalysisResult]:
    try:
        agent = SceneInfoAnalysisAgent(llm)
        result = agent.analyze_scene_description(
            scene_context=request.scene_context,
            scene_description=request.scene_description,
        )
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Scene info analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze scene info: {str(e)}",
        )


# ============================================================================
# 5e. CostumeInfoAnalysisAgent - 服装信息缺失分析
# ============================================================================
class CostumeInfoAnalysisRequest(BaseModel):
    """服装信息缺失分析请求。"""

    relation_entity_id: str | None = Field(None, description="任务关联实体 ID（资产页恢复任务可选）")
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    costume_context: str | None = Field(
        None,
        description="原文服装上下文（可为空；用于提供额外背景，帮助判断缺失信息）",
    )
    costume_description: str = Field(..., description="原文服装描述", min_length=1)


@router.post(
    "/analyze-costume-info-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步分析服装信息缺失项",
    description="创建服装信息分析任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def analyze_costume_info_async(
    request: CostumeInfoAnalysisRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_analysis_relation_entity_id(
        relation_entity_id=request.relation_entity_id,
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        endpoint="analyze-costume-info-async",
    )
    task_info = await create_costume_info_task(
        db,
        relation_entity_id=relation_entity_id,
        costume_context=request.costume_context,
        costume_description=request.costume_description,
    )
    await db.commit()
    if not task_info.reused:
        spawn_costume_info_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/analyze-costume-info",
    response_model=ApiResponse[CostumeInfoAnalysisResult],
    summary="分析服装信息缺失项",
    description="根据原文服装上下文与服装描述，判断缺少哪些关键信息，并给出优化后的可生成服装描述。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 analyze-costume-info-async。",
)
async def analyze_costume_info(
    request: CostumeInfoAnalysisRequest,
    llm: BaseChatModel = Depends(get_llm),
) -> ApiResponse[CostumeInfoAnalysisResult]:
    try:
        agent = CostumeInfoAnalysisAgent(llm)
        result = agent.analyze_costume_description(
            costume_context=request.costume_context,
            costume_description=request.costume_description,
        )
        return success_response(data=result)
    except Exception as e:
        logger.error(f"Costume info analysis failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze costume info: {str(e)}",
        )


# ============================================================================
# 6. 剧本优化与精简（统一异步任务）
# ============================================================================

class ScriptOptimizeRequest(BaseModel):
    """剧本优化请求（基于一致性检查结果）。"""
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    script_text: str = Field(..., description="原文剧本文本", min_length=1)
    consistency: dict[str, Any] = Field(..., description="一致性检查输出（ScriptConsistencyCheckResult 序列化）")


class ScriptSimplifyRequest(BaseModel):
    """智能精简剧本请求。"""

    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    script_text: str = Field(..., description="原文剧本文本", min_length=1)


@router.post(
    "/optimize-script-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步基于一致性检查优化剧本",
    description="创建剧本优化任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def optimize_script_async(
    request: ScriptOptimizeRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_analysis_relation_entity_id(
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        endpoint="optimize-script-async",
    )
    task_info = await create_script_optimization_task(
        db,
        relation_entity_id=relation_entity_id,
        script_text=request.script_text,
        consistency=request.consistency,
    )
    await db.commit()
    if not task_info.reused:
        spawn_script_optimization_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/simplify-script-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步智能精简剧本",
    description="创建剧本精简任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def simplify_script_async(
    request: ScriptSimplifyRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    relation_entity_id = pick_analysis_relation_entity_id(
        chapter_id=request.chapter_id,
        project_id=request.project_id,
        endpoint="simplify-script-async",
    )
    task_info = await create_script_simplification_task(
        db,
        relation_entity_id=relation_entity_id,
        script_text=request.script_text,
    )
    await db.commit()
    if not task_info.reused:
        spawn_script_simplification_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


# ============================================================================
# 7. ElementExtractorAgent - 项目级提取（最终输出）
# ============================================================================

class ScriptExtractRequest(BaseModel):
    """项目级信息提取请求（最终输出）。"""
    project_id: str = Field(..., description="项目 ID", min_length=1)
    chapter_id: str = Field(..., description="章节 ID", min_length=1)
    script_division: dict[str, Any] = Field(..., description="分镜结果（ScriptDivisionResult 序列化）")
    consistency: dict[str, Any] | None = Field(None, description="一致性检查结果（可选；ScriptConsistencyCheckResult 序列化）")
    refresh_cache: bool = Field(False, description="是否跳过后端缓存并强制重新提取")


@router.post(
    "/extract-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步项目级信息提取（最终输出）",
    description="创建项目级信息提取任务并立即返回 task_id；前端可通过任务状态接口轮询。",
)
async def extract_script_async(
    request: ScriptExtractRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[AsyncTaskCreateRead]:
    task_info = await create_extract_task(
        db,
        project_id=request.project_id,
        chapter_id=request.chapter_id,
        script_division=request.script_division,
        consistency=request.consistency,
        refresh_cache=request.refresh_cache,
    )
    await db.commit()
    if not task_info.reused:
        spawn_extract_task(task_info.task_id)
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )


@router.post(
    "/extract",
    response_model=ApiResponse[StudioScriptExtractionDraft],
    summary="项目级信息提取（最终输出）",
    description="输入分镜结果（可选带一致性检查结果），输出可导入 Studio 的草稿结构（name-based，ID 由导入接口生成）。当前同步接口主要用于兼容旧调用与调试场景；页面主流程优先使用 extract-async。"
)
async def extract_script(
    request: ScriptExtractRequest,
    llm: BaseChatModel = Depends(get_nothinking_llm),
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[StudioScriptExtractionDraft]:
    try:
        cache_key = build_script_extract_cache_key(
            project_id=request.project_id,
            chapter_id=request.chapter_id,
            script_division=request.script_division,
            consistency=request.consistency,
        )
        if not request.refresh_cache:
            cached = get_cached_script_extract(cache_key)
            if cached is not None:
                await sync_shot_extracted_candidates_from_draft(
                    db,
                    chapter_id=request.chapter_id,
                    draft=cached,
                )
                await sync_shot_extracted_dialogue_candidates_from_draft(
                    db,
                    chapter_id=request.chapter_id,
                    draft=cached,
                )
                await apply_shot_semantic_defaults_from_draft(
                    db,
                    chapter_id=request.chapter_id,
                    draft=cached,
                )
                await db.commit()
                return success_response(data=cached, meta={"from_cache": True})

        agent = ElementExtractorAgent(llm)
        result = agent.extract(
            project_id=request.project_id,
            chapter_id=request.chapter_id,
            script_division_json=json.dumps(request.script_division, ensure_ascii=False),
            consistency_json=json.dumps(request.consistency or {}, ensure_ascii=False),
        )
        set_cached_script_extract(cache_key, result)
        await sync_shot_extracted_candidates_from_draft(
            db,
            chapter_id=request.chapter_id,
            draft=result,
        )
        await sync_shot_extracted_dialogue_candidates_from_draft(
            db,
            chapter_id=request.chapter_id,
            draft=result,
        )
        await apply_shot_semantic_defaults_from_draft(
            db,
            chapter_id=request.chapter_id,
            draft=result,
        )
        await db.commit()
        return success_response(data=result, meta={"from_cache": False})
    except Exception as e:
        logger.error(f"Script extraction failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to extract script: {str(e)}",
        )
