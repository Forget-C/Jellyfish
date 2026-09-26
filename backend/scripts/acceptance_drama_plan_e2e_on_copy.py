#!/usr/bin/env python3
"""在**正式库的副本**上跑完整 HTTP 链路，验收「确认落库 → 既有五步流程能读到」。

为什么在副本上跑（而不是直接跑正式库）
======================================

- 正式库是真实项目数据，验收不该在上面留下测试分镜；
- 模型调用**打桩**（返回固定 JSON），**零付费**；不依赖任何环境密钥；
- 跑完比对正式库的 sha256，证明它**一个字节都没变** —— 这条是本脚本的立身之本。

与 ``workbench_smoke.py`` 同一个思路（那支也是"只读跑在正式库副本上"）。

覆盖的验收条目
==============

1. brief 保存免费、且不落任何正式行；打桩模型走得通（证明真实调用路径确实被替换）；
2. generate 只落草稿；手改草稿（改一镜时长）能被 confirm 用上；
3. confirm 一个事务落齐：章节标题/主线 + 分镜（真实时长/景别/机位/运镜/动作拍点）
   + 对白独立表 + 角色 + 场景 + 商品 + 关联行（含逐镜 shot 档）；
4. **既有五步流程的读取路径**（镜头列表 / 镜头细节 / 对白行 / 资产准备就绪 / 商品实体）
   能直接读到这些产物；
5. 正式库哈希不变。

用法：
    cd backend && uv run python scripts/acceptance_drama_plan_e2e_on_copy.py
    # 指定副本目录 / 正式库 / 项目：
    cd backend && uv run python scripts/acceptance_drama_plan_e2e_on_copy.py \\
        --work-dir /tmp/drama-plan-e2e --project-id <项目ID>
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sqlite3
import sys
import types
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

DEFAULT_REAL_DB = Path("/Users/apple/Documents/Jellyfish/backend/jellyfish.db")
DEFAULT_WORK_DIR = Path("/tmp/drama-plan-e2e")

BRIEF = {
    "product_name": "紧致焕颜精华",
    "product_description": "白色磨砂塑料瓶身，金色压泵，正面居中金色字标",
    "selling_points": ["三秒吸收不黏腻", "孕妇可用"],
    "target_audience": "25-35 岁通勤女性",
    "genre": "真人都市",
    "tone": "一本正经地荒诞",
    "shot_count": 3,
    "director_notes": "不要旁白",
}
#: 打桩模型的返回（3 镜，2 镜出现商品 = 满足「至少一半」；第 3 镜故意给非法机位，验证归一化）
STUB_PLAN = {
    "title": "（验收）面试那天",
    "logline": "她带着一瓶精华去面试，面试官是前任",
    "sellingPoints": ["三秒吸收 → 她当众拍在桌上"],
    "characters": [
        {"name": "验收女主", "profile": {"appearance": "鹅蛋脸杏眼"}, "shot_indexes": [1, 2, 3]},
        {"name": "验收前任", "profile": {"identity": "面试官"}, "shot_indexes": [2]},
    ],
    "scenes": [{"name": "验收会议室", "profile": {"spatial_structure": "长桌，落地窗"}, "shot_indexes": [1, 2]}],
    "product": {
        "name": "紧致焕颜精华",
        "description": "白色磨砂塑料瓶身，金色压泵",
        "profile": {"package": "方形瓶身", "logo": "正面居中金色字标"},
        "shot_indexes": [1, 2],
    },
    "shots": [
        {
            "index": 1, "title": "拍瓶", "characters": ["验收女主"],
            "script_excerpt": "她把瓶子拍在桌上", "description": "会议室中景",
            "duration": 8, "camera_shot": "MS", "angle": "EYE_LEVEL", "movement": "STATIC",
            "action_beats": ["推门", "拍瓶"],
            "dialogue": [{"speaker": "验收女主", "text": "我不用补妆。", "mode": "DIALOGUE"}],
            "product_present": True,
        },
        {
            "index": 2, "title": "抬头", "characters": ["验收女主", "验收前任"],
            "description": "过肩特写", "duration": 5, "camera_shot": "CU",
            "angle": "OVER_SHOULDER", "movement": "DOLLY_IN", "action_beats": ["抬头"],
            "dialogue": [{"speaker": "验收前任", "text": "好久不见。", "mode": "DIALOGUE"}],
            "product_present": True,
        },
        {
            "index": 3, "title": "转身", "characters": ["验收女主"],
            "description": "全景", "duration": 4, "camera_shot": "LS",
            "angle": "EYE_LOW_ANGLE_PLACEHOLDER",  # 故意非法：必须被归一而不是原样落库
            "movement": "PAN", "action_beats": ["转身"], "dialogue": [], "product_present": False,
        },
    ],
    "climax": "前任说这瓶是他买的",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _prepare(real_db: Path, work_dir: Path) -> tuple[Path, str]:
    """复制正式库到工作目录，并写一份只给本次演练用的 .env；返回 (副本路径, 项目 ID)。"""
    work_dir.mkdir(parents=True, exist_ok=True)
    copy_db = work_dir / "jellyfish.db"
    for stale in work_dir.glob("jellyfish.db*"):
        stale.unlink()
    source = sqlite3.connect(str(real_db))
    try:
        dest = sqlite3.connect(str(copy_db))
        try:
            source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()
    env_file = work_dir / "env"
    env_file.write_text(
        f"DATABASE_URL=sqlite+aiosqlite:///{copy_db}\n"
        f"JELLYFISH_ENV_FILE={env_file}\n"
        "JELLYFISH_DRY_RUN=0\n"           # 需要走"真实调用分支"才会调 call_text_llm（被我们打桩）
        "JELLYFISH_REAL_LLM_CONFIRMED=1\n"
        "JELLYFISH_NETWORK_GUARD=1\n",
        encoding="utf-8",
    )
    os.environ["JELLYFISH_ENV_FILE"] = str(env_file)
    os.environ["JELLYFISH_NETWORK_GUARD"] = "1"
    return copy_db, str(env_file)


def _pick_project(copy_db: Path) -> str:
    """挑一个"有章节且该章节还没有分镜"的项目（这样 confirm 不会被"章节非空"挡住）。"""
    conn = sqlite3.connect(str(copy_db))
    try:
        row = conn.execute(
            "select c.project_id from chapters c left join shots s on s.chapter_id = c.id "
            "where s.id is null group by c.project_id order by max(c.updated_at) desc limit 1"
        ).fetchone()
    finally:
        conn.close()
    return str(row[0]) if row else ""


def main() -> int:  # noqa: C901 - 验收脚本，按步骤线性读更清楚
    parser = argparse.ArgumentParser(description="剧情策划端到端验收（正式库副本 + 打桩模型，零付费）")
    parser.add_argument("--real-db", default=str(DEFAULT_REAL_DB), help="正式库路径（只读来源）")
    parser.add_argument("--work-dir", default=str(DEFAULT_WORK_DIR), help="副本与临时 env 放哪")
    parser.add_argument("--project-id", default="", help="用哪个项目（默认自动挑一个有空章节的）")
    args = parser.parse_args()

    real_db = Path(args.real_db)
    if not real_db.exists():
        print(f"✗ 找不到正式库：{real_db}", file=sys.stderr)
        return 1
    real_before = _sha256(real_db)
    copy_db, _env = _prepare(real_db, Path(args.work_dir))
    project_id = args.project_id or _pick_project(copy_db)
    if not project_id:
        print("✗ 副本里找不到「有章节且该章节为空」的项目，请用 --project-id 指定", file=sys.stderr)
        return 1

    from app.main import app
    from app.services.studio.llm_orchestration import drama_plan as orchestration
    from fastapi.testclient import TestClient

    stub_calls: list[str] = []

    async def stub_call(prompt: str, target=None):  # noqa: ANN001, ARG001
        stub_calls.append(prompt)
        return types.SimpleNamespace(text=json.dumps(STUB_PLAN, ensure_ascii=False), latency_ms=7)

    orchestration.call_text_llm = stub_call  # type: ignore[assignment]

    failures: list[str] = []

    def check(label: str, ok: bool, detail: str = "") -> None:
        print(f"  {'✓' if ok else '✗'} {label}{('  —— ' + detail) if detail else ''}")
        if not ok:
            failures.append(label)

    def rows(sql: str, params: tuple = ()) -> list[tuple]:
        conn = sqlite3.connect(str(copy_db))
        try:
            return conn.execute(sql, params).fetchall()
        finally:
            conn.close()

    print(f"副本：{copy_db}")
    print(f"项目：{project_id}")
    with TestClient(app) as client:
        print("=== 1) 项目级入口：取一个没有分镜的可用空章节 ===")
        resp = client.post(
            f"/api/v1/studio/projects/{project_id}/drama-plan/chapter",
            json={"product_name": BRIEF["product_name"]},
        )
        check("入口 200", resp.status_code == 200, resp.text[:200])
        chapter_id = (resp.json().get("data") or {}).get("chapter_id", "")
        print(f"    章节：{chapter_id}")
        if not chapter_id:
            return 1
        base = f"/api/v1/studio/chapters/{chapter_id}/drama-plan"

        print("=== 2) 保存 brief（免费）→ 3) 生成草稿（打桩模型） ===")
        resp = client.put(f"{base}/brief", json=BRIEF)
        check("brief 200 且 status=none", resp.status_code == 200 and resp.json()["data"]["status"] == "none")
        resp = client.post(f"{base}/generate")
        body = resp.json().get("data") or {}
        check("generate 200 且草稿 status=ok", resp.status_code == 200 and body.get("status") == "ok")
        check("打桩模型确实被调用（未走真实 HTTP）", len(stub_calls) == 1, f"{len(stub_calls)} 次")
        check("确认前正式行仍为空", rows("select id from shots where chapter_id=?", (chapter_id,)) == [])

        print("=== 4) 手改草稿（第 1 镜改 12 秒）→ 5) 确认落库 ===")
        edited = dict(body.get("plan") or {})
        edited["shots"] = [dict(item) for item in (edited.get("shots") or [])]
        edited["shots"][0]["duration"] = 12
        resp = client.put(f"{base}/draft", json=edited)
        check("保存手改草稿 200", resp.status_code == 200, resp.text[:200])
        resp = client.post(f"{base}/confirm")
        check("confirm 200", resp.status_code == 200, resp.text[:300])

        print("=== 6) 直接查副本库，核对正式产物 ===")
        chapter_row = rows("select title, summary, storyboard_count from chapters where id=?", (chapter_id,))
        check("章节标题/主线/分镜数", bool(chapter_row) and chapter_row[0] == ("（验收）面试那天", "她带着一瓶精华去面试，面试官是前任", 3), str(chapter_row))
        shot_rows = rows(
            'select s."index", s.title, d.duration, d.camera_shot, d.angle, d.movement, d.action_beats '
            'from shots s join shot_details d on d.id = s.id where s.chapter_id=? order by s."index"',
            (chapter_id,),
        )
        check("3 个镜头按序落库", [row[0] for row in shot_rows] == [1, 2, 3], str(shot_rows))
        check("第 1 镜用手改后的 12 秒", bool(shot_rows) and shot_rows[0][2] == 12)
        check("景别/机位/运镜是真实 code", len(shot_rows) > 1 and shot_rows[1][3:6] == ("CU", "OVER_SHOULDER", "DOLLY_IN"), str(shot_rows[1:2]))
        check("非法机位被归一而非原样落库", len(shot_rows) > 2 and shot_rows[2][4] == "EYE_LEVEL", str(shot_rows[2][4] if len(shot_rows) > 2 else ""))
        check("动作拍点是 JSON 数组", bool(shot_rows) and json.loads(shot_rows[0][6]) == ["推门", "拍瓶"])
        dialog_rows = rows(
            'select l.text, l.speaker_name from shot_dialog_lines l join shots s on s.id = l.shot_detail_id '
            'where s.chapter_id=? order by s."index", l."index"',
            (chapter_id,),
        )
        check("对白落进独立表且带说话人", len(dialog_rows) == 2 and dialog_rows[0][1] == "验收女主", str(dialog_rows))
        check("角色 / 场景 / 商品资产已建", len(rows("select id from characters where project_id=? and name like '验收%'", (project_id,))) == 2 and len(rows("select id from scenes where name='验收会议室'")) == 1 and len(rows("select id from products where name='紧致焕颜精华'")) == 1)
        product_row = rows("select id from products where name='紧致焕颜精华'")
        links = rows("select shot_id from project_product_links where project_id=? and product_id=?", (project_id, product_row[0][0] if product_row else ""))
        check("商品 shot 档关联 = 2（「至少一半」的判据）", len([row for row in links if row[0]]) == 2, str(links))

        print("=== 7) 既有五步流程的读取路径 ===")
        resp = client.get("/api/v1/studio/shots", params={"chapter_id": chapter_id, "page_size": 50})
        shots_api = (resp.json().get("data") or {}).get("items") or []
        check("镜头列表读到 3 镜", len(shots_api) == 3, f"status={resp.status_code}")
        first_id = shots_api[0]["id"] if shots_api else ""
        detail = (client.get(f"/api/v1/studio/shot-details/{first_id}").json().get("data") or {})
        check("镜头细节读到 12 秒 / MS", detail.get("duration") == 12 and detail.get("camera_shot") == "MS")
        lines = (
            client.get("/api/v1/studio/shot-dialog-lines", params={"shot_detail_id": first_id, "page_size": 50})
            .json().get("data") or {}
        ).get("items") or []
        check("对白行端点读到 1 句且带说话人", len(lines) == 1 and lines[0].get("speaker_name") == "验收女主")
        check("资产准备就绪端点 200", client.get(f"/api/v1/studio/projects/{project_id}/asset-readiness").status_code == 200)
        products_api = (
            client.get("/api/v1/studio/entities/product", params={"page": 1, "page_size": 50})
            .json().get("data") or {}
        ).get("items") or []
        check("商品实体端点读得到", any(item.get("name") == "紧致焕颜精华" for item in products_api), f"{len(products_api)} 条")

    print("=== 8) 正式库完全没被动过 ===")
    check("正式库 sha256 前后一致", real_before == _sha256(real_db), f"{real_before[:16]}…")

    print()
    if failures:
        print(f"✗ 失败 {len(failures)} 项：" + "；".join(failures))
        return 1
    print("✓ 全部通过：HTTP 全链路 + 落库 + 五步读取 在正式库副本上验收成功（零付费、正式库未改动）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
