"""统一生成的执行期媒体解析能力。"""

from app.services.generation.files.resolver import FileResolutionError, FileResolver
from app.services.generation.files.types import ResolvedMediaContent, ResolvedMediaSnapshot

__all__ = [
    "FileResolutionError",
    "FileResolver",
    "ResolvedMediaContent",
    "ResolvedMediaSnapshot",
]
