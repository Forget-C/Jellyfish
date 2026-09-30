#!/usr/bin/env python3
"""显式接入指定项目划分历史；默认演练回滚，--apply 才提交。"""

import argparse
import asyncio
import json

from sqlalchemy import select, text

from app.core.db import async_session_maker, engine
from app.models.studio import Chapter
from app.services.directing.division_import import DivisionImportService


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-id', required=True)
    parser.add_argument('--chapter-id')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    engine.echo = False
    try:
        async with async_session_maker() as db:
            query = select(Chapter.id).where(Chapter.project_id == args.project_id).order_by(Chapter.id)
            if args.chapter_id:
                query = query.where(Chapter.id == args.chapter_id)
            chapters = list(await db.scalars(query))
        if not chapters:
            raise ValueError('没有找到指定项目下的章节')
        for chapter_id in chapters:
            async with async_session_maker() as db:
                if db.bind.dialect.name == 'sqlite':
                    # legacy SQLite 驱动的 SELECT 不开启事务，避免演练保存点被隐式提交。
                    await db.execute(text('BEGIN'))
                result = await DivisionImportService(db, args.project_id).import_history(chapter_id)
                if args.apply:
                    await db.commit()
                else:
                    await db.rollback()
                print(json.dumps({'chapter_id': chapter_id, 'applied': args.apply, **result}, ensure_ascii=False))
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
