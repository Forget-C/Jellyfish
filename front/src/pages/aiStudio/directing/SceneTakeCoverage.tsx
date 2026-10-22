import { useState } from 'react'
import { Alert, Button, Input, InputNumber, Select, Space } from 'antd'
import type { SceneActualCoverage_Output, SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'

/** 人工观察明确绑定当前动作和原文件时间码，不从生产计划推断覆盖。 */
export function SceneTakeCoverage({ take, content, coverage, disabled, onChange }: {
  take: SceneTakeLibraryRead; content: SceneVersionContent_Output; coverage: SceneActualCoverage_Output[]; disabled: boolean
  onChange: (coverage: SceneActualCoverage_Output[]) => void
}) {
  const [target, setTarget] = useState<string>()
  const [observation, setObservation] = useState('')
  const [start, setStart] = useState<number | null>(null)
  const [end, setEnd] = useState<number | null>(null)
  const [editing, setEditing] = useState<string>()
  const choices = content.units.flatMap((unit, unitIndex) => unit.coverage.map((action, actionIndex) => ({
    value: JSON.stringify([unit.id, action.id]), unitId: unit.id, actionId: action.id,
    label: `单元 ${unitIndex + 1} · 动作 ${actionIndex + 1}：${action.action_scope || '动作待填写'}`,
  })))
  const chosen = choices.find(row => row.value === target)
  const validRange = start != null && end != null && Number.isInteger(start) && Number.isInteger(end)
    && start >= 0 && end > start && take.duration_ms != null && end <= take.duration_ms
  const clear = () => { setTarget(undefined); setObservation(''); setStart(null); setEnd(null); setEditing(undefined) }
  const record = () => {
    if (disabled || !chosen || !validRange || !observation.trim() || start == null || end == null) return
    const range = { source_in_ms: start, source_out_ms: end }
    const next: SceneActualCoverage_Output = { id: editing || crypto.randomUUID(), unit_id: chosen.unitId, coverage_item_id: chosen.actionId,
      media_range: range, observation: observation.trim(), source: { kind: 'file', reference: take.take_id, version: take.file_id, file_id: take.file_id, media_range: range } }
    onChange(editing ? coverage.map(row => row.id === editing ? next : row) : [...coverage, next])
    clear()
  }
  return <section aria-label="实际覆盖判断" id="scene-take-coverage-editor" tabIndex={-1}>
    <h3>实际覆盖</h3>
    <p>记录素材中实际看到的内容；动作偏差或部分完成需如实说明，不自动计为计划已完成。</p>
    {!coverage.length && <p>尚未记录实际覆盖。</p>}
    {coverage.map((row, index) => {
      const action = choices.find(item => item.unitId === row.unit_id && item.actionId === row.coverage_item_id)
      return <div key={row.id} id={`scene-actual-coverage-${row.id}`} tabIndex={-1}>
        <p>{action?.label || `原动作已失效：${row.unit_id} / ${row.coverage_item_id}`}</p>
        <p>{row.media_range.source_in_ms}–{row.media_range.source_out_ms} 毫秒：{row.observation}</p>
        {!action && <Alert type="warning" message="覆盖目标已失效，请明确改绑或删除此判断后保存" />}
        <Space><Button disabled={disabled} onClick={() => {
          setEditing(row.id); setTarget(JSON.stringify([row.unit_id, row.coverage_item_id])); setObservation(row.observation)
          setStart(row.media_range.source_in_ms); setEnd(row.media_range.source_out_ms)
        }}>编辑覆盖 {index + 1}</Button>
          <Button disabled={disabled} onClick={() => { onChange(coverage.filter(item => item.id !== row.id)); if (editing === row.id) clear() }}>删除覆盖 {index + 1}</Button></Space>
      </div>
    })}
    <Select aria-label="实际覆盖动作" placeholder="明确选择当前方案动作" style={{ width: '100%' }} disabled={disabled} value={target} options={choices} onChange={setTarget} />
    <Input.TextArea aria-label="实际覆盖观察" placeholder="如实记录观察到的动作及偏差" disabled={disabled} rows={3} value={observation} onChange={event => setObservation(event.target.value)} />
    <Space wrap>
      <InputNumber aria-label="实际覆盖入点毫秒" placeholder="入点（毫秒）" disabled={disabled} precision={0} value={start} onChange={setStart} />
      <InputNumber aria-label="实际覆盖出点毫秒" placeholder="出点（毫秒）" disabled={disabled} precision={0} value={end} onChange={setEnd} />
    </Space>
    {(start != null || end != null) && !validRange && <Alert type="warning" message={`区间须满足 0 ≤ 入点 < 出点 ≤ ${take.duration_ms ?? '待核实'} 毫秒`} />}
    {target && !chosen && <Alert type="warning" message="所选动作已失效，请重新选择" />}
    <Space wrap><Button disabled={disabled || !chosen || !validRange || !observation.trim()} onClick={record}>{editing ? '更新实际覆盖' : '记录实际覆盖'}</Button>
      <Button disabled={disabled} onClick={clear}>清空覆盖表单</Button></Space>
    <p>点击记录后纳入当前方案保存；未记录的表单不属于已保存判断。</p>
  </section>
}
