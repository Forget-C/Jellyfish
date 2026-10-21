import { WorkbenchButton } from './ui/WorkbenchButton'
import { CanvasTextPreview } from './CanvasTextPreview'
import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { InstructionCheckRead, SceneDesignSuggestionRead, SceneInstructionSuggestionRead, SceneVersionContent_Output, SceneVersionRead, SceneVideoRead, CanvasObject } from '../../../services/generated'
import { designObjects, scopeGraph } from './designWorkspace'
import { targetFor } from './SceneDesignPanel'
import { SceneRelationDetails } from './SceneRelationDetails'
import type { SceneInspectionTarget } from './SceneRelationDetails'
import type { SceneNavigationTarget } from './SceneRelationsNavigation'
import { DesignFields } from './DesignFields'
import { SceneInstructionCheckResult } from './SceneInstructionCheckResult'
import { SceneInstructionSnapshot } from './SceneInstructionSnapshot'
import { BasisInputs } from './SceneInstructionBasis'
import { directingError } from './common'

type Node = { id: string; label: string; column: number; detail?: string; navigation?: SceneNavigationTarget; inspection?: SceneInspectionTarget; historyUnitId?: string }
type Edge = { from: string; to: string; label: string }
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
const objectAddress = (object: CanvasObject) => JSON.stringify([object.version_id, object.revision, object.kind, object.id, object.path])
const headings = ['依据与共享', '设计对象', '镜头', '生产单元', '指令、参考与检查', '素材', '整场剪辑']

