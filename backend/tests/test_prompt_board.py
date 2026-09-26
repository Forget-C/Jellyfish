"""集级视频提示词看板：解析 / 匹配 / 覆盖模式 / 演练不落库。

用户流程修正后的硬要求（2026-09-19）：
- 一次导入 7~20 条要能按编号或顺序自动匹配；
- 数量不一致 / 编号重复 / 无法匹配必须拦下，**不能错位写入**；
- 覆盖模式默认"只填充空白镜头"，不得静默覆盖；
- 演练（未真调用大模型）时**不写库**，绝不把占位冒充成大模型产物。
"""

from __future__ import annotations

import pytest

from sqlalchemy import select

from app.models.studio import Chapter, Project, Shot, ShotDetail
from app.services.studio import prompt_board as board
from tests.llm_orchestration_fixtures import build_session


async def _seed_episode(db, *, count: int = 8, prompts: dict[int, str] | None = None) -> None:
    """建一集 count 个镜头；``prompts`` 指定第几镜已有提示词。"""
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人都市", visual_style="现实"))
    await db.flush()
    db.add(
        Chapter(id="proj-1::EP01", project_id="proj-1", index=1, title="EP01", raw_text="文本", condensed_text="文本")
    )
    await db.flush()
    given = prompts or {}
    for index in range(1, count + 1):
        shot_id = f"proj-1_EP01_SHOT_{index:03d}"
        db.add(
            Shot(
                id=shot_id,
                chapter_id="proj-1::EP01",
                index=index,
                title=f"镜头{index}",
                script_excerpt=f"第{index}镜的剧本摘录",
                status="ready",
            )
        )
        db.add(
            ShotDetail(
                id=shot_id,
                camera_shot="中景",
                angle="平视",
                movement="固定",
                video_prompt=given.get(index, ""),
                video_prompt_source="jurilu" if given.get(index) else "",
            )
        )
    await db.flush()


def test_split_import_text_handles_numbered_and_plain_blocks():
    numbered = "S001 第一镜提示词\n内容续行\n\n#2 第二镜提示词\n\n3、第三镜提示词"
    parsed = board.split_import_text(numbered)
    assert [item[0] for item in parsed] == [1, 2, 3]
    assert "内容续行" in parsed[0][1]

    plain = "第一段提示词\n\n第二段提示词\n\n第三段提示词"
    parsed_plain = board.split_import_text(plain)
    assert [item[0] for item in parsed_plain] == [None, None, None]
    assert [item[1] for item in parsed_plain] == ["第一段提示词", "第二段提示词", "第三段提示词"]


@pytest.mark.asyncio
async def test_match_by_number_reports_duplicates_and_blocks_save():
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=8)
        shots = await board.load_board(db, chapter_id="proj-1::EP01")
        preview = board.match_import_entries("S001 甲\nS001 乙\nS003 丙", shots)
    finally:
        await engine.dispose()

    assert len(preview.entries) == 3
    assert preview.entries[0].status == "ok"
    assert preview.entries[1].status == "duplicate"
    assert preview.save_allowed is False
    assert any("编号重复" in issue for issue in preview.issues)


@pytest.mark.asyncio
async def test_match_by_order_fills_free_shots_without_misaligning():
    """没编号时按顺序补**空位**，已按编号匹配的镜头不会被覆盖。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=8)
        shots = await board.load_board(db, chapter_id="proj-1::EP01")
        preview = board.match_import_entries("S005 第五镜\n\n无编号甲\n\n无编号乙", shots)
    finally:
        await engine.dispose()

    matched = {item.shot_id: item for item in preview.entries}
    assert matched["proj-1_EP01_SHOT_005"].matched_by == "number"
    order_matched = [item for item in preview.entries if item.matched_by == "order"]
    # 顺序匹配从 S001 开始补，跳过已被编号占用的 S005
    assert [item.shot_id for item in order_matched] == ["proj-1_EP01_SHOT_001", "proj-1_EP01_SHOT_002"]
    # 3 条 vs 8 镜：匹配都成功，但**数量不一致默认仍不允许整体保存**（可显式降级为仅保存已匹配项）
    assert preview.save_allowed is False
    assert preview.matched_only_save_allowed is True


@pytest.mark.asyncio
async def test_count_mismatch_is_reported_and_unmatched_blocks_save():
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=8)
        shots = await board.load_board(db, chapter_id="proj-1::EP01")
        # 12 条提示词 vs 8 个镜头：多出来的必须有明确状态，且不允许一键保存
        text = "\n".join(f"{i}. 第{i}条提示词" for i in range(1, 13))
        preview = board.match_import_entries(text, shots)
    finally:
        await engine.dispose()

    assert len(preview.entries) == 12
    assert len([item for item in preview.entries if item.status != "ok"]) == 4
    assert preview.save_allowed is False
    assert any("数量不一致" in issue for issue in preview.issues)


@pytest.mark.asyncio
async def test_count_mismatch_blocks_save_by_default_even_if_all_matched():
    """8 镜只导入 3 条：即使 3 条都匹配成功，默认也**必须拦住**整体保存。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=8)
        shots = await board.load_board(db, chapter_id="proj-1::EP01")
        preview = board.match_import_entries("S001 甲\n\nS002 乙\n\nS003 丙", shots)
        blocked = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[{"shot_id": item.shot_id, "prompt": item.prompt} for item in preview.entries],
            mode=board.MODE_FILL_EMPTY,
            origin="jurilu_import",
        )
        allowed = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[{"shot_id": item.shot_id, "prompt": item.prompt} for item in preview.entries],
            mode=board.MODE_FILL_EMPTY,
            origin="jurilu_import",
            allow_partial=True,
        )
    finally:
        await engine.dispose()

    assert preview.save_allowed is False          # 默认不许保存
    assert preview.count_mismatch is True
    assert preview.matched_only_save_allowed is True  # 但允许用户显式降级
    assert blocked["applied_count"] == 0 and "数量不一致" in blocked["error"]
    assert allowed["applied_count"] == 3          # 显式「仅保存已匹配项」后才落库


