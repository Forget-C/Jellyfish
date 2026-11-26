"""Studio 模块路由聚合（按子模块拆分，避免单文件过大）。"""

from fastapi import APIRouter

from app.api.v1.routes.studio import (
    chapters,
    chat_sessions,
    session_transport,
    text_trials,
    generation_canvases,
    directing,
    entities,
    experiment_sessions,
    files,
    home,
    generation_tasks,
    lab_chat,
    generation_prompts,
    projects,
    prompts,
    project_assets,
)

router = APIRouter()

router.include_router(directing.router)
router.include_router(lab_chat.router, prefix="/chat/sessions/lab", tags=["chat"])
router.include_router(text_trials.router, prefix="/chat/sessions/text", tags=["chat"])
router.include_router(session_transport.router, prefix="/chat/sessions", tags=["chat"])
router.include_router(chat_sessions.router, prefix="/chat/sessions", tags=["chat"])

router.include_router(projects.router, prefix="/projects", tags=["studio/projects"])
router.include_router(chapters.router, prefix="/chapters", tags=["studio/chapters"])

router.include_router(project_assets.router, prefix="/project-assets", tags=["studio/project-assets"])

router.include_router(entities.router, prefix="/entities", tags=["studio/entities"])
router.include_router(prompts.router, prefix="/prompts", tags=["studio/prompts"])
router.include_router(experiment_sessions.router, prefix="/experiment-sessions", tags=["studio/experiment-sessions"])
router.include_router(files.router, prefix="/files", tags=["studio/files"])
router.include_router(generation_prompts.router, prefix="/generation-prompts", tags=["studio/generation-prompts"])
router.include_router(generation_tasks.router, prefix="/generation-tasks", tags=["studio/generation-tasks"])

router.include_router(generation_canvases.router, prefix="/generation-canvases", tags=["studio/generation-canvases"])
router.include_router(home.router, prefix="/home", tags=["studio/home"])
