#!/usr/bin/env python3
"""出口 A + 巨日禄导入的 HTTP 层自检（进程内 ASGI，不占端口、不写库）。

为什么用进程内 ASGI 而不是起 uvicorn
--------------------------------------
拉起 uvicorn 需要一个常驻进程，而这个环境里后台进程会被回收；
``httpx.ASGITransport`` 直接把请求交给 ASGI app，等价于真实 HTTP 路径
（路由匹配 / 请求体校验 / 依赖注入 / 异常映射全都跑一遍），但不占端口。

覆盖：
  1. 出口 A 预览：真实库读取，计数与独立重算一致；
  2. 出口 A 下载：TXT 带 UTF-8 BOM、Content-Disposition 文件名规范；
  3. 出口 A 空范围：返回 404（不是返回空文件）；
  4. 巨日禄导入预览：抓取失败时返回 502 且带脱敏诊断（Cookie 不出现）；
  5. 巨日禄导入预览：章节不存在 → 404；章节不属于项目 → 400；
  6. 巨日禄导入预览（**单数语义**）：没选组 → 只回脚本组、不匹配；选两组 → 400；
     恰好一组 → 完整配对计划（只含该组）；
  7. 巨日禄导入提交：桩掉写库后验证路由把该组的计划正确交给写库层。

库怎么选：优先 ``JELLYFISH_SELFCHECK_DB``，其次 ``DATABASE_URL`` 里的 sqlite 路径
（应用读哪个库，这里就指纹哪个库），最后回退 ``backend/jellyfish.db``；
库不可用会明确跳过并说明原因（见 ``tests/selfcheck_db.py``）。

跑法（需提权，沙箱会杀 sqlalchemy）：
    cd /Users/apple/Documents/Jellyfish/backend
    JELLYFISH_CELERY_EAGER=1 .venv/bin/python tests/selfcheck_http_endpoints.py
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import sqlite3
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("JELLYFISH_CELERY_EAGER", "1")

from tests.selfcheck_db import resolve_db_path, skip_note, unusable_reason  # noqa: E402

DB = resolve_db_path(BACKEND)
PASS = 0
FAIL = 0
FAKE_COOKIE = "SESSION_MARKER_DO_NOT_LEAK_9f3a1c"

#: 自检用的脚本组（新契约：一次只能导入**一个**脚本组）
SCRIPT_ID = "SC1"
OTHER_SCRIPT_ID = "SC2"
#: 桩里的分镜条数（= 该脚本组的条数）
STUB_GROUP_SIZE = 3


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def fingerprint() -> str:
    h = hashlib.sha256()
    with open(DB, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:12]


def pick_project_and_chapter():
    """找一个含 jurilu 提示词的项目 + 该项目的一个章节 + 一个不属于它的章节。

    数据不足（没有 jurilu 提示词 / 只有一个项目）时返回 ``None``，
    由调用方打印明确的「跳过」原因，而不是抛一个看不懂的 ``NoneType`` 异常。
    """
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        cur = con.cursor()
        row = cur.execute(
            """
            SELECT c.project_id FROM shot_details d
            JOIN shots s ON s.id = d.id
            JOIN chapters c ON c.id = s.chapter_id
            WHERE d.video_prompt_source = 'jurilu' AND TRIM(d.video_prompt) <> ''
            GROUP BY c.project_id ORDER BY COUNT(*) DESC LIMIT 1
            """
        ).fetchone()
        if row is None:
            return None
        project_id = row[0]
        chapter_row = cur.execute(
            "SELECT id FROM chapters WHERE project_id = ? ORDER BY rowid LIMIT 1", (project_id,)
        ).fetchone()
        other_row = cur.execute(
            "SELECT id FROM chapters WHERE project_id <> ? LIMIT 1", (project_id,)
        ).fetchone()
        if chapter_row is None or other_row is None:
            return None
        chapter_id = chapter_row[0]
        other_chapter = other_row[0]
        expected = cur.execute(
            """
            SELECT COUNT(*) FROM shot_details d
            JOIN shots s ON s.id = d.id
            JOIN chapters c ON c.id = s.chapter_id
            WHERE c.project_id = ? AND d.video_prompt_source = 'jurilu'
                  AND TRIM(d.video_prompt) <> ''
            """,
            (project_id,),
        ).fetchone()[0]
    finally:
        con.close()
    return project_id, chapter_id, other_chapter, expected


async def main() -> int:  # noqa: C901
    import httpx

    from app.main import app
    from app.services.external import jurilu_agent_import as jurilu
    from app.services.external import jurilu_import_service as svc

    reason = unusable_reason(DB)
    if reason:
        print(skip_note(DB, reason))
        return 0

    picked = pick_project_and_chapter()
    if picked is None:
        print(skip_note(
            DB,
            "库里没有可用于自检的数据（需要：至少一个含 jurilu 提示词的项目，"
            "以及另一个项目的章节）",
        ))
        return 0
    project_id, chapter_id, other_chapter, expected_exportable = picked
    print(f"  库={DB}")
    print(f"  项目={project_id}")
    print(f"  章节={chapter_id}")
    print(f"  独立重算的可导出条数={expected_exportable}")

    before = fingerprint()
    print(f"  真库指纹（前）={before}\n")

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        print("== 1. 出口 A 预览 ==")
        r = await client.get(f"/api/v1/studio/prompt-delivery/{project_id}", params={"scope": "episodes"})
        check("HTTP 200", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        body = r.json()
        data = body.get("data") or {}
        check("code=200", body.get("code") == 200, str(body.get("code")))
        check(
            f"exportable_count 与独立重算一致（{expected_exportable}）",
            data.get("exportable_count") == expected_exportable,
            f'接口={data.get("exportable_count")} 重算={expected_exportable}',
        )
        check("export_source 为 jurilu", data.get("export_source") == "jurilu", str(data.get("export_source")))
        check("rows 非空", len(data.get("rows") or []) > 0, str(len(data.get("rows") or [])))
        check("text 非空", bool(data.get("text")), f'len={len(data.get("text") or "")}')
        check("带口径说明 note", bool(data.get("note")))

        print("\n== 2. 出口 A 下载（BOM / 文件名 / 正文一致） ==")
        r2 = await client.get(f"/api/v1/studio/prompt-delivery/{project_id}/export", params={"scope": "episodes"})
        check("HTTP 200", r2.status_code == 200, str(r2.status_code))
        raw = r2.content
        check("带 UTF-8 BOM", raw[:3] == b"\xef\xbb\xbf", raw[:3].hex())
        ctype = r2.headers.get("content-type", "")
        check("Content-Type 为 utf-8 文本", "charset=utf-8" in ctype, ctype)
        disp = r2.headers.get("content-disposition", "")
        check("带 Content-Disposition 附件名", "attachment" in disp and ".txt" in disp, disp)
        decoded = raw.decode("utf-8-sig")
        check("正文与预览逐字一致", decoded == data.get("text"), "下载正文 != 预览正文")

        print("\n== 3. 出口 A 空范围应 404 ==")
        r3 = await client.get(
            "/api/v1/studio/prompt-delivery/__nonexistent_project__/export",
            params={"scope": "episodes"},
        )
        check("HTTP 404", r3.status_code == 404, str(r3.status_code))

        print("\n== 4. 巨日禄导入：抓取失败 → 502 且带脱敏诊断 ==")
        payload = {
            "chapter_id": chapter_id,
            "url": "https://example.invalid/agent?projectId=P1&clipId=C1",
            "cookie": FAKE_COOKIE,
            "auth_mode": "auto",
        }
        r4 = await client.post(f"/api/v1/studio/jurilu-import/{project_id}/preview", json=payload)
        check("HTTP 502", r4.status_code == 502, f"{r4.status_code} {r4.text[:200]}")
        body4 = r4.json() or {}
        check("遵循统一信封（code/message/data/meta）",
              set(body4.keys()) >= {"code", "message", "data", "meta"}, str(body4.keys()))
        check("code=502", body4.get("code") == 502, str(body4.get("code")))
        check("message 可读", "分镜导入失败" in str(body4.get("message")), str(body4.get("message"))[:120])
        meta = body4.get("meta") or {}
        check("meta.diagnostics 为结构化字典", isinstance(meta.get("diagnostics"), dict), str(meta)[:200])
        check("diagnostics 里有 has_cookie", "has_cookie" in (meta.get("diagnostics") or {}))
        check(
            "diagnostics.script_status 被保留",
            "script_status" in (meta.get("diagnostics") or {}),
            str(meta.get("diagnostics"))[:160],
        )
        check("meta.warnings 为列表", isinstance(meta.get("warnings"), list), str(meta.get("warnings")))
        check(
            "响应体不泄露 Cookie 原文",
            FAKE_COOKIE not in r4.text,
            "!! Cookie 出现在响应里",
        )

        print("\n== 5. 巨日禄导入：章节校验 ==")
        r5 = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/preview",
            json={**payload, "chapter_id": "__no_such_chapter__"},
        )
        check("章节不存在 → 404", r5.status_code == 404, str(r5.status_code))
        r6 = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/preview",
            json={**payload, "chapter_id": other_chapter},
        )
        check("章节不属于该项目 → 400", r6.status_code == 400, f"{r6.status_code} {r6.text[:120]}")

        print("\n== 6. 巨日禄导入（单数语义）：没选组 / 选两组 / 恰好一组 ==")
        # 桩在**抓取层**（而不是 fetch_entries）：这样分组、单数校验、过滤、配对
        # 全都是真代码在跑，桩只负责「假装抓到了这个脚本组的分镜」。
        stub_storyboards = [
            {
                "agent_name": f"EP01｜第一集｜分镜 S{i:03d}",
                "shot_summary": f"第{i}个分镜",
                "prompt_text": f"提示词内容{i}",
                "agent_id": f"agent-{i}",
                "sbid": f"S{i:03d}",
                "seqNum": str(i),
                "source_script_id": SCRIPT_ID,
                "source_script_title": "第一集",
                "source_script_index": 1,
            }
            for i in range(1, STUB_GROUP_SIZE + 1)
        ]
        original_fetch = jurilu.fetch_all_storyboards
        jurilu.fetch_all_storyboards = lambda **kwargs: {  # type: ignore[assignment]
            "ok": True,
            "scripts": [{"id": SCRIPT_ID, "title": "第一集"}],
            "storyboards": stub_storyboards,
            "warnings": [],
            "diagnostics": {"getScriptPage_url": "stub://getScriptPage",
                            "script_records_count": 1},
            "storyboard_pages": {SCRIPT_ID: 1},
            "storyboard_totals": {SCRIPT_ID: None},
        }
        # 目标章节的镜头本来就带 jurilu 提示词，这里显式开覆盖，
        # 否则会被正确判成 conflict（那是另一条分支，第 5 节已验证）
        payload_overwrite = {**payload, "overwrite": True}

        print("  6.1 没选组 → 只回脚本组、不做匹配")
        r_none = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/preview", json=payload_overwrite
        )
        check("HTTP 200", r_none.status_code == 200, f"{r_none.status_code} {r_none.text[:200]}")
        ndata = (r_none.json() or {}).get("data") or {}
        check("requires_script_selection=true", ndata.get("requires_script_selection") is True,
              str(ndata.get("requires_script_selection")))
        check("rows 为空（默认不跨 scriptId 合并）", (ndata.get("rows") or []) == [],
              str(len(ndata.get("rows") or [])))
        check("entry_count=0", ndata.get("entry_count") == 0, str(ndata.get("entry_count")))
        check("plan_summary 为空", ndata.get("plan_summary") == "", repr(ndata.get("plan_summary")))
        check("仍返回脚本组",
              [g.get("script_id") for g in ndata.get("script_groups") or []] == [SCRIPT_ID],
              str(ndata.get("script_groups")))
        check("note 写明默认不合并",
              "默认不跨 scriptId 合并" in str(ndata.get("note")), str(ndata.get("note")))

        print("  6.2 选了两组 → 400（一次只能导入一个脚本组）")
        r_two = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/preview",
            json={**payload_overwrite, "script_ids": [SCRIPT_ID, OTHER_SCRIPT_ID]},
        )
        check("HTTP 400", r_two.status_code == 400, f"{r_two.status_code} {r_two.text[:200]}")
        two_body = r_two.json() or {}
        check("code=400", two_body.get("code") == 400, str(two_body.get("code")))
        check("中文说明「一次只能导入一个脚本组」",
              "一次只能导入一个脚本组" in str(two_body.get("message")),
              str(two_body.get("message"))[:160])
        check("data 为 null（结构化错误）", two_body.get("data") is None, str(two_body.get("data")))

        print(f"  6.3 恰好选一组 → 该组 {STUB_GROUP_SIZE} 条全部进计划")
        r7 = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/preview",
            json={**payload_overwrite, "script_ids": [SCRIPT_ID]},
        )
        check("HTTP 200", r7.status_code == 200, f"{r7.status_code} {r7.text[:200]}")
        pdata = (r7.json() or {}).get("data") or {}
        rows = pdata.get("rows") or []
        check(f"entry_count={STUB_GROUP_SIZE}", pdata.get("entry_count") == STUB_GROUP_SIZE,
              str(pdata.get("entry_count")))
        check(f"rows 长度={STUB_GROUP_SIZE}", len(rows) == STUB_GROUP_SIZE, str(len(rows)))
        check("selected_script_id 为所选组", pdata.get("selected_script_id") == SCRIPT_ID,
              str(pdata.get("selected_script_id")))
        check("requires_script_selection=false",
              pdata.get("requires_script_selection") is False,
              str(pdata.get("requires_script_selection")))
        check("带 plan_summary", bool(pdata.get("plan_summary")), str(pdata.get("plan_summary")))
        check(
            "所有行来源为 jurilu",
            all(row.get("source") == "jurilu" for row in rows),
            str([row.get("source") for row in rows]),
        )
        check(
            "所有行都属于所选组（不会混进别的脚本组）",
            {row.get("script_id") for row in rows} == {SCRIPT_ID},
            str({row.get("script_id") for row in rows}),
        )
        check(
            "每行都带巨日禄序号 + 镜头编号 + 匹配状态",
            all(row.get("seq") and row.get("index") and row.get("matched_by") for row in rows),
            str(rows[:1]),
        )
        check(
            "开覆盖后行级动作全为 overwrite",
            all(row.get("action") == "overwrite" for row in rows),
            str([row.get("action") for row in rows]),
        )

        print("\n== 7. 巨日禄导入：提交把计划交给写库层（写库桩化，不落盘） ==")
        captured = {}

        async def fake_apply(db, *, chapter_id, plan):  # noqa: ANN001
            captured["chapter_id"] = chapter_id
            from app.services.external import jurilu_import_plan as planner

            rows = planner.writable_rows(plan["rows"])
            captured["writable"] = len(rows)
            captured["script_ids"] = {row.get("script_id") for row in rows}
            return {
                "chapter_id": chapter_id,
                "updated": len(rows),
                "created": 0,
                "written": len(rows),
                "touched_shot_ids": [r.get("shot_id") or "new" for r in rows],
                "counts": plan["counts"],
            }

        original_apply = svc.apply_plan
        svc.apply_plan = fake_apply  # type: ignore[assignment]
        print("  7.1 没选组 → 400（写库端点必须恰好一个）")
        r_no_pick = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/apply", json=payload_overwrite
        )
        check("HTTP 400", r_no_pick.status_code == 400, f"{r_no_pick.status_code}")
        check("中文提示要求指定 script_ids",
              "script_ids" in str((r_no_pick.json() or {}).get("message")),
              str((r_no_pick.json() or {}).get("message"))[:160])
        check("写库层没有被调用过", captured == {}, str(captured))

        print(f"  7.2 恰好选一组 → 该组 {STUB_GROUP_SIZE} 条交给写库层")
        r8 = await client.post(
            f"/api/v1/studio/jurilu-import/{project_id}/apply",
            json={**payload_overwrite, "script_ids": [SCRIPT_ID]},
        )
        check("HTTP 200", r8.status_code == 200, f"{r8.status_code} {r8.text[:200]}")
        adata = (r8.json() or {}).get("data") or {}
        check("写库层收到正确章节", captured.get("chapter_id") == chapter_id, str(captured))
        check(f"写库层收到 {STUB_GROUP_SIZE} 条可写行",
              captured.get("writable") == STUB_GROUP_SIZE, str(captured))
        check("写库层收到的行都属于所选组",
              captured.get("script_ids") == {SCRIPT_ID}, str(captured))
        check(f"返回 written={STUB_GROUP_SIZE}", adata.get("written") == STUB_GROUP_SIZE, str(adata))

        jurilu.fetch_all_storyboards = original_fetch  # type: ignore[assignment]
        svc.apply_plan = original_apply  # type: ignore[assignment]

    after = fingerprint()
    print("\n== 8. 真库未被写入 ==")
    print(f"  真库指纹（后）={after}")
    check("真库指纹一致", before == after, f"{before} vs {after}")

    print()
    print(f"结果：{PASS} 通过 / {FAIL} 失败")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
