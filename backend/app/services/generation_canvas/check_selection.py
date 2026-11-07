"""从已采用依据派生当前检查范围，用户选择独立持久化。"""
from app.schemas.canvas_checks import CanvasCheckCategory, CanvasCheckItem, CanvasCheckOmission
from app.schemas.generation_canvas import CheckCard
from app.services.generation_canvas.check_duration import DURATION_CATEGORY, DURATION_LABEL, duration_checks

CHECK_CATEGORY_LABELS = {DURATION_CATEGORY: DURATION_LABEL}


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


def check_items(basis, card: CheckCard):
    """共用来源派生结果，使预览、整卡和单项执行使用同一范围。"""
    items, comparisons = duration_checks(basis, card)
    categories = [describe_category(card, DURATION_CATEGORY, items, '未采用可核对时长的镜头设计')]
    return categories, items, comparisons


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
