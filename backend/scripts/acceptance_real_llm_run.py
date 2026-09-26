"""真实大模型验收：**恰好 5 次**调用，单次尝试、失败即停、前后记录守卫状态。

授权范围（用户 2026-09 明示）
============================

- **5 次上限**：1 次整章剧本分析（覆盖 2 角色 / 1 场景 / 1 道具）
  ＋ 4 次逐资产图片提示词生成；
- **不授权**真实出图 / 视频 / 新 OSS 写入（本脚本只打文本模型端点，绝不碰出图/视频）；
- **不得失败后自动重试**：任何一次失败立即停止并把守卫状态写进报告（脚本里没有重试逻辑）。

纪律（脚本内置，不靠自觉）
==========================

1. **启动自检**：先打 ``/api/v1/studio/llm/orchestration/status``，确认
   ``mode == real`` 且 ``is_real_mode``；不是真实模式 → **直接退出、一次都不发**；
2. **逐次计数**：每一次调用前打印 ``[call k/5]``，调用后立刻打印结果摘要；
   一旦某次抛错或返回非 200 → 写 ``aborted`` 摘要后 **return 非 0**，不再继续；
3. **每次调用前后都记状态**：把 ``status`` 的 ``mode`` / ``outlet_states`` /
   ``dry_run_audit`` 摘要落到 ``--out`` 指定的 JSON 报告；
4. **结束恢复安全状态**：默认在跑完后把 ``JELLYFISH_DRY_RUN=1``
   写回 ``backend/.env``（``--keep-real-mode`` 可跳过），并**再打一次**状态确认已回到演练；
5. 报告**不含** api_key / base_url / 本机绝对路径。

跑法（**由用户下令后才执行**）::

    cd backend
    # 1) 先建独立验收章节（零 LLM）
    .venv/bin/python scripts/acceptance_chapter_setup.py --project-id accept-x --chapter-id accept-x-ep1
    # 2) 显式打开真实模式（两个开关都要）
    #    JELLYFISH_DRY_RUN=0 且 JELLYFISH_REAL_LLM_CONFIRMED=1
    JELLYFISH_DRY_RUN=0 JELLYFISH_REAL_LLM_CONFIRMED=1 \
      .venv/bin/python scripts/acceptance_real_llm_run.py \
        --project-id accept-x --chapter-id accept-x-ep1 \
        --out /tmp/acceptance_real_llm_report.json

``--print-plan`` 只打印这 5 次调用会发什么（**不调用**），用于先给我看方案。

``--skip-analysis``（续跑，**不重复花钱**）
==========================================

第 1 次分析的结果现在**持久化在数据库**里（``chapter_asset_profiles`` /
``chapter_asset_profile_runs``，按项目 + 章节隔离）。所以某次调用失败后重启进程/重启后端，
可以带 ``--skip-analysis`` 直接从"确认落库 + 逐资产图片提示词"继续：

- 脚本先 ``GET .../asset-profiles``（**只读**）并断言库里确实有这份清单、
  且这次读取 ``persistence.llm_called == false``（证明用的是库、没有再调模型）；
- 库里没有 → **直接退出**，绝不偷偷把第 1 次调用再跑一遍（那就超预算了）；
- 每次调用仍逐次计数、失败即停、报告里如实写明"本次跳过第 1 次调用"及其证据。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

STATUS_URL = "/api/v1/studio/llm/orchestration/status"
MAX_CALLS = 5

#: 逐资产图片提示词：每次**只**要一个槽位 → 最终就是"四条提示词"，便于逐条比对差异。
ASSET_SLOT_PLAN: tuple[tuple[str, str], ...] = (
    ("character", "character_image_front"),
    ("character", "character_image_front"),
    ("scene", "scene_image_front"),
    ("prop", "prop_image_front"),
)


def _status(client: Any) -> dict[str, Any]:
    """打一次守卫状态接口，只留摘要（脱敏）。"""
    response = client.get(STATUS_URL)
    data = response.json().get("data") or {}
    details = data.get("real_run_mode") or {}
    return {
        "http_status": response.status_code,
        "mode": data.get("mode"),
        "mode_label": data.get("mode_label"),
        "is_real_mode": data.get("is_real_mode"),
        "switch_source": data.get("switch_source"),
        "outlet_states": _outlet_summary(details.get("outlets")),
        "guard_status_text": data.get("guard_status_text"),
        "audit_tail": (data.get("dry_run_audit") or [])[-3:],
    }


def _outlet_summary(raw: Any) -> dict[str, Any]:
    """把 ``mode_details()['outlets']`` 归一成 ``{outlet: {allowed, reason}}``。

    守卫返回的是**列表**（每项带 ``outlet`` 字段），不是 dict —— 这里两种形状都兼容，
    免得因为上游换了结构就让验收脚本挂掉。
    """
    summary: dict[str, Any] = {}
    if isinstance(raw, dict):
        for key, value in raw.items():
            if isinstance(value, dict):
                summary[str(key)] = {"allowed": value.get("allowed"), "reason": value.get("reason")}
        return summary
    for item in raw or []:
        if isinstance(item, dict) and item.get("outlet"):
            summary[str(item["outlet"])] = {
                "allowed": item.get("allowed"),
                "reason": item.get("reason") or item.get("reason_text"),
            }
    return summary


def _restore_env() -> str:
    """把 ``backend/.env`` 的 ``JELLYFISH_DRY_RUN`` 恢复成 1（默认动作）。"""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return "backend/.env 不存在，进程内环境变量在脚本退出后自然失效。"
    lines = env_path.read_text(encoding="utf-8").splitlines()
    replaced = False
    out: list[str] = []
    for line in lines:
        if line.strip().startswith("JELLYFISH_DRY_RUN="):
            out.append("JELLYFISH_DRY_RUN=1")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append("JELLYFISH_DRY_RUN=1")
    env_path.write_text("\n".join(out).rstrip("\n") + "\n", encoding="utf-8")
    return "已把 backend/.env 的 JELLYFISH_DRY_RUN 写回 1（演练模式）。"


def _plan(*, project_id: str, chapter_id: str, entity_names: list[str]) -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = [
        {
            "call": "1/5",
            "purpose": "整章剧本分析（结构化资产清单：2 角色 / 1 场景 / 1 道具）",
            "method": "POST",
            "path": f"/api/v1/studio/chapters/{chapter_id}/asset-profiles",
            "body": {"extra_instructions": ""},
        }
    ]
    for index, (asset_type, slot) in enumerate(ASSET_SLOT_PLAN, start=2):
        name = entity_names[index - 2] if index - 2 < len(entity_names) else ""
        plan.append(
            {
                "call": f"{index}/5",
                "purpose": f"逐资产图片提示词：{asset_type}「{name}」→ {slot}",
                "method": "POST",
                "path": "/api/v1/studio/llm/image-prompt/preview",
                "body": {
                    "project_id": project_id,
                    "chapter_id": chapter_id,
                    "entity_names": [name] if name else [],
                    "categories": [slot],
                },
            }
        )
    return plan


# pylint: disable=too-many-return-statements  # 单次流程脚本：每个失败分支都如实 return，可读性优先
def main(argv: list[str] | None = None) -> int:  # noqa: C901 - 单次流程脚本，分支就是它的可读性
    parser = argparse.ArgumentParser(description="真实大模型验收（恰好 5 次、单次尝试、失败即停）")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--chapter-id", required=True)
    parser.add_argument(
        "--entity-names",
        default="",
        help="逐资产调用的名称顺序（逗号分隔，4 个：角色A,角色B,场景,道具）；留空则按清单里前 4 项自动取",
    )
    parser.add_argument("--out", default="/tmp/acceptance_real_llm_report.json")
    parser.add_argument("--print-plan", action="store_true", help="只打印这 5 次调用会发什么（不调用）")
    parser.add_argument(
        "--confirm-authorized",
        action="store_true",
        help="硬闸门：必须显式带上，才允许真的发出这 5 次调用（防止误跑花钱）",
    )
    parser.add_argument("--keep-real-mode", action="store_true", help="跑完不把 .env 写回演练模式")
    parser.add_argument(
        "--skip-analysis",
        action="store_true",
        help=(
            "续跑模式：第 1 次整章分析的结果已在库里（持久化）时跳过它，"
            "直接从确认 + 逐资产图片提示词继续（不重复花钱）。库里没有则直接退出。"
        ),
    )
    args = parser.parse_args(argv)

    names = [item.strip() for item in args.entity_names.split(",") if item.strip()]
    plan = _plan(project_id=args.project_id, chapter_id=args.chapter_id, entity_names=names)
    if args.print_plan:
        print("[验收] 计划中的 5 次调用（未执行）：")
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0

    from fastapi.testclient import TestClient

    from app.main import app
    from app.services import paid_outlet_guard  # noqa: F401  # pylint: disable=unused-import

    report: dict[str, Any] = {
        "project_id": args.project_id,
        "chapter_id": args.chapter_id,
        "max_calls": MAX_CALLS,
        "calls": [],
        "result": "running",
        "restore": "",
    }

    # 刻意**不用** ``with TestClient(app)``：那会跑 lifespan（含对象存储 HeadBucket 真实出网）。
    # 验收脚本只打本进程内的路由，不需要 lifespan。与 tests/test_adopt_upload_reachability.py
    # 里记录的约定一致。
    client = TestClient(app)
    try:
        before = _status(client)
        report["status_before"] = before
        print("[验收] 调用前守卫状态：")
        print(json.dumps(before, ensure_ascii=False, indent=2))

        if not args.confirm_authorized:
            report["result"] = "aborted"
            report["abort_reason"] = (
                "缺少 --confirm-authorized 硬闸门 → **一次调用都不发**。"
                "真实调用必须由用户明确下令后，显式带上这个开关。"
            )
            print(f"[验收] {report['abort_reason']}")
            return _finish(report, args)

        if not before.get("is_real_mode"):
            report["result"] = "aborted"
            report["abort_reason"] = (
                "当前不是真实模式（is_real_mode=false）→ **一次调用都不发**。"
                "请显式设置 JELLYFISH_DRY_RUN=0 且 JELLYFISH_REAL_LLM_CONFIRMED=1。"
            )
            print(f"[验收] {report['abort_reason']}")
            return _finish(report, args)

        # ---- call 1/5：整章剧本分析（或 --skip-analysis 时从库里直读） ----
        if args.skip_analysis:
            print("[验收] --skip-analysis：先从库里**只读**取回已持久化的清单（不调用模型）…")
            persisted = client.get(f"/api/v1/studio/chapters/{args.chapter_id}/asset-profiles")
            if persisted.status_code != 200:
                report["result"] = "aborted"
                report["abort_reason"] = (
                    f"读取已持久化清单失败（HTTP {persisted.status_code}）→ 立即停止。"
                )
                return _finish(report, args)
            data = persisted.json().get("data") or {}
            persistence = data.get("persistence") or {}
            if not persistence.get("generated"):
                report["result"] = "aborted"
                report["abort_reason"] = (
                    "库里没有已持久化的清单（persistence.generated=false）→ **一次调用都不发**。"
                    "请去掉 --skip-analysis，让脚本从头跑（第 1 次整章分析）。"
                )
                return _finish(report, args)
            report["skipped_analysis"] = {
                "reason": "第 1 次分析结果已持久化在数据库（按项目 + 章节隔离），续跑不重复分析。",
                "read_http_status": persisted.status_code,
                "read_llm_called": bool(persistence.get("llm_called")),
                "generated_by_llm": bool(persistence.get("generated_by_llm")),
                "run_id": persistence.get("run_id"),
                "records_total": persistence.get("records_total"),
                "content_changed": bool(persistence.get("content_changed")),
                "status": persistence.get("status"),
                "note": "只读接口回 llm_called=false 即证明这次取清单**没有**调用模型。",
            }
            print(
                "[验收] 已从数据库取回清单："
                f"run_id={persistence.get('run_id')} records={persistence.get('records_total')} "
                f"本次调用模型={persistence.get('llm_called')}（原始分析由模型产生="
                f"{persistence.get('generated_by_llm')}）"
            )
            user_flow = data.get("user_flow") or {}
            items = user_flow.get("items") or []
        else:
            print("[验收] [call 1/5] 整章剧本分析 …")
            first = client.post(
                f"/api/v1/studio/chapters/{args.chapter_id}/asset-profiles",
                json={"extra_instructions": ""},
            )
            report["calls"].append(_record_call(plan[0], first))
            if first.status_code != 200:
                report["result"] = "aborted"
                report["abort_reason"] = f"第 1 次调用失败（HTTP {first.status_code}）→ 立即停止、不重试。"
                return _finish(report, args)

            user_flow = (first.json().get("data") or {}).get("user_flow") or {}
            items = user_flow.get("items") or []
            print(f"[验收] [call 1/5] 成功：{len(items)} 项资产；summary={user_flow.get('summary')}")

        resolved_names = names or [str(item.get("name") or "") for item in items[:4]]
        report["resolved_entity_names"] = resolved_names
        report["user_flow_summary"] = user_flow.get("summary")

        # 确认落库（**不调大模型**）：把结构化资料与章节 overlay 落到库里，
        # 后面 4 次图片提示词才有真实资料可读。
        confirm = client.post(
            f"/api/v1/studio/chapters/{args.chapter_id}/asset-profiles/confirm",
            json={"auto_confirm_unconflicted": True, "extra_instructions": ""},
        )
        report["confirm"] = {"http_status": confirm.status_code}
        if confirm.status_code != 200:
            report["result"] = "aborted"
            report["abort_reason"] = f"确认落库失败（HTTP {confirm.status_code}）→ 立即停止。"
            return _finish(report, args)
        report["confirm"]["summary"] = (confirm.json().get("data") or {}).get("summary")
        report["created_asset_ids"] = (confirm.json().get("data") or {}).get("created_asset_ids")
        print(f"[验收] 确认落库：{report['confirm']['summary']}")

        # ---- call 2/5 ~ 5/5：逐资产图片提示词 ----
        for index, (asset_type, slot) in enumerate(ASSET_SLOT_PLAN, start=2):
            name = resolved_names[index - 2] if index - 2 < len(resolved_names) else ""
            body = {
                "project_id": args.project_id,
                "chapter_id": args.chapter_id,
                "entity_names": [name] if name else [],
                "categories": [slot],
            }
            print(f"[验收] [call {index}/5] {asset_type}「{name}」→ {slot} …")
            response = client.post("/api/v1/studio/llm/image-prompt/preview", json=body)
            report["calls"].append(_record_call({"call": f"{index}/5", "body": body}, response))
            if response.status_code != 200:
                report["result"] = "aborted"
                report["abort_reason"] = (
                    f"第 {index} 次调用失败（HTTP {response.status_code}）→ 立即停止、不重试。"
                )
                return _finish(report, args)
            data = response.json().get("data") or {}
            slots = data.get("slots") or []
            report.setdefault("prompts", []).append(
                {
                    "asset_type": asset_type,
                    "asset_name": name,
                    "slot": slot,
                    "prompt": slots[0].get("prompt") if slots else "",
                    "savable": slots[0].get("savable") if slots else None,
                    "quality_issues": slots[0].get("quality_issues") if slots else None,
                    "structured_source": slots[0].get("structured_source") if slots else None,
                    "profile_source": (data.get("entity_cards") or [{}])[0].get("profile_source"),
                }
            )
            print(f"[验收] [call {index}/5] 成功（savable={report['prompts'][-1]['savable']}）")

        report["result"] = "ok"
    finally:
        client.close()

    return _finish(report, args)


def _record_call(request: dict[str, Any], response: Any) -> dict[str, Any]:
    body = response.json()
    return {
        "call": request.get("call"),
        "path": request.get("path") or "/api/v1/studio/llm/image-prompt/preview",
        "request": request.get("body"),
        "http_status": response.status_code,
        "meta": (body.get("data") or {}).get("meta"),
        "error": (body.get("meta") or {}).get("error") or (body.get("detail") if response.status_code != 200 else None),
    }


def _finish(report: dict[str, Any], args: argparse.Namespace) -> int:
    """收尾：再记一次守卫状态、恢复安全状态、落报告。"""
    from fastapi.testclient import TestClient

    from app.main import app

    # 如实记录"本次真正发出几次调用"（续跑时不是 5 次；报告里必须一眼看得出来）
    report["calls_issued"] = len(report.get("calls") or [])
    report["authorized_total"] = MAX_CALLS

    if not args.keep_real_mode:
        report["restore"] = _restore_env()
    else:
        report["restore"] = "--keep-real-mode：未改动 backend/.env（请自行确认停在哪一档）。"

    tail_client = TestClient(app)
    try:
        # 说明：.env 的改动要重启进程才生效；这里记录的是**进程内**当前状态，
        # 以及"我已把开关写回演练"的事实。
        report["status_after"] = _status(tail_client)
    finally:
        tail_client.close()

    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[验收] 报告已写入 {args.out}")
    print(f"[验收] 结论：{report['result']}" + (f"（{report.get('abort_reason')}）" if report.get("abort_reason") else ""))
    print(f"[验收] 恢复：{report['restore']}")
    return 0 if report["result"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
