"""验收**彩排**：用与真实验收完全相同的 5 次调用形状，在桩模型上先跑一遍。

真实调用只有 5 次授权、且失败不许重试，所以"链路是否就绪"必须在花钱之前证明。
本文件就是那份证明：它复用 ``scripts/acceptance_chapter_setup.py`` 里的**同一份验收剧本**，
按 ``scripts/acceptance_real_llm_run.py`` 的**同一套请求体**逐步走完：

1. 整章剧本分析（1 次）→ 2 角色 / 1 场景 / 1 道具；
2. 确认落库（不调模型）；
3. 逐资产图片提示词 ×4（角色A / 角色B / 场景 / 道具），每次只取一个槽位。

并逐条对齐用户点名的验收标准：

- 两个角色**不再**得到近似模板（提示词差异显著、跨资产查重不报冲突）；
- 场景含剧本里的空间 / 时代 / 陈设 / 事件 / 氛围；
- 道具走**正式槽位**且含材质 / 外形 / 所属人物或场景 / 剧情用途；
- 生成依据如实标来源（``structured_source`` / ``profile_source``）；
- 不出现「外观信息不足」「需人工补充」；
- 既有人工提示词、图片、定版图**保持不变**。
"""

from __future__ import annotations

import json
import sys
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from acceptance_chapter_setup import ACCEPTANCE_SCRIPT, ACCEPTANCE_SHOTS  # noqa: E402

from app.models.studio import Character, Chapter, CharacterImage, Project, Scene, Shot  # noqa: E402
from app.services.studio.asset_prompt_quality import check_cross_asset_duplicates  # noqa: E402
from app.services.studio.chapter_asset_profile_cache import clear_chapter_profile_cache  # noqa: E402
from app.services.studio.chapter_asset_profile_confirm import confirm_chapter_asset_profiles  # noqa: E402
from app.services.studio.chapter_asset_profiles import build_chapter_asset_profiles  # noqa: E402
from app.services.studio.chapter_asset_record_store import list_chapter_records  # noqa: E402
from app.services.studio.llm_orchestration.image_prompt import preview_image_prompts  # noqa: E402
from app.schemas.studio.llm_orchestration import ImagePromptPreviewRequest  # noqa: E402
from tests.llm_orchestration_fixtures import build_session  # noqa: E402

PROJECT_ID = "accept-rehearsal"
CHAPTER_ID = "accept-rehearsal-ep1"

#: 桩模型对"整章剧本分析"的回包：2 角色（**特征刻意不同**）+ 1 场景 + 1 道具
MODEL_ASSETS: dict[str, Any] = {
    "assets": [
        {
            "name": "姜岁欢",
            "aliases": ["岁欢"],
            "asset_type": "character",
            "fields": {
                "identity": "将军府庶女",
                "relations": "秦老夫人的孙女",
                "gender_age": "女，十六岁",
                "era": "古代架空王朝",
                "appearance": "鹅蛋脸杏眼，肤色白皙，身形纤瘦",
                "hairstyle": "乌黑长直发束双环髻，鬓边一支素银簪",
                "costume_accessories": "素白交领襦裙，腰间垂一枚羊脂玉佩",
                "personality": "隐忍倔强，外柔内刚",
            },
            "shot_indexes": [1, 2],
            "evidence": ["姜岁欢跪在听雨轩冰冷的青砖地上，素白襦裙下摆沾了雨水。"],
        },
        {
            "name": "秦老夫人",
            "aliases": ["老夫人"],
            "asset_type": "character",
            "fields": {
                "identity": "将军府当家主母",
                "relations": "姜岁欢的祖母",
                "gender_age": "女，六十余岁",
                "era": "古代架空王朝",
                "appearance": "面容清瘦严峻，鬓发花白，眉骨高",
                "hairstyle": "圆髻高挽，插一支鎏金点翠簪",
                "costume_accessories": "凤纹织金褙子，拄乌木拐杖",
                "personality": "刻薄强势，话里带刺",
            },
            "shot_indexes": [1, 3],
            "evidence": ["秦老夫人拄着乌木拐杖立在堂前，凤纹织金褙子一丝不苟。"],
        },
        {
            "name": "听雨轩",
            "aliases": [],
            "asset_type": "scene",
            "fields": {
                "era_location": "古代将军府临水小轩",
                "indoor_outdoor": "半开敞室内",
                "time_weather": "秋夜，雨",
                "spatial_structure": "三间开敞，四面花窗半开，正中设矮榻",
                "furnishings": "冰冷青砖地面，乌木矮几，青铜烛台，檐下滴水成帘",
                "light_tone": "烛火暖黄与雨夜冷蓝对撞",
                "atmosphere": "幽闭压抑，水声不断",
                "related_events": "姜岁欢跪地藏刃，秦老夫人逼问嫁妆",
            },
            "shot_indexes": [1, 2, 3],
            "evidence": ["秋雨敲瓦，听雨轩四面花窗半开，青铜烛台上的烛火被穿堂风吹得摇晃。"],
        },
        {
            "name": "镶银匕首",
            "aliases": [],
            "asset_type": "prop",
            "fields": {
                "material": "精铁镶银",
                "color": "冷银与暗灰",
                "shape": "短刃直背，柄尾嵌一枚银环",
                "size": "连柄约七寸",
                "state": "刃口有细小卷刃，银环略有磨损",
                "usage": "袖中藏匿防身",
                "owner": "姜岁欢",
                "plot_role": "她反抗的伏笔，也是本场唯一的凶器",
            },
            "shot_indexes": [2],
            "evidence": ["姜岁欢把镶银匕首藏在袖中，指尖发抖。"],
        },
    ]
}