/** 汇总同一版本的真实身份；选择只高亮关系，定位与查看均须明确操作。 */
export function SceneWorkbenchOverview({ projectId, sequenceId, versionId, snapshot, content, unitId, shotId, onNavigate, onClose }: {
  projectId: string; sequenceId: string; versionId: string; snapshot: SceneVersionRead; content: SceneVersionContent_Output; unitId?: string; shotId?: string
  onNavigate: (target: SceneNavigationTarget) => void; onClose: () => void
}) {
  const [selected, setSelected] = useState(unitId ? objectAddress(snapshot.unit_graph.nodes.find(node => node.kind === 'unit' && node.unit_id === unitId)?.object || { version_id: versionId, revision: snapshot.revision, kind: 'unit', id: unitId }) : shotId ? `shot:${shotId}` : 'basis')
  const selectedObject = useRef<CanvasObject>()
  const [historyUnitId, setHistoryUnitId] = useState<string>()
  const [inspection, setInspection] = useState<SceneInspectionTarget>()
  const [trigger] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  const close = () => { onClose(); requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }) }
  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  const add = (node: Node) => nodes.set(node.id, node)
  const link = (from: string, to: string, label: string) => edges.push({ from, to, label })
  add({ id: 'basis', label: '原文依据', column: 0, detail: content.basis.text, inspection: { kind: 'basis' } })
  add({ id: 'location', label: '本场场所', column: 0, detail: content.design.direction.location_asset_id ? '已关联场所资产' : '尚未关联场所资产', inspection: { kind: 'location' } })
  const canonical = new Map<string, string>()
  designObjects(content.design).forEach(object => {
    const target = targetFor(content.design, object.path)
    const id = object.key.startsWith('shot:') || object.key.startsWith('participant:') ? object.key : `design:${JSON.stringify(target)}`
    canonical.set(object.key, id)
    const index = content.design.direction.shots.findIndex(shot => object.key === `shot:${shot.id}`)
    add({ id, label: index >= 0 ? `镜头 ${index + 1}` : object.label, column: index >= 0 ? 2 : object.path.length === 1 ? 0 : 1,
      detail: index >= 0 ? content.design.direction.shots[index].visible_result.text || '动作未填写' : undefined,
      navigation: index >= 0 ? { kind: 'shot', shotId: content.design.direction.shots[index].id } : undefined,
      inspection: object.key.startsWith('participant:') ? { kind: 'participant', id: object.key.slice(12) } : { kind: 'design', target, fields: object.fields } })
  })
  link('basis', canonical.get('overview')!, '设计依据')
  add({ id: 'design-history', label: '整场设计任务', column: 1, detail: '查看本版本整场设计任务的固定输入与结果，不应用到当前编辑内容。' })
  link('basis', 'design-history', '任务固定原文')
  link('design-history', canonical.get('overview')!, '设计建议记录')
  const designGraph = scopeGraph(content.design, 'all')
  designGraph.edges.forEach(edge => link(canonical.get(edge.from) || edge.from, canonical.get(edge.to) || edge.to, edge.label))
  content.design.direction.shots.forEach(shot => {
    link(canonical.get('overview')!, `shot:${shot.id}`, '共享设计')
    if (content.design.direction.location_asset_id) link('location', `shot:${shot.id}`, '共享场所')
  })
  // 成员、业务关系与摘要来自同一版本图；这里只分配总览的几何列。
  const graphNodes = [...snapshot.unit_graph.nodes, ...snapshot.instruction_graph.nodes, ...snapshot.edit_graph.nodes]
  graphNodes.forEach(node => {
    if (!['unit', 'instruction', 'unit_references', 'unit_basis', 'edit_take', 'edit_clip', 'edit_planned', 'edit_seam', 'edit_coverage', 'edit_cut_review', 'edit_end_frame', 'edit_downstream'].includes(node.kind)) return
    let navigation: SceneNavigationTarget | undefined
    let historyUnitId: string | undefined
    if (node.kind === 'unit' || node.kind === 'instruction') {
      if (content.units.some(unit => unit.id === node.unit_id)) navigation = { kind: node.kind, unitId: node.unit_id }
      historyUnitId = node.unit_id
    } else if (node.kind === 'edit_take') navigation = { kind: 'take', takeKind: node.take_kind, takeId: node.take_id }
    else if ((node.kind === 'edit_clip' || node.kind === 'edit_planned') && content.timeline.items.some(clip => clip.id === node.clip_id)) navigation = { kind: 'clip', clipId: node.clip_id }
    add({ id: objectAddress(node.object), label: node.title, column: node.kind === 'unit' ? 3 : node.kind === 'edit_take' || node.kind === 'edit_coverage' ? 5 : node.kind.startsWith('edit_') ? 6 : 4,
      detail: node.summary.map(field => `${field.label}：${field.text}`).join('\n'), navigation, historyUnitId })
  })
  ;[snapshot.unit_graph, snapshot.instruction_graph, snapshot.edit_graph].forEach(graph => graph.edges.forEach(edge => {
    if (edge.kind !== 'business' || !edge.target) return
    const source = graph.nodes.find(node => node.id === edge.source)
    const target = graph.nodes.find(node => node.id === edge.target)
    const address = (node: typeof source) => node?.kind === 'shot_basis' ? `shot:${node.shot_id}` : node ? objectAddress(node.object) : undefined
    const from = address(source), to = address(target)
    if (from && to && nodes.has(from) && nodes.has(to)) link(from, to, edge.label)
  }))
  const rows = [...nodes.values()]
  const counts = headings.map(() => 0)
  const positions = new Map(rows.map(node => [node.id, { x: node.column * 220 + 8, y: counts[node.column]++ * 94 + 42 }]))
  if (nodes.has(selected)) selectedObject.current = graphNodes.find(node => objectAddress(node.object) === selected)?.object
  const retained = selectedObject.current
  const retainedNode = !nodes.has(selected) && retained && retained.stable !== false ? graphNodes.find(node => node.object.stable !== false && node.object.version_id === retained.version_id && node.object.kind === retained.kind && node.object.id === retained.id) : undefined
  const activeSelection = retainedNode ? objectAddress(retainedNode.object) : selected
  const current = nodes.get(activeSelection)
  const related = edges.filter(edge => edge.from === activeSelection || edge.to === activeSelection)
  const highlighted = new Set([activeSelection, ...related.flatMap(edge => [edge.from, edge.to])])
  return <WorkbenchDetails open title="全场关系总览" initialExpanded onClose={close}>
    <div hidden={!!inspection}>
    <p>选择对象查看直接关联；定位和查看不保存、不应用、不生成。声音制作：{{ postproduction: '待后期', generated: '同期生成', unknown: '待确定' }[content.design.sound.execution]}。</p>
    {JSON.stringify(content) !== JSON.stringify(snapshot.content) && <p role="status">关系摘要为已保存图；当前编辑待同步，新对象仍可在原工作区编辑。</p>}
    <div className="scene-overview-viewport" aria-label="全场对象关系图"><div className="scene-overview-graph" style={{ width: 1540, height: Math.max(320, Math.max(...counts) * 94 + 52) }}>
      {headings.map((heading, index) => <h3 key={heading} style={{ left: index * 220 + 8 }}>{heading}</h3>)}
      <svg aria-hidden="true" width="100%" height="100%">{edges.map((edge, index) => {
        const from = positions.get(edge.from), to = positions.get(edge.to)
        if (!from || !to) return null
        return <line key={index} x1={from.x + 96} y1={from.y + 34} x2={to.x + 96} y2={to.y + 34} stroke={edge.from === activeSelection || edge.to === activeSelection ? '#a3a3a3' : '#484848'} strokeWidth={edge.from === activeSelection || edge.to === activeSelection ? 3 : 1} />
      })}</svg>
      {rows.map(node => <button key={node.id} type="button" data-overview-id={node.id} className={`scene-overview-node${highlighted.has(node.id) ? ' is-related' : ''}`} style={{ left: positions.get(node.id)!.x, top: positions.get(node.id)!.y }} aria-pressed={activeSelection === node.id} aria-label={`选择总览对象：${node.label}`} onClick={() => setSelected(node.id)}>{node.label}</button>)}
    </div></div>
    <section className="scene-overview-detail" aria-label="当前总览对象">{current ? <><h3>{current.label}</h3>{current.detail && <CanvasTextPreview text={current.detail} label="对象摘要" />}
      <Space wrap>{current.navigation && <Button onClick={() => { onClose(); onNavigate(current.navigation!) }}>定位当前对象</Button>}{current.inspection && <Button onClick={() => setInspection(current.inspection)}>查看对象详情</Button>}</Space>
      <ul>{related.map((edge, index) => { const other = nodes.get(edge.from === activeSelection ? edge.to : edge.from); return <li key={index}>{edge.label}：{other ? <Button type="link" onClick={() => setSelected(other.id)}>{other.label}</Button> : '原关联对象不可用或尚未核实'}</li> })}</ul>
      {current.id === 'design-history' && <OverviewDesignHistory projectId={projectId} sequenceId={sequenceId} versionId={versionId} />}
      {current.historyUnitId && historyUnitId !== current.historyUnitId && <WorkbenchButton variant="secondary" onClick={() => setHistoryUnitId(current.historyUnitId)}>查看完整任务与检查历史</WorkbenchButton>}
      {current.historyUnitId && historyUnitId === current.historyUnitId && <OverviewUnitHistory key={current.historyUnitId} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={current.historyUnitId} />}
    </> : <Alert type="warning" message="原总览对象已不可用，请重新选择" />}</section>
    </div>{inspection && <SceneRelationDetails inline key={JSON.stringify(inspection)} projectId={projectId} content={content} target={inspection} onClose={() => setInspection(undefined)} />}</WorkbenchDetails>
}