@pytest.mark.asyncio
async def test_save_rejects_duplicate_targets():
    """同一条镜头被写两次 → 直接拒绝（错位覆盖的典型征兆）。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=3)
        result = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[
                {"shot_id": "proj-1_EP01_SHOT_001", "prompt": "甲"},
                {"shot_id": "proj-1_EP01_SHOT_001", "prompt": "乙"},
            ],
            mode=board.MODE_FILL_EMPTY,
            allow_partial=True,
        )
    finally:
        await engine.dispose()

    assert result["applied_count"] == 0
    assert "重复指定" in result["error"]


@pytest.mark.asyncio
async def test_save_default_mode_only_fills_empty_shots():
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=8, prompts={2: "已有人工提示词"})
        result = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[
                {"shot_id": "proj-1_EP01_SHOT_001", "prompt": "新甲"},
                {"shot_id": "proj-1_EP01_SHOT_002", "prompt": "会覆盖吗"},
            ],
            mode=board.MODE_FILL_EMPTY,
            origin="jurilu_import",
            allow_partial=True,  # 本用例只验证"覆盖模式"语义，故显式允许部分保存
        )
        shot1 = await db.get(ShotDetail, "proj-1_EP01_SHOT_001")
        shot2 = await db.get(ShotDetail, "proj-1_EP01_SHOT_002")
    finally:
        await engine.dispose()

    assert result["applied_count"] == 1
    assert result["skipped_count"] == 1
    assert any("只填充空白镜头" in item["reason"] for item in result["results"] if not item["applied"])
    assert shot1.video_prompt == "新甲"
    assert shot1.video_prompt_source == "jurilu"
    assert shot2.video_prompt == "已有人工提示词"  # 未被静默覆盖


@pytest.mark.asyncio
async def test_generate_returns_drafts_and_never_writes_to_db(monkeypatch):
    """批量生成只出草稿：**未确认前一个字节都不落库**（演练模式同样如此）。"""
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")
    monkeypatch.delenv("JELLYFISH_REAL_LLM_CONFIRMED", raising=False)

    db, engine = await build_session()
    try:
        await _seed_episode(db, count=3)
        # 逐镜调用（页面维护队列）：一镜一次请求，演练模式下不落库
        results = [
            await board.generate_draft(db, chapter_id="proj-1::EP01", shot_id=f"proj-1_EP01_SHOT_{i:03d}")
            for i in (1, 2, 3)
        ]
        rows = [await db.get(ShotDetail, f"proj-1_EP01_SHOT_{i:03d}") for i in (1, 2, 3)]
    finally:
        await engine.dispose()

    assert all(item["status"] == "dry_run" for item in results)
    assert all(not (row.video_prompt or "").strip() for row in rows)


@pytest.mark.asyncio
async def test_entity_create_with_shot_marks_candidate_linked_for_all_asset_types():
    """就地新建（带 shot_id）必须把候选回写为 linked —— 场景/道具/服装也要（回归点）。

    修改前：character 走 upsert_shot_character_link（内部会回写），而 scene/prop/costume
    走通用 upsert_project_link（不管候选）→ 候选停在 pending，镜头永远 ready 不了。
    """
    from app.models.studio import ShotCandidateStatus, ShotExtractedCandidate
    from app.services.studio import entity_crud

    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        for candidate_id, (entity_type, name) in enumerate(
            [("character", "林小满"), ("scene", "咖啡店"), ("prop", "雨伞"), ("costume", "林小满日常装")],
            start=1,
        ):
            db.add(
                ShotExtractedCandidate(
                    id=candidate_id,
                    shot_id="proj-1_EP01_SHOT_001",
                    candidate_type=entity_type,
                    candidate_name=name,
                    candidate_status=ShotCandidateStatus.pending,
                )
            )
        await db.flush()

        created_ids: dict[str, str] = {}
        for entity_type, name in [("character", "林小满"), ("scene", "咖啡店"), ("prop", "雨伞"), ("costume", "林小满日常装")]:
            payload = await entity_crud.create_entity(
                db,
                entity_type=entity_type,
                body={
                    "id": f"{entity_type}_{name}",
                    "name": name,
                    "description": "",
                    "project_id": "proj-1",
                    "chapter_id": "proj-1::EP01",
                    "shot_id": "proj-1_EP01_SHOT_001",
                    "visual_style": "现实",
                    "style": "真人都市",
                },
            )
            created_ids[entity_type] = str(payload.get("id") or "")

        rows = (
            await db.execute(
                select(ShotExtractedCandidate).where(ShotExtractedCandidate.shot_id == "proj-1_EP01_SHOT_001")
            )
        ).scalars().all()
        statuses = {row.candidate_type: row.candidate_status for row in rows}
        linked_ids = {row.candidate_type: row.linked_entity_id for row in rows}
    finally:
        await engine.dispose()

    for entity_type in ("character", "scene", "prop", "costume"):
        assert statuses[entity_type] == ShotCandidateStatus.linked, f"{entity_type} 候选未被回写为 linked"
        assert linked_ids[entity_type] == created_ids[entity_type]


@pytest.mark.asyncio
async def test_llm_origin_requires_backend_draft_token():
    """声明"来自大模型"必须带后端签发的草稿令牌：手工粘贴内容标不成 llm。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        forged = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[{"shot_id": "proj-1_EP01_SHOT_001", "prompt": "我手写的一段"}],
            mode=board.MODE_FILL_EMPTY,
            origin="llm_draft",
            allow_partial=True,
        )
        token = board.draft_token(shot_id="proj-1_EP01_SHOT_001", prompt="模型生成的一段")
        genuine = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[
                {"shot_id": "proj-1_EP01_SHOT_001", "prompt": "模型生成的一段", "draft_token": token}
            ],
            mode=board.MODE_FILL_EMPTY,
            origin="llm_draft",
            allow_partial=True,
        )
        row = await db.get(ShotDetail, "proj-1_EP01_SHOT_001")
    finally:
        await engine.dispose()

    assert forged["applied_count"] == 0
    assert any("草稿令牌" in item["reason"] for item in forged["results"])
    assert genuine["applied_count"] == 1
    assert row.video_prompt == "模型生成的一段"
    assert row.video_prompt_source == "llm"


