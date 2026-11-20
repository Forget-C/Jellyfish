import { Select } from 'antd'
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
export function EditGraphCanvas({ graph, versionId, revision, contextKey, viewId, onRetry, onLocate, onLocateCoverage }: {
  graph: EditCanvasGraph; versionId: string; revision: number; contextKey: string
  viewId?: string; onLocateCoverage: (node: Extract<EditCanvasGraph['nodes'][number], { kind: 'edit_coverage' }>) => void
  onRetry: () => void; onLocate: (node: EditCanvasGraph['nodes'][number], recordId?: string) => void
}) {
  const valid = !!graph && graph.kind === 'edit' && graph.version_id === versionId && graph.revision === revision &&
    Array.isArray(graph.nodes) && Array.isArray(graph.edges) && Array.isArray(graph.views)
  const view = valid ? graph.views.find(row => viewId ? row.id === viewId : row.parent_id === null) : undefined
  if (!view) return <p className="scene-edit-empty" role="alert">剪辑图与当前版本不一致。<WorkbenchButton variant="secondary" onClick={onRetry}>重新读取版本</WorkbenchButton></p>
  return <>
    {!view.members.length && view.id === graph.library_view_id && <p className="scene-edit-empty">本场暂无已登记素材。</p>}
    {!view.members.length && view.id !== graph.library_view_id && <p className="scene-edit-empty">时间线尚无片段。浏览同场次素材或打开剪辑工作区，明确采用素材或添加待拍占位。</p>}
    <GraphCanvas contextKey={`${contextKey}:edit-graph`} ariaLabel={view.id === graph.library_view_id ? '同场素材画布视口' : '整场剪辑画布视口'} layoutScope={{
      storageKey: `jellyfish:edit:local-user:${contextKey}`, viewId: view.id, anchorId: view.anchor_id || view.members[0]?.node_id || '',
      validIds: graph.nodes.map(node => node.id), validViewIds: graph.views.map(row => row.id), arrange: arrangeEdit, initialTop: 96,
    }} groups={view.groups} objects={view.members.flatMap(member => {
      const node = graph.nodes.find(row => row.id === member.node_id)
      if (!node) return []
      return [{ id: node.id, label: node.title, group: member.group,
        size: node.kind === 'edit_take' ? { width: 360, height: 340 + node.reviews.length * 64 } : node.kind === 'edit_coverage' ? { width: 360, height: 320 } : node.kind === 'edit_cut_review' ? { width: 420, height: 560 } : undefined,
        content: <section className="canvas-workbench-card"><div className="design-compact-fields">{node.summary.map(field => <p key={field.field} title={`${field.label}：${field.text}`}><span>{field.label}：</span><strong>{field.text}</strong></p>)}</div>
          {node.kind === 'edit_clip' && <p>片段适配：{node.fit === 'cover' ? '居中填满' : '完整显示'}</p>}
          {node.kind === 'edit_take' && <p>{node.take_kind === 'scene_video' ? '场次版本素材' : '生产计划素材'} · {node.available ? '文件已登记' : '文件不可用'}</p>}
          {node.kind === 'edit_take' && node.reviews.map(record => <p key={record.id}>固定复核：{record.matches_current ? '依据一致' : '依据已变'}<WorkbenchButton variant="secondary" onClick={() => onLocate(node, record.id)}>查看原复核记录</WorkbenchButton></p>)}
          {node.kind === 'edit_coverage' && <WorkbenchButton variant="secondary" onClick={() => onLocateCoverage(node)}>定位当前覆盖目标</WorkbenchButton>}
          {node.kind === 'edit_cut_review' && <>
            <div className="design-compact-fields"><p><span>整场观察：</span><strong>{node.decision.overall}</strong></p></div>
            <p>审片问题 {(node.decision.issues || []).length} 项；从原整场验收阅读完整问题和验收条件。</p>
            {!!node.decision.issues?.some(issue => issue.clip_ids?.length) && <Select aria-label="问题片段定位" placeholder="明确定位问题片段" style={{ width: '100%' }} value={null}
              options={[...new Set(node.decision.issues.flatMap(issue => issue.clip_ids || []))].map(id => ({ value: id, label: graph.nodes.some(item => (item.kind === 'edit_clip' || item.kind === 'edit_planned') && item.clip_id === id) ? `定位问题片段 ${id}` : `原问题片段 ${id} 已不在当前剪辑`, disabled: !graph.nodes.some(item => (item.kind === 'edit_clip' || item.kind === 'edit_planned') && item.clip_id === id) }))}
              onChange={id => {
                const clip = graph.nodes.find(item => (item.kind === 'edit_clip' || item.kind === 'edit_planned') && item.clip_id === id)
                if (clip) onLocate(clip)
              }} />}
          </>}
          {node.issues.map(issue => <p key={issue.code}>{issue.message}</p>)}
          <WorkbenchButton variant="secondary" onClick={() => onLocate(node)}>{node.kind === 'edit_cut_review' ? '查看原整场验收' : node.kind === 'edit_end_frame' ? '查看原实际落幅' : node.kind === 'edit_downstream' ? '定位后段单元' : node.kind === 'edit_take' ? '定位源素材' : node.kind === 'edit_coverage' ? '定位实际覆盖' : node.kind === 'edit_seam' ? '定位接缝审查' : '定位时间线片段'}</WorkbenchButton>
        </section>, onInspect: () => onLocate(node) }]
    })} relations={graph.edges.filter(edge => view.edge_ids.includes(edge.id) && edge.target).map(edge => ({
      from: edge.source, to: edge.target!, label: edge.label, category: edge.category,
    }))} />
  </>
}
