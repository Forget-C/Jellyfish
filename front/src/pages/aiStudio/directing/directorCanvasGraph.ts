import type { DirectorCanvasGraph, EditableSceneDesign_Output } from '../../../services/generated'
import { resolveTarget, targetFor } from './SceneDesignPanel'
import { designAt, designObjectSnapshot } from './designValue'
import type { DesignObject } from './designWorkspace'

/** 只适配后端展示视图；原始设计仅用于将编辑目标安全定位到当前输入。 */
export function directorCanvasProjection(authority: DirectorCanvasGraph, current: EditableSceneDesign_Output, saved: EditableSceneDesign_Output) {
  const metadata = new Map(authority.nodes.map(node => [node.id, node]))
  const byKey = new Map(authority.nodes.map(node => [node.object.id, node]))
  const unavailable = new Set<string>()
  const objects = authority.nodes.flatMap<DesignObject>(node => {
    if (node.kind === 'source') return []
    if (node.kind === 'missing') return [{ key: node.object.id, label: node.title, kind: 'missing', path: [] }]
    const path = node.object.path || []
    const binding = node.record_id ? { path, identity: { id: node.record_id } } : targetFor(saved, path)
    let resolved = resolveTarget(current, binding)
    const row = typeof path[path.length - 1] === 'number'
    // 同一修订且整个列表仍一致时，明确点击的历史出现项可按原位置编辑。
    if (!resolved && !node.object.stable && row && designObjectSnapshot(designAt(current, path.slice(0, -1))) ===
      designObjectSnapshot(designAt(saved, path.slice(0, -1)))) resolved = path
    if (!resolved) unavailable.add(node.id)
    return [{ key: node.object.id, label: node.title, kind: node.editor_kind, path: resolved || path, fields: row ? undefined : node.fields }]
  })
  const objectMap = new Map(objects.map(object => [object.key, object]))
  const root = authority.views.find(view => view.id === 'scene')
  const rootMembers = new Map(root?.members.map(member => [member.node_id, member]))
  const location = (key: string): string => {
    const node = byKey.get(key)
    if (!node) return 'unlinked'
    const home = authority.views.find(view => view.id === node.home_view_id)
    if (home?.id === 'scene') {
      const group = rootMembers.get(node.id)?.group
      return group === 'scene-global' ? 'global' : group === 'scene-shared' ? 'shared' : 'unlinked'
    }
    const anchor = home?.anchor_id && metadata.get(home.anchor_id)
    return anchor && anchor.kind === 'design' && anchor.record_id || 'unlinked'
  }
  const view = (shotId?: string) => {
    const selected = shotId ? authority.views.find(candidate => {
      const node = candidate.anchor_id && metadata.get(candidate.anchor_id)
      return node && node.kind === 'design' && node.design_kind === 'shot' && node.record_id === shotId
    }) : root
    const members = new Map(selected?.members.map(member => [member.node_id, member]))
    const nodes: DesignObject[] = [], unlinked: DesignObject[] = []
    for (const member of selected?.members || []) {
      const node = metadata.get(member.node_id)
      const object = node && objectMap.get(node.object.id)
      if (!object) continue
      const display = member.presentation === 'reference' ? { ...object, kind: 'reference' } : object
      if (member.group === 'scene-unlinked') unlinked.push(display)
      else nodes.push(display)
    }
    const edgeIds = new Set(selected?.edge_ids)
    const edges = authority.edges.filter(edge => edgeIds.has(edge.id) && edge.kind === 'business').map(edge => {
      const owner = metadata.get(edge.source)!, target = metadata.get(edge.target!)!
      return { from: owner.object.id, to: target.object.id, label: edge.label, category: edge.category,
        field: edge.sources?.[0]?.field || undefined,
        sources: (edge.sources || []).map(source => ({ from: metadata.get(source.node_id)?.object.id || source.object.id,
          to: target.object.id, label: edge.label, field: source.field || undefined })) }
    })
    const guides = authority.edges.filter(edge => edgeIds.has(edge.id) && edge.kind === 'guide')
      .map(edge => ({ from: edge.source, to: edge.target || undefined, group: edge.target_group || undefined }))
    return { nodes, unlinked, edges, guides, members, metadata: selected, location }
  }
  return { objects, metadata, byKey, unavailable, view, location }
}
