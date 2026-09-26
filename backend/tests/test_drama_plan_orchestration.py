"""剧情策划编排层（``llm_orchestration/drama_plan``）的确定性测试。

这一层是"提示词 + 解析 + **确定性后校验**"三件事，所以测试也分三块：

1. **提示词**：六条创作硬要求必须在提示词里逐条出现（改模板时不许悄悄丢掉）。
   这是产品口径的可执行副本 —— 用户明确要求的"3 秒钩子 / 卖点剧情化 / 起势升级反转 /
   商品至少一半镜头 / 结尾反转加购买暗示 / 每镜给角色动作台词时长商品"。
2. **后校验**：模型返回脏数据时**归一化 + 如实告警**，绝不静默通过
   （景别/机位/运镜的中文与大小写别名、时长取最近档位、悬空角色引用、
   空壳镜头丢弃、商品覆盖不足告警）。
3. **演练**：``preview_drama_plan`` 在 DRY_RUN 下返回**没有 plan 的占位说明**，
   一次模型都不调 —— 因为假 JSON 一旦被上层写进草稿列就是污染。

零出网、零付费：所有用例要么是纯函数，要么用注入的 stub caller / 内存库。
"""

from __future__ import annotations

import json

import pytest
from fastapi import HTTPException

from app.services.studio.llm_orchestration import drama_plan as module
from app.schemas.studio.drama_plan import DramaPlanDraft
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

BRIEF = {
    "product_name": "紧致焕颜精华",
    "product_description": "白色磨砂瓶身，金色压泵",
    "selling_points": ["三秒吸收", "孕妇可用"],
    "target_audience": "25-35 岁通勤女性",
    "genre": "真人都市",
    "tone": "一本正经地荒诞",
    "shot_count": 4,
    "director_notes": "不要旁白",
}


