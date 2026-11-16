"""预检或按精确审批计划转换场次单图选用；默认只读，不删除文件。"""
import argparse
import asyncio
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.models.directing import Sequence
from app.models.studio import FileUsage
from app.services.studio.object_selection_conversion import apply_plan, preflight


def private_json(path, value):
    """维护报告和恢复资料可能包含身份或正文，只写新建的私有文件。"""
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2,
            default=lambda item: item.isoformat() if isinstance(item, datetime) else str(item))
        stream.write('\n')


async def run(args):
    """只读报告可供审批，执行须提供不变的计划摘要及私有备份路径。"""
    from app.config import settings  # pylint: disable=import-outside-toplevel
    engine = create_async_engine(args.database_url or settings.database_url)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        if args.apply:
            if not args.plan or not args.expected_sha256 or not args.backup:
                raise ValueError('执行必须提供 --plan、--expected-sha256 和 --backup')
            content = Path(args.plan).read_bytes()
            if hashlib.sha256(content).hexdigest() != args.expected_sha256:
                raise ValueError('审批计划摘要不一致')
            plan = json.loads(content)
            if Path(args.output).exists():
                raise ValueError('结果输出文件已存在，请使用新路径')
            async with sessions.begin() as db:
                # 执行函数再次锁定、核对所有计划身份；备份写失败不执行任何修改。
                rows = list(await db.scalars(select(Sequence).where(Sequence.id.in_(
                    [item['sequence_id'] for item in plan['sequences']])).with_for_update()))
                usages = list(await db.scalars(select(FileUsage).where(FileUsage.id.in_(plan['release_usages']))))
                private_json(args.backup, {'preparations': {row.id: row.object_preparation for row in rows},
                    'released_usages': [{column.name: getattr(usage, column.name) for column in FileUsage.__table__.columns}
                        for usage in usages],
                    'plan': plan, 'plan_sha256': args.expected_sha256})
                result = await apply_plan(db, plan)
            private_json(args.output, result)
        else:
            async with sessions() as db:
                if engine.dialect.name == 'mysql':
                    await db.execute(text('SET TRANSACTION READ ONLY'))
                elif engine.dialect.name == 'sqlite':
                    await db.execute(text('PRAGMA query_only=ON'))
                result = await preflight(db)
                await db.rollback()
            private_json(args.output, result)
        print(json.dumps({'output': args.output, 'sequence_count': len(result.get('sequences', []))
            if isinstance(result.get('sequences'), list) else result.get('sequences', 0),
            'applied': args.apply}, ensure_ascii=False))
    finally:
        await engine.dispose()


def main():
    """明确区分只读预检和审批后的转换，禁止自动扩展清理范围。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database-url', help='隔离测试数据库；默认应用配置')
    parser.add_argument('--output', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--plan')
    parser.add_argument('--expected-sha256')
    parser.add_argument('--backup')
    asyncio.run(run(parser.parse_args()))


if __name__ == '__main__':
    main()
