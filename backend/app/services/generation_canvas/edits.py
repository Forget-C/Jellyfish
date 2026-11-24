"""在普通后端事务中预演并提交画布编辑，按改动组保存执行回执。"""

from copy import deepcopy
from hashlib import sha256
from typing import TYPE_CHECKING, Annotated, Literal, Protocol, overload

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StringConstraints, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.scene_storyboard import StoryboardApplication, StoryboardDiff, StoryboardRestore
from app.models.generation_canvas import GenerationCanvas
from app.schemas.generation_canvas import (
    CanvasCard, CanvasDiagnostic, CanvasDocument, CanvasRead, CanvasSave, GenerationCanvasEdge, GenerationCanvasGroup,
)
from app.services.generation_canvas.errors import CanvasDomainError, diagnostic
from app.services.generation_canvas.graph_edit import append_edge, remove_card, remove_edges
from app.services.generation_canvas.store import CanvasStore

if TYPE_CHECKING:
    from app.schemas.canvas_assistant_draft import CanvasDraftSave

Identity = Annotated[str, StringConstraints(min_length=1, max_length=64)]
_ENTITY_FIELDS = ('cards', 'edges', 'groups')


class CanvasEditGroup(BaseModel):
    """依赖顺序内提交一组稳定身份的创建、替换或删除。"""

    model_config = ConfigDict(extra='forbid')

    id: Identity
    depends_on: tuple[Identity, ...] = ()
    source_card_ids: tuple[Identity, ...] = ()
    cards: list[CanvasCard] = Field(default_factory=list)
    edges: list[GenerationCanvasEdge] = Field(default_factory=list)
    groups: list[GenerationCanvasGroup] = Field(default_factory=list)
    remove_cards: set[Identity] = Field(default_factory=set)
    remove_edges: set[Identity] = Field(default_factory=set)
    remove_groups: set[Identity] = Field(default_factory=set)

    @model_validator(mode='after')
    def require_distinct_targets(self):
        """同组中的每项改动由一个稳定身份定位。"""
        for field in _ENTITY_FIELDS:
            targets = [item.id for item in getattr(self, field)]
            if len(set(targets)) != len(targets) or set(targets) & getattr(self, 'remove_' + field):
                raise ValueError('同一改动组中不能重复编辑同一个身份')
        return self


class CanvasEditValue(BaseModel):
    """区分字段缺失与字段值为空。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    exists: bool = False
    value: JsonValue = None


class CanvasEditDifference(BaseModel):
    """路径内按身份定位卡片、连线和编组，便于对照当前字段。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    path: tuple[str, ...] = Field(min_length=1)
    before: CanvasEditValue
    after: CanvasEditValue


class CanvasEditGroupPreview(BaseModel):
    """一组预演的差异及其依赖。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    id: Identity
    depends_on: tuple[Identity, ...]
    differences: tuple[CanvasEditDifference, ...]
    source_guards: tuple[CanvasEditDifference, ...] = ()


class CanvasEditPreview(BaseModel):
    """在指定画布修订生成，可在实际执行之前送审。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    canvas_id: str
    revision: int
    groups: tuple[CanvasEditGroupPreview, ...]


class CanvasEditConflict(BaseModel):
    """并列展示预演原值、当前值和建议。"""

    difference: CanvasEditDifference
    current: CanvasEditValue


class CanvasEditGroupReceipt(BaseModel):
    """实际执行结果。依赖未生效时保留受阻原因。"""

    group_id: str
    state: Literal['applied', 'no_change', 'conflict', 'blocked']
    conflicts: tuple[CanvasEditConflict, ...] = ()
    blocked_by: tuple[str, ...] = ()
    diagnostic: CanvasDiagnostic | None = None


class CanvasEditReceipt(BaseModel):
    """同一个请求身份可查回原效果，即使后来画布再次变化。"""

    request_id: str
    canvas_id: str
    revision: int
    groups: tuple[CanvasEditGroupReceipt, ...]


