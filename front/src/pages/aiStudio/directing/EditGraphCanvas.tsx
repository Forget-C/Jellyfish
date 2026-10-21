import { GraphCanvas } from './GraphCanvas'
import type { EditCanvasGraph } from '../../../services/generated'
import type { GraphArrange } from './graphLayout'
import { WorkbenchButton } from './ui/WorkbenchButton'

/** 成员顺序来自后端，前端只沿行排布几何并保留用户布局。 */
const arrangeEdit: GraphArrange = (nodes, sizes, _width, _anchor, retained = {}) => {
  const positions = { ...retained }
  let top = 0
  for (const group of new Set(nodes.map(node => node.group))) {
    const rows = nodes.filter(node => node.group === group)
    let x = 0
    rows.forEach(node => {
      if (!positions[node.id]) positions[node.id] = { x, y: top }
      x = positions[node.id].x + (sizes[node.id]?.width || 360) + 64
    })
    top += Math.max(0, ...rows.map(node => sizes[node.id]?.height || 240)) + 96
  }
  return positions
}

/** 已保存剪辑总览只负责定位；播放器和编辑器持续留在原工作区。 */
export function EditGraphCanvas({ graph, versionId, revision, contextKey, onRetry, onLocate }: {
  graph: EditCanvasGraph; versionId: string; revision: number; contextKey: string
  onRetry: () => void; onLocate: (node: EditCanvasGraph['nodes'][number]) => void
}) {
  const valid = !!graph && graph.kind === 'edit' && graph.version_id === versionId && graph.revision === revision &&
    Array.isArray(graph.nodes) && Array.isArray(graph.edges) && Array.isArray(graph.views)
  const view = valid ? graph.views.find(row => row.parent_id == null) : undefined
  if (!view) return <p className="scene-edit-empty" role="alert">剪辑图与当前版本不一致。<WorkbenchButton variant="secondary" onClick={onRetry}>重新读取版本</WorkbenchButton></p>
  return <>
    {!view.members.length && <p className="scene-edit-empty">时间线尚无片段。浏览同场次素材或打开剪辑工作区，明确采用素材或添加待拍占位。</p>}
    <GraphCanvas contextKey={`${contextKey}:edit-graph`} ariaLabel="整场剪辑画布视口" layoutScope={{
      storageKey: `jellyfish:edit:local-user:${contextKey}`, viewId: view.id, anchorId: view.anchor_id || view.members[0]?.node_id || '',
      validIds: graph.nodes.map(node => node.id), validViewIds: graph.views.map(row => row.id), arrange: arrangeEdit, initialTop: 96,
    }} groups={view.groups} objects={view.members.flatMap(member => {
      const node = graph.nodes.find(row => row.id === member.node_id)
      if (!node) return []
      return [{ id: node.id, label: node.title, group: member.group,
        content: <section className="canvas-workbench-card"><div className="design-compact-fields">{node.summary.map(field => <p key={field.field} title={`${field.label}：${field.text}`}><span>{field.label}：</span><strong>{field.text}</strong></p>)}</div>
          {node.kind === 'edit_clip' && <p>片段适配：{node.fit === 'cover' ? '居中填满' : '完整显示'}</p>}
          {node.kind === 'edit_take' && <p>{node.take_kind === 'scene_video' ? '场次版本素材' : '生产计划素材'} · {node.available ? '文件已登记' : '文件不可用'}</p>}
          {node.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
          <WorkbenchButton variant="secondary" onClick={() => onLocate(node)}>{node.kind === 'edit_take' ? '定位源素材' : '定位时间线片段'}</WorkbenchButton>
        </section>, onInspect: () => onLocate(node) }]
    })} relations={graph.edges.filter(edge => view.edge_ids.includes(edge.id) && edge.target).map(edge => ({
      from: edge.source, to: edge.target!, label: edge.label, category: edge.category,
    }))} />
  </>
}
