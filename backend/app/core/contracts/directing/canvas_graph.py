"""后端画布展示协议；结构约束不执行查询或推断业务执行范围。"""

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, model_validator

from app.core.contracts.directing.common import Contract, Identity, Source, Text, unique
from app.core.contracts.directing.production import ReferenceBinding, MediaRange
from app.core.contracts.directing.unit_scope import UnitScopeProjection
from app.core.contracts.video_generation import VideoReferenceCapabilities


class CanvasObject(Contract):
    """业务身份与显示节点分开；无稳定 ID 的目标只在该 revision 内有效。"""

    version_id: Identity
    revision: int = Field(gt=0)
    kind: Literal['source', 'design', 'unit', 'coverage', 'reference', 'dependency', 'unit_config', 'unit_basis', 'instruction', 'clip', 'planned', 'take', 'seam']
    id: Text
    stable: bool = True
    path: list[str | int] = Field(default_factory=list)


class CanvasTarget(Contract):
    """显式定位业务对象；外部或历史目标必须携带独立来源上下文。"""

    node_id: Text
    object: CanvasObject
    field: str | None = None
    external: bool = False


class CanvasSummaryField(Contract):
    """已解析名称和正文的展示字段，浏览器无需再关联原始业务数组。"""

    field: Text
    label: Text
    text: str


class CanvasIssue(Contract):
    """共同诊断形状保留具体业务语义，不等同于生成授权。"""

    code: Text
    message: Text
    severity: Literal['info', 'warning', 'error']
    target: CanvasTarget


class CanvasNode(Contract):
    """两种画布共享显示与定位信息，具体载荷由 kind 区分。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    id: Text
    title: Text
    object: CanvasObject
    summary: list[CanvasSummaryField] = Field(default_factory=list)
    edit_target: CanvasTarget | None = None
    sources: list[CanvasTarget] = Field(default_factory=list)
    issues: list[CanvasIssue] = Field(default_factory=list)
    home_view_id: str = 'scene'


class SourceCanvasNode(CanvasNode):
    """固定原文的实际正文和来源，不携带编辑器当前未保存输入。"""

    # 同时提供 enum，使现有 OpenAPI codegen 保留单值判别类型。
    kind: Literal['source'] = Field(default='source', json_schema_extra={'enum': ['source']})
    text: str
    source: Source


class DesignCanvasNode(CanvasNode):
    """设计卡片保留其自身字段与范围含义，不泛化为生产配置。"""

    kind: Literal['design'] = Field(default='design', json_schema_extra={'enum': ['design']})
    design_kind: Literal['overview', 'space', 'location', 'performance', 'staging', 'sound', 'prompt',
                         'participant', 'event', 'criterion', 'fact', 'beat', 'anchor', 'blocking',
                         'shot', 'situation', 'activity', 'camera', 'continuity', 'dialogue']
    editor_kind: Literal['direction', 'participants', 'performance', 'staging',
                         'cinematography', 'continuity', 'sound', 'prompt', 'location'] = 'direction'
    record_id: Identity | None = None
    number: int | None = Field(default=None, gt=0)
    fields: list[str]
    scope_label: str
    scope_reason: str


class MissingCanvasNode(CanvasNode):
    """缺失引用仍具备原标识和只读诊断，不冒充可编辑业务对象。"""

    kind: Literal['missing'] = Field(default='missing', json_schema_extra={'enum': ['missing']})
    reference_id: Text
    reason: Text


class ShotBasisCanvasNode(CanvasNode):
    """单元浏览中的镜头依据只解释设计，不在生产画布改写设计。"""

    kind: Literal['shot_basis'] = Field(default='shot_basis', json_schema_extra={'enum': ['shot_basis']})
    shot_id: Identity
    number: int = Field(gt=0)


class UnitCanvasNode(CanvasNode):
    """一个生产单元只有一个聚合入口，筛选不改变其身份或执行范围。"""

    kind: Literal['unit'] = Field(default='unit', json_schema_extra={'enum': ['unit']})
    unit_id: Identity
    number: int = Field(gt=0)
    preview_title: Text = Field(description='完整覆盖镜头与场次内单元编号组成的聚合预览标题，不随镜头筛选变化')
    coverage_count: int = Field(gt=0)
    reference_count: int = Field(ge=0)
    execution_scope_supported: bool = Field(description='仅表示覆盖形态符合当前单 coverage 执行限制，不代表整体准备通过')


class CanvasDependencyState(Contract):
    """固定依赖的当前核对结果，不改变原绑定，也不等于单元生成准备通过。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    frame_id: Identity | None
    reference_id: Identity | None
    status: Literal['unbound', 'current', 'needs_review', 'unavailable']
    message: str
    frame_file_id: Identity | None = None
    at_ms: int | None = Field(default=None, ge=0)
    source: Source | None = None

    @model_validator(mode='after')
    def actual_evidence(self):
        """适用结论必须带真实固定帧和来源，未绑定不能冒充已核验。"""
        if (self.frame_id is None) != (self.reference_id is None):
            raise ValueError('dependency evidence frame and reference must be paired')
        if self.status == 'current' and not all((self.frame_id, self.frame_file_id, self.source)):
            raise ValueError('current dependency evidence requires a real frame and source')
        if self.status == 'unbound' and self.frame_id is not None:
            raise ValueError('unbound dependency evidence cannot carry a bound frame')
        return self


