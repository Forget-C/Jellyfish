import { CanvasBrowse } from './CanvasBrowse'
import { SceneUnitPreparationStatus } from './SceneUnitPreparationStatus'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { ReferencePreview } from './ReferencePreview'
import { createPortal } from 'react-dom'
import { useSceneUnitPreparation } from './useSceneUnitPreparation'
import type { ScenePreparationIssue } from './useSceneUnitPreparation'
import { useState } from 'react'
import { Button, Input, Select } from 'antd'
import type { SceneVersionContent_Output } from '../../../services/generated'
import { GraphCanvas } from './GraphCanvas'
import type { GraphArrange } from './graphLayout'
import { UnitScopeSummary } from './UnitScopeSummary'
import type { CanvasTarget, InstructionCanvasGraph, UnitCanvasGraph } from '../../../services/generated'
import { referencePurposes } from './referenceInput'
import { humanNote } from './common'
import { SceneInstructionSuggestions } from './SceneInstructionSuggestions'
import { SceneInstructionChecks } from './SceneInstructionChecks'
import { SceneInstructionBasis } from './SceneInstructionBasis'

const recordStatuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 正文摘要作为视口锚点，依据和参考在邻列排列；只决定几何位置。 */
const arrangeInstruction: GraphArrange = (nodes, sizes, _width, anchor, retained = {}) => {
  const positions = { ...retained }
  let top = 0
  nodes.forEach(node => {
    if (!positions[node.id]) positions[node.id] = node.id === anchor ? { x: 0, y: 0 } : { x: 424, y: top }
    if (node.id !== anchor) top = positions[node.id].y + (sizes[node.id]?.height || 240) + 32
  })
  return positions
}

