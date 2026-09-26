"""出口A 自检：独立重算 + 格式核对 + 只读性。

纪律（见 parallel-ui-page-migration skill §5）：
  1. 独立重算 —— 用 sqlite 直接查库算期望值，不把被测函数调一遍当断言。
  2. 不用字符串匹配源码。
  3. 不把数据层既有行为当承诺。
"""
import hashlib
import os
import sqlite3
import sys

BACKEND = "/Users/apple/Documents/Jellyfish/backend"
DB = os.path.join(BACKEND, "jellyfish.db")
sys.path.insert(0, BACKEND)

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    print(("  PASS  " if ok else "  FAIL  ") + name + ((" — " + detail) if detail else ""))


def db_fingerprint():
    h = hashlib.sha256()
    with open(DB, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


con = sqlite3.connect("file:" + DB + "?mode=ro", uri=True)
cur = con.cursor()

print("=== 1. 独立重算：期望值（直接查库）===")
projects = [
    r[0]
    for r in cur.execute(
        """
        select distinct c.project_id
        from shot_details sd
        join shots s on s.id = sd.id
        join chapters c on c.id = s.chapter_id
        where trim(sd.video_prompt_source)='jurilu' and trim(coalesce(sd.video_prompt,''))<>''
        order by c.project_id
        """
    )
]
print("  含 jurilu 提示词的项目数:", len(projects))
print("  项目样例:", projects[:3])

# 逐项目独立重算期望条数
expected_by_project = {}
for pid in projects:
    n = cur.execute(
        """
        select count(*)
        from shot_details sd
        join shots s on s.id = sd.id
        join chapters c on c.id = s.chapter_id
        where c.project_id = ? and trim(sd.video_prompt_source)='jurilu'
          and trim(coalesce(sd.video_prompt,''))<>''
        """,
        (pid,),
    ).fetchone()[0]
    expected_by_project[pid] = n

total_expected = sum(expected_by_project.values())
print("  全库 jurilu 可导出总条数:", total_expected)
check("全库 jurilu 可导出条数为 90（与中控台源库一致）", total_expected == 90, f"实际 {total_expected}")

# 也统计「来源非 jurilu 但库里有提示词」的条数，确保不会被误导出
other = cur.execute(
    "select count(*) from shot_details where trim(coalesce(video_prompt,''))<>'' and trim(coalesce(video_prompt_source,''))<>'jurilu'"
).fetchone()[0]
print("  来源非 jurilu 但有正文的条数（不应被导出）:", other)
con.close()

print()
print("=== 2. 调用服务层 ===")
from app.services.studio import prompt_delivery as svc  # noqa: E402

# 测纯函数：格式核对。用构造数据，不碰库。
sample = [
    {
        "shot_id": "s2",
        "chapter_id": "script_x::EP01",
        "chapter_title": "第一集",
        "chapter_index": 1,
        "shot_index": 2,
        "video_prompt": "第二镜提示词",
        "video_prompt_source": "jurilu",
    },
    {
        "shot_id": "s1",
        "chapter_id": "script_x::EP01",
        "chapter_title": "第一集",
        "chapter_index": 1,
        "shot_index": 1,
        "video_prompt": "第一镜提示词",
        "video_prompt_source": "jurilu",
    },
    {
        "shot_id": "s3",
        "chapter_id": "script_x::EP01",
        "chapter_title": "第一集",
        "chapter_index": 1,
        "shot_index": 3,
        "video_prompt": "不该出现",
        "video_prompt_source": "shot_description",
    },
    {
        "shot_id": "s4",
        "chapter_id": "script_x::EP02",
        "chapter_title": "第二集",
        "chapter_index": 2,
        "shot_index": 1,
        "video_prompt": "另一集提示词",
        "video_prompt_source": "jurilu",
    },
]

text = svc.build_jurilu_prompt_export_document(sample, multi_episode=True)
lines = text.strip("\n").split("\n")
print("  生成文本行数:", len(lines))
print("  首 8 行:", lines[:8])

check("按镜头序号排序（S001 在 S002 之前）", text.index("S001") < text.index("S002"))
check(
    "章节标签取 :: 之后（与中控台 episode_id 同值）",
    "EP01 / S001" in text and "script_x / S001" not in text,
    "应出现 'EP01 / S001'，不应出现带剧本前缀的 'script_x / S001'",
)
check("非 jurilu 来源被剔除", "不该出现" not in text)
check("含巨日禄提示词表头", svc.JURILU_PROMPT_HEADER in text)
check("多集模式插章节头", svc.CHAPTER_RULE in text)
check("文本以换行结尾", text.endswith("\n"))
check("镜头分隔线为 20 等号", svc.SHOT_RULE in lines)

single = svc.build_jurilu_prompt_export_document(sample, multi_episode=False)
check("单集模式不插章节头", svc.CHAPTER_RULE not in single)

empty = svc.build_jurilu_prompt_export_document([], multi_episode=True)
check("无内容返回空串", empty == "", repr(empty))

nojurilu = svc.build_jurilu_prompt_export_document(
    [dict(sample[2])], multi_episode=True
)
check("全非 jurilu 也返回空串", nojurilu == "", repr(nojurilu))

bom = svc.encode_txt_download("测试")
check("TXT 带 UTF-8 BOM", bom.startswith(b"\xef\xbb\xbf"), repr(bom[:3]))
check("BOM 后正文可解", bom.decode("utf-8-sig") == "测试")

print()
print("=== 3. 路由层 + 只读性 ===")
before = db_fingerprint()

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)
pid = projects[0]
r = client.get(f"/api/v1/studio/prompt-delivery/{pid}")
check("预览端点 200", r.status_code == 200, f"status={r.status_code} body={r.text[:200]}")