class CanvasPlanDependency(CanvasDependencyState):
    """历史生产计划与单元身份保持固定，不按当前单元名称替代。"""

    kind: Literal['plan'] = Field(default='plan', json_schema_extra={'enum': ['plan']})
    plan_revision_id: Identity
    unit_id: Identity


class CanvasSceneDependency(CanvasDependencyState):
    """场次版本单次采用与落幅身份，不重新绑定到最新采用。"""

    kind: Literal['scene'] = Field(default='scene', json_schema_extra={'enum': ['scene']})
    version_id: Identity
    clip_id: Identity


CanvasDependencyEvidence = Annotated[CanvasPlanDependency | CanvasSceneDependency, Field(discriminator='kind')]


class UnitConfigCanvasNode(CanvasNode):
    """四类配置的稳定编辑地址，不将配置转成任意 JSON 表单。"""

    kind: Literal['unit_config'] = Field(default='unit_config', json_schema_extra={'enum': ['unit_config']})
    unit_id: Identity
    config_kind: Literal['coverage', 'generation', 'organization', 'dependencies']
    coverage_item_id: Identity | None = None
    shot_id: Identity | None = None
    fields: list[str]
    dependency_evidence: list[CanvasDependencyEvidence] = Field(default_factory=list)
    reference_capabilities: VideoReferenceCapabilities | None = None
    capability_error: str | None = None


class CanvasReferencePreview(Contract):
    """当前文件登记和预览地址；available 不代表字节或模型输入已通过执行前复核。"""

    binding_id: Identity
    file_id: Identity
    display_name: str
    status: Literal['available', 'deleted', 'unavailable', 'wrong_media_kind']
    thumbnail_url: str | None = None
    media_url: str | None = None
    preview_issue: str | None = None


class UnitReferencesCanvasNode(CanvasNode):
    """每个单元一个真实输入集合；绑定保留用途、角色、顺序及固定文件身份。"""

    kind: Literal['unit_references'] = Field(default='unit_references', json_schema_extra={'enum': ['unit_references']})
    unit_id: Identity
    binding_count: int = Field(ge=0)
    bindings: list[ReferenceBinding]
    previews: list[CanvasReferencePreview]


class CanvasBasisTarget(Contract):
    """消费投影中的一行对应一个真实来源字段或明确不可定位的原因。"""

    section: Literal['execution', 'constraints', 'background']
    index: int = Field(ge=0)
    target: CanvasTarget | None = None
    unavailable_reason: Text | None = None

    @model_validator(mode='after')
    def explicit_target(self):
        """不存在当前来源时不得生成可编辑替代目标。"""
        if (self.target is None) == (self.unavailable_reason is None):
            raise ValueError('basis source requires a target or unavailable reason')
        return self