/** 历史记录按需只读查询；刷新只重新读取，不提交、应用或确认。 */
export function OverviewUnitHistory(target: { projectId: string; sequenceId: string; versionId: string; unitId: string; focusTaskId?: string; taskKind?: 'instructions' | 'checks' | 'videos' }) {
  const [data, setData] = useState<{ instructions?: SceneInstructionSuggestionRead[]; checks?: InstructionCheckRead[]; videos?: SceneVideoRead[] }>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      const keys = target.taskKind ? [target.taskKind] : ['instructions', 'checks', 'videos'] as const
      const reads = { instructions: () => StudioDirectingService.directingSceneInstructionSuggestions(target), checks: () => StudioDirectingService.directingInstructionChecks(target), videos: () => StudioDirectingService.directingSceneVideos(target) }
      const results = await Promise.allSettled(keys.map(kind => reads[kind]()))
      if (!active) return
      results.forEach((result, index) => {
        const key = keys[index]
        if (result.status === 'fulfilled' && result.value.data) {
          setData(previous => ({ ...previous, [key]: result.value.data }))
          setErrors(previous => ({ ...previous, [key]: '' }))
        } else setErrors(previous => ({ ...previous, [key]: result.status === 'rejected' ? directingError(result.reason) : '记录尚未核实' }))
      })
      if (results.some(result => result.status === 'fulfilled' && result.value.data?.some(row => !['succeeded', 'failed', 'cancelled'].includes(row.status)))) timer = setTimeout(() => void read(), 2000)
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [target.projectId, target.sequenceId, target.versionId, target.unitId, target.taskKind, attempt])
  return <section aria-label="总览任务与检查"><p>所属版本：{target.versionId} · 单元：{target.unitId}。历史状态与当前适用性分别核对。</p><Button onClick={() => setAttempt(value => value + 1)}>重新读取任务与检查</Button>
    {(target.taskKind ? [target.taskKind] : ['instructions', 'checks', 'videos'] as const).map(kind => <section key={kind}><h4>{{ instructions: '指令建议记录', checks: '检查记录', videos: '视频执行记录' }[kind]}</h4>
      {errors[kind] ? <Alert type="warning" message="总览记录读取失败" description={errors[kind]} /> : !data[kind] ? <p>正在核实记录</p> : data[kind]?.length === 0 ? <p>尚无此类记录</p> : null}
      {!errors[kind] && data[kind] && target.focusTaskId && !data[kind]?.some(row => row.task_id === target.focusTaskId) && <Alert type="warning" message="指定任务不属于此版本或单元，未选择其他记录。" />}
      {data[kind]?.filter(row => !target.focusTaskId || row.task_id === target.focusTaskId).map(row => <details key={row.task_id} open={target.focusTaskId === row.task_id}><summary>任务 {row.task_id} · {statuses[row.status] || row.status}</summary>
        {row.error && <p>{row.error}</p>}
        {'text' in row ? <><p>当时原文：{row.basis.text}</p><p>当时动作：{row.unit.coverage.map(item => item.action_scope).join('；')}</p><p>建议正文：{row.text || '尚无成功结果'}</p><SceneInstructionSnapshot selected={row} /></> :
          'inputs' in row ? <><p>记录原所属版本：{row.origin_version_id}</p><p>当时指令：{row.instruction}</p><BasisInputs title="检查固定依据" value={row.inputs} /><p>检查模型：{row.model_name}</p><SceneInstructionCheckResult selected={row} /></> :
            <><p>当时指令：{row.preparation.request.execution_prompt}</p><BasisInputs title="视频固定依据" value={row.preparation.inputs} /><p>登记素材：{row.takes.length}，不代表已采用。</p></>}
      </details>)}
    </section>)}
  </section>
}