class CanvasLayoutPoint(BaseModel):
    """浏览器投影中的卡片坐标。"""

    model_config = ConfigDict(extra='forbid', frozen=True)

    x: float = Field(ge=-1000000, le=1000000)
    y: float = Field(ge=-1000000, le=1000000)


class CanvasLayoutPreview(BaseModel):
    """宿主提供位置快照，画布协议生成可核对的位置差异。"""

    canvas_id: str
    before: dict[str, CanvasLayoutPoint]
    after: dict[str, CanvasLayoutPoint]


class CanvasLayoutProjection(BaseModel):
    """宿主可以应用的投影结果，位置仍由浏览器持有。"""

    state: Literal['projected', 'no_change', 'conflict']
    positions: dict[str, CanvasLayoutPoint]
    conflicts: tuple[str, ...] = ()


class CanvasEdits(Protocol):
    """普通可信业务调用方的画布编辑能力，调用方管理事务与审批。"""

    async def save(self, canvas_id: str, command: CanvasSave) -> dict:
        """保存编辑器提交的整份文档。"""
        ...

    async def preview(self, canvas_id: str, groups: list[CanvasEditGroup]) -> CanvasEditPreview:
        """预演候选并返回经过业务校验的实际差异。"""
        ...

    async def submit(self, plan: CanvasEditPreview, *, request_id: str,
                     group_ids: tuple[str, ...] | None = None) -> CanvasEditReceipt:
        """应用选中的组，并以稳定请求身份返回原执行回执。"""
        ...

    async def read_receipt(self, canvas_id: str, request_id: str) -> CanvasEditReceipt | None:
        """读取原提交的结果。"""
        ...

    async def preview_layout(self, canvas_id: str, positions: dict[str, CanvasLayoutPoint],
                             desired: dict[str, CanvasLayoutPoint]) -> CanvasLayoutPreview:
        """基于宿主提供的当前卡片位置预演移动。"""
        ...

    async def project_layout(self, plan: CanvasLayoutPreview,
                             positions: dict[str, CanvasLayoutPoint]) -> CanvasLayoutProjection:
        """用最新布局核对差异并计算供宿主应用的新投影。"""
        ...


class FreeCanvasEdits(CanvasEdits, Protocol):
    """自由画布还支持编辑器的首次保存。"""

    async def save_free_draft(self, canvas_id: str, command: 'CanvasDraftSave') -> dict:
        """从尚未保存的草稿创建画布，重放可查询原结果。"""
        ...


class SceneStoryboardEdits(Protocol):
    """按场次受理候选应用，沿用已经核对的来源及应用回执。"""

    @overload
    async def apply_storyboard(self, chapter_id: str, sequence_id: str, task_id: str,
                               body: StoryboardApplication, *, preview: Literal[True]) -> StoryboardDiff: ...

    @overload
    async def apply_storyboard(self, chapter_id: str, sequence_id: str, task_id: str,
                               body: StoryboardApplication, *, preview: Literal[False] = False) -> CanvasRead: ...

    async def restore_storyboard(self, chapter_id: str, sequence_id: str, task_id: str,
                                 body: StoryboardRestore) -> CanvasRead:
        """按原应用回执撤销或重做。"""
        ...


def free_canvas_edits(db: AsyncSession) -> FreeCanvasEdits:
    """绑定自由画布草稿与编辑入口。"""
    return _CanvasEdits(db, None)


def canvas_edits(db: AsyncSession, project_id: str | None) -> CanvasEdits:
    """使用调用方已授权的项目或自由画布范围。"""
    return _CanvasEdits(db, project_id)


def scene_storyboard_edits(db: AsyncSession, project_id: str) -> SceneStoryboardEdits:
    """绑定普通后端调用方已授权的分镜画布编辑范围。"""
    from app.services.directing.scene_storyboard import SceneStoryboardService

    return SceneStoryboardService(db, project_id)


