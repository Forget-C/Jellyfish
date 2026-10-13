import { useSceneUnitPreparation } from './useSceneUnitPreparation'
import type { ScenePreparationIssue } from './useSceneUnitPreparation'
import { useState } from 'react'
import { Input, Select } from 'antd'
import type { SceneVersionContent_Output } from '../../../services/generated'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'
import { referencePurposes } from './referenceInput'
import { humanNote } from './common'
import { SceneInstructionSuggestions } from './SceneInstructionSuggestions'
import { SceneInstructionChecks } from './SceneInstructionChecks'
import { SceneInstructionBasis } from './SceneInstructionBasis'

/** 指令正文属于明确选中的原单元；查看、编辑与执行分别授权。 */
export function SceneInstructionCanvas({ onPrepare, focusRequest, projectId, sequenceId, versionId, revision, content, shotId, unitId, disabled, onSelectUnit, onChange, taskId, onTask, dirty, videoBusy, savePending, onVerifyVideo, videoRefresh, onGenerateVideo, onRetryVideo, videoFocus, onVideoFocused }: {
  projectId: string; sequenceId: string; revision: number; versionId: string; content: SceneVersionContent_Output; shotId?: string; unitId?: string; disabled: boolean
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
  const [suggestionPriority, setSuggestionPriority] = useState<{ versionId: string; unitId: string; priority: boolean }>()
  const [suggestionFocus, setSuggestionFocus] = useState<{ unitId: string; serial: number }>()
  const [suggestionsHost, setSuggestionsHost] = useState<HTMLSpanElement | null>(null)
  const [primaryHost, setPrimaryHost] = useState<HTMLSpanElement | null>(null)
  const allUnits = content.units || []
  const units = allUnits.filter(row => row.coverage.some(item => item.shot_id === shotId))
  const unit = units.find(row => row.id === unitId)
  const { missing } = useSceneUnitPreparation(projectId, sequenceId, versionId, revision, content, unit)
  return <><nav className="scene-unit-primary" aria-label="当前指令主操作"><strong>{unit ? `当前单元 ${allUnits.indexOf(unit) + 1} 的指令` : '请明确选择单元'}</strong><span ref={setPrimaryHost} /></nav><DirectorCanvasSurface key={`${versionId}:instructions:${unitId || 'empty'}`} focusTarget={suggestionFocus?.unitId === unit?.id && suggestionFocus && suggestionFocus.serial > (focusRequest?.serial || 0) ? { nodeId: '参考输入', fieldId: 'scene-instruction-suggestions', serial: suggestionFocus.serial } : focusRequest && focusRequest.unitId === unit?.id ? { nodeId: '当前指令', fieldId: 'scene-current-instruction', serial: focusRequest.serial } : undefined} contextKey={`${versionId}:instructions:${unitId || 'empty'}`} ariaLabel="指令画布视口"
    labels={['单元依据', '当前指令', '参考输入']} initialPositions={{ 参考输入: { x: 800, y: 0 } }}
    relations={unit ? [{ from: '单元依据', to: '当前指令', label: '编写依据' }, { from: '参考输入', to: '当前指令', label: '明确输入' }] : []}>
    <section className="canvas-workbench-card">
      <h2>当前单元</h2>
      <Select className="scene-instruction-select" aria-label="指令所属单元" placeholder="明确选择单元" value={unit?.id} style={{ width: '100%' }}
        options={units.map(row => ({ value: row.id, label: `单元 ${allUnits.indexOf(row) + 1} · ${row.coverage.map(item => item.action_scope).join('；') || '动作待填写'}` }))}
        onChange={id => onSelectUnit(id)} />
      {!unit && <p>{unitId ? '原单元不可用或不属于当前镜头，请重新选择。' : '先在单元画布明确准备单元，再编辑对应指令。'}</p>}
      {unit && <>{unit.coverage.map((item, index) => <p key={item.id}>覆盖 {index + 1}：{item.action_scope || '动作范围待填写'}</p>)}
        <p>画幅：{unit.ratio} · 预计时长：{unit.duration_ms == null ? '待填写' : `${unit.duration_ms / 1000} 秒`}</p>
        <details><summary>查看单元身份</summary><p>{unit.id}</p></details></>}
    </section>
    <section className="canvas-workbench-card">
      <h2>当前指令</h2>
      {unit ? <><p>单元 {allUnits.indexOf(unit) + 1} · 人工编辑按当前保存模式保存，可撤销。</p>
        <Input.TextArea id="scene-current-instruction" aria-label="当前单元指令正文" rows={16} disabled={disabled} value={unit.instruction || ''}
          placeholder="填写本单元的拍摄指令" onChange={event => {
            if (!disabled) onChange({ ...content, units: allUnits.map(row => row.id === unit.id ? { ...row, instruction: event.target.value, instruction_source: humanNote(event.target.value).sources?.[0] || null } : row) })
          }} />
        <p>保存正文不代表检查通过，也不会发起视频生成。</p>
        <SceneInstructionBasis key={unit.id} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={unit.id} revision={revision} content={content} disabled={disabled} onChange={onChange} />
        <SceneInstructionChecks suggestionPriority={suggestionPriority?.versionId === versionId && suggestionPriority.unitId === unit.id ? suggestionPriority.priority : true} onEmptyPrimaryHost={setSuggestionsHost} savePending={savePending} onVerifyVideo={onVerifyVideo} primaryHost={primaryHost} onVideoFocused={onVideoFocused} videoFocus={videoFocus} dirty={dirty} videoBusy={videoBusy} videoRefresh={videoRefresh} onGenerateVideo={() => onGenerateVideo(unit.id)} onRetryVideo={executionId => onRetryVideo(unit.id, executionId)} key={`${versionId}:${unit.id}`} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={unit.id} revision={revision} content={content} disabled={disabled} onChange={onChange} />
        {unit.instruction_source && <details><summary>查看正文来源</summary><p>{({ human: '人工填写', model: 'AI 指令建议', chapter: '章节原文', file: '参考文件', revision: '历史版本' })[unit.instruction_source.kind]}</p><p>来源身份：{unit.instruction_source.reference}</p><p>来源版本：{unit.instruction_source.version}</p></details>}</> : <p>明确选择单元后查看和编辑其正文。</p>}
    </section>
    <section className="canvas-workbench-card">
      <h2>本单元参考</h2>
      {unit ? <>{unit.references.length ? unit.references.map(reference => <p key={reference.id}>{reference.asset_origin?.name || reference.file_id} · {referencePurposes[reference.purpose]}</p>) : <p>当前没有明确参考输入。</p>}
        <p>在单元画布明确选择或修改参考；正文中的提及不会自动绑定素材。</p>
        <SceneInstructionSuggestions onPriority={setSuggestionPriority} onPrepare={missing.length ? () => onPrepare(unit.id, missing[0]) : undefined} onLocate={() => setSuggestionFocus({ unitId: unit.id, serial: Date.now() })} primaryHost={suggestionsHost} key={`${versionId}:${unit.id}`} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision}
          unitId={unit.id} content={content} disabled={disabled} onChange={onChange} initialTaskId={taskId} onTask={onTask} /></> : <p>先选择单元。</p>}
    </section>
  </DirectorCanvasSurface></>
}
