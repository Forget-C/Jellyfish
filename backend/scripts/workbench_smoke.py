#!/usr/bin/env python
"""资产生产工作台 + 旧提示词排除：**只读**自检脚本（跑在正式库的副本上）。

为什么要有它
============

用户口径：「真实项目（御兽嫡长女 第 1 集）没有接上新资料链路」——11 个资产描述全空、
没有任何已保存提示词、``chapter_asset_profiles`` 0 行，页面却同时显示"可以生成图片"
和"本次未提供生成依据"。这个脚本用一条命令把"工作台现在回报什么、旧提示词会不会
被排除出批量"照实打出来，便于人工核对，不需要起服务、不触网、不花钱。

安全边界（**一个字节都不写正式库**）
==================================

1. 源库**只被复制**：只读打开（``copy`` + ``-wal`` / ``-shm``），不执行任何写语句；
2. 所有动作都跑在 ``tempfile.mkdtemp()`` 新建的副本上；
3. ``--demo-old-prompt`` 会往**副本**里写一条旧空话提示词（演示用），并当场打印
   "源库行数与内容未变"的对照；
4. 不调用任何模型、不出图、不写 OSS。

用法::

    cd backend && .venv/bin/python scripts/workbench_smoke.py \\
        --db /path/to/jellyfish.db \\
        --chapter-id 33696d3f-fbe3-4843-892f-9cd3a01d2062 \\
        --demo-old-prompt --character-name 苏晚棠

退出码：0 成功；2 参数缺失或被安全规则拒绝。
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

#: 只读统计的行数（用于证明源库没被改动）
_COUNT_TABLES = ("characters", "scenes", "props", "costumes", "chapter_asset_profiles")


def _row_counts(db_path: Path) -> dict[str, int]:
    """只读统计业务表行数（打不开的表记为 -1）。"""
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        counts: dict[str, int] = {}
        for name in _COUNT_TABLES:
            try:
                query = f'SELECT COUNT(*) FROM "{name}"'
                counts[name] = int(connection.execute(query).fetchone()[0])
            except sqlite3.Error:
                counts[name] = -1
        return counts
    finally:
        connection.close()


def _copy_source(source: Path) -> Path:
    """把源库（含 -wal/-shm）复制到临时目录；源库始终只被读。"""
    if not source.is_file():
        raise SystemExit(f"[拒绝] 源库不存在：{source}")
    tmpdir = Path(tempfile.mkdtemp(prefix="jellyfish_workbench_smoke_"))
    target = tmpdir / "copy_of_source.db"
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(source) + suffix)
        if candidate.is_file():
            shutil.copy(candidate, Path(str(target) + suffix))
    if target.parent != tmpdir:  # 兜底：所有写入都必须落在这个临时目录里
        raise SystemExit("[拒绝] 副本不在临时目录里，已中止。")
    return target


async def _run(args: argparse.Namespace, copy_path: Path) -> dict[str, object]:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.services.studio.asset_workbench import build_chapter_asset_workbench

    engine = create_async_engine(f"sqlite+aiosqlite:///{copy_path}", future=True)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    output: dict[str, object] = {}
    try:
        async with maker() as db:
            workbench = await build_chapter_asset_workbench(db, chapter_id=args.chapter_id)
        output["analysis"] = workbench["analysis"]
        output["summary"] = workbench["summary"]
        output["items_head"] = [
            {
                "asset_type": item["asset_type"],
                "asset_id": item["asset_id"],
                "name": item["name"],
                "profile_source": item["profile_source"],
                "prompt_slot": item["prompt"]["slot"],
                "prompt_text_chars": len(item["prompt"]["text"]),
                "prompt_quality": item["prompt"]["quality"]["verdict"],
                "status": item["status"]["key"],
                "batch_eligible": item["batch_eligible"],
            }
            for item in workbench["items"][:3]
        ]
        output["pending_review_total"] = len(workbench["pending_review"])
        output["pending_review_head"] = workbench["pending_review"][:2]
        output["technical"] = {
            key: value
            for key, value in workbench["technical"].items()
            if key != "match_diagnostics"
        }

        if args.demo_old_prompt:
            output["demo"] = await _demo_old_prompt(args, maker, workbench)
    finally:
        await engine.dispose()
    return output


async def _demo_old_prompt(
    args: argparse.Namespace,
    maker: object,
    workbench: dict[str, object],
) -> dict[str, object]:
    """只在**副本**里写一条旧空话提示词，演示"重新判定 + 排除出批量"。"""
    from sqlalchemy import text

    items = workbench["items"]  # type: ignore[index]
    wanted = str(args.character_name or "")
    target = next(
        (item for item in items if item["name"] == wanted),  # type: ignore[index]
        None,
    )
    if target is None or not target["asset_id"]:
        return {"skipped": f"副本里没有找到角色「{wanted}」的真实资产，跳过演示。"}

    slot_label = str(target["prompt"]["slot_label"] or target["prompt"]["slot"])
    old_prompt = f"{wanted}（角色）：外观信息不足，需人工补充，{slot_label}展示，高清写实"
    async with maker() as db:  # type: ignore[operator]
        await db.execute(
            text("UPDATE characters SET image_prompts = :prompts WHERE id = :asset_id"),
            {
                "prompts": json.dumps({target["prompt"]["slot"]: old_prompt}, ensure_ascii=False),
                "asset_id": target["asset_id"],
            },
        )
        await db.commit()

    from app.services.studio.asset_workbench import build_chapter_asset_workbench
    from app.services.studio.image_pipeline.image_pipeline import build_targets

    async with maker() as db:  # type: ignore[operator]
        after = await build_chapter_asset_workbench(db, chapter_id=args.chapter_id)
        judged = next(item for item in after["items"] if item["name"] == wanted)
        char_ids = [
            item["asset_id"] for item in after["items"] if item["asset_type"] == "character"
        ]
        targets, warnings = await build_targets(
            db,
            project_id=str(after["project_id"]),
            asset_type="character",
            stage="character_sheet",
            asset_ids=char_ids,
        )
    return {
        "injected_prompt": old_prompt,
        "workbench_verdict": judged["prompt"]["quality"],
        "workbench_status": judged["status"],
        "workbench_batch_eligible": judged["batch_eligible"],
        "plan_target_names": [target.name for target in targets],
        "plan_excluded_warnings": [w for w in warnings if "排除" in w],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="资产生产工作台只读自检（跑在副本上）")
    parser.add_argument("--db", required=True, help="源库路径（只读复制，不会被改动）")
    parser.add_argument("--chapter-id", required=True, help="要检查的章节 ID")
    parser.add_argument("--character-name", default="", help="演示用的角色名（默认取第一个角色）")
    parser.add_argument(
        "--demo-old-prompt",
        action="store_true",
        help="在**副本**里写一条旧空话提示词，演示质量重判与批量排除",
    )
    parser.add_argument("--json", action="store_true", help="额外打印完整 JSON")
    args = parser.parse_args()

    source = Path(args.db).expanduser().resolve()
    before = _row_counts(source)
    copy_path = _copy_source(source)

    output = asyncio.run(_run(args, copy_path))
    after = _row_counts(source)

    print("== 工作台 ==")
    print(json.dumps(output, ensure_ascii=False, indent=1))
    print("== 源库只读校验 ==")
    print("源库行数（前 / 后）：", before, after)
    print("源库未被改动：", before == after)
    if args.json:
        print("== 副本路径（可自行删除）==", copy_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
