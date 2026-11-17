"""章节原文检查、优化、精简和资产描述分析 API。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_db
from app.schemas.source_explanations import SourceExplanation
from app.schemas.common import ApiResponse, success_response
from app.services.script_processing_tasks import create_consistency_task, create_costume_info_task, create_character_portrait_task, create_prop_info_task, create_scene_info_task, create_script_optimization_task, create_script_simplification_task, pick_consistency_relation_entity_id, pick_analysis_relation_entity_id
from app.api.v1.routes.film.common import AsyncTaskCreateRead


router = APIRouter(prefix="/script-processing", tags=["script-processing"])


# ============================================================================
# 5. ConsistencyCheckerAgent - 一致性检查（新流程：基于原文）
# ============================================================================

class ScriptConsistencyCheckRequest(BaseModel):
    """原文一致性检查请求。"""
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    script_text: str = Field(..., description="完整剧本文本", min_length=1)
    source_explanations: list[SourceExplanation] | None = None


@router.post(
    "/check-consistency-async",
    response_model=ApiResponse[AsyncTaskCreateRead],
    summary="异步原文一致性检查",
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
        **({"source_explanations": [item.model_dump() for item in request.source_explanations]}
           if request.source_explanations is not None else {}),
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


# ============================================================================
# 6. 剧本优化与精简（统一异步任务）
# ============================================================================

class ScriptOptimizeRequest(BaseModel):
    """剧本优化请求（基于一致性检查结果）。"""
    project_id: str | None = Field(None, description="项目 ID（异步任务关联可选）")
    chapter_id: str | None = Field(None, description="章节 ID（异步任务关联可选）")
    script_text: str = Field(..., description="原文剧本文本", min_length=1)
    source_explanations: list[SourceExplanation] | None = None
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
        **({"source_explanations": [item.model_dump() for item in request.source_explanations]}
           if request.source_explanations is not None else {}),
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
