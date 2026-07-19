"""Studio 模块路由聚合（按子模块拆分，避免单文件过大）。"""

from fastapi import APIRouter

from app.api.v1.routes.studio import (
    chapters,
    entities,
    files,
    image_tasks,
    projects,
    prompts,
    text_lab,
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
router.include_router(text_lab.router, prefix="/text-lab", tags=["studio/text-lab"])
router.include_router(files.router, prefix="/files", tags=["studio/files"])
router.include_router(timeline.router, prefix="/timeline", tags=["studio/timeline"])
router.include_router(image_tasks.router, prefix="/image-tasks", tags=["studio/image-tasks"])
router.include_router(shot_character_links.router, prefix="/shot-character-links", tags=["studio/shot-character-links"])