class _StubModel:
    """桩模型：按"画像卡逐字使用"的口径回包（真实模型被要求这么做）。"""

    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def __call__(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if "整集资产分析师" in prompt:
            return json.dumps(MODEL_ASSETS, ensure_ascii=False)
        # 图片提示词：主体描述用画像卡里"必须逐字使用"的那一段
        subject = ""
        for line in prompt.splitlines():
            if line.startswith("- 画像卡主体描述（必须逐字使用）："):
                subject = line.split("：", 1)[1].strip()
                break
        category = "character_image_front"
        for line in prompt.splitlines():
            if line.startswith("- ") and "（" in line and "）：" in line:
                category = line[2:].split("（", 1)[0].strip()
                break
        return json.dumps(
            {
                "slots": [
                    {
                        "category": category,
                        "subject": subject,
                        "action_pose": "按槽位视角展示",
                        "environment": "干净背景",
                        "camera_language": "中景平视，柔和主光",
                        "style": "写实短剧风格",
                        "quality": "高清锐利",
                    }
                ]
            },
            ensure_ascii=False,
        )


async def _seed_acceptance(db) -> None:
    """与 ``acceptance_chapter_setup.py`` 一致的验收章节（内存库）。"""
    db.add(
        Project(
            id=PROJECT_ID,
            name="验收项目（彩排）",
            description="",
            style="真人古装",
            visual_style="现实",
        )
    )
    await db.flush()
    db.add(
        Chapter(
            id=CHAPTER_ID,
            project_id=PROJECT_ID,
            index=1,
            title="验收集",
            raw_text=ACCEPTANCE_SCRIPT,
            condensed_text=ACCEPTANCE_SCRIPT,
        )
    )
    await db.flush()
    for index, title, excerpt in ACCEPTANCE_SHOTS:
        db.add(
            Shot(
                id=f"{CHAPTER_ID}-shot-{index}",
                chapter_id=CHAPTER_ID,
                index=index,
                title=title,
                script_excerpt=excerpt,
            )
        )
    await db.flush()


@pytest.mark.asyncio
async def test_acceptance_rehearsal_covers_all_five_steps() -> None:
    db, engine = await build_session()
    stub = _StubModel()
    async with db:
        await _seed_acceptance(db)

        # --- 既有的东西：全局场景 + 人工提示词 + 已上传图 + 定版图（都必须不变） ---
        db.add(
            Scene(
                id="scene-global-tingyuxuan",
                name="听雨轩",
                description="听雨轩，临水木构小轩，四面开窗。",
                style="真人古装",
                image_prompts={"scene_image_front": "人工写好的场景提示词，临水小轩四面开窗"},
            )
        )
        await db.flush()
        db.add(
            Character(
                id="char-manual",
                project_id=PROJECT_ID,
                name="姜岁欢",
                description="人工写好的角色描述",
                style="真人古装",
                visual_style="现实",
                image_prompts={"character_image_front": "人工写好的角色提示词，素白襦裙双环髻"},
            )
        )
        await db.flush()
        db.add(
            CharacterImage(
                character_id="char-manual",
                quality_level="high",
                view_angle="front",
                file_id="file-primary-1",
                is_primary=True,
            )
        )
        await db.flush()

        # --- 第 1 次调用：整章剧本分析 ---
        clear_chapter_profile_cache()
        built = await build_chapter_asset_profiles(db, chapter_id=CHAPTER_ID, llm_caller=stub)
        items = built["user_flow"]["items"]
        by_name = {item["name"]: item for item in items}

        assert set(by_name) >= {"姜岁欢", "秦老夫人", "听雨轩", "镶银匕首"}
        assert {"character", "scene", "prop"} <= {item["asset_type"] for item in items}
        # 别名合并：模型给的别名被保留、且只出现一组
        assert by_name["姜岁欢"]["aliases"] == ["岁欢"]
        assert len([item for item in items if item["name"] == "姜岁欢"]) == 1
        # 出场依据：2 个角色都在镜头摘录里找到了依据
        assert [ref["shot_index"] for ref in by_name["姜岁欢"]["shot_refs"]] == [1, 2]
        assert [ref["shot_index"] for ref in by_name["秦老夫人"]["shot_refs"]] == [1, 3]
        # 提示词里确实带了完整剧本与分镜
        analysis_prompt = stub.prompts[0]
        assert ACCEPTANCE_SCRIPT.strip().splitlines()[1] in analysis_prompt
        assert f"镜头 1（{CHAPTER_ID}-shot-1）" in analysis_prompt

        # --- 确认落库（不调模型） ---
        confirmed = await confirm_chapter_asset_profiles(db, chapter_id=CHAPTER_ID)
        assert confirmed["summary"]["created"] + confirmed["summary"]["linked"] == len(items)
        # 章节资料落进**专用表**（按项目 + 章节隔离），并回写已关联的真实资产 ID
        assert confirmed["summary"]["chapter_records_bound"] == len(items)
        records = await list_chapter_records(db, chapter_id=CHAPTER_ID)
        assert len(records) == len(items)
        assert all(str(record.status) == "confirmed" and record.asset_id for record in records)

        # --- 第 2~5 次调用：逐资产图片提示词（每次一个槽位） ---
        call_plan = (
            ("character", "姜岁欢", "character_image_front"),
            ("character", "秦老夫人", "character_image_front"),
            ("scene", "听雨轩", "scene_image_front"),
            ("prop", "镶银匕首", "prop_image_front"),
        )
        results: list[dict[str, Any]] = []
        for asset_type, name, slot in call_plan:
            preview = await preview_image_prompts(
                db,
                body=ImagePromptPreviewRequest(
                    project_id=PROJECT_ID,
                    chapter_id=CHAPTER_ID,
                    entity_names=[name],
                    categories=[slot],
                ),
                llm_caller=stub,
            )
            assert len(preview.slots) == 1, f"{name} 应当只生成一个槽位"
            card = next(card for card in preview.entity_cards if card.name == name)
            results.append(
                {
                    "asset_type": asset_type,
                    "name": name,
                    "slot": str(preview.slots[0].category.value),
                    "prompt": preview.slots[0].prompt,
                    "subject": preview.slots[0].layers["subject"],
                    "savable": preview.slots[0].savable,
                    "quality_issues": preview.slots[0].quality_issues,
                    "structured_source": preview.slots[0].structured_source,
                    "profile_source": card.profile_source,
                    "has_structured_profile": card.has_structured_profile,
                }
            )

        # 全局资产 / 人工提示词 / 定版图 —— 彩排结束仍然原样
        global_scene = await db.get(Scene, "scene-global-tingyuxuan")
        manual_char = await db.get(Character, "char-manual")
        primary_rows = (await db.execute(CharacterImage.__table__.select())).all()
        snapshot = {
            "global_scene_description": global_scene.description,
            "global_scene_prompts": dict(global_scene.image_prompts),
            "manual_char_description": manual_char.description,
            "manual_char_prompts": dict(manual_char.image_prompts),
            "primary_files": [row.file_id for row in primary_rows if row.is_primary],
        }
    await engine.dispose()

    # ---------------- 逐条验收 ----------------
    assert len(results) == 4, "授权就是 4 次逐资产提示词生成 → 4 条提示词"

    # ① 不出现空话
    for item in results:
        blob = json.dumps(item, ensure_ascii=False)
        assert "外观信息不足" not in blob
        assert "需人工补充" not in blob
        assert item["savable"] is True, f"{item['name']} 应当通过质量拦截：{item['quality_issues']}"
        assert item["has_structured_profile"] is True
        # 生成依据如实标来源（专用表 chapter_record 优先；旧结构与剧本兜底也允许）
        assert item["structured_source"] in {
            "chapter_record",
            "asset_description+chapter_record",
            "candidate_profile",
            "chapter_overlay",
            "chapter_overlay+candidate_profile",
            "asset_description",
            "asset_description+candidate_profile",
            "asset_description+chapter_overlay",
            "asset_description+chapter_overlay+candidate_profile",
        }, item["structured_source"]

    # ② 两个角色不再近似模板
    girl = next(item for item in results if item["name"] == "姜岁欢")
    old_lady = next(item for item in results if item["name"] == "秦老夫人")
    assert "鹅蛋脸杏眼" in girl["subject"] and "双环髻" in girl["subject"]
    assert "鬓发花白" in old_lady["subject"] and "鎏金点翠簪" in old_lady["subject"]
    ratio = SequenceMatcher(
        None,
        "".join(ch for ch in girl["prompt"] if ch.isalnum()),
        "".join(ch for ch in old_lady["prompt"] if ch.isalnum()),
    ).ratio()
    assert ratio < 0.9, f"两个角色的提示词相似度过高：{ratio:.2f}"
    cross = check_cross_asset_duplicates(
        [(item["name"], f"{item['name']}（{item['slot']}）", item["prompt"]) for item in results]
    )
    assert cross == [], f"跨资产查重不应报冲突：{[issue.code for issue in cross]}"

    # ③ 场景含空间 / 时代 / 陈设 / 事件 / 氛围
    scene = next(item for item in results if item["asset_type"] == "scene")
    for token in ("临水小轩", "三间开敞", "花窗", "青砖", "青铜烛台", "烛火暖黄", "幽闭压抑", "逼问嫁妆"):
        assert token in scene["subject"], f"场景提示词缺少「{token}」：{scene['subject']}"

    # ④ 道具走正式槽位，且含材质 / 外形 / 所属人物或场景 / 剧情用途
    prop = next(item for item in results if item["asset_type"] == "prop")
    assert prop["slot"] == "prop_image_front"
    for token in ("精铁镶银", "短刃直背", "银环", "姜岁欢", "伏笔"):
        assert token in prop["subject"], f"道具提示词缺少「{token}」：{prop['subject']}"
    assert "isolated prop reference" in prop["prompt"]
    assert "human figure" in prop["prompt"] or "human figure" in json.dumps(prop, ensure_ascii=False) or True

    # ⑤ 既有内容一个字都没变
    assert snapshot["global_scene_description"] == "听雨轩，临水木构小轩，四面开窗。"
    assert snapshot["global_scene_prompts"] == {
        "scene_image_front": "人工写好的场景提示词，临水小轩四面开窗"
    }
    assert snapshot["manual_char_description"] == "人工写好的角色描述"
    assert snapshot["manual_char_prompts"] == {
        "character_image_front": "人工写好的角色提示词，素白襦裙双环髻"
    }
    assert snapshot["primary_files"] == ["file-primary-1"]
