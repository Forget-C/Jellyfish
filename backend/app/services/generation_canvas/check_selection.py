"""从已采用依据派生当前检查范围，用户选择独立持久化。"""
from app.schemas.canvas_checks import CanvasCheckCategory, CanvasCheckItem, CanvasCheckOmission
from app.schemas.generation_canvas import CheckCard
from app.services.generation_canvas.check_adoption import ADOPTION_CATEGORY, ADOPTION_LABEL, adoption_checks
from app.services.generation_canvas.check_duration import DURATION_CATEGORY, DURATION_LABEL, duration_checks
from app.services.generation_canvas.check_reference_media import REFERENCE_CATEGORY, REFERENCE_LABEL
from app.services.generation_canvas.check_requirement_quality import (
    CONSISTENCY_CATEGORY, CONSISTENCY_LABEL, REVIEWABILITY_CATEGORY, REVIEWABILITY_LABEL,
    consistency_checks, reviewability_checks,
)
from app.services.generation_canvas.check_rhythm import RHYTHM_CATEGORY, RHYTHM_LABEL, rhythm_checks
from app.services.generation_canvas.check_sequence import (
    ACTION_CATEGORY, ACTION_LABEL, CONTINUITY_CATEGORY, CONTINUITY_LABEL, sequence_checks,
)
from app.services.generation_canvas.check_sound_capability import (
    SOUND_CAPABILITY_CATEGORY, SOUND_CAPABILITY_LABEL, sound_capability_checks,
)

CHECK_CATEGORY_LABELS = {
    DURATION_CATEGORY: DURATION_LABEL, ADOPTION_CATEGORY: ADOPTION_LABEL, CONSISTENCY_CATEGORY: CONSISTENCY_LABEL,
    REVIEWABILITY_CATEGORY: REVIEWABILITY_LABEL, REFERENCE_CATEGORY: REFERENCE_LABEL,
    ACTION_CATEGORY: ACTION_LABEL, CONTINUITY_CATEGORY: CONTINUITY_LABEL, RHYTHM_CATEGORY: RHYTHM_LABEL,
    SOUND_CAPABILITY_CATEGORY: SOUND_CAPABILITY_LABEL,
}


def initial_check_categories() -> list[str]:
    """仅初始化新卡；旧卡保留其已知类别的明确选择。"""
    return list(CHECK_CATEGORY_LABELS)


def describe_category(card: CheckCard, category: str, items: list[CanvasCheckItem],
                      not_applicable: str) -> CanvasCheckCategory:
    """提供适用状态及原因，不因检查不可执行而隐藏适用项。"""
    members = [item for item in items if item.category == category]
    ready = any(item.availability == 'ready' for item in members)
    availability = 'ready' if ready else 'unavailable' if members else 'not_applicable'
    return CanvasCheckCategory(id=category, label=CHECK_CATEGORY_LABELS[category], enabled=category in card.enabled_categories,
                               availability=availability, reason=None if ready else members[0].reason if members else not_applicable)


def check_items(basis, card: CheckCard, model_unavailable: str | None):
    """共用来源派生结果，使预览、整卡和单项执行使用同一范围。"""
    items, comparisons, duration_observations = duration_checks(basis, card, model_unavailable)
    categories = [describe_category(card, DURATION_CATEGORY, items, '未采用可核对时长的镜头设计')]
    adopted, observations = adoption_checks(basis, card, model_unavailable)
    categories.append(describe_category(card, ADOPTION_CATEGORY, adopted, '未采用可核对的设计或验收要求'))
    consistency, consistency_observations = consistency_checks(basis, card, model_unavailable)
    categories.append(describe_category(card, CONSISTENCY_CATEGORY, consistency, '未采用两条可对照的设计或补充要求'))
    reviewability, reviewability_observations = reviewability_checks(basis, card, model_unavailable)
    categories.append(describe_category(card, REVIEWABILITY_CATEGORY, reviewability, '未采用需要核对的验收要求、约束或可见结果'))
    sequence, sequence_observations = sequence_checks(basis, card, model_unavailable)
    categories += [
        describe_category(card, ACTION_CATEGORY, sequence, '未采用可核对的动作、反应或调度要求'),
        describe_category(card, CONTINUITY_CATEGORY, sequence, '未采用可核对的前后态、变化或保持要求'),
    ]
    rhythm, rhythm_observations = rhythm_checks(basis, card, model_unavailable)
    categories.append(describe_category(card, RHYTHM_CATEGORY, rhythm, '未采用可核对的动作、运镜或对白要求'))
    sound, sound_rules, sound_observations = sound_capability_checks(basis, card, model_unavailable)
    categories.append(describe_category(card, SOUND_CAPABILITY_CATEGORY, sound, '未采用有效对白、声音安排或声音策略'))
    return (categories, items + adopted + consistency + reviewability + sequence + rhythm + sound, comparisons | sound_rules,
            observations | consistency_observations | reviewability_observations | sequence_observations
            | duration_observations | rhythm_observations | sound_observations)


def select_check_items(items: list[CanvasCheckItem], item_id: str | None) -> tuple[list[CanvasCheckItem], list[CanvasCheckOmission]]:
    """整卡记录关闭和不可执行；显式单项只覆盖用户指定的身份。"""
    if item_id is not None:
        return [item for item in items if item.id == item_id and item.availability == 'ready'], []
    selected, omitted = [], []
    for item in items:
        if not item.enabled:
            omitted.append(CanvasCheckOmission(item_id=item.id, label=item.label, source_card_id=item.source.card_id,
                                               status='disabled', reason='类别或单项已关闭'))
        elif item.availability == 'unavailable':
            omitted.append(CanvasCheckOmission(item_id=item.id, label=item.label, source_card_id=item.source.card_id,
                                               status='unavailable', reason=item.reason or '检查依据不足'))
        else:
            selected.append(item)
    return selected, omitted
