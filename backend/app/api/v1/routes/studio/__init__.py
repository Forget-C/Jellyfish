"""Studio 模块路由聚合（按子模块拆分，避免单文件过大）。"""

from fastapi import APIRouter

from app.api.v1.routes.studio import (
    asset_voices,
    documents,
    chapters,
    drama_plan,
    entities,
    files,
    image_pipeline,
    image_tasks,
    jurilu_import,
    llm_orchestration,
    projects,
    prompt_board,
    prompt_delivery,
    prompts,
    quick_skill,
    shots,
    timeline,
    shot_character_links,
)

router = APIRouter()

router.include_router(projects.router, prefix="/projects", tags=["studio/projects"])
router.include_router(chapters.router, prefix="/chapters", tags=["studio/chapters"])

router.include_router(shots.router, prefix="/shots", tags=["studio/shots"])
router.include_router(shots.details_router, prefix="/shot-details", tags=["studio/shot-details"])
router.include_router(shots.dialog_router, prefix="/shot-dialog-lines", tags=["studio/shot-dialog-lines"])
router.include_router(shots.links_router, prefix="/shot-links", tags=["studio/shot-links"])
router.include_router(shots.frames_router, prefix="/shot-frame-images", tags=["studio/shot-frame-images"])

router.include_router(entities.router, prefix="/entities", tags=["studio/entities"])
router.include_router(prompts.router, prefix="/prompts", tags=["studio/prompts"])
router.include_router(files.router, prefix="/files", tags=["studio/files"])
router.include_router(asset_voices.router, prefix="/asset-voices", tags=["studio/asset-voices"])
router.include_router(documents.router, prefix="/documents", tags=["studio/documents"])
router.include_router(timeline.router, prefix="/timeline", tags=["studio/timeline"])
router.include_router(image_tasks.router, prefix="/image-tasks", tags=["studio/image-tasks"])
router.include_router(shot_character_links.router, prefix="/shot-character-links", tags=["studio/shot-character-links"])
router.include_router(prompt_delivery.router, prefix="/prompt-delivery", tags=["studio/prompt-delivery"])
router.include_router(prompt_board.router, prefix="/prompt-board", tags=["studio/prompt-board"])
router.include_router(jurilu_import.router, prefix="/jurilu-import", tags=["studio/jurilu-import"])
router.include_router(quick_skill.router, prefix="/quick-skill", tags=["studio/quick-skill"])
router.include_router(llm_orchestration.router, prefix="/llm", tags=["studio/llm"])
router.include_router(image_pipeline.router, prefix="/image-pipeline", tags=["studio/image-pipeline"])

# 广告剧情流程：四个章节级端点 + 一个项目级"取可用空章节"入口（两条路由共用同一个模块，
# 因此拆成两个 router 分别挂到 /chapters 与 /projects 前缀下）。
router.include_router(drama_plan.router, prefix="/chapters", tags=["studio/drama-plan"])
router.include_router(drama_plan.project_router, prefix="/projects", tags=["studio/drama-plan"])

