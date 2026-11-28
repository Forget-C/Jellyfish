"""Fault injection at the public HTTP response boundary of the real app."""

import asyncio
import os
from pathlib import Path

from app.main import app as product_app


async def app(scope, receive, send):
    """Drop a selected approval response after its request transaction completes."""
    if scope['type'] != 'http' or (b'x-test-drop-receipt', b'1') not in scope['headers']:
        return await product_app(scope, receive, send)

    async def discard(_message):
        pass

    await product_app(scope, receive, discard)
    Path(os.environ['ASSISTANT_APPROVAL_COMMITTED_MARKER']).touch()
    await asyncio.Event().wait()
