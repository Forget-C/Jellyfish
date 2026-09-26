"""验收章节搭建：建一个**独立的**项目/章节/分镜，不碰任何已有章节的数据。

为什么要有这个脚本
==================

真实大模型调用（用户授权 5 次）必须在**独立验收章节**上跑，避免污染已有数据。
本脚本只做**零 LLM、零出图、零 OSS** 的建表写入：

- 新建一个项目（``--project-id`` 默认 ``accept-<时间戳>``）；
- 新建一个章节（``--chapter-id`` 同上前缀）；
- 新建 3 个镜头，``script_excerpt`` 覆盖"2 角色 + 1 场景 + 1 道具"；
- **不种子候选**：`/script-processing/extract` 本身要真实调大模型，
  而本次授权的第 1 次调用是"整章剧本分析"（``asset-profiles``），
  所以候选留空由它产出（``--seed-candidates`` 可选，用于离线自检，默认关闭）。

跑法（**由用户下令后才执行**）::

    cd backend
    .venv/bin/python scripts/acceptance_chapter_setup.py            # 建章节
    .venv/bin/python scripts/acceptance_chapter_setup.py --print-only  # 只打印计划，不写库

脚本幂等：同一 ``--project-id`` 已存在时**不会重复建**，并如实回报。
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as _dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

#: 验收剧本：2 个角色 + 1 个场景 + 1 个道具，且每个资产名都落在某条镜头摘录里
#: （这样"出场依据"是 shot 级证据，而不是 chapter_only 兜底）。
ACCEPTANCE_SCRIPT = """\
第一场 夜 内 听雨轩
秋雨敲瓦，听雨轩四面花窗半开，青铜烛台上的烛火被穿堂风吹得摇晃。
姜岁欢跪在听雨轩冰冷的青砖地上，素白襦裙下摆沾了雨水。
秦老夫人拄着乌木拐杖立在堂前，凤纹织金褙子一丝不苟。
秦老夫人：把嫁妆单子交出来。
姜岁欢把镶银匕首藏在袖中，指尖发抖，却一字不答。
"""

ACCEPTANCE_SHOTS: tuple[tuple[int, str, str], ...] = (
    (1, "夜雨听雨轩", "秋雨敲瓦，听雨轩四面花窗半开；姜岁欢与秦老夫人隔着一盏青铜烛台对峙。"),
    (2, "跪地藏刃", "姜岁欢跪在听雨轩冰冷的青砖地上，素白襦裙下摆沾了雨水，把镶银匕首藏在袖中。"),
    (3, "老夫人逼问", "秦老夫人拄着乌木拐杖立在听雨轩堂前，凤纹织金褙子一丝不苟：把嫁妆单子交出来。"),
)


async def _run(*, project_id: str, chapter_id: str, seed_candidates: bool, print_only: bool) -> int:
    from app.core.db import Base, async_session_maker  # noqa: F401 - Base 触发模型注册
    from app.models.studio import Chapter, Project, Shot
    from app.models.types import ShotCandidateType

    plan = {
        "project_id": project_id,
        "chapter_id": chapter_id,
        "script_chars": len(ACCEPTANCE_SCRIPT),
        "shots": [{"index": index, "title": title} for index, title, _ in ACCEPTANCE_SHOTS],
        "seed_candidates": seed_candidates,
    }
    print("[验收章节搭建] 计划：")
    for key, value in plan.items():
        print(f"  {key}: {value}")
    if print_only:
        print("[验收章节搭建] --print-only：未写库。")
        return 0

    async with async_session_maker() as db:
        if await db.get(Project, project_id) is not None:
            print(f"[验收章节搭建] 项目 {project_id} 已存在 → 不重复建（幂等）。")
            return 0
        db.add(
            Project(
                id=project_id,
                name=f"验收项目（{project_id}）",
                description="真实大模型调用验收专用；独立于任何已有章节。",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        db.add(
            Chapter(
                id=chapter_id,
                project_id=project_id,
                index=1,
                title="验收集",
                summary="真实调用验收",
                raw_text=ACCEPTANCE_SCRIPT,
                condensed_text=ACCEPTANCE_SCRIPT,
            )
        )
        await db.flush()
        for index, title, excerpt in ACCEPTANCE_SHOTS:
            db.add(
                Shot(
                    id=f"{chapter_id}-shot-{index}",
                    chapter_id=chapter_id,
                    index=index,
                    title=title,
                    script_excerpt=excerpt,
                )
            )
        await db.flush()

        if seed_candidates:
            # 离线自检用：按"每个镜头里出现的名字"确定性造候选（**不调大模型**）。
            from app.services.studio.shot_extracted_candidates import replace_for_shot

            names_by_shot = {
                1: [(ShotCandidateType.scene, "听雨轩"), (ShotCandidateType.prop, "青铜烛台")],
                2: [
                    (ShotCandidateType.character, "姜岁欢"),
                    (ShotCandidateType.scene, "听雨轩"),
                    (ShotCandidateType.prop, "镶银匕首"),
                    (ShotCandidateType.costume, "素白襦裙"),
                ],
                3: [
                    (ShotCandidateType.character, "秦老夫人"),
                    (ShotCandidateType.scene, "听雨轩"),
                    (ShotCandidateType.prop, "乌木拐杖"),
                ],
            }
            for index, candidates in names_by_shot.items():
                await replace_for_shot(
                    db,
                    shot_id=f"{chapter_id}-shot-{index}",
                    candidates=[
                        {"candidate_type": kind.value, "candidate_name": name, "payload": {}}
                        for kind, name in candidates
                    ],
                )
        await db.commit()

    print(f"[验收章节搭建] 完成：project={project_id} chapter={chapter_id} shots={len(ACCEPTANCE_SHOTS)}")
    print("[验收章节搭建] 下一步（等你下令）：scripts/acceptance_real_llm_run.py")
    return 0


def main(argv: list[str] | None = None) -> int:
    stamp = _dt.datetime.now().strftime("%Y%m%d%H%M%S")
    parser = argparse.ArgumentParser(description="建一个独立验收章节（零 LLM 调用）")
    parser.add_argument("--project-id", default=f"accept-{stamp}")
    parser.add_argument("--chapter-id", default=f"accept-{stamp}-ep1")
    parser.add_argument("--seed-candidates", action="store_true", help="离线自检用：确定性造候选（默认关闭）")
    parser.add_argument("--print-only", action="store_true", help="只打印计划，不写库")
    args = parser.parse_args(argv)
    return asyncio.run(
        _run(
            project_id=args.project_id,
            chapter_id=args.chapter_id,
            seed_candidates=args.seed_candidates,
            print_only=args.print_only,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