def _indexed(document: CanvasDocument) -> dict:
    data = document.model_dump(mode='json')
    for field in _ENTITY_FIELDS:
        data[field] = {row['id']: row for row in data[field]}
    return data


def _document_data(indexed: dict) -> dict:
    return {field: list(value.values()) if field in _ENTITY_FIELDS else value for field, value in indexed.items()}


def _value(mapping: dict, key: str) -> CanvasEditValue:
    return CanvasEditValue(exists=True, value=mapping[key]) if key in mapping else CanvasEditValue()


def _differences(before: dict, after: dict, path: tuple[str, ...] = ()) -> list[CanvasEditDifference]:
    changes = []
    for key in dict.fromkeys([*before, *after]):
        original, desired = _value(before, key), _value(after, key)
        if original == desired:
            continue
        key_path = (*path, key)
        if isinstance(original.value, dict) and isinstance(desired.value, dict):
            changes.extend(_differences(original.value, desired.value, key_path))
        else:
            changes.append(CanvasEditDifference(path=key_path, before=original, after=desired))
    return changes


def _against(document: dict, change: CanvasEditDifference) -> tuple[dict | None, CanvasEditValue]:
    parent = document
    for item in change.path[:-1]:
        parent = parent.get(item) if isinstance(parent, dict) else None
    if isinstance(parent, dict):
        return parent, _value(parent, change.path[-1])
    return None, CanvasEditValue()


def _apply(document: dict, differences: tuple[CanvasEditDifference, ...]) -> list[CanvasEditConflict]:
    conflicts, pending = [], []
    for change in differences:
        parent, current = _against(document, change)
        if parent is not None and current == change.after:
            continue
        if parent is None or current != change.before:
            conflicts.append(CanvasEditConflict(difference=change, current=current))
        else:
            pending.append((parent, change))
    if conflicts:
        return conflicts
    for parent, change in pending:
        key = change.path[-1]
        if change.after.exists:
            parent[key] = change.after.model_dump()['value']
        else:
            parent.pop(key, None)
    return []


def _receipt_key(request_id: str) -> str:
    return 'canvas-edit:' + sha256(request_id.encode()).hexdigest()[:52]


def _replace_entities(current: list, replacements: list) -> list:
    indexed = {item.id: item for item in current}
    for item in replacements:
        indexed[item.id] = item.model_copy(deep=True)
    return list(indexed.values())


def _replace_edges(document: CanvasDocument, replacements: list[GenerationCanvasEdge]) -> None:
    existing = {edge.id: edge for edge in document.edges}
    updates = {edge.id: edge.model_copy(deep=True) for edge in replacements}
    moved = {key for key in existing.keys() & updates.keys()
             if (existing[key].target_card, existing[key].target_port) !=
                (updates[key].target_card, updates[key].target_port)}
    if moved:
        remove_edges(document, moved)
    document.edges = [updates.pop(edge.id, edge) for edge in document.edges]
    for edge in updates.values():
        append_edge(document, edge)


