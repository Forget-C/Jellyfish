"""Keep admitted turns running independently of the HTTP request."""
import asyncio
from hashlib import sha256
import json
import logging

from sqlalchemy.ext.asyncio import async_sessionmaker

logger = logging.getLogger(__name__)
_running = set()


def command_digest(command):
    """Fingerprint normalized client input independently from server model and context choices."""
    value = json.dumps(command.model_dump(mode='json'), sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return sha256(value.encode()).hexdigest()


async def admit_turn(bind, execute):
    """Wait for validation and committed admission, leaving execution in its own session."""
    admitted = asyncio.get_running_loop().create_future()

    def accept(cursor=None):
        if not admitted.done():
            admitted.set_result(cursor)

    async def run():
        try:
            async with async_sessionmaker(bind, expire_on_commit=False)() as db:
                await execute(db, accept)
                await db.commit()
            accept()
        except asyncio.CancelledError:
            admitted.cancel()
            raise
        except Exception as error:
            if not admitted.done():
                admitted.set_exception(error)
            else:
                logger.exception('Admitted chat turn ended with an error')

    task = asyncio.create_task(run())
    _running.add(task)
    task.add_done_callback(_running.discard)
    return await admitted
