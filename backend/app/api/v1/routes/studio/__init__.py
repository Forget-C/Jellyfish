"""Studio 模块路由聚合（按子模块拆分，避免单文件过大）。"""

from fastapi import APIRouter

from app.api.v1.routes.studio import (
    chapters,
    generation_canvases,
    directing,
    entities,
    experiment_sessions,
    files,
    generation_tasks,
    lab_generation_tasks,
    generation_prompts,
    projects,
    prompts,
    text_lab,
    project_assets,
)

router = APIRouter()

router.include_router(directing.router)

router.include_router(projects.router, prefix="/projects", tags=["studio/projects"])
router.include_router(chapters.router, prefix="/chapters", tags=["studio/chapters"])

router.include_router(project_assets.router, prefix="/project-assets", tags=["studio/project-assets"])

router.include_router(entities.router, prefix="/entities", tags=["studio/entities"])
router.include_router(prompts.router, prefix="/prompts", tags=["studio/prompts"])
router.include_router(text_lab.router, prefix="/labs/text", tags=["studio/text-lab"])
router.include_router(experiment_sessions.router, prefix="/experiment-sessions", tags=["studio/experiment-sessions"])
router.include_router(files.router, prefix="/files", tags=["studio/files"])
router.include_router(generation_prompts.router, prefix="/generation-prompts", tags=["studio/generation-prompts"])
router.include_router(generation_tasks.router, prefix="/generation-tasks", tags=["studio/generation-tasks"])
router.include_router(lab_generation_tasks.router, prefix="/generation-tasks/labs", tags=["studio/generation-tasks"])

router.include_router(generation_canvases.router, prefix="/generation-canvases", tags=["studio/generation-canvases"])
