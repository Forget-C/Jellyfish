"""Expose the scene storyboard protocol to MCP clients."""

from contextlib import asynccontextmanager

from fastapi import HTTPException
from mcp.server.fastmcp import FastMCP

from app.canvas_mcp.tools import CanvasReadWithRef, CanvasRef, Identity, canvas_read_result, canvas_session
from app.core.contracts.directing.scene_storyboard import (
    StoryboardApplication, StoryboardBasis, StoryboardCheckRequest, StoryboardDiff, StoryboardReextractRequest,
    StoryboardRequest, StoryboardRestore, StoryboardRetry, StoryboardRetryBasis, StoryboardTaskRead,
    StoryboardTaskSummary,
)
from app.services.directing.store import RevisionConflict
from app.services.generation_canvas.edits import scene_storyboard_edits
from app.services.generation_canvas.generation_inputs import storyboard_generation_inputs
from app.services.generation_canvas.runs import storyboard_runs


class SceneCanvasRef(CanvasRef):
    """A scene storyboard canvas always belongs to a project."""

    project_id: Identity


class SubmittedStoryboard(StoryboardTaskRead):
    """A submitted storyboard and its newly created canvas reference."""

    canvas_ref: SceneCanvasRef


@asynccontextmanager
async def _storyboard_session():
    """Preserve the same validation and conflict distinctions as the scene HTTP routes."""
    async with canvas_session() as db:
        try:
            yield db
        except RevisionConflict as error:
            raise HTTPException(409, str(error)) from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error


def register(server: FastMCP) -> None:
    """Register scene-scoped storyboard operations."""

    @server.tool()
    async def scene_storyboard_basis(project_id: Identity, chapter_id: Identity, sequence_id: Identity) -> StoryboardBasis:
        """Read the confirmed scene source and object references for storyboard extraction."""
        async with _storyboard_session() as db:
            return await storyboard_generation_inputs(db, project_id).read_storyboard_basis(chapter_id, sequence_id)

    @server.tool()
    async def scene_storyboard_submit(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, body: StoryboardRequest,
    ) -> SubmittedStoryboard:
        """Create a storyboard canvas and submit a storyboard extraction from the scene."""
        async with _storyboard_session() as db:
            task = await storyboard_runs(db, project_id).submit_storyboard(chapter_id, sequence_id, body)
        return SubmittedStoryboard(**task.model_dump(), canvas_ref=SceneCanvasRef(
            canvas_id=task.canvas_id, project_id=project_id,
        ))

    @server.tool()
    async def scene_storyboard_list(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, canvas_id: Identity | None = None,
    ) -> list[StoryboardTaskSummary]:
        """List recent extraction tasks in the scene, optionally for one canvas in that scene."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, project_id).list_storyboards(chapter_id, sequence_id, canvas_id)

    @server.tool()
    async def scene_storyboard_read(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, task_id: Identity,
    ) -> StoryboardTaskRead:
        """Read one scene storyboard task, including its candidate and application state."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, project_id).read_storyboard(chapter_id, sequence_id, task_id)

    @server.tool()
    async def scene_storyboard_reextract(
        canvas_ref: SceneCanvasRef, chapter_id: Identity, sequence_id: Identity, body: StoryboardReextractRequest,
    ) -> StoryboardTaskRead:
        """Submit a new extraction against an existing scene canvas and its selected source."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, canvas_ref.project_id).reextract_storyboard(
                chapter_id, sequence_id, canvas_ref.canvas_id, body,
            )

    @server.tool()
    async def scene_storyboard_retry_basis(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, task_id: Identity,
    ) -> StoryboardRetryBasis:
        """Read the source, object references and configuration that a task retry would use."""
        async with _storyboard_session() as db:
            return await storyboard_generation_inputs(db, project_id).read_storyboard_retry_basis(
                chapter_id, sequence_id, task_id,
            )

    @server.tool()
    async def scene_storyboard_retry(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, task_id: Identity, body: StoryboardRetry,
    ) -> StoryboardTaskRead:
        """Retry a storyboard task or request a follow-up repair or review on the original canvas."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, project_id).retry_storyboard(chapter_id, sequence_id, task_id, body)

    @server.tool()
    async def scene_storyboard_candidate(
        canvas_ref: SceneCanvasRef, chapter_id: Identity, sequence_id: Identity, task_id: Identity | None = None,
    ) -> StoryboardTaskRead | None:
        """Read the latest successful candidate for a scene canvas or find a specified task's candidate."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, canvas_ref.project_id).read_canvas_candidate(
                chapter_id, sequence_id, canvas_ref.canvas_id, task_id,
            )

    @server.tool()
    async def scene_storyboard_preview_application(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, task_id: Identity,
        body: StoryboardApplication,
    ) -> StoryboardDiff:
        """Preview the actual additions, changes, removals and retained impacts before adopting a candidate."""
        async with _storyboard_session() as db:
            return await scene_storyboard_edits(db, project_id).apply_storyboard(
                chapter_id, sequence_id, task_id, body, preview=True,
            )

    @server.tool()
    async def scene_storyboard_apply(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, task_id: Identity,
        body: StoryboardApplication,
    ) -> CanvasReadWithRef:
        """Adopt the candidate for the reviewed canvas revision and return the saved document."""
        async with _storyboard_session() as db:
            canvas = await scene_storyboard_edits(db, project_id).apply_storyboard(
                chapter_id, sequence_id, task_id, body,
            )
        return canvas_read_result(canvas)

    @server.tool()
    async def scene_storyboard_restore(
        project_id: Identity, chapter_id: Identity, sequence_id: Identity, task_id: Identity, body: StoryboardRestore,
    ) -> CanvasReadWithRef:
        """Undo or redo the storyboard adoption against its original application receipt."""
        async with _storyboard_session() as db:
            canvas = await scene_storyboard_edits(db, project_id).restore_storyboard(
                chapter_id, sequence_id, task_id, body,
            )
        return canvas_read_result(canvas)

    @server.tool()
    async def scene_storyboard_check_read(
        canvas_ref: SceneCanvasRef, chapter_id: Identity, sequence_id: Identity,
    ) -> StoryboardTaskRead | None:
        """Read the latest explicit continuity check for the saved storyboard."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, canvas_ref.project_id).saved_check(
                chapter_id, sequence_id, canvas_ref.canvas_id,
            )

    @server.tool()
    async def scene_storyboard_check_submit(
        canvas_ref: SceneCanvasRef, chapter_id: Identity, sequence_id: Identity, body: StoryboardCheckRequest,
    ) -> StoryboardTaskRead:
        """Submit a continuity check of one saved storyboard revision."""
        async with _storyboard_session() as db:
            return await storyboard_runs(db, canvas_ref.project_id).saved_check(
                chapter_id, sequence_id, canvas_ref.canvas_id, body,
            )