class _CanvasEdits(CanvasStore):
    async def preview_layout(self, canvas_id: str, positions: dict[str, CanvasLayoutPoint],
                             desired: dict[str, CanvasLayoutPoint]) -> CanvasLayoutPreview:
        current = await self.read(canvas_id)
        cards = {card.id for card in current.document.cards}
        if not desired or set(desired) - (cards & positions.keys()):
            raise diagnostic('INVALID_LAYOUT_TARGET', '请为画布内已定位的卡片提供目标坐标', {'canvas_id': canvas_id})
        return CanvasLayoutPreview(canvas_id=canvas_id, before={key: positions[key] for key in desired}, after=desired)

    async def project_layout(self, plan: CanvasLayoutPreview,
                             positions: dict[str, CanvasLayoutPoint]) -> CanvasLayoutProjection:
        current = await self.read(plan.canvas_id)
        cards = {card.id for card in current.document.cards}
        conflicts = tuple(key for key, point in plan.after.items()
                          if key not in cards or key not in positions
                          or positions[key] not in (plan.before.get(key), point))
        if conflicts:
            return CanvasLayoutProjection(state='conflict', positions=positions, conflicts=conflicts)
        projected = positions | plan.after
        return CanvasLayoutProjection(state='no_change' if projected == positions else 'projected', positions=projected)

    async def preview(self, canvas_id: str, groups: list[CanvasEditGroup]) -> CanvasEditPreview:
        canvas = await self.get(canvas_id)
        current = _indexed(CanvasDocument.model_validate(canvas.document))
        previews = {}
        for group in groups:
            if group.id in previews or set(group.depends_on) - previews.keys():
                raise diagnostic('INVALID_EDIT_GROUP', '改动组身份须唯一，依赖组应排在前面', {'canvas_id': canvas_id})
            baseline = self._dependencies(current, group.depends_on, previews)
            candidate = CanvasDocument.model_validate(_document_data(baseline))
            self._change(candidate, group)
            prepared = await self.prepare_ordinary_document(canvas, candidate.model_dump(mode='json'))
            changes = tuple(_differences(baseline, _indexed(prepared.document)))
            guards = self._source_guards(group, baseline, candidate)
            previews[group.id] = CanvasEditGroupPreview(
                id=group.id, depends_on=group.depends_on, differences=changes, source_guards=guards,
            )
        return CanvasEditPreview(canvas_id=canvas_id, revision=canvas.revision, groups=tuple(previews.values()))

    @staticmethod
    def _source_guards(group: CanvasEditGroup, baseline: dict,
                       candidate: CanvasDocument) -> tuple[CanvasEditDifference, ...]:
        sources = []
        candidates = {card.id for card in candidate.cards}
        for card_id in dict.fromkeys(group.source_card_ids):
            before = _value(baseline['cards'], card_id)
            if before.exists:
                sources.append(CanvasEditDifference(path=('cards', card_id), before=before, after=before))
            elif card_id not in candidates:
                raise diagnostic('INVALID_EDIT_SOURCE', '预演引用的来源卡不存在', {'card_id': card_id})
        return tuple(sources)

    @staticmethod
    def _dependencies(original: dict, required_ids: tuple[str, ...], previews: dict) -> dict:
        required = set(required_ids)
        for group in reversed(previews.values()):
            if group.id in required:
                required.update(group.depends_on)
        baseline = deepcopy(original)
        for group in previews.values():
            if group.id in required and _apply(baseline, group.differences):
                raise diagnostic('INVALID_EDIT_GROUP', '依赖组包含不一致的改动', {'group_id': group.id})
        return baseline

    @staticmethod
    def _change(document: CanvasDocument, group: CanvasEditGroup) -> None:
        for card_id in group.remove_cards:
            if any(card.id == card_id for card in document.cards):
                remove_card(document, card_id)
        remove_edges(document, group.remove_edges)
        document.groups = [item for item in document.groups if item.id not in group.remove_groups]
        document.cards = _replace_entities(document.cards, group.cards)
        document.groups = _replace_entities(document.groups, group.groups)
        _replace_edges(document, group.edges)

    async def read_receipt(self, canvas_id: str, request_id: str) -> CanvasEditReceipt | None:
        await self.get(canvas_id)
        data = await self.save_receipt(canvas_id, _receipt_key(request_id))
        return CanvasEditReceipt.model_validate(data['edit']) if data else None

    async def submit(self, plan: CanvasEditPreview, *, request_id: str,
                     group_ids: tuple[str, ...] | None = None) -> CanvasEditReceipt:
        canvas = await self.get(plan.canvas_id, lock=True)
        requested = set(group_ids) if group_ids is not None else {group.id for group in plan.groups}
        selected = tuple(group.id for group in plan.groups if group.id in requested)
        if set(selected) != requested or len(set(group.id for group in plan.groups)) != len(plan.groups):
            raise diagnostic('INVALID_EDIT_GROUP', '选择了不存在或重复的改动组', {'canvas_id': canvas.id})
        digest = self.command_digest({'plan': plan.model_dump(mode='json'), 'groups': selected})
        key = _receipt_key(request_id)
        previous = await self.save_receipt(canvas.id, key, digest)
        if previous:
            return CanvasEditReceipt.model_validate(previous['edit'])
        document = _indexed(CanvasDocument.model_validate(canvas.document))
        document, results = await self._apply_selected(canvas, plan, selected, document)
        changed = any(result.state == 'applied' for result in results)
        result = CanvasEditReceipt(request_id=request_id, canvas_id=canvas.id,
                                   revision=canvas.revision + int(changed), groups=results)
        await self._record(canvas, key, digest, document, result, changed=changed)
        return result

    async def _apply_selected(self, canvas: GenerationCanvas, plan: CanvasEditPreview, selected: tuple[str, ...],
                              document: dict) -> tuple[dict, tuple[CanvasEditGroupReceipt, ...]]:
        results = {}
        satisfied = set()
        for group in plan.groups:
            if group.id not in selected:
                if set(group.depends_on) <= satisfied and all(
                    _against(document, change)[0] is not None and _against(document, change)[1] == change.after
                    for change in group.differences
                ):
                    satisfied.add(group.id)
                continue
            blocked = tuple(g for g in group.depends_on if g not in satisfied)
            if blocked:
                results[group.id] = CanvasEditGroupReceipt(group_id=group.id, state='blocked', blocked_by=blocked)
                continue
            candidate, receipt = await self._apply_candidate(canvas, document, group)
            results[group.id] = receipt
            if candidate is not None:
                satisfied.add(group.id)
                document = candidate
        return document, tuple(results.values())

    async def _apply_candidate(self, canvas: GenerationCanvas, document: dict,
                               group: CanvasEditGroupPreview) -> tuple[dict | None, CanvasEditGroupReceipt]:
        candidate = deepcopy(document)
        conflicts = _apply(candidate, group.differences)
        if conflicts:
            return None, CanvasEditGroupReceipt(group_id=group.id, state='conflict', conflicts=tuple(conflicts))
        if candidate == document:
            return document, CanvasEditGroupReceipt(group_id=group.id, state='no_change')
        source_conflicts = tuple(CanvasEditConflict(difference=guard, current=current)
                                 for guard in group.source_guards
                                 if (current := _against(document, guard)[1]) != guard.before)
        if source_conflicts:
            return None, CanvasEditGroupReceipt(group_id=group.id, state='conflict', conflicts=source_conflicts)
        try:
            prepared = await self.prepare_ordinary_document(canvas, _document_data(candidate))
            if _indexed(prepared.document) != candidate:
                raise diagnostic('EDIT_PREVIEW_CHANGED', '当前画布会产生预演范围之外的变更，请重新核对',
                                 {'group_id': group.id}, status=409)
        except CanvasDomainError as exc:
            return None, CanvasEditGroupReceipt(group_id=group.id, state='conflict',
                                                diagnostic=CanvasDiagnostic.model_validate(exc.detail))
        return candidate, CanvasEditGroupReceipt(group_id=group.id, state='applied')

    async def _record(self, canvas: GenerationCanvas, key: str, digest: str, document: dict,
                      receipt: CanvasEditReceipt, *, changed: bool) -> None:
        fields = {'edit': receipt.model_dump(mode='json')}
        if changed:
            await self._write(canvas, CanvasSave(request_id=key, expected_revision=canvas.revision,
                                                document=_document_data(document)), digest, receipt_fields=fields)
        else:
            await self.record_save_receipt(canvas.id, key, digest, fields)
