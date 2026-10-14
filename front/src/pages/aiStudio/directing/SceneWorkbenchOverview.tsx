import { useEffect, useState } from 'react'
import { Alert, Button, Modal, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { InstructionCheckRead, SceneDesignSuggestionRead, SceneInstructionSuggestionRead, SceneTakeLibraryRead, SceneVersionContent_Output, SceneVideoRead } from '../../../services/generated'
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
const headings = ['依据与共享', '设计对象', '镜头', '生产单元', '指令、参考与检查', '素材', '整场剪辑']

/** 汇总同一版本的真实身份；选择只高亮关系，定位与查看均须明确操作。 */
export function SceneWorkbenchOverview({ projectId, sequenceId, versionId, content, unitId, shotId, onNavigate, onClose }: {
  projectId: string; sequenceId: string; versionId: string; content: SceneVersionContent_Output; unitId?: string; shotId?: string
  onNavigate: (target: SceneNavigationTarget) => void; onClose: () => void
}) {
  const [selected, setSelected] = useState(unitId ? `unit:${unitId}` : shotId ? `shot:${shotId}` : 'basis')
  const [inspection, setInspection] = useState<SceneInspectionTarget>()
  const [takes, setTakes] = useState<SceneTakeLibraryRead[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [trigger] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  const close = () => { onClose(); requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }) }) }
  useEffect(() => {
    let active = true
    setLoading(true)
    void StudioDirectingService.directingSceneTakeLibrary({ projectId, sequenceId, versionId }).then(result => {
      if (!result.data) throw new Error('同场次素材尚未核实')
      if (active) { setTakes(result.data); setError('') }
    }).catch(cause => { if (active) setError(directingError(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, attempt])
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
  content.units.forEach((unit, index) => {
    const id = `unit:${unit.id}`
    const shot = unit.coverage.find(row => row.shot_id === shotId) || unit.coverage.find(row => content.design.direction.shots.some(item => item.id === row.shot_id))
    const navigation = shot ? { kind: 'unit' as const, unitId: unit.id, shotId: shot.shot_id } : undefined
    add({ id, label: `单元 ${index + 1}`, column: 3, navigation,
      detail: `${unit.coverage.map(row => row.action_scope || '动作未填写').join('；')}；${unit.model_id ? '已选模型' : '未选模型'}；${unit.duration_ms == null ? '时长未填写' : `${unit.duration_ms / 1000} 秒`}。执行准备度仍需核实。` })
    unit.coverage.forEach(row => link(`shot:${row.shot_id}`, id, '计划覆盖'))
    add({ id: `instruction:${unit.id}`, label: `单元 ${index + 1} 指令`, column: 4, detail: unit.instruction || '正文尚未填写', navigation: navigation ? { ...navigation, kind: 'instruction' } : undefined })
    link(id, `instruction:${unit.id}`, '当前正文')
    add({ id: `history:${unit.id}`, label: `单元 ${index + 1} 任务与检查`, column: 4, detail: '展开核实指令建议、检查和视频执行；历史成功不代表当前依据适用。', historyUnitId: unit.id })
    link(`instruction:${unit.id}`, `history:${unit.id}`, '任务与固定依据')
    unit.references.forEach((reference, refIndex) => {
      const refId = `reference:${unit.id}:${reference.id}`
      add({ id: refId, label: `单元 ${index + 1} 参考 ${refIndex + 1}`, column: 4, detail: reference.asset_origin?.name || reference.file_id, inspection: { kind: 'reference', unitId: unit.id, id: reference.id } })
      link(refId, id, '明确参考输入')
      reference.participant_ids.forEach(person => link(`participant:${person}`, refId, '主体绑定'))
    })
  })
  takes?.forEach((take, index) => {
    const id = `take:${take.take_kind}:${take.take_id}`
    const judgment = content.take_judgments.find(row => row.take_kind === take.take_kind && row.take_id === take.take_id)
    const verdict = judgment?.annotation.verdict ? { pass: '通过', retain: '保留', repair: '需修复', discard: '弃用' }[judgment.annotation.verdict] : '未审查'
    add({ id, label: `素材 ${index + 1}`, column: 5, detail: `${take.available ? '已登记' : '文件不可用'}；当前方案判断：${verdict}；来源${take.take_kind === 'scene_video' ? '场次版本' : '生产计划'}：${take.origin_id}；任务：${take.task_id}`,
      navigation: !loading && !error ? { kind: 'take', takeKind: take.take_kind, takeId: take.take_id } : undefined })
    if (take.take_kind === 'scene_video' && take.origin_id === versionId && nodes.has(`history:${take.unit_id}`)) link(`history:${take.unit_id}`, id, '真实生成输出')
  })
  ;[...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms).forEach((clip, index) => {
    add({ id: `clip:${clip.id}`, label: `片段 ${index + 1}`, column: 6, navigation: { kind: 'clip', clipId: clip.id },
      detail: 'media_range' in clip ? `源区间：${clip.media_range.source_in_ms}–${clip.media_range.source_out_ms} 毫秒\n时间位置：${clip.timeline_start_ms} 毫秒` : `待拍占位；预计 ${clip.estimated_duration_ms} 毫秒；时间位置：${clip.timeline_start_ms} 毫秒` })
    link('media_range' in clip ? `take:${clip.take_kind}:${clip.take_id}` : `shot:${clip.shot_id}`, `clip:${clip.id}`, 'media_range' in clip ? '明确采用' : '预计占位')
  })
  const rows = [...nodes.values()]
  const counts = headings.map(() => 0)
  const positions = new Map(rows.map(node => [node.id, { x: node.column * 220 + 8, y: counts[node.column]++ * 94 + 42 }]))
  const current = nodes.get(selected)
  const related = edges.filter(edge => edge.from === selected || edge.to === selected)
  const highlighted = new Set([selected, ...related.flatMap(edge => [edge.from, edge.to])])
  return <><Modal open title="全场关系总览" width="calc(100vw - 32px)" rootClassName="canvas-workbench-dialog scene-overview-dialog" style={{ top: 16 }} onCancel={close} footer={<Button onClick={close}>返回当前工作</Button>}>
    <p>选择对象查看直接关联；定位和查看不保存、不应用、不生成。声音制作：{{ postproduction: '待后期', generated: '同期生成', unknown: '待确定' }[content.design.sound.execution]}。</p>
    {loading && <p>正在核实总览素材</p>}
    {error && <Alert type="warning" message="总览素材读取失败" description={error} action={<Button loading={loading} onClick={() => setAttempt(value => value + 1)}>重试总览素材</Button>} />}
    {!loading && !error && takes?.length === 0 && <p>本场暂无素材</p>}
    <div className="scene-overview-viewport" aria-label="全场对象关系图"><div className="scene-overview-graph" style={{ width: 1540, height: Math.max(320, Math.max(...counts) * 94 + 52) }}>
      {headings.map((heading, index) => <h3 key={heading} style={{ left: index * 220 + 8 }}>{heading}</h3>)}
      <svg aria-hidden="true" width="100%" height="100%">{edges.map((edge, index) => {
        const from = positions.get(edge.from), to = positions.get(edge.to)
        if (!from || !to) return null
        return <line key={index} x1={from.x + 96} y1={from.y + 34} x2={to.x + 96} y2={to.y + 34} stroke={edge.from === selected || edge.to === selected ? '#a3a3a3' : '#484848'} strokeWidth={edge.from === selected || edge.to === selected ? 3 : 1} />
      })}</svg>
      {rows.map(node => <button key={node.id} type="button" data-overview-id={node.id} className={`scene-overview-node${highlighted.has(node.id) ? ' is-related' : ''}`} style={{ left: positions.get(node.id)!.x, top: positions.get(node.id)!.y }} aria-pressed={selected === node.id} aria-label={`选择总览对象：${node.label}`} onClick={() => setSelected(node.id)}>{node.label}</button>)}
    </div></div>
    <section className="scene-overview-detail" aria-label="当前总览对象">{current ? <><h3>{current.label}</h3>{current.detail?.split('\n').map((line, index) => <p key={index}>{line}</p>)}
      <Space wrap>{current.navigation && <Button onClick={() => { onClose(); onNavigate(current.navigation!) }}>定位当前对象</Button>}{current.inspection && <Button onClick={() => setInspection(current.inspection)}>查看对象详情</Button>}</Space>
      <ul>{related.map((edge, index) => { const other = nodes.get(edge.from === selected ? edge.to : edge.from); return <li key={index}>{edge.label}：{other ? <Button type="link" onClick={() => setSelected(other.id)}>{other.label}</Button> : '原关联对象不可用或尚未核实'}</li> })}</ul>
      {current.id === 'design-history' && <OverviewDesignHistory projectId={projectId} sequenceId={sequenceId} versionId={versionId} />}
      {current.historyUnitId && <OverviewUnitHistory key={current.historyUnitId} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={current.historyUnitId} />}
    </> : <Alert type="warning" message="原总览对象已不可用，请重新选择" />}</section>
  </Modal>{inspection && <SceneRelationDetails key={JSON.stringify(inspection)} projectId={projectId} content={content} target={inspection} onClose={() => setInspection(undefined)} />}</>
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
      {!errors[kind] && data[kind]?.filter(row => !target.focusTaskId || row.task_id === target.focusTaskId).map(row => <details key={row.task_id} open={target.focusTaskId === row.task_id}><summary>任务 {row.task_id} · {statuses[row.status] || row.status}</summary>
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
    {!error && rows?.filter(row => !target.focusTaskId || row.task_id === target.focusTaskId).map(row => <details key={row.task_id} open={target.focusTaskId === row.task_id}><summary>任务 {row.task_id} · {statuses[row.status] || row.status}</summary>
      {row.error && <p>{row.error}</p>}
      <p>当时原文：{row.basis.text}</p><p>当时要求：{row.instruction || '未补充要求'}</p>
      <p>请求范围：{row.scope?.join('、') || '整场设计'}</p>
      <details><summary>当时设计</summary><DesignFields value={row.before} path={[]} disabled onChange={() => {}} /></details>
      {row.design ? <details><summary>设计建议结果 · 未自动应用</summary><DesignFields value={row.design} path={[]} disabled onChange={() => {}} /></details> : <p>尚无成功设计结果</p>}
    </details>)}
  </section>
}