class UnitBasisCanvasNode(CanvasNode):
    """只读范围沿用指令的实际消费投影；不另行沿图推断执行内容。"""

    kind: Literal['unit_basis'] = Field(default='unit_basis', json_schema_extra={'enum': ['unit_basis']})
    unit_id: Identity
    scope: UnitScopeProjection
    field_targets: list[CanvasBasisTarget]


class InstructionCanvasRecord(Contract):
    """当前相关原任务的轻量只读定位；不携带历史正文或执行授权。"""

    task_id: Identity
    version_id: Identity
    unit_id: Identity
    request_id: Identity
    kind: Literal['suggestion', 'check']
    status: str
    bound: bool = False
    matches_current: bool | None = None
    confirmed: bool = False
    reason: str | None = None


class InstructionCanvasNode(CanvasNode):
    """完整自由文本的已保存投影；编辑目标始终指向明确生产单元。"""

    kind: Literal['instruction'] = Field(default='instruction', json_schema_extra={'enum': ['instruction']})
    unit_id: Identity
    text: str
    source: Source | None = None
    basis_id: Identity | None = None
    basis_status: Literal['empty', 'unbound', 'current', 'changed', 'unverified'] = 'unverified'
    evidence_issue: str | None = None
    records: list[InstructionCanvasRecord] = Field(default_factory=list)


class EditTakeCanvasNode(CanvasNode):
    """共享素材的轻量固定来源；不展开完整生成输入或历史正文。"""

    kind: Literal['edit_take'] = Field(default='edit_take', json_schema_extra={'enum': ['edit_take']})
    take_kind: Literal['production_plan', 'scene_video']
    take_id: Identity
    file_id: Identity
    origin_id: Identity | None
    unit_id: Identity | None
    task_id: Identity | None
    available: bool
    duration_ms: int | None = None


class EditClipCanvasNode(CanvasNode):
    """每次采用独立保存真实源区间、位置和片段适配。"""

    kind: Literal['edit_clip'] = Field(default='edit_clip', json_schema_extra={'enum': ['edit_clip']})
    clip_id: Identity
    take_kind: Literal['production_plan', 'scene_video']
    take_id: Identity
    file_id: Identity
    media_range: MediaRange
    timeline_start_ms: int = Field(ge=0)
    fit: Literal['contain', 'cover']


class EditSeamReviewSummary(Contract):
    """当前相关固定审查身份和结论；完整历史由原记录入口读取。"""

    id: Identity
    version_id: Identity
    revision: int
    verdict: Literal['pass', 'revise']
    observation: str
    established: str
    issues: str


class EditSeamCanvasNode(CanvasNode):
    """真实相接的独立采用对；来源引用保留两侧素材与真实区间。"""

    kind: Literal['edit_seam'] = Field(default='edit_seam', json_schema_extra={'enum': ['edit_seam']})
    left_clip_id: Identity
    right_clip_id: Identity
    review_status: Literal['applicable', 'needs_review', 'unreviewed', 'failed']
    review: EditSeamReviewSummary | None = None
    review_issue: str | None = None


class EditPlannedCanvasNode(CanvasNode):
    """预期内容只有预计时长，不拥有真实媒体或源区间。"""

    kind: Literal['edit_planned'] = Field(default='edit_planned', json_schema_extra={'enum': ['edit_planned']})
    clip_id: Identity
    shot_id: Identity
    expected_content: str
    estimated_duration_ms: int = Field(gt=0)
    timeline_start_ms: int = Field(ge=0)


CanvasGraphNode = Annotated[SourceCanvasNode | DesignCanvasNode | MissingCanvasNode |
                            ShotBasisCanvasNode | UnitCanvasNode | UnitConfigCanvasNode |
                            UnitReferencesCanvasNode | UnitBasisCanvasNode | InstructionCanvasNode |
                            EditTakeCanvasNode | EditClipCanvasNode | EditPlannedCanvasNode | EditSeamCanvasNode,
                            Field(discriminator='kind')]


