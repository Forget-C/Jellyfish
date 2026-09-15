"""章节原文检查、优化、精简和资产描述分析 API。"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.language_models.chat_models import BaseChatModel
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.chains.agents import CharacterPortraitAnalysisAgent, CostumeInfoAnalysisAgent, ConsistencyCheckerAgent, PropInfoAnalysisAgent, SceneInfoAnalysisAgent
from app.schemas.skills.script_processing import ScriptConsistencyCheckResult
from app.dependencies import get_db, get_llm
from app.schemas.common import ApiResponse, success_response
from app.core.contracts.asset_analysis import CharacterPortraitAnalysisResult
from app.core.contracts.asset_analysis import CostumeInfoAnalysisResult
from app.core.contracts.asset_analysis import PropInfoAnalysisResult
from app.core.contracts.asset_analysis import SceneInfoAnalysisResult
from app.services.script_processing_tasks import create_consistency_task, create_costume_info_task, create_character_portrait_task, create_prop_info_task, create_scene_info_task, create_script_optimization_task, create_script_simplification_task, pick_consistency_relation_entity_id, pick_analysis_relation_entity_id
from app.api.v1.routes.film.common import AsyncTaskCreateRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/script-processing", tags=["script-processing"])


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
    return success_response(
        AsyncTaskCreateRead(
            task_id=task_info.task_id,
            status=task_info.status,
            reused=task_info.reused,
            relation_type=task_info.relation_type,
            relation_entity_id=task_info.relation_entity_id,
        )
    )
