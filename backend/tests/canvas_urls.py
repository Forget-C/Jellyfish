"""Canonical scoped URLs and scene fixtures for shared canvas HTTP tests."""
from urllib.parse import parse_qsl, urlencode, urlsplit
from uuid import uuid4
from app.models.generation_canvas import GenerationCanvas
from app.schemas.generation_canvas import CanvasDocument


class CanvasURL(str):
    """Append a resource suffix before the project query, like a normal URL builder."""
    def __add__(self, suffix):
        parts = urlsplit(self)
        if not suffix.startswith(('?', '&')):
            return CanvasURL(parts.path + suffix + ('?' + parts.query if parts.query else ''))
        return CanvasURL(super().__add__(suffix))


def canvas_url(value):
    """Replace project path scope with the explicit project query parameter."""
    prefix = '/api/v1/studio/generation-canvases' if value.startswith('/api/') else '/canvases'
    rest = value[len(prefix):].lstrip('/').split('/', 1)
    project = rest[0]
    if not project:
        return value
    path = prefix + ('/' + rest[1] if len(rest) > 1 else '')
    return CanvasURL(path + ('&' if '?' in path else '?') + urlencode({'project_id': project}))


async def seed_scene_canvas(client, scope, *, json):
    """Set up a scene-owned document; assertions still read/save/run via real HTTP."""
    project_id = scope.rsplit('/', 1)[-1]
    canvas_id = uuid4().hex
    document = CanvasDocument(id=canvas_id, project_id=project_id, name=json.get('name', '未命名画布'))
    async with client.canvas_sessions.begin() as db:
        db.add(GenerationCanvas(id=canvas_id, project_id=project_id, kind='scene', document=document.model_dump()))
        from app.models.generation_canvas import CanvasEventHead
        await db.flush()
        db.add(CanvasEventHead(canvas_id=canvas_id))
    return await client.get(canvas_url(scope + '/' + canvas_id))


def canvas_params(value):
    """HTTPX explicit params replace URL queries; retain the caller's scope."""
    return dict(parse_qsl(urlsplit(str(value)).query))


def append_canvas_path(value, suffix):
    """Append a resource suffix while preserving scoped canvas queries."""
    return value + suffix if isinstance(value, CanvasURL) else str(value) + suffix