class CanvasEdge(Contract):
    """业务边必须有来源证据；结构引导线单独分类。"""

    id: Text
    source: Text
    target: Text | None = None
    target_group: str | None = None
    kind: Literal['business', 'guide']
    label: str
    sources: list[CanvasTarget] = Field(default_factory=list)
    category: Literal['design', 'evidence', 'criterion', 'constraint', 'input'] = 'evidence'

    @model_validator(mode='after')
    def endpoint(self):
        """业务边连接真实节点，布局引导才可连接一个明确分组。"""
        if (self.target is None) == (self.target_group is None):
            raise ValueError('canvas edge requires exactly one target')
        if self.target_group is not None and self.kind != 'guide':
            raise ValueError('only canvas guides may target a group')
        return self


class CanvasMember(Contract):
    """一个原对象可属于多个视图，呈现角色不改变其业务身份。"""

    node_id: Text
    presentation: Literal['card', 'entry', 'reference'] = 'card'
    group: str
    entry_view_id: str | None = None
    title: str | None = None


class CanvasGroup(Contract):
    """分组标签与数量由服务端视图提供，前端只计算包围几何。"""

    id: Text
    label: Text
    node_count: int = Field(default=0, ge=0)


class CanvasView(Contract):
    """服务端确定成员、可见边及导航目标；位置和视口属于浏览器。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    id: Text
    title: Text
    parent_id: str | None = None
    anchor_id: str | None = None
    members: list[CanvasMember]
    edge_ids: list[str] = Field(default_factory=list)
    groups: list[CanvasGroup] = Field(default_factory=list)
    node_count: int = Field(default=0, ge=0)
    reference_count: int = Field(default=0, ge=0)
    card_count: int = Field(default=0, ge=0)
    issue_count: int = Field(default=0, ge=0)


class CanvasGraph(Contract):
    """与业务内容属于同一快照的派生图；校验引用闭合，不进行领域推断。"""

    kind: Literal['director', 'units', 'instructions', 'edit']
    version_id: Identity
    revision: int = Field(gt=0)
    nodes: list[CanvasGraphNode]
    edges: list[CanvasEdge]
    views: list[CanvasView] = Field(description='含一个 parent_id 为空的根视图；视图 ID 为后端提供的不透明地址')
    issues: list[CanvasIssue]

    @model_validator(mode='after')
    def closed_references(self):
        """拒绝重复、悬空、跨快照目标及层级循环，历史来源必须显式声明。"""
        unique([node.id for node in self.nodes], 'canvas node IDs')
        unique([edge.id for edge in self.edges], 'canvas edge IDs')
        unique([view.id for view in self.views], 'canvas view IDs')
        nodes = {node.id: node for node in self.nodes}
        edges = {edge.id: edge for edge in self.edges}
        views = {view.id: view for view in self.views}
        canonical: dict[tuple[str, str], CanvasObject] = {}

        def target_exists(target: CanvasTarget):
            if target.external:
                return
            node = nodes.get(target.node_id)
            if node is None or node.object != target.object:
                raise ValueError(f'unknown or inconsistent canvas target: {target.node_id}')

        for node in self.nodes:
            if (node.object.version_id, node.object.revision) != (self.version_id, self.revision):
                raise ValueError(f'canvas node belongs to another snapshot: {node.id}')
            key = (node.object.kind, node.object.id)
            if key in canonical and canonical[key] != node.object:
                raise ValueError(f'inconsistent canonical canvas object: {node.id}')
            canonical[key] = node.object
            if node.home_view_id not in views:
                raise ValueError(f'unknown canvas object home view: {node.id}')
            if node.edit_target:
                target_exists(node.edit_target)
                if node.edit_target.external or node.edit_target.object != node.object:
                    raise ValueError(f'canvas edit target does not identify its object: {node.id}')
                if isinstance(node, InstructionCanvasNode) and node.edit_target.field not in (None, 'instruction'):
                    raise ValueError(f'unknown canvas target field: {node.id}/{node.edit_target.field}')
                if (isinstance(node, (DesignCanvasNode, UnitConfigCanvasNode)) and node.edit_target.field is not None
                        and node.edit_target.field not in node.fields):
                    raise ValueError(f'unknown canvas target field: {node.id}/{node.edit_target.field}')
            for target in node.sources:
                target_exists(target)
            if isinstance(node, UnitReferencesCanvasNode):
                binding_files = {binding.id: binding.file_id for binding in node.bindings}
                unique([binding.id for binding in node.bindings], 'canvas reference bindings')
                unique([preview.binding_id for preview in node.previews], 'canvas reference previews')
                if (node.binding_count != len(node.bindings)
                        or binding_files != {preview.binding_id: preview.file_id for preview in node.previews}):
                    raise ValueError(f'inconsistent canvas reference collection: {node.id}')
            if isinstance(node, UnitBasisCanvasNode):
                expected = {(section, index) for section in ('execution', 'constraints', 'background')
                            for index, _ in enumerate(getattr(node.scope, section))}
                addresses = [(row.section, row.index) for row in node.field_targets]
                unique(addresses, 'basis field addresses')
                if set(addresses) != expected:
                    raise ValueError(f'inconsistent canvas basis field addresses: {node.id}')
                for row in node.field_targets:
                    if row.target:
                        target_exists(row.target)
            for issue in node.issues:
                target_exists(issue.target)
        for edge in self.edges:
            if edge.source not in nodes or edge.target is not None and edge.target not in nodes:
                raise ValueError(f'unknown canvas edge endpoint: {edge.id}')
            if edge.target_group is not None and not any(
                    group.id == edge.target_group for view in self.views for group in view.groups):
                raise ValueError(f'unknown canvas edge group: {edge.id}')
            if edge.kind == 'business' and not edge.sources:
                raise ValueError(f'canvas business edge requires source evidence: {edge.id}')
            for target in edge.sources:
                target_exists(target)
        for view in self.views:
            members = {member.node_id for member in view.members}
            unique([member.node_id for member in view.members], 'canvas view members')
            unique(view.edge_ids, 'canvas view edges')
            unique([group.id for group in view.groups], 'canvas view groups')
            if view.node_count != len(view.members) or view.reference_count != sum(
                    member.presentation == 'reference' for member in view.members):
                raise ValueError(f'inconsistent canvas view counts: {view.id}')
            for group in view.groups:
                if group.node_count != sum(member.group == group.id for member in view.members):
                    raise ValueError(f'inconsistent canvas group count: {view.id}/{group.id}')
            if not members <= nodes.keys() or view.anchor_id is not None and view.anchor_id not in members:
                raise ValueError(f'unknown canvas view member or anchor: {view.id}')
            for member in view.members:
                if member.presentation == 'entry':
                    if member.entry_view_id not in views:
                        raise ValueError(f'unknown canvas entry view: {member.node_id}')
                elif member.entry_view_id is not None:
                    raise ValueError(f'non-entry canvas member has an entry target: {member.node_id}')
            for edge_id in view.edge_ids:
                edge = edges.get(edge_id)
                if edge is None:
                    raise ValueError(f'canvas view edge is not closed: {view.id}/{edge_id}')
                group_missing = edge.target_group is not None and edge.target_group not in {
                    group.id for group in view.groups}
                if (edge.source not in members or group_missing
                        or edge.target is not None and edge.target not in members):
                    raise ValueError(f'canvas view edge is not closed: {view.id}/{edge_id}')
            ancestors = {view.id}
            parent = view.parent_id
            while parent is not None:
                if parent in ancestors or parent not in views:
                    raise ValueError(f'cyclic or unknown canvas view parent: {view.id}')
                ancestors.add(parent)
                parent = views[parent].parent_id
        if sum(view.parent_id is None for view in self.views) != 1:
            raise ValueError('canvas requires exactly one root view')
        for issue in self.issues:
            target_exists(issue.target)
        return self


class DirectorCanvasGraph(CanvasGraph):
    """导演专属范围计数不变成所有画布的通用准备状态。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal['director'] = Field(default='director', json_schema_extra={'enum': ['director']})
    nodes: list[Annotated[SourceCanvasNode | DesignCanvasNode | MissingCanvasNode,
                          Field(discriminator='kind')]]
    shot_count: int = Field(ge=0)
    pending_count: int = Field(ge=0)
    unlinked_count: int = Field(ge=0)


