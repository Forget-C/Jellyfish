#!/usr/bin/env python3
"""剧情策划的**真实 1 次调用**验收（会花钱，必须显式下令后才执行）。

与 ``acceptance_real_llm_run.py`` 同一套纪律（那支是 4 个编排预览的验收，上限 5 次）：

- **硬上限 1 次调用**（``MAX_CALLS = 1``），**无重试**：截断/解析失败就如实失败，不偷偷再来一次；
- **不写库**：``preview_drama_plan`` 本身只在内存里产出草稿，本脚本不落任何行
  （章节、分镜、资产、草稿表都不动）；
- ``--print-plan`` 只打印"本来要发给哪个模型、提示词多少字"，**一次调用都不发**；
- 真实模式必须由调用方在**命令行**上显式打开（不是脚本里偷偷设）：
  进程启动时就要带上 ``JELLYFISH_DRY_RUN=0`` 且 ``JELLYFISH_REAL_LLM_CONFIRMED=1``，
  这样"关闸"这件事在外层命令里一眼可见、可审计。

用法：

    # 1) 先看不花钱的计划（模型、提示词字数、brief）
    cd backend && uv run python scripts/acceptance_drama_plan_real_run.py --print-plan \\
        --chapter-id <章节ID> --product-name 紧致焕颜精华

    # 2) 用户下令后，才跑真实那一次
    cd backend && JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1 \\
        uv run python scripts/acceptance_drama_plan_real_run.py \\
        --chapter-id <章节ID> --product-name 紧致焕颜精华 \\
        --selling-points 三秒吸收 --selling-points 孕妇可用 --shot-count 6
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

#: 本脚本的调用上限（改这个数字要连同测试一起改，见 tests/test_acceptance_runner_guard.py 的先例）
MAX_CALLS = 1


def _brief_from_args(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "product_name": args.product_name,
        "product_description": args.product_description,
        "selling_points": list(args.selling_points or []),
        "target_audience": args.target_audience,
        "genre": args.genre,
        "tone": args.tone,
        "duration_seconds": args.duration_seconds,
        "shot_count": args.shot_count,
        "brand_voice": args.brand_voice,
        "director_notes": args.director_notes,
    }


async def _print_plan(chapter_id: str, brief: dict[str, Any]) -> int:
    """只打印计划：不调用模型。"""
    from app.models.studio import Chapter
    from app.core.db import async_session_maker
    from app.services.studio.llm_orchestration import dry_run
    from app.services.studio.llm_orchestration.client import resolve_text_llm_target
    from app.services.studio.llm_orchestration.drama_plan import build_drama_plan_prompt

    async with async_session_maker() as db:
        chapter = await db.get(Chapter, chapter_id)
        if chapter is None:
            print(f"✗ 章节不存在：{chapter_id}", file=sys.stderr)
            return 1
        try:
            target = await resolve_text_llm_target(db)
            target_desc = f"{target.provider_name} / {target.model_name}（base_url={target.base_url}）"
            max_tokens = target.max_tokens
        except Exception as exc:  # noqa: BLE001 - 只读预览：解析不到就如实说
            target_desc = f"（解析失败：{exc}）"
            max_tokens = "?"
        prompt = build_drama_plan_prompt(
            brief=brief,
            chapter_title=chapter.title,
            chapter_text=chapter.raw_text or chapter.condensed_text,
            shot_count=int(brief.get("shot_count") or 6),
            duration_hint=int(brief.get("duration_seconds") or 0),
            style_hint=" / ".join(item for item in (brief.get("genre") or "", brief.get("tone") or "") if item),
        )

    print("=== 计划（本次 --print-plan 不会调用任何模型）===")
    print(f"章节：{chapter_id}｜{chapter.title}")
    print(f"目标模型：{target_desc}")
    print(f"max_tokens：{max_tokens}")
    print(f"提示词长度：{len(prompt)} 字")
    print(f"本次调用上限：{MAX_CALLS} 次（无重试）")
    print(f"当前模式：{dry_run.mode()}（dry_run={dry_run.dry_run_enabled()}）")
    print("brief：")
    print(json.dumps(brief, ensure_ascii=False, indent=2))
    return 0


async def _run_real_call(chapter_id: str, brief: dict[str, Any]) -> int:
    """真实那一次调用：调用上限 1，失败即如实退出（不重试）。"""
    from app.services.studio.llm_orchestration import dry_run
    from app.services.studio.llm_orchestration.drama_plan import preview_drama_plan

    if dry_run.dry_run_enabled():
        print(
            "✗ 当前是演练模式：本脚本不会替你关闸。\n"
            "  请显式带 JELLYFISH_DRY_RUN=0 与 JELLYFISH_REAL_LLM_CONFIRMED=1 再跑。",
            file=sys.stderr,
        )
        return 1

    from app.core.db import async_session_maker

    async with async_session_maker() as db:
        result = await preview_drama_plan(db, chapter_id=chapter_id, brief=brief)

    plan = result.get("plan")
    meta = result.get("meta")
    print("=== 真实调用结果（本脚本不写库：章节/分镜/资产/草稿表都没有变化）===")
    print(f"模型元信息：{json.dumps(meta.model_dump() if hasattr(meta, 'model_dump') else meta, ensure_ascii=False, indent=2)}")
    if plan is None:
        print("✗ 没有产出草稿。")
        print("警告：" + "；".join(result.get("warnings") or []))
        return 1
    print("草稿（归一化后）：")
    print(json.dumps(plan, ensure_ascii=False, indent=2))
    warnings = plan.get("warnings") or []
    if warnings:
        print("归一化警告：")
        for item in warnings:
            print(f"  · {item}")
    print(f"镜头数：{len(plan.get('shots') or [])}")
    print(f"出现商品的镜头：{sum(1 for shot in plan.get('shots') or [] if shot.get('product_present'))}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="剧情策划真实 1 次调用验收（会花钱）")
    parser.add_argument("--chapter-id", required=True, help="用哪一集的上下文（**只读**，不会被修改）")
    parser.add_argument("--product-name", required=True)
    parser.add_argument("--product-description", default="")
    parser.add_argument("--selling-points", action="append", default=[])
    parser.add_argument("--target-audience", default="")
    parser.add_argument("--genre", default="")
    parser.add_argument("--tone", default="")
    parser.add_argument("--brand-voice", default="")
    parser.add_argument("--director-notes", default="")
    parser.add_argument("--duration-seconds", type=int, default=0)
    parser.add_argument("--shot-count", type=int, default=6)
    parser.add_argument("--print-plan", action="store_true", help="只打印计划，不调用模型（免费）")
    args = parser.parse_args()

    brief = _brief_from_args(args)
    if args.print_plan:
        return asyncio.run(_print_plan(args.chapter_id, brief))
    return asyncio.run(_run_real_call(args.chapter_id, brief))


if __name__ == "__main__":
    raise SystemExit(main())
