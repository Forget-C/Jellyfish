#!/usr/bin/env python3
"""巨日禄导入「匹配计划」纯逻辑自检（零依赖，可在受限沙箱内直接跑）。

跑法：
    /Users/apple/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
        /Users/apple/Documents/Jellyfish/backend/tests/selfcheck_jurilu_plan.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.external import jurilu_import_plan as plan  # noqa: E402

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


def entry(label: str, text: str) -> dict:
    return {
        "shot_label": label,
        "description": f"{label} 的描述",
        "final_prompt": text,
    }


def shot(sid: str, index: int, title: str = "", prompt: str = "") -> dict:
    return {"id": sid, "index": index, "title": title or f"镜头 {index}", "video_prompt": prompt}


print("== 案例1：条目数与镜头数相等，全部写入空镜头 ==")
p = plan.build_import_plan(
    [entry("S001", "提示词一"), entry("S002", "提示词二")],
    [shot("s1", 1), shot("s2", 2)],
)
check("两条都是 update", p["counts"].get("update") == 2, str(p["counts"]))
check("按顺序配到 s1/s2", [r["shot_id"] for r in p["rows"]] == ["s1", "s2"], str([r["shot_id"] for r in p["rows"]]))
check("next_index 未增长", p["next_index"] == 2, str(p["next_index"]))

print("== 案例2：目标镜头已有不同提示词，未开覆盖 → conflict，不写 ==")
p = plan.build_import_plan(
    [entry("S001", "新提示词")],
    [shot("s1", 1, prompt="旧提示词")],
)
check("判为 conflict", p["counts"].get("conflict") == 1, str(p["counts"]))
check("writable_rows 为空", plan.writable_rows(p["rows"]) == [], str(plan.writable_rows(p["rows"])))

print("== 案例3：同一文本 → unchanged，不重复写 ==")
p = plan.build_import_plan(
    [entry("S001", "一模一样")],
    [shot("s1", 1, prompt="一模一样")],
)
check("判为 unchanged", p["counts"].get("unchanged") == 1, str(p["counts"]))
check("writable_rows 为空", plan.writable_rows(p["rows"]) == [])

print("== 案例4：开覆盖 → 原 conflict 变 overwrite，可写 ==")
p = plan.build_import_plan(
    [entry("S001", "新提示词")],
    [shot("s1", 1, prompt="旧提示词")],
    overwrite=True,
)
check("判为 overwrite", p["counts"].get("overwrite") == 1, str(p["counts"]))
check("writable_rows 有 1 条", len(plan.writable_rows(p["rows"])) == 1)

print("== 案例5：条目多于镜头，允许新建 ==")
p = plan.build_import_plan(
    [entry("S001", "a"), entry("S002", "b"), entry("S003", "c")],
    [shot("s1", 1)],
)
check("2 条 create", p["counts"].get("create") == 2, str(p["counts"]))
check("新建 index 递增为 2,3", [r["index"] for r in p["rows"][1:]] == [2, 3], str([r["index"] for r in p["rows"]]))
check("新建标题取分镜 label", p["rows"][1]["title"] == "S002", p["rows"][1]["title"])

print("== 案例6：条目多于镜头，禁止新建 → skip_no_shot ==")
p = plan.build_import_plan(
    [entry("S001", "a"), entry("S002", "b")],
    [shot("s1", 1)],
    create_missing=False,
)
check("1 条 skip_no_shot", p["counts"].get("skip_no_shot") == 1, str(p["counts"]))
check("writable_rows 只有 1 条", len(plan.writable_rows(p["rows"])) == 1)

print("== 案例7：空正文条目被跳过，且不占用镜头位 ==")
p = plan.build_import_plan(
    [entry("S001", "有内容"), entry("S002", "   "), entry("S003", "第三条")],
    [shot("s1", 1), shot("s2", 2), shot("s3", 3)],
)
check("1 条 skip_empty", p["counts"].get("skip_empty") == 1, str(p["counts"]))
check("第 1 条配 s1", p["rows"][0]["shot_id"] == "s1", str(p["rows"][0]["shot_id"]))
check("空条目仍占位（指向 s2 但标明不写）", p["rows"][1]["shot_id"] == "s2", str(p["rows"][1]["shot_id"]))
check("第 3 条配 s3（空分镜也占一格）", p["rows"][2]["shot_id"] == "s3", str(p["rows"][2]["shot_id"]))

print("== 案例8：镜头 index 乱序输入也能正确配对 ==")
p = plan.build_import_plan(
    [entry("S001", "a"), entry("S002", "b")],
    [shot("s2", 2), shot("s1", 1)],
)
check("配到 index 最小的 s1 在前", [r["shot_id"] for r in p["rows"]] == ["s1", "s2"], str([r["shot_id"] for r in p["rows"]]))

print("== 案例9：来源标记固定为 jurilu（出口 A 依赖） ==")
p = plan.build_import_plan([entry("S001", "a")], [])
check("写入行的 source=jurilu", all(r["source"] == "jurilu" for r in plan.writable_rows(p["rows"])))
check("常量与中控台一致", plan.JURILU_SOURCE == "jurilu")

print("== 案例10：全空章节 + create_missing → index 从 1 开始 ==")
p = plan.build_import_plan([entry("S001", "a"), entry("S002", "b")], [])
check("2 条 create", p["counts"].get("create") == 2, str(p["counts"]))
check("index 为 1,2", [r["index"] for r in p["rows"]] == [1, 2], str([r["index"] for r in p["rows"]]))
check("next_index=2", p["next_index"] == 2, str(p["next_index"]))

print("== 案例11：摘要文案 ==")
p = plan.build_import_plan([entry("S001", "a")], [shot("s1", 1)])
s = plan.plan_summary(p)
check("摘要含'将写入'", "将写入" in s, s)

print("== 案例12：不改输入（无副作用） ==")
shots_in = [shot("s1", 1)]
entries_in = [entry("S001", "a")]
snapshot = [dict(x) for x in shots_in]
plan.build_import_plan(entries_in, shots_in)
check("shots 未被就地修改", shots_in == snapshot, str(shots_in))
check("entries 未被就地修改", entries_in[0]["final_prompt"] == "a")

print()
print(f"结果：{PASS} 通过 / {FAIL} 失败")
sys.exit(1 if FAIL else 0)