class UnitCanvasGraph(CanvasGraph):
    """单元画布拥有独立载荷，复用共同结构与校验，不复用导演业务推断。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal['units'] = Field(default='units', json_schema_extra={'enum': ['units']})
    nodes: list[Annotated[ShotBasisCanvasNode | UnitCanvasNode | UnitConfigCanvasNode |
                          UnitReferencesCanvasNode | UnitBasisCanvasNode | MissingCanvasNode,
                          Field(discriminator='kind')]]


class InstructionCanvasGraph(CanvasGraph):
    """按明确单元进入的指令图，不要求用户先浏览全场概览。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal['instructions'] = Field(default='instructions', json_schema_extra={'enum': ['instructions']})
    nodes: list[Annotated[InstructionCanvasNode | UnitReferencesCanvasNode | UnitBasisCanvasNode,
                          Field(discriminator='kind')]]


class EditCanvasGraph(CanvasGraph):
    """整场已保存采用总览；素材身份与采用身份分别表达。"""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal['edit'] = Field(default='edit', json_schema_extra={'enum': ['edit']})
    nodes: list[Annotated[EditTakeCanvasNode | EditClipCanvasNode | EditPlannedCanvasNode | EditSeamCanvasNode,
                          Field(discriminator='kind')]]

    @model_validator(mode='after')
    def adoption_sources(self):
        """采用只能编辑自己的时间线对象；取材边须保留同一素材和文件身份。"""
        nodes = {node.id: node for node in self.nodes}
        for node in self.nodes:
            if isinstance(node, EditTakeCanvasNode):
                if node.edit_target or node.object.kind != 'take' or node.object.id != f'{node.take_kind}:{node.take_id}':
                    raise ValueError('invalid canvas take identity or edit target')
                continue
            if isinstance(node, EditSeamCanvasNode):
                if node.edit_target or node.object.kind != 'seam':
                    raise ValueError('invalid canvas seam target')
                pair = [nodes.get(target.node_id) for target in node.sources if not target.external]
                if len(pair) != 2 or any(not isinstance(clip, EditClipCanvasNode) for clip in pair):
                    raise ValueError('invalid canvas seam sources')
                left, right = pair
                if (left.clip_id, right.clip_id) != (node.left_clip_id, node.right_clip_id) or (
                        left.timeline_start_ms + left.media_range.source_out_ms - left.media_range.source_in_ms
                        != right.timeline_start_ms):
                    raise ValueError('invalid canvas seam pair')
                continue
            expected = 'clip' if isinstance(node, EditClipCanvasNode) else 'planned'
            if node.object.kind != expected or node.object.id != node.clip_id:
                raise ValueError('invalid canvas adoption identity')
            if node.edit_target and node.edit_target.field is not None:
                raise ValueError('invalid canvas adoption edit field')
            if isinstance(node, EditClipCanvasNode):
                sources = [nodes.get(target.node_id) for target in node.sources if not target.external]
                matches = [source for source in sources if isinstance(source, EditTakeCanvasNode) and
                    (source.take_kind, source.take_id, source.file_id) == (node.take_kind, node.take_id, node.file_id)]
                if len(matches) != 1 or not any(edge.kind == 'business' and edge.source == matches[0].id
                        and edge.target == node.id for edge in self.edges):
                    raise ValueError('invalid canvas adoption source')
        return self