def _raw_plan(**overrides: object) -> dict:
    """一份"模型返回"的最小合法 JSON（用 dict 直接构造，便于逐项改坏）。"""
    payload = {
        "title": "面试那天",
        "logline": "她带着一瓶精华去面试，却发现面试官是前任",
        "sellingPoints": ["三秒吸收 → 她当众拍在桌上"],
        "characters": [
            {"name": "林小满", "profile": {"appearance": "鹅蛋脸"}, "shot_indexes": [1, 2]},
            {"name": "周砚", "profile": {"identity": "面试官"}, "shot_indexes": [2]},
        ],
        "scenes": [{"name": "写字楼会议室", "profile": {"spatial_structure": "长桌"}, "shot_indexes": [1]}],
        "product": {
            "name": "紧致焕颜精华",
            "description": "白色磨砂瓶身，金色压泵",
            "profile": {"package": "方形瓶身"},
            "shot_indexes": [1, 2],
        },
        "shots": [
            {
                "index": 1,
                "title": "拍瓶",
                "characters": ["林小满"],
                "script_excerpt": "她把瓶子拍在桌上",
                "description": "会议室全景",
                "duration": 8,
                "camera_shot": "中景",
                "angle": "平视",
                "movement": "固定",
                "action_beats": ["推门", "拍瓶"],
                "dialogue": [{"speaker": "林小满", "text": "我不用补妆。", "mode": "DIALOGUE"}],
                "product_present": True,
            },
            {
                "index": 2,
                "title": "抬头",
                "characters": ["林小满", "周砚"],
                "duration": 6,
                "camera_shot": "CU",
                "angle": "LOW_ANGLE",
                "movement": "slow push in",
                "action_beats": ["抬头"],
                "dialogue": [{"speaker": "周砚", "text": "好久不见。", "mode": "DIALOGUE"}],
                "product_present": True,
            },
        ],
        "climax": "她转身要走，前任却说这瓶是他买的",
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# 1) 提示词里的六条硬要求
# ---------------------------------------------------------------------------


def test_prompt_contains_the_six_hard_rules() -> None:
    """六条创作口径必须逐条出现在提示词里（这是产品要求的可执行副本）。"""
    prompt = module.build_drama_plan_prompt(
        brief=BRIEF,
        chapter_title="第一集",
        chapter_text="会议室里，林小满推门进来。",
        shot_count=4,
        duration_hint=32,
        style_hint="真人都市 / 一本正经地荒诞",
    )
    assert "开场 3 秒" in prompt and "可拍摄的动作冲突" in prompt
    assert "卖点不许直接念参数" in prompt
    assert "起势 → 升级 → 反转" in prompt
    assert "至少出现在一半镜头" in prompt
    assert "反转 + 自然的购买暗示" in prompt
    assert "出场角色" in prompt  # 每镜要素：角色 / 动作 / 台词 / 时长 / 商品是否出现
    assert "动作" in prompt and "台词" in prompt and "时长" in prompt
    for key in ("product_present", "sellingPoints", "climax", "logline"):
        assert key in prompt, f"输出结构缺字段：{key}"
    # 用户填的 brief 与章节原文都要进提示词
    assert "紧致焕颜精华" in prompt
    assert "三秒吸收" in prompt
    assert "不要旁白" in prompt
    assert "会议室里" in prompt


# ---------------------------------------------------------------------------
# 2) 确定性后校验
# ---------------------------------------------------------------------------


def test_postprocess_normalizes_aliases_and_durations() -> None:
    """中文景别/机位/运镜 → code；时长取最近档位；编号连续。"""
    plan, warnings = module.postprocess_plan(_raw_plan(), shot_count=2)

    first, second = plan.shots
    assert first.camera_shot == "MS"          # 「中景」
    assert first.angle == "EYE_LEVEL"         # 「平视」
    assert first.movement == "STATIC"         # 「固定」
    assert second.camera_shot == "CU"
    assert second.angle == "LOW_ANGLE"
    assert second.movement == "DOLLY_IN"      # 「slow push in」靠包含匹配归一到推近
    assert first.duration == 8
    assert second.duration == 5               # 6 秒不在档位里 → 取最近的 5
    assert [shot.index for shot in plan.shots] == [1, 2]
    assert plan.characters[0].name == "林小满"
    assert plan.product is not None and plan.product.name == "紧致焕颜精华"
    # 归一化过程不产生 warning（都是合法别名）
    assert warnings == []


def test_postprocess_reports_unknown_enum_values() -> None:
    """非法枚举落默认并**记 warning**（不许静默通过）。"""
    raw = _raw_plan()
    raw["shots"][0]["camera_shot"] = "超级特写"
    raw["shots"][0]["movement"] = "瞬移"
    plan, warnings = module.postprocess_plan(raw, shot_count=2)

    assert plan.shots[0].camera_shot == module.DEFAULT_SHOT_TYPE
    assert plan.shots[0].movement == module.DEFAULT_MOVEMENT
    assert any("景别" in item for item in warnings)
    assert any("运镜" in item for item in warnings)


def test_postprocess_drops_dangling_references_with_warnings() -> None:
    """台词的说话人不在人物表里 → 清空说话人；镜头的出场角色不在人物表里 → 剔除并告警。"""
    raw = _raw_plan()
    raw["shots"][0]["characters"] = ["林小满", "不存在的黑衣人"]
    raw["shots"][1]["dialogue"][0]["speaker"] = "查无此人"
    plan, warnings = module.postprocess_plan(raw, shot_count=2)

    assert plan.shots[0].characters == ["林小满"]
    assert plan.shots[1].dialogue[0].text == "好久不见。"   # 台词保留
    assert plan.shots[1].dialogue[0].speaker == ""           # 说话人清空
    assert any("出场角色" in item for item in warnings)
    assert any("说话人" in item for item in warnings)


def test_postprocess_drops_empty_shell_shots() -> None:
    """既没标题也没动作/台词的镜头是空壳，丢弃并告警（落库只会得到无意义分镜）。"""
    raw = _raw_plan(shots=[{"index": 7, "title": "", "action_beats": [], "dialogue": []}, _raw_plan()["shots"][0]])
    plan, warnings = module.postprocess_plan(raw, shot_count=2)

    assert len(plan.shots) == 1
    assert plan.shots[0].index == 1  # 重新编号
    assert any("空壳" in item for item in warnings)


def test_postprocess_flags_insufficient_product_coverage() -> None:
    """商品覆盖：**恰好一半算满足**（不告警），低于一半才告警。"""
    raw = _raw_plan()
    raw["shots"][1]["product_present"] = False
    # 2 镜里 1 镜出现商品 = 恰好一半 → 满足要求
    _, warnings_ok = module.postprocess_plan(raw, shot_count=2)
    assert not any("至少一半" in item for item in warnings_ok)

    # 3 镜里只有 1 镜出现商品 → 少于一半（需要 2 个）→ 告警
    raw_three = _raw_plan()
    raw_three["shots"].append(dict(_raw_plan()["shots"][0], index=3, product_present=False))
    raw_three["shots"][1]["product_present"] = False
    plan, warnings = module.postprocess_plan(raw_three, shot_count=3)
    assert len(plan.shots) == 3
    assert sum(1 for shot in plan.shots if shot.product_present) == 1
    assert any("至少一半" in item for item in warnings)


def test_postprocess_rejects_plan_without_usable_shots() -> None:
    """一个可用镜头都没有 → 422（视为生成失败，不落草稿）。"""
    with pytest.raises(HTTPException) as info:
        module.postprocess_plan(_raw_plan(shots=[]), shot_count=2)
    assert info.value.status_code == 422


def test_postprocess_ignores_product_without_name() -> None:
    """模型给了 product 但没有名称 → 忽略该字段并告警；镜头上的商品标记也置 False。"""
    raw = _raw_plan()
    raw["product"] = {"name": "", "description": "?"}
    plan, warnings = module.postprocess_plan(raw, shot_count=2)

    assert plan.product is None
    assert all(shot.product_present is False for shot in plan.shots)
    assert any("product 没有名称" in item for item in warnings)


# ---------------------------------------------------------------------------
# 3) 演练：不调模型、不给假草稿
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_in_dry_run_calls_no_model_and_returns_no_plan() -> None:
    """DRY_RUN 下：一次模型都不调，且**不给假 plan**（假 JSON 会污染草稿列）。

    注意这里**不注入 caller**：只有走真实调用分支才会碰模型，
    而 conftest 已把整套测试锁在演练模式，所以它必然进占位分支。
    """
    db, engine = await build_session()
    try:
        async with db:
            await seed_project_chapter_shot(db)
            result = await module.preview_drama_plan(db, chapter_id="chap-1", brief=BRIEF)
    finally:
        await engine.dispose()

    assert result["plan"] is None, "演练模式下不许给出假草稿"
    assert result["meta"].llm_called is False
    assert result["meta"].dry_run is True
    assert any("DRY_RUN" in item for item in result["warnings"])
    assert "未生成草稿" in result["note"]


@pytest.mark.asyncio
async def test_preview_parses_stub_output_and_reports_meta() -> None:
    """注入 stub caller 时，真实解析路径跑通：plan 归一化 + meta 标注已调用模型。"""
    db, engine = await build_session()
    try:
        async with db:
            await seed_project_chapter_shot(db)

            async def caller(_prompt: str) -> str:
                # 故意留一个尾随逗号：必须走 json_utils 的三级抢救（去尾随逗号）才算解析成功
                body = json.dumps(_raw_plan(), ensure_ascii=False)
                return "```json\n" + body[:-1] + ",\n}\n```"

            result = await module.preview_drama_plan(
                db, chapter_id="chap-1", brief=BRIEF, llm_caller=caller
            )
    finally:
        await engine.dispose()

    plan = DramaPlanDraft.model_validate(result["plan"])
    assert plan.title == "面试那天"
    assert len(plan.shots) == 2
    meta = result["meta"]
    assert meta.llm_called is True
    assert meta.raw_output_chars > 0
    assert meta.json_repairs, "尾随逗号应当被记录成一次抢救"
    assert any("抢救" in item for item in result["warnings"])


@pytest.mark.asyncio
async def test_preview_raises_422_on_broken_json() -> None:
    """模型返回不是 JSON 对象 → 422 结构化明细（上层据此**不落库**）。"""
    db, engine = await build_session()
    try:
        async with db:
            await seed_project_chapter_shot(db)

            async def caller(_prompt: str) -> str:
                return "抱歉，我不能完成这个请求。"

            with pytest.raises(HTTPException) as info:
                await module.preview_drama_plan(
                    db, chapter_id="chap-1", brief=BRIEF, llm_caller=caller
                )
    finally:
        await engine.dispose()

    assert info.value.status_code == 422
    detail = info.value.detail
    assert isinstance(detail, dict) and detail.get("code") == "llm_json_parse_failed"
