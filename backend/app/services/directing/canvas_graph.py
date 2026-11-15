"""共同读取上下文与图构建工具；领域投影器不重复基础注册和校验。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Awaitable, Callable, Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.canvas_graph import (
    CanvasDependencyEvidence, CanvasEdge, CanvasGraph, CanvasGraphNode, CanvasIssue, CanvasView,
)
from app.core.contracts.directing.common import Note
from app.core.contracts.directing.relationship_graph import SceneRelationshipGraph
from app.core.contracts.directing.style import StyleRule
from app.services.directing.unit_video_inputs import VideoUnitModel, read_video_unit_model
from app.models.llm import Model
from app.models.studio import Character, FileItem, FileUsage, Prop, Scene

if TYPE_CHECKING:
    from app.core.contracts.directing.scene_version import SceneVersionContent


class GraphAssembler:
    """注册真实图对象并统一验证；不查询数据，也不推断授权或执行范围。"""

    def __init__(self, kind: Literal['director', 'units', 'instructions', 'edit'], version_id: str, revision: int):
        self.kind = kind
        self.version_id = version_id
        self.revision = revision
        self.nodes: dict[str, CanvasGraphNode] = {}
        self.edges: dict[str, CanvasEdge] = {}
        self.views: dict[str, CanvasView] = {}
        self.issues: list[CanvasIssue] = []

    def add_node(self, node: CanvasGraphNode) -> None:
        """相同显示身份只能定义一次，不能静默覆盖已有对象。"""
        if node.id in self.nodes:
            raise ValueError(f'duplicate canvas node: {node.id}')
        self.nodes[node.id] = node

    def add_edge(self, edge: CanvasEdge) -> None:
        """边的来源证据和端点在 finish 一次核对。"""
        if edge.id in self.edges:
            raise ValueError(f'duplicate canvas edge: {edge.id}')
        self.edges[edge.id] = edge

    def add_view(self, view: CanvasView) -> None:
        """注册视图后统一核对成员、导航和父级关系。"""
        if view.id in self.views:
            raise ValueError(f'duplicate canvas view: {view.id}')
        self.views[view.id] = view

    def add_issue(self, issue: CanvasIssue) -> None:
        """具体问题由业务投影器产生，构建器只核对定位信息。"""
        self.issues.append(issue)

    def finish(self) -> CanvasGraph:
        """只返回通过共同数据约束的闭合图。"""
        issues = {issue.model_dump_json(): issue for issue in [*self.issues,
            *(issue for node in self.nodes.values() for issue in node.issues)]}
        views = []
        for view in self.views.values():
            member_ids = {member.node_id for member in view.members}
            groups = [group.model_copy(update={'node_count': sum(
                member.group == group.id for member in view.members)}) for group in view.groups]
            views.append(view.model_copy(update={
                'groups': groups, 'node_count': len(view.members),
                'reference_count': sum(member.presentation == 'reference' for member in view.members),
                'card_count': sum(member.presentation != 'reference'
                    and self.nodes.get(member.node_id) is not None
                    and self.nodes[member.node_id].kind != 'missing' for member in view.members),
                'issue_count': sum(issue.target.node_id in member_ids for issue in issues.values()),
            }))
        return CanvasGraph(kind=self.kind, version_id=self.version_id, revision=self.revision,
            nodes=list(self.nodes.values()), edges=list(self.edges.values()),
            views=views, issues=list(issues.values()))


@dataclass(frozen=True)
class CanvasReadContext:
    """一次版本读取固定内容、修订与公共证据，投影器之间复用同一上下文。"""

    version_id: str
    revision: int
    content: SceneVersionContent
    relationships: SceneRelationshipGraph
    location_name: str | None
    model_names: dict[str, str]
    model_inputs: dict[str, VideoUnitModel]
    model_input_errors: dict[str, str]
    style_rules: dict[str, list[StyleRule]]
    style_issues: dict[str, str]
    files: dict[str, FileItem]
    available_sources: set[tuple[str, str]]
    dependencies: dict[str, list[CanvasDependencyEvidence]]

    @classmethod
    async def load(cls, db: AsyncSession, project_id: str, version_id: str, revision: int,
                   content: SceneVersionContent, relationships: SceneRelationshipGraph,
                   style_loader: Callable[[str], Awaitable[list[StyleRule]]],
                   dependency_loader: Callable[[], Awaitable[dict[str, list[CanvasDependencyEvidence]]]]):
        """批量读取名称；固定风格由既有鉴权与适用性服务解析，不在图中复制规则。"""
        location_name = None
        asset_id = content.design.direction.location_asset_id
        if asset_id:
            location_name = await db.scalar(select(Scene.name).where(
                Scene.id == asset_id, Scene.project_id == project_id))
        model_ids = {unit.model_id for unit in content.units if unit.model_id}
        models = list(await db.scalars(select(Model).where(
            Model.id.in_(model_ids), Model.category == 'video'))) if model_ids else []
        model_names = {model.id: model.name for model in models}
        model_inputs, model_input_errors = {}, {}
        for model in models:
            try:
                model_inputs[model.id] = await read_video_unit_model(db, project_id, model)
            except (ValueError, HTTPException) as error:
                model_input_errors[model.id] = str(error.detail) if isinstance(error, HTTPException) else str(error)
        style_rules, style_issues = {}, {}
        if content.design.style_revision_id:
            for model_id in dict.fromkeys(unit.model_id or '' for unit in content.units):
                name = model_names.get(model_id)
                try:
                    style_rules[model_id] = await style_loader(name or '')
                    if not name:
                        style_issues[model_id] = '视频模型未核实，模型专属项目风格适用范围待核对'
                except ValueError as error:
                    style_issues[model_id] = f'固定项目风格未核实：{error}'
        file_ids = {binding.file_id for unit in content.units for binding in unit.references}
        files = {file.id: file for file in (await db.scalars(select(FileItem).join(
            FileUsage, FileUsage.file_id == FileItem.id).where(
                FileItem.id.in_(file_ids), FileUsage.project_id == project_id))).unique()} if file_ids else {}
        origins = {(binding.asset_origin.kind, binding.asset_origin.id)
                   for unit in content.units for binding in unit.references if binding.asset_origin}
        available_sources = set()
        for kind, model in [('character', Character), ('scene', Scene), ('prop', Prop)]:
            ids = {identity for source_kind, identity in origins if source_kind == kind}
            if not ids:
                continue
            query = select(model.id).where(model.id.in_(ids), model.project_id == project_id)
            available_sources.update((kind, identity) for identity in await db.scalars(query))
        return cls(version_id, revision, content, relationships, location_name,
                   model_names, model_inputs, model_input_errors, style_rules, style_issues, files, available_sources, await dependency_loader())


def note_summary(note: Note) -> str:
    """保留明确无、不适用和未知，未填不能冒充空字符串已确认。"""
    if note.text:
        return note.text
    label = {'unset': '未填写', 'unknown': '待确定', 'none': '明确没有',
             'not_applicable': '不适用'}.get(note.state, '未填写')
    return f'{label} · {note.reason}' if note.reason else label