if r.status_code == 200:
    body = r.json()
    data = body.get("data") or {}
    got = data.get("exportable_count")
    want = expected_by_project[pid]
    check(
        f"可交付条数与独立重算一致（{pid}）",
        got == want,
        f"接口 {got} / 独立重算 {want}",
    )
    check("预览文本非空", bool(data.get("text", "").strip()))
    check("返回行含 exportable 标记", all("exportable" in row for row in data.get("rows", [])))
    n_exportable_rows = sum(1 for row in data.get("rows", []) if row.get("exportable"))
    check("行级 exportable 计数 = exportable_count", n_exportable_rows == got, f"{n_exportable_rows} vs {got}")

    r2 = client.get(f"/api/v1/studio/prompt-delivery/{pid}/export")
    check("下载端点 200", r2.status_code == 200, f"status={r2.status_code}")
    if r2.status_code == 200:
        check("下载内容带 BOM", r2.content.startswith(b"\xef\xbb\xbf"))
        check(
            "下载文件名带 jurilu-prompt.txt",
            "jurilu-prompt.txt" in r2.headers.get("content-disposition", ""),
            r2.headers.get("content-disposition", ""),
        )
        check(
            "下载正文与预览一致",
            r2.content.decode("utf-8-sig") == data.get("text"),
        )

# 空范围应 404
r3 = client.get(f"/api/v1/studio/prompt-delivery/{pid}?scope=episode&chapter_id=__not_exist__")
check("不存在的范围返回 200 且 has_content=False", r3.status_code == 200 and not (r3.json().get("data") or {}).get("has_content"), f"status={r3.status_code}")

after = db_fingerprint()
check("全程只读（库文件指纹未变）", before == after, f"{before[:12]} -> {after[:12]}")

print()
print("=" * 56)
print(f"结果：{len(PASS)}/{len(PASS) + len(FAIL)} 通过")
if FAIL:
    print("失败项：")
    for name in FAIL:
        print("  -", name)
    sys.exit(1)
print("全部通过")