/** 指令正文属于明确选中的原单元；查看、编辑与执行分别授权。 */
export function SceneInstructionCanvas({ preparationHost, unitGraphState, graph, evidenceError, onEvidenceChanged, onRetryGraph, onLocateSource, primaryHost, onPrepare, focusRequest, projectId, sequenceId, versionId, revision, content, unitId, disabled, onSelectUnit, onChange, taskId, onTask, dirty, videoBusy, savePending, onVerifyVideo, videoRefresh, onGenerateVideo, onRetryVideo, videoFocus, onVideoFocused }: {
  preparationHost: HTMLElement | null
  unitGraphState: { graph?: UnitCanvasGraph; current: boolean; pending: boolean; error: string; retry: () => void }
  evidenceError: string
  onEvidenceChanged: () => void
  graph: InstructionCanvasGraph
  onRetryGraph: () => void
  onLocateSource: (target: CanvasTarget) => boolean
  primaryHost: HTMLElement | null
  projectId: string; sequenceId: string; revision: number; versionId: string; content: SceneVersionContent_Output; unitId?: string; disabled: boolean
  onSelectUnit: (id: string) => void; onChange: (content: SceneVersionContent_Output) => void
  focusRequest?: { unitId: string; serial: number }
  onPrepare: (unitId: string, issue: ScenePreparationIssue) => void
  onVideoFocused: () => void
  videoFocus?: { executionId: string; serial: number }
  onVerifyVideo?: () => void
  dirty: boolean; videoBusy: boolean; savePending: boolean; videoRefresh: number; onGenerateVideo: (unitId: string) => void; onRetryVideo: (unitId: string, executionId: string) => void
  taskId?: string
  onTask: (taskId: string, unitId: string) => void
}) {
  const [selectedRecord, setSelectedRecord] = useState<string>()
  const [unavailableSource, setUnavailableSource] = useState(false)
  const [recordFocus, setRecordFocus] = useState<{ unitId: string; kind: 'suggestion' | 'check'; taskId: string; serial: number }>()
  const [reading, setReading] = useState<'basis' | 'references'>()
  const [expandedUnit, setExpandedUnit] = useState<string>()
  const [suggestionPriority, setSuggestionPriority] = useState<{ versionId: string; unitId: string; priority: boolean }>()
  const [suggestionFocus, setSuggestionFocus] = useState<{ unitId: string; serial: number }>()
  const [suggestionsHost, setSuggestionsHost] = useState<HTMLSpanElement | null>(null)
  const [actionHost, setActionHost] = useState<HTMLSpanElement | null>(null)
  const allUnits = content.units || []
  const units = allUnits
  const unit = allUnits.find(row => row.id === unitId)
  const [preparationAttempt, setPreparationAttempt] = useState(0)
  const { missing, checking, failed, frameEvidence } = useSceneUnitPreparation(projectId, sequenceId, versionId, revision, content, unit, preparationAttempt, unitGraphState)
  const validGraph = !!graph && graph.kind === 'instructions' && graph.version_id === versionId && graph.revision === revision && Array.isArray(graph.nodes) && Array.isArray(graph.edges) && Array.isArray(graph.views)
  const nodes = validGraph && unit ? graph.nodes.filter(node => node.unit_id === unitId) : []
  const basis = nodes.find(node => node.kind === 'unit_basis')
  const references = nodes.find(node => node.kind === 'unit_references')
  const instruction = nodes.find(node => node.kind === 'instruction')
  const view = validGraph ? graph.views.find(row => row.anchor_id === instruction?.id) : undefined
  const summary = (node: typeof graph.nodes[number]) => <><div className="design-compact-fields">{node.summary.slice(0, 3).map(field => <p key={field.field} title={`${field.label}：${field.text}`}><span>{field.label}：</span><strong>{field.text}</strong></p>)}</div>{node.issues.length > 0 && <div className="design-compact-fields"><p><strong>{node.issues[0].message}</strong></p></div>}</>
  const editor = <section className="canvas-workbench-card">
      {unit ? <><p>单元 {allUnits.indexOf(unit) + 1} · 人工编辑按当前保存模式保存，可撤销。</p>
        <Input.TextArea id="scene-current-instruction" aria-label="当前单元指令正文" rows={expandedUnit === unit.id ? 16 : 4} onFocus={() => setExpandedUnit(unit.id)} disabled={disabled} value={unit.instruction || ''}
          placeholder="填写本单元的拍摄指令" onChange={event => {
            if (!disabled) onChange({ ...content, units: allUnits.map(row => row.id === unit.id ? { ...row, instruction: event.target.value, instruction_source: humanNote(event.target.value).sources?.[0] || null } : row) })
          }} />
        <Button type="text" aria-expanded={expandedUnit === unit.id} onClick={() => setExpandedUnit(expandedUnit === unit.id ? undefined : unit.id)}>{expandedUnit === unit.id ? '收起指令正文' : '展开编辑指令'}</Button>
        <p>保存正文不代表检查通过，也不会发起视频生成。</p>
        <SceneInstructionBasis key={unit.id} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={unit.id} revision={revision} content={content} disabled={disabled} onChange={onChange} />
        <SceneInstructionChecks focusTask={recordFocus?.unitId === unit?.id && recordFocus?.kind === 'check' ? recordFocus : undefined} onEvidenceChanged={onEvidenceChanged} suggestionPriority={suggestionPriority?.versionId === versionId && suggestionPriority.unitId === unit.id ? suggestionPriority.priority : true} onEmptyPrimaryHost={setSuggestionsHost} savePending={savePending} onVerifyVideo={onVerifyVideo} primaryHost={actionHost} onVideoFocused={onVideoFocused} videoFocus={videoFocus} dirty={dirty} videoBusy={videoBusy} videoRefresh={videoRefresh} onGenerateVideo={() => onGenerateVideo(unit.id)} onRetryVideo={executionId => onRetryVideo(unit.id, executionId)} key={`${versionId}:${unit.id}`} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={unit.id} revision={revision} content={content} disabled={disabled} onChange={onChange} />
        {unit.instruction_source && <details><summary>查看正文来源</summary><p>{({ human: '人工填写', model: 'AI 指令建议', chapter: '章节原文', file: '参考文件', revision: '历史版本' })[unit.instruction_source.kind]}</p><p>来源身份：{unit.instruction_source.reference}</p><p>来源版本：{unit.instruction_source.version}</p></details>}</> : <p>明确选择单元后查看和编辑其正文。</p>}
    </section>
  return <div className="scene-instruction-canvas">
    {unit && <SceneUnitPreparationStatus host={preparationHost} missing={missing} checking={checking} failed={failed} onLocate={issue => onPrepare(unit.id, issue)} onRetry={() => { setPreparationAttempt(value => value + 1); unitGraphState.retry(); frameEvidence.reload() }} />}
    {primaryHost && createPortal(<nav className="scene-unit-primary" aria-label="当前指令主操作"><strong>{unit ? `当前单元 ${allUnits.indexOf(unit) + 1} 的指令` : '请明确选择单元'}</strong><span ref={setActionHost} /></nav>, primaryHost)}
    <CanvasBrowse storageKey={`jellyfish:instructions:local-user:${projectId}:${sequenceId}:${versionId}`} label="指令画布位置" filtered={!!unitId}
      filters={<label>单元<Select aria-label="指令所属单元" value={unitId || ''} onChange={onSelectUnit}
        options={[{ value: '', label: '请选择单元' }, ...units.map(row => ({ value: row.id, label: `单元 ${allUnits.indexOf(row) + 1} · ${row.coverage.map(item => item.action_scope).join('；') || '动作待填写'}` })),
          ...(unitId && !unit ? [{ value: unitId, label: '原单元不可用' }] : [])]} /></label>}
      actions={<WorkbenchButton variant="secondary" onClick={onRetryGraph}>刷新图证据</WorkbenchButton>}
      notice={<>
        {!validGraph && <p role="alert">指令图与当前版本不一致。<WorkbenchButton variant="secondary" onClick={onRetryGraph}>重新读取版本</WorkbenchButton></p>}
        {evidenceError && <p role="alert">图证据读取失败，当前选择和输入已保留：{evidenceError}。请刷新图证据重试。</p>}
        {dirty && <p aria-label="指令图同步状态">图待同步：图展示已保存内容，正文编辑器保留当前输入。</p>}
        {!unit && <p>{unitId ? '原单元不可用，请重新选择。' : '先明确选择单元，再编辑对应指令。'}</p>}
      </>}>
      <WorkbenchButton aria-label="返回指令概览" variant="quiet" onClick={() => onSelectUnit('')}>指令画布</WorkbenchButton>
      {unitId && <span>{unit ? `› 单元 ${allUnits.indexOf(unit) + 1}` : '› 原单元不可用'}</span>}
    </CanvasBrowse>

    {validGraph && <GraphCanvas key={`${versionId}:instructions:${unitId || 'empty'}`} contextKey={`${projectId}:${sequenceId}:${versionId}:instructions:${unitId || 'empty'}`} ariaLabel="指令画布视口"
      focusTarget={focusRequest && instruction && focusRequest.unitId === unit?.id ? { nodeId: instruction.id, fieldId: 'scene-current-instruction', serial: focusRequest.serial } : suggestionFocus && references && suggestionFocus.unitId === unit?.id ? { nodeId: references.id, fieldId: 'scene-instruction-suggestions', serial: suggestionFocus.serial } : undefined}
      layoutScope={view ? { storageKey: `jellyfish:instructions:local-user:${projectId}:${sequenceId}:${versionId}`, viewId: view.id, anchorId: instruction?.id || '',
        validIds: graph.nodes.map(node => node.id), validViewIds: graph.views.map(row => row.id), arrange: arrangeInstruction, initialTop: 112 } : undefined}
      objects={(view?.members || []).flatMap(member => {
        const node = nodes.find(row => row.id === member.node_id)
        if (!node) return []
        const record = node.kind === 'instruction' ? node.records.find(row => row.task_id === selectedRecord) || node.records[0] : undefined
        return [{ id: node.id, label: node.title, group: member.group, size: { width: 392, height: 560 },
          content: node.kind === 'instruction' ? <section className="canvas-workbench-card">{summary(node)}<section aria-label="已保存指令记录">
            <p>正文来源：{node.source?.kind || '未绑定'} · 依据：{({ empty: '正文为空', unbound: '依据未绑定', current: '依据一致', changed: '依据已变', unverified: '依据待核实' })[node.basis_status]}</p>
            {node.evidence_issue && <div className="design-compact-fields"><p><strong>{node.evidence_issue}</strong></p></div>}
            <p>相关建议／检查 {node.records.length} 条；在原工作区阅读完整记录与原因。</p>
            {record && <><div className="design-compact-fields"><p><strong>{record.kind === 'suggestion' ? '建议' : '检查'} · {recordStatuses[record.status] || '状态待核实'}</strong></p>
              <p><strong>{record.reason || (record.kind === 'check' ? record.confirmed ? '检查已明确确认' : record.matches_current ? '适用于已保存输入，尚未确认' : '不适用于已保存输入' : '查看后明确应用')}</strong></p></div>
              <Select aria-label="指令记录定位" style={{ width: '100%' }} value={record.task_id}
                options={node.records.map(row => ({ value: row.task_id, label: `${row.kind === 'suggestion' ? '建议' : '检查'} · ${row.bound ? '当前绑定 · ' : ''}${recordStatuses[row.status] || '状态待核实'} · ${row.task_id}` }))} onChange={setSelectedRecord} />
              <WorkbenchButton variant="secondary" onClick={() => {
                setRecordFocus({ unitId: record.unit_id, kind: record.kind, taskId: record.task_id, serial: Date.now() })
                document.querySelector(`[aria-label="当前单元指令${record.kind === 'suggestion' ? '建议' : '检查'}"]`)?.scrollIntoView({ block: 'center' })
              }}>查看原{record.kind === 'suggestion' ? '建议' : '检查'}记录</WorkbenchButton></>}
            {!node.records.length && <p>尚无已登记的建议或检查；待核实原请求仍在工作区核实。</p>}
          </section><WorkbenchButton variant="secondary" disabled={!unit} onClick={() => document.getElementById('scene-current-instruction')?.focus()}>编辑当前指令</WorkbenchButton></section> : <section className="canvas-workbench-card">{summary(node)}
            {node.kind === 'unit_basis' ? <WorkbenchButton variant="secondary" disabled={!unit} onClick={() => setReading('basis')}>查看完整单元依据</WorkbenchButton> : <>
              <WorkbenchButton variant="secondary" disabled={!unit} onClick={() => setReading('references')}>查看完整参考输入</WorkbenchButton>
              <p>在单元画布明确选择或修改参考；正文中的提及不会自动绑定素材。</p>
            </>}
          </section>, onInspect: node.kind === 'instruction' ? () => document.getElementById('scene-current-instruction')?.focus() : () => { if (unit) setReading(node.kind === 'unit_basis' ? 'basis' : 'references') } }]
      })}
      relations={graph.edges.filter(edge => view?.edge_ids.includes(edge.id) && edge.target).map(edge => ({ from: edge.source, to: edge.target!, label: edge.label, category: edge.category }))} />}
    <div className="scene-instruction-workspace" aria-label="指令编辑工作区">
      {unit && validGraph && !instruction && <p>此单元尚未保存，图待同步。继续编辑当前正文。</p>}
      {editor}
      {unit && <SceneInstructionSuggestions onEvidenceChanged={onEvidenceChanged} onPriority={setSuggestionPriority} preparationBlocked={!!missing.length || checking || failed} onLocate={() => setSuggestionFocus({ unitId: unit.id, serial: Date.now() })} primaryHost={suggestionsHost} key={`${versionId}:${unit.id}`} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision}
          unitId={unit.id} content={content} disabled={disabled} onChange={onChange} initialTaskId={taskId} recordFocus={recordFocus?.unitId === unit?.id && recordFocus?.kind === 'suggestion' ? recordFocus : undefined} onTask={onTask} />}
    </div>

    <WorkbenchDetails title={reading === 'basis' ? '单元依据 · 只读' : '参考输入 · 只读'} status="只读" open={!!reading && !!unit} onClose={() => setReading(undefined)}>
      {unavailableSource && <p role="alert">当前来源目标不可用，请保存后重新核对；不会选择其他对象。</p>}
      {reading === 'basis' && basis?.kind === 'unit_basis' && <UnitScopeSummary value={basis.scope} fieldTargets={basis.field_targets} onLocate={target => { if (onLocateSource(target)) { setUnavailableSource(false); setReading(undefined) } else setUnavailableSource(true) }} />}
      {reading === 'references' && references?.kind === 'unit_references' && (!references.bindings.length ? <p>当前没有明确参考输入。</p> : references.bindings.map(reference => <section key={reference.id}><p>绑定身份：{reference.id} · 用途：{referencePurposes[reference.purpose]} · 输入角色：{reference.input_role} · 顺序：{reference.ordinal}</p><ReferencePreview reference={reference} /></section>))}
    </WorkbenchDetails>
  </div>
}
