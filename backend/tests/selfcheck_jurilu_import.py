#!/usr/bin/env python3
"""巨日禄导入端到端自检（在**真实库的临时副本**上跑，真库零风险）。

覆盖：
  1. 抓取层被桩替换后，预览能否产出正确配对计划（真库副本，只读章节镜头）；
  2. 提交能否真的把 video_prompt / video_prompt_source 写进去；
  3. 重复提交是否幂等（第二次判 unchanged，不再写）；
  4. 已存在不同提示词时是否拒绝覆盖，开 overwrite 才覆盖；
  5. 分镜多于镜头时是否新建镜头；
  6. **单数语义**：没选组 → 不匹配；恰好选一组 → 只匹配该组；选两组 → 400 级报错；
  7. 抓取失败时是否明确报错；
  8. **真库文件指纹全程未变**（证明没有误写源库）。

库怎么选：优先 ``JELLYFISH_SELFCHECK_DB``，其次 ``DATABASE_URL`` 里的 sqlite 路径，
最后回退 ``backend/jellyfish.db``（见 ``tests/selfcheck_db.py``）；库不可用会明确跳过。

跑法（需提权，沙箱会杀 sqlalchemy）：
    cd /Users/apple/Documents/Jellyfish/backend
    JELLYFISH_CELERY_EAGER=1 .venv/bin/python tests/selfcheck_jurilu_import.py
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("JELLYFISH_CELERY_EAGER", "1")

from tests.selfcheck_db import resolve_db_path, skip_note, unusable_reason  # noqa: E402

#: 自检用的脚本组（新契约：一次只能导入**一个**脚本组）
SCRIPT_ID = "SC1"
REAL_DB = resolve_db_path(BACKEND)

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def fingerprint(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


# --- 桩：伪造巨日禄抓取结果（不发任何网络请求） -------------------------

def make_agents(labels_and_texts, script_id: str = SCRIPT_ID):
    """伪造**抓取层**的输出。

    必须带 ``source_script_id``：分组/过滤都靠它，少了它分镜会因为
    「归属不明」被 fail-closed 丢掉（这正是新契约想要的行为）。
    """
    return [
        {
            "agent_name": label,
            "prompt_text": text,
            "shot_summary": f"{label} 的画面摘要",
            "duration": "5",
            "aspectRatio": "9:16",
            "resolution": "720p",
            "modelName": "巨日禄 Agent",
            "agent_id": f"agent-{i}",
            "sbid": label,
            "seqNum": str(i),
            "source_script_id": script_id,
            "source_script_title": "第一集",
            "source_script_index": 1,
            "source_url": "https://www.jurilu.com/x?projectId=P&clipId=C",
            "fetched_at": "2026-09-17T17:00:00",
            "raw_data": "{}",
        }
        for i, (label, text) in enumerate(labels_and_texts, start=1)
    ]


FIXTURE = make_agents([("S001", "提示词甲"), ("S002", "提示词乙"), ("S003", "提示词丙")])


def _stub_fetch(storyboards, scripts=None):
    """抓取层桩：返回 ``fetch_all_storyboards`` 的形状（含翻页取证字段）。"""
    return lambda **kwargs: {  # type: ignore[assignment]
        "ok": True,
        "scripts": scripts if scripts is not None else [{"id": SCRIPT_ID, "title": "第一集"}],
        "storyboards": storyboards,
        "warnings": [],
        "diagnostics": {"getScriptPage_url": "stub://getScriptPage", "script_records_count": 1},
        "storyboard_pages": {SCRIPT_ID: 1},
        "storyboard_totals": {SCRIPT_ID: None},
    }


async def main() -> int:  # noqa: C901
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models.studio import Shot, ShotDetail
    from app.services.external import jurilu_agent_import as jai
    from app.services.external import jurilu_import_plan as planner
    from app.services.external import jurilu_import_service as svc

    reason = unusable_reason(REAL_DB)
    if reason:
        print(skip_note(REAL_DB, reason))
        return 0

    real_before = fingerprint(REAL_DB)
    print(f"  真库（本次自检的数据源）: {REAL_DB}")
    print(f"  真库指纹（前）: {real_before}")

    tmpdir = Path(tempfile.mkdtemp(prefix="jf_jurilu_"))
    tmp_db = tmpdir / "jellyfish_copy.db"
    shutil.copy2(REAL_DB, tmp_db)
    print(f"  临时副本: {tmp_db}")

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_db}")
    Session = async_sessionmaker(engine, expire_on_commit=False)

    # 桩掉抓取：把返回结构换成 fixture（fixture 只属于 SCRIPT_ID 这一个脚本组）
    original_fetch = jai.fetch_all_storyboards
    jai.fetch_all_storyboards = _stub_fetch(FIXTURE)

    URL = "https://www.jurilu.com/agent?projectId=P&clipId=C"

    # 选一个只有少量镜头的章节，便于验证"新建镜头"
    async with Session() as db:
        rows = (
            await db.execute(
                select(Shot.chapter_id, Shot.chapter_id).group_by(Shot.chapter_id)
            )
        ).all()
        all_chapters = [r[0] for r in rows]

    # 找一个镜头数 <= 3 的章节：
    #   优先「提示词全空」的（这样写入路径能被真实验证）；
    #   找不到就退化成任意 1..3 个镜头的章节，并**显式开 overwrite**
    #   （覆盖语义本身在第 4 节单独验证），否则这一轮只会得到 conflict。
    target_chapter = None
    needs_overwrite = False
    async with Session() as db:
        for cid in all_chapters:
            shots = await svc.load_chapter_shots(db, cid)
            if not 1 <= len(shots) <= 3:
                continue
            all_empty = all(not (s["video_prompt"] or "").strip() for s in shots)
            if all_empty:
                target_chapter, needs_overwrite = cid, False
                break
            if target_chapter is None:
                target_chapter, needs_overwrite = cid, True
    check("找到一个用于测试的章节", target_chapter is not None, str(all_chapters[:5]))
    if target_chapter is None:
        jai.fetch_all_storyboards = original_fetch  # type: ignore[assignment]
        await engine.dispose()
        print()
        print(f"结果：{PASS} 通过 / {FAIL} 失败")
        return 1 if FAIL else 0
    print(f"  目标章节={target_chapter}（提示词全空={not needs_overwrite}，"
          f"本次 overwrite={needs_overwrite}）")

    print("\n== 0. 单数语义：没选组 / 恰好一组 / 选了两组 ==")
    async with Session() as db:
        no_pick = await svc.build_preview(
            db, chapter_id=target_chapter, url=URL, cookie="stub-cookie", auth_mode="auto",
            script_ids=[],
        )
    check("没选组 → requires_script_selection", no_pick["requires_script_selection"] is True,
          str(no_pick["requires_script_selection"]))
    check("没选组 → 一行计划都没有", no_pick["plan"]["rows"] == [], str(len(no_pick["plan"]["rows"])))
    check("没选组 → entry_count=0", no_pick["entry_count"] == 0, str(no_pick["entry_count"]))
    check("没选组 → plan_summary 为空", no_pick["plan_summary"] == "", repr(no_pick["plan_summary"]))
    check("没选组也返回脚本组", [g["script_id"] for g in no_pick["script_groups"]] == [SCRIPT_ID],
          str(no_pick["script_groups"]))
    check("口径文案写明默认不合并", no_pick["note"] == svc.NO_MERGE_NOTE, no_pick["note"])

    multi_raised = None
    async with Session() as db:
        try:
            await svc.build_preview(
                db, chapter_id=target_chapter, url=URL, cookie="stub-cookie", auth_mode="auto",
                script_ids=[SCRIPT_ID, "SC2"],
            )
        except svc.JuriluSelectionError as exc:
            multi_raised = exc
    check("选两组 → JuriluSelectionError（400 级）", multi_raised is not None)
    check("选两组 → 中文说明「一次只能导入一个脚本组」",
          bool(multi_raised and "一次只能导入一个脚本组" in str(multi_raised)),
          str(multi_raised))

    print("\n== 1. 预览（恰好选一组，不写库） ==")
    async with Session() as db:
        preview = await svc.build_preview(
            db, chapter_id=target_chapter, url=URL, cookie="stub-cookie", auth_mode="auto",
            script_ids=[SCRIPT_ID], overwrite=needs_overwrite,
        )
    plan = preview["plan"]
    print(f"  章节镜头数={preview['chapter_shot_count']} 条目数={preview['entry_count']}"
          f" 所选组={preview['selected_script_id']} 缺口={preview['missing_shot_count']}")
    print(f"  摘要: {preview['plan_summary']}")
    check("只匹配所选组", preview["selected_script_ids"] == [SCRIPT_ID],
          str(preview["selected_script_ids"]))
    check("所选组不是空组（entry_count>0）", preview["entry_count"] == len(FIXTURE),
          str(preview["entry_count"]))
    check("每一行都属于所选组",
          {row["script_id"] for row in plan["rows"]} == {SCRIPT_ID},
          str({row["script_id"] for row in plan["rows"]}))
    check("每一行都带巨日禄序号与镜头编号",
          all(row["seq"] and row["index"] for row in plan["rows"]), "行的 seq/index 不能缺")
    check(
        "计划行数 = 该组条数（不截断）",
        len(plan["rows"]) == len(FIXTURE),
        f'{len(plan["rows"])} != {len(FIXTURE)}',
    )
    check(
        "计划可写动作数 = 3",
        len(planner.writable_rows(plan["rows"])) == 3,
        str(plan["counts"]),
    )
    check("无 skip_empty", plan["counts"].get("skip_empty", 0) == 0)
    check("来源标记为 jurilu", all(r["source"] == "jurilu" for r in plan["rows"]))

    print("\n== 2. 提交（写库） ==")
    async with Session() as db:
        result = await svc.apply_plan(db, chapter_id=target_chapter, plan=plan)
        await db.commit()
    print(f"  updated={result['updated']} created={result['created']} written={result['written']}")
    check("实际写入 = 3", result["written"] == 3, str(result["written"]))

    async with Session() as db:
        shots = await svc.load_chapter_shots(db, target_chapter)
    written_prompts = {s["video_prompt"] for s in shots if s["video_prompt"]}
    check(
        "三条提示词都进了库",
        {"提示词甲", "提示词乙", "提示词丙"} <= written_prompts,
        str(sorted(written_prompts)),
    )
    async with Session() as db:
        srcs = (
            await db.execute(
                select(ShotDetail.video_prompt_source)
                .where(ShotDetail.id.in_([s["id"] for s in shots]))
                .distinct()
            )
        ).all()
    src_values = {r[0] for r in srcs if r[0]}
    check("来源字段写为 jurilu", src_values == {"jurilu"}, str(src_values))

    print("\n== 3. 重复提交应幂等 ==")
    async with Session() as db:
        plan2 = (
            await svc.build_preview(
                db, chapter_id=target_chapter, url=URL, cookie="stub-cookie",
                script_ids=[SCRIPT_ID], overwrite=needs_overwrite,
            )
        )["plan"]
    check(
        "第二次全部判 unchanged",
        plan2["counts"].get("unchanged", 0) == 3,
        str(plan2["counts"]),
    )
    check("第二次无可写动作", planner.writable_rows(plan2["rows"]) == [])

    print("\n== 4. 已有不同内容 → 拒绝；开 overwrite 才覆盖 ==")
    strict = planner.build_import_plan(
        [{"shot_label": "S001", "description": "d", "final_prompt": "完全不同"}],
        [{"id": shots[0]["id"], "index": shots[0]["index"], "title": "t",
          "video_prompt": shots[0]["video_prompt"] or "旧内容"}],
    )
    check("未开覆盖判 conflict", strict["counts"].get("conflict") == 1, str(strict["counts"]))
    forced = planner.build_import_plan(
        [{"shot_label": "S001", "description": "d", "final_prompt": "完全不同"}],
        [{"id": shots[0]["id"], "index": shots[0]["index"], "title": "t",
          "video_prompt": shots[0]["video_prompt"] or "旧内容"}],
        overwrite=True,
    )
    check("开覆盖判 overwrite", forced["counts"].get("overwrite") == 1, str(forced["counts"]))

    print("\n== 5. 分镜多于既有镜头 → 新建镜头 ==")
    many = make_agents([(f"S{i:03d}", f"批量提示词{i}") for i in range(1, 8)])
    # scripts 为空也不要紧：分组能从分镜记录自身的 source_script_id 兜出来
    jai.fetch_all_storyboards = _stub_fetch(many, scripts=[])  # type: ignore[assignment]
    async with Session() as db:
        before = len(await svc.load_chapter_shots(db, target_chapter))
        preview3 = await svc.build_preview(
            db, chapter_id=target_chapter, url=URL, cookie="c", create_missing=True,
            script_ids=[SCRIPT_ID], overwrite=needs_overwrite,
        )
        p3 = preview3["plan"]
        r3 = await svc.apply_plan(db, chapter_id=target_chapter, plan=p3)
        await db.commit()
        after = len(await svc.load_chapter_shots(db, target_chapter))
    print(f"  镜头数 {before} → {after}，新建 {r3['created']}"
          f"（缺口 missing_shot_count={preview3['missing_shot_count']}）")
    check("有新建镜头", r3["created"] > 0, str(r3))
    check("镜头数增加等于新建数", after - before == r3["created"], f"{before}->{after}")
    check("缺口数 = 新建数（缺多少如实报出来）",
          preview3["missing_shot_count"] == r3["created"],
          f"{preview3['missing_shot_count']} != {r3['created']}")
    check("整组 7 条都在计划里（不截断）", len(p3["rows"]) == 7, str(len(p3["rows"])))

    print("\n== 6. 抓取失败时是否明确报错 ==")
    jai.fetch_all_storyboards = lambda **kwargs: {  # type: ignore[assignment]
        "ok": False, "scripts": [], "storyboards": [],
        "warnings": ["接口返回 401"], "diagnostics": {"script_status": 401},
    }
    raised = None
    async with Session() as db:
        try:
            await svc.build_preview(db, chapter_id=target_chapter, url=URL, cookie="bad",
                                    script_ids=[SCRIPT_ID])
        except svc.JuriluImportError as exc:
            raised = exc
    check("抛出 JuriluImportError", raised is not None)
    check("带诊断信息", bool(raised and raised.diagnostics.get("script_status") == 401),
          str(raised.diagnostics if raised else None))
    check("带告警信息", bool(raised and raised.warnings), str(raised.warnings if raised else None))

    jai.fetch_all_storyboards = original_fetch  # type: ignore[assignment]
    await engine.dispose()

    print("\n== 7. 真库未被波及 ==")
    real_after = fingerprint(REAL_DB)
    print(f"  真库指纹（后）: {real_after}")
    check("真库指纹一致（全程只读真库）", real_before == real_after, f"{real_before} vs {real_after}")

    shutil.rmtree(tmpdir, ignore_errors=True)

    print()
    print(f"结果：{PASS} 通过 / {FAIL} 失败")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
