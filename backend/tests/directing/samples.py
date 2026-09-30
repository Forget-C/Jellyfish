"""三段可复用验收故事：对白、交接、多人反应。纯业务样例不调用模型。"""

from copy import deepcopy

SOURCE = {"kind": "human", "reference": "author", "version": "brief-1"}


def note(text):
    """给创作提议保留人工来源。"""
    return {"state": "proposal", "text": text, "sources": [SOURCE]}


def notes(**values):
    """将同一工作单的有语义文字转换为带来源字段。"""
    return {key: note(value) for key, value in values.items()}


def design_sample(story="dialogue"):
    """返回独立样例，可改动一处而不污染其他测试。"""
    stories = {
        "dialogue": ("哥哥提出借钱，弟弟回避", "借钱请求", "弟弟停下擦杯并看向门口"),
        "handover": ("哥哥交出借条，弟弟不接", "借条触桌", "纸从哥哥右手落到桌面"),
        "crowd": ("店内众人先后察觉争执", "杯子碰桌", "弟弟先停手，店员稍后抬眼"),
    }
    intent, event, action = stories[story]
    data = {
        "sources": [SOURCE],
        "participants": [{"id": "brother", "name": "哥哥"}, {"id": "younger", "name": "弟弟"}, {"id": "waiter", "name": "店员"}],
        "events": [{"id": "request", "description": note(event)}, {"id": "reaction", "description": note(action)}],
        "criteria": [{"id": "visible", "requirement": note("杯子、纸张和手部持续可见")}],
        "direction": {
            **notes(viewpoint="弟弟的反应", information_change=intent, relationship_change="信任动摇", turning_point=action,
                    spatial_basis="兄弟隔桌，店员后景", shootable_area="桌子和门口", axis="兄弟连线同侧", scale="两人相距一张桌宽", control_level="保持交接因果"),
            "immutable_facts": [note("纸张开始在哥哥手中")], "open_questions": [],
            "anchors": [{"id": "table", "description": note("靠门的方桌")}],
            "beats": [{"id": "b1", "event_ids": ["request"], **notes(objective="提出请求", obstacle="弟弟回避", expected_change="迫使回应", must_show=event)},
                      {"id": "b2", "event_ids": ["reaction"], **notes(objective="不作承诺", obstacle="哥哥追问", expected_change="关系紧张", must_show=action)}],
            "blocking_states": [{"id": "seated", "participant_id": "younger", "anchor_ids": ["table"], "event_id": "reaction",
                                 **notes(position="桌子右侧", orientation="面向哥哥", initiative="被动回应", path="保持坐姿", transition_reason="听到请求")}],
            "shots": [{"id": "s1", "beat_ids": ["b1"], "event_ids": ["request"], "blocking_state_ids": ["seated"], "participant_ids": ["brother", "younger"], "criterion_ids": ["visible"],
                       **notes(narrative_function="建立关系并提出请求", visible_result=event), "estimated_duration_ms": 4000},
                      {"id": "s2", "beat_ids": ["b2"], "event_ids": ["reaction"], "blocking_state_ids": ["seated"], "participant_ids": ["younger"], "criterion_ids": ["visible"],
                       **notes(narrative_function="看到回应", visible_result=action), "estimated_duration_ms": 5000}],
        },
        "performance": {"applicability": note("兄弟的微动作构成主叙事"),
                        "situations": [{"participant_id": "younger", **notes(situation="不愿借钱", relationship="对哥哥有所防备")}],
                        "beats": [{"beat_id": "b2", "participant_id": "younger", "received_event_ids": ["request"], "dialogue_ids": ["d1"], "criterion_ids": ["visible"],
                                   **notes(objective="回避承诺", obstacle="哥哥等待", subtext="不信任", attention="纸张", internal_adjustment="由随意转紧绷", physical_action=action,
                                           delivery="压低声音", reaction_order="先停手再移开目光", exit_state="目光朝门", avoid="无缘由大幅转头", hands="杯子留在手中")}]},
        "staging": {"activities": [{"participant_id": "waiter", "anchor_id": "table", "trigger_event_id": "reaction",
                                   **notes(depth="后景", ongoing_task="收碗", path="沿柜台", attention="餐具", reaction_delay="主角反应后才抬眼", intensity="低", entrances_exits="留在画内", narrative_support="不抢主戏", end_state="继续收碗")}],
                    "environment": note("门外有轻微人流"), "intentional_absence": {"state": "not_applicable", "reason": "有背景活动"}},
        "cinematography": [],
        "continuity": [{"id": "paper", "domain": "hands_props", "participant_id": "brother", "event_id": "request",
                        **notes(before="纸在右手", change="伸手递纸", after="纸在桌上", following_constraint="不凭空消失")}],
        "sound": {"dialogues": [{"id": "d1", "participant_id": "younger", "version": "1", "content": note("我再想想")}],
                  **notes(sources="人物口中", ambience_actions="瓷杯和餐具", music_constraints="对白时不加音乐"), "execution": "postproduction"},
        "prompt": notes(priorities="先保证动作因果", binding_requirements="保持两人身份及桌子空间", sound_strategy="对白待后期", prohibitions="道具不得消失"),
    }
    for shot in ("s1", "s2"):
        data["cinematography"].append({"shot_id": shot, "criterion_ids": ["visible"],
            **notes(composition="手部和杯子在画内", depth_layers="兄弟前景店员后景", viewpoint="桌子同侧", position="桌边", height_angle="平视", lens_effect="正常空间透视",
                    depth_focus="对焦弟弟", support="固定支撑", movement_start="固定", movement_trigger="无需运动", movement_path="无", movement_speed="静止", end_frame="弟弟看向门口",
                    light_sources="窗光", light_regions="窗边柔光", exposure_color="保持稳定", optical_effects="无", motion_texture="自然", technical_parameters="待目标模型核验",
                    adjacent_requirements="保持桌轴同侧", prohibitions="不越轴")})
    return deepcopy(data)


def plan_sample(design_revision_id="design1"):
    """同一计划同时包含多镜单元和仅覆盖反应的补拍单元。"""
    return {"design_revision_id": design_revision_id, "units": [
        {"id": "u1", "coverage": [
            {"id": "c1", "shot_id": "s1", "beat_ids": ["b1"], "event_ids": ["request"], "action_scope": "提出请求"},
            {"id": "c2", "shot_id": "s2", "beat_ids": ["b2"], "event_ids": ["reaction"], "action_scope": "弟弟停手并回避"}],
         "references": [], "model_id": "model1", "duration_ms": 9000, "ratio": "16:9", "capability": {}},
        {"id": "u2", "coverage": [
            {"id": "c3", "shot_id": "s2", "beat_ids": ["b2"], "event_ids": ["reaction"], "action_scope": "只补停手后的目光"}],
         "references": [], "model_id": "model1", "duration_ms": 3000, "ratio": "16:9", "capability": {}}
    ]}
