"""可拍叙事关系和格式边界的离线验收，不把结构合法视为成片质量。"""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.core.contracts.directing import SceneDesign, ProductionPlan, ReviewPacket, SequenceCut
from app.core.contracts.directing.common import Note, ROLES
from tests.directing.samples import SOURCE, design_sample, plan_sample


@pytest.mark.parametrize("story", ["dialogue", "handover", "crowd"])
def test_story_roundtrip(story):
    """三个故事多岗信息无损往返，拆镜不复制原表演行。"""
    original = SceneDesign.model_validate(design_sample(story))
    assert SceneDesign.model_validate_json(original.model_dump_json()) == original
    value = original.model_dump(mode="json")
    shot = deepcopy(value["direction"]["shots"][1])
    shot["id"] = "s3"
    value["direction"]["shots"].append(shot)
    split = SceneDesign.model_validate(value)
    assert split.performance == original.performance
    assert len(split.direction.shots) == 3


@pytest.mark.parametrize("path,value", [
    (("performance", "beats", 0, "beat_id"), "other-version"),
    (("staging", "activities", 0, "trigger_event_id"), "missing"),
    (("cinematography", 0, "shot_id"), "missing"),
    (("direction", "shots", 0, "id"), "../bad"),
    (("direction", "shots", 1, "id"), "s1"),
    (("direction", "shots", 0, "estimated_duration_ms"), "4000"),
])
def test_invalid_shared_references(path, value):
    """未知、重复身份和隐式数值转换在写入前被拒绝。"""
    data = design_sample()
    node = data
    for part in path[:-1]:
        node = node[part]
    node[path[-1]] = value
    with pytest.raises(ValidationError):
        SceneDesign.model_validate(data)


def test_missing_role_and_unknown_field_are_errors():
    """工作单缺失不等于通过，模型不能夹带确认字段。"""
    data = design_sample()
    del data["staging"]
    with pytest.raises(ValidationError):
        SceneDesign.model_validate(data)
    data = design_sample()
    data["confirmed_by"] = "model"
    with pytest.raises(ValidationError):
        SceneDesign.model_validate(data)


@pytest.mark.parametrize("value", [{"state": "fact", "text": "事实"}, {"state": "not_applicable"}, {"state": "none"}, {"state": "unknown", "text": "已确认"}])
def test_information_states(value):
    """事实需要来源，不适用/明确无需要理由，未知不能伪造内容。"""
    with pytest.raises(ValidationError):
        Note.model_validate(value)


def test_unit_relations_and_capability():
    """多镜和局部单元可表达，但不自动宣称多镜生成已验证。"""
    plan = ProductionPlan.model_validate(plan_sample())
    assert len(plan.units[0].coverage) == 2
    assert plan.units[1].coverage[0].shot_id == "s2"
    assert plan.units[0].capability.multi_shot == "unknown"
    bad = plan_sample()
    bad["units"][0]["coverage"].append(deepcopy(bad["units"][0]["coverage"][0]))
    with pytest.raises(ValidationError, match="duplicate coverage"):
        ProductionPlan.model_validate(bad)
    bad = plan_sample()
    bad["units"][0]["dependencies"] = [{"plan_revision_id": "old-plan", "unit_id": "u2", "frame_id": "frame"}]
    with pytest.raises(ValidationError, match="同时选择"):
        ProductionPlan.model_validate(bad)
    bad["units"][0]["dependencies"] = [{"plan_revision_id": "old-plan", "unit_id": "u2"}] * 2
    with pytest.raises(ValidationError, match="duplicate unit dependency"):
        ProductionPlan.model_validate(bad)
    bad = plan_sample()
    bad["units"][0]["capability"] = {"multi_shot": "supported"}
    with pytest.raises(ValidationError, match="evidence"):
        ProductionPlan.model_validate(bad)


def review_sample():
    """同一镜头在两个提示词中出现，生成十八条而非十二条审稿行。"""
    occurrences = [
        {"id": "o1", "prompt_revision_id": "p1", "plan_revision_id": "plan1", "unit_id": "u1", "coverage_item_id": "c1", "shot_id": "s1", "local_number": 1},
        {"id": "o2", "prompt_revision_id": "p1", "plan_revision_id": "plan1", "unit_id": "u1", "coverage_item_id": "c2", "shot_id": "s2", "local_number": 2},
        {"id": "o3", "prompt_revision_id": "p2", "plan_revision_id": "plan1", "unit_id": "u2", "coverage_item_id": "c3", "shot_id": "s2", "local_number": 1},
    ]
    return {"mode": "formal", "roles": list(ROLES), "occurrences": occurrences, "context": {},
            "rows": [{"role": role, "occurrence_id": o["id"], "verdict": "pending", "rationale": "待人工核对", "findings": []} for role in ROLES for o in occurrences]}


def test_subject_group_contract():
    """同组表达相同主体和用途，不得与旧参考的模型名称冲突。"""
    data = plan_sample()
    binding = {"id": "r1", "file_id": "image1", "media_kind": "image", "purpose": "identity",
               "participant_ids": ["brother"], "ordinal": 0, "source": SOURCE,
               "input_role": "subject", "subject_group_id": "person",
               "asset_origin": {"kind": "character", "id": "role1", "name": "哥哥"}}
    data["units"][0]["references"] = [binding, {**binding, "id": "r2", "ordinal": 1}]
    assert ProductionPlan.model_validate(data).units[0].references[0].subject_group_id == "person"
    for patch in ({"purpose": "space"}, {"participant_ids": ["younger"]},
                  {"asset_origin": None}, {"input_role": "first_frame"}):
        bad = deepcopy(data)
        bad["units"][0]["references"][1].update(patch)
        with pytest.raises(ValidationError):
            ProductionPlan.model_validate(bad)
    bad = deepcopy(data)
    bad["units"][0]["references"][1].update(id="person", subject_group_id=None)
    with pytest.raises(ValidationError):
        ProductionPlan.model_validate(bad)


def test_exact_six_role_manifest():
    """重复/漏审不能满足六乘 N，结构完整也仍为 pending。"""
    packet = ReviewPacket.model_validate(review_sample())
    assert len(packet.rows) == 18 and all(r.verdict == "pending" for r in packet.rows)
    for action in ("missing", "duplicate", "number", "roles"):
        data = review_sample()
        if action == "missing":
            data["rows"].pop()
        elif action == "duplicate":
            data["rows"].append(data["rows"][0])
        elif action == "number":
            data["occurrences"][1]["local_number"] = 1
        else:
            data["roles"].pop()
        with pytest.raises(ValidationError):
            ReviewPacket.model_validate(data)


@pytest.mark.parametrize("item", [
    {"kind": "planned", "id": "x", "design_revision_id": "d", "shot_id": "s", "timeline_start_ms": 0, "media_range": {"source_in_ms": 0, "source_out_ms": 10}},
    {"kind": "media", "id": "x", "take_id": "t", "timeline_start_ms": 0, "estimated_duration_ms": 100},
    {"kind": "media", "id": "x", "take_id": "t", "timeline_start_ms": 0, "media_range": {"source_in_ms": 50, "source_out_ms": 10}},
])
def test_planned_actual_range_separation(item):
    """计划时长和实际源时间码不可互换。"""
    with pytest.raises(ValidationError):
        SequenceCut.model_validate({"items": [item]})