@pytest.mark.asyncio
async def test_source_is_decided_by_flow_not_by_client():
    """同一段文字，按不同流程来源写入时记录的 source 必须不同。"""
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=2)
        await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[{"shot_id": "proj-1_EP01_SHOT_001", "prompt": "外部平台内容"}],
            mode=board.MODE_FILL_EMPTY,
            origin="external_import",
            allow_partial=True,
        )
        await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[{"shot_id": "proj-1_EP01_SHOT_002", "prompt": "巨日禄内容"}],
            mode=board.MODE_FILL_EMPTY,
            origin="jurilu_import",
            allow_partial=True,
        )
        first = await db.get(ShotDetail, "proj-1_EP01_SHOT_001")
        second = await db.get(ShotDetail, "proj-1_EP01_SHOT_002")
    finally:
        await engine.dispose()

    assert first.video_prompt_source == "external_import"
    assert second.video_prompt_source == "jurilu"


@pytest.mark.asyncio
async def test_save_without_origin_is_rejected():
    db, engine = await build_session()
    try:
        await _seed_episode(db, count=1)
        result = await board.save_entries(
            db,
            chapter_id="proj-1::EP01",
            entries=[{"shot_id": "proj-1_EP01_SHOT_001", "prompt": "x"}],
            mode=board.MODE_FILL_EMPTY,
            allow_partial=True,
        )
    finally:
        await engine.dispose()

    assert result["applied_count"] == 0
    assert "origin" in result["error"]