/** 整场设计历史保持原任务依据；展示结果不进入当前版本编辑历史。 */
export function OverviewDesignHistory(target: { projectId: string; sequenceId: string; versionId: string; focusTaskId?: string }) {
  const [rows, setRows] = useState<SceneDesignSuggestionRead[]>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = await StudioDirectingService.directingSceneDesignSuggestions(target)
        if (!result.data) throw new Error('设计任务尚未核实')
        if (!active) return
        setRows(result.data); setError('')
        if (result.data.some(row => !['succeeded', 'failed', 'cancelled'].includes(row.status))) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [target.projectId, target.sequenceId, target.versionId, attempt])
  return <section aria-label="总览设计任务"><p>所属版本：{target.versionId}。历史结果不代表当前编辑内容。</p>
    <Button onClick={() => setAttempt(value => value + 1)}>重新读取设计任务</Button>
    {error ? <Alert type="warning" message="总览设计任务读取失败" description={error} /> : !rows ? <p>正在核实设计任务</p> : rows.length === 0 ? <p>本版本尚无设计任务</p> : null}
    {!error && rows && target.focusTaskId && !rows.some(row => row.task_id === target.focusTaskId) && <Alert type="warning" message="指定设计任务不属于此版本，未选择其他记录。" />}
    {rows?.filter(row => !target.focusTaskId || row.task_id === target.focusTaskId).map(row => <details key={row.task_id} open={target.focusTaskId === row.task_id}><summary>任务 {row.task_id} · {statuses[row.status] || row.status}</summary>
      {row.error && <p>{row.error}</p>}
      <p>当时原文：{row.basis.text}</p><p>当时要求：{row.instruction || '未补充要求'}</p>
      {row.diagnostics && <section aria-label="设计诊断 · 只读"><ul>{row.diagnostics.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul><details><summary>查看模型输出 · 只读</summary><pre>{row.diagnostics.output}</pre></details></section>}
      <p>请求范围：{row.scope?.join('、') || '整场设计'}</p>
      <details><summary>当时设计</summary><DesignFields value={row.before} path={[]} disabled onChange={() => {}} /></details>
      {row.design ? <details><summary>设计建议结果 · 未自动应用</summary><DesignFields value={row.design} path={[]} disabled onChange={() => {}} /></details> : <p>尚无成功设计结果</p>}
    </details>)}
  </section>
}
