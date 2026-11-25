"""Temporary credentials for the single-user app's MCP connection."""
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from hmac import compare_digest
from secrets import token_urlsafe

from app.config import settings


MCP_PATH = '/mcp'
CONNECTION_LIFETIME = timedelta(hours=8)


@dataclass(frozen=True)
class IssuedCredential:
    credential: str
    expires_at: datetime


@dataclass(frozen=True)
class _ActiveConnection:
    digest: bytes
    expires_at: datetime


class CanvasMcpConnectionState:
    """Keep the active credential digest in the API process."""

    def __init__(self):
        self._active: _ActiveConnection | None = None

    def _current(self) -> _ActiveConnection | None:
        if self._active is not None and self._active.expires_at <= datetime.now(UTC):
            self._active = None
        return self._active

    def expires_at(self) -> datetime | None:
        active = self._current()
        return active.expires_at if active else None

    def issue(self) -> IssuedCredential:
        """Rotate the credential and return its plaintext once."""
        credential = token_urlsafe(32)
        expires_at = datetime.now(UTC) + CONNECTION_LIFETIME
        self._active = _ActiveConnection(sha256(credential.encode()).digest(), expires_at)
        return IssuedCredential(credential, expires_at)

    def close(self) -> None:
        self._active = None

    def accepts(self, credential: str) -> bool:
        active = self._current()
        return active is not None and compare_digest(active.digest, sha256(credential.encode()).digest())


connection_state = CanvasMcpConnectionState()


def allows_origin(origin: str | None) -> bool:
    """Allow only explicit deployment origins for browser requests."""
    return origin is not None and origin != '*' and origin in settings.cors_origins_list
