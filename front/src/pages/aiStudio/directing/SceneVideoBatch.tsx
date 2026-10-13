import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Modal, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneVersionContent_Output, SceneVersionRead, SceneVideoPreparation_Output } from '../../../services/generated'
import { SceneVideoBatchTask } from './SceneVideoBatchTask'
import type { VideoActivityTarget } from './SceneVideoActivity'
import { directingError } from './common'

// 本地键只检测变化；实际影响范围由服务端检查输入比较决定。
const inputKey = (content: SceneVersionContent_Output, id: string) => JSON.stringify({
  basis: content.basis, design: content.design, unit: content.units.find(unit => unit.id === id),
})
type Checked = { key: string; preparation?: SceneVideoPreparation_Output; error?: string; submitted?: boolean }

/** 明确选择、逐项预检、再次授权提交；预检不会保存内容或创建任务。 */
export function SceneVideoBatch({ projectId, sequenceId, version, content, disabled, onSubmit, onLocate, pending, onVerify, storageError, activities }: {
  activities: VideoActivityTarget[]
  pending: { unitId: string; submitting?: boolean; error?: string }[]
  onVerify: (unitId: string) => void; storageError: string
  projectId: string; sequenceId: string; version: SceneVersionRead; content: SceneVersionContent_Output; disabled: boolean
  onSubmit: (preparation: SceneVideoPreparation_Output) => boolean
  onLocate: (unitId: string) => Promise<void>
}) {
  const [tasks, setTasks] = useState<VideoActivityTarget[]>([])
  useEffect(() => {
    setTasks(previous => {
      const added = activities.filter(target => !previous.some(item => item.taskId === target.taskId))
      return added.length ? [...previous, ...added] : previous
    })
  }, [activities])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [checks, setChecks] = useState<Record<string, Checked>>({})
  const [comparisons, setComparisons] = useState<Record<string, { key: string; matches?: boolean; pending?: boolean; error?: string }>>({})
  const [compareAttempt, setCompareAttempt] = useState(0)
  const comparisonKey = JSON.stringify([content, checks])
  useEffect(() => {
    let active = true
    const changed = Object.entries(checks).filter(([id, checked]) => checked.preparation && !checked.submitted &&
      (checked.key !== inputKey(content, id) || comparisons[id]?.pending || comparisons[id]?.error))
    if (!changed.length) return
    setComparisons(previous => ({ ...previous, ...Object.fromEntries(changed.map(([id]) => [id, { key: inputKey(content, id), pending: true }])) }))
    void Promise.all(changed.map(async ([unitId, checked]) => {
      const key = inputKey(content, unitId)
      try {
        const response = await StudioDirectingService.directingInstructionCheckCompare({ projectId, sequenceId, versionId: version.id,
          unitId, taskId: checked.preparation!.check_task_id, requestBody: { content } })
        if (!response.data) throw new Error('预检适用性尚未核实')
        return [unitId, { key, matches: response.data.confirmed && response.data.matches_current && response.data.basis_current }] as const
      } catch (cause) { return [unitId, { key, error: directingError(cause) }] as const }
    })).then(results => { if (active) setComparisons(previous => ({ ...previous, ...Object.fromEntries(results) })) })
    return () => { active = false }
  }, [comparisonKey, compareAttempt, projectId, sequenceId, version.id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [readErrors, setReadErrors] = useState<Record<string, string>>({})
  const [readAttempt, setReadAttempt] = useState(0)
  const unitIds = JSON.stringify(content.units.map(unit => unit.id))
  useEffect(() => {
    if (!open) return
    let active = true
    setReading(true)
    void Promise.all(content.units.map(async (unit, index) => {
      const target = { projectId, sequenceId, versionId: version.id, unitId: unit.id }
      try {
        const response = await StudioDirectingService.directingSceneVideos(target)
        if (!response.data) throw new Error('此单元任务记录尚未核实')
        return { unitId: unit.id, tasks: response.data.map(row => ({ ...target, taskId: row.task_id,
          versionTitle: version.title, unitLabel: `单元 ${index + 1}` })), error: '' }
      } catch (cause) { return { unitId: unit.id, tasks: [], error: directingError(cause) } }
    })).then(results => {
      if (!active) return
      const loaded = results.flatMap(result => result.tasks)
      setTasks(previous => [...previous, ...loaded.filter(target => !previous.some(item => item.taskId === target.taskId))])
      setReadErrors(Object.fromEntries(results.filter(result => result.error).map(result => [result.unitId, result.error])))
      setReading(false)
    })
    return () => { active = false }
  }, [open, projectId, sequenceId, version.id, unitIds, readAttempt])
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const applicable = (id: string) => !comparisons[id]?.pending && !comparisons[id]?.error &&
    (checks[id]?.key === inputKey(content, id) || comparisons[id]?.key === inputKey(content, id) && comparisons[id]?.matches)
  const eligible = selected.filter(id => !pending.some(row => row.unitId === id) && checks[id]?.preparation && !checks[id].submitted && applicable(id))
  const preflight = async () => {
    setBusy(true); setError('')
    const results = await Promise.all(selected.filter(id => !pending.some(row => row.unitId === id)).map(async unitId => {
      const key = inputKey(content, unitId)
      try {
        if (key !== inputKey(version.content, unitId)) throw new Error('本单元或共同依据有未保存修改，请先保存再预检')
        const target = { projectId, sequenceId, versionId: version.id, unitId }
        const videos = await StudioDirectingService.directingSceneVideos(target)
        if (!videos.data) throw new Error('视频任务状态尚未核实')
        if (videos.data.some(row => !['succeeded', 'failed', 'cancelled'].includes(row.status))) throw new Error('本单元已有视频任务，请等待结束后重新预检')
        const response = await StudioDirectingService.directingSceneVideoPrepare({ ...target, requestBody: { expected_revision: version.revision } })
        if (!response.data) throw new Error('预检结果尚未核实')
        return [unitId, { key, preparation: response.data }] as const
      } catch (cause) { return [unitId, { key, error: directingError(cause) }] as const }
    }))
    if (mounted.current) { setChecks(previous => ({ ...previous, ...Object.fromEntries(results) })); setBusy(false) }
  }
  return <>
    <Button disabled={disabled} onClick={() => setOpen(true)}>批量拍摄</Button>
    <Modal title="批量预检与拍摄" open={open} onCancel={() => setOpen(false)} footer={null} width={720}>
      <p>选择单元的当前指令及已确认检查，先逐项预检，再明确提交。预检不自动保存或拍摄。</p>
      {error && <Alert type="error" message={error} />}
      {storageError && <Alert type="error" message={storageError} />}
      {reading && <p role="status">正在读取各单元视频记录</p>}
      {content.units.map((unit, index) => {
        const checked = checks[unit.id]
        const changed = checked && !applicable(unit.id)
        const request = pending.find(row => row.unitId === unit.id)
        return <section key={unit.id} aria-label={`批量单元 ${index + 1}`}>
          <Checkbox aria-label={`选择单元 ${index + 1}`} checked={selected.includes(unit.id)} disabled={busy || disabled}
            onChange={event => setSelected(previous => event.target.checked ? [...previous, unit.id] : previous.filter(id => id !== unit.id))}>单元 {index + 1}</Checkbox>
          <p>检查：{unit.instruction_check_task_id || '尚未确认'} · {unit.instruction || '尚无指令'}</p>
          {comparisons[unit.id]?.pending && <p>正在核对预检适用性</p>}
          {comparisons[unit.id]?.error && <Alert type="error" message="预检适用性读取失败" description={comparisons[unit.id].error}
            action={<Button onClick={() => setCompareAttempt(value => value + 1)}>重试适用性核对</Button>} />}
          {readErrors[unit.id] && <Alert type="error" message={`单元 ${index + 1} 任务记录读取失败`} description={readErrors[unit.id]}
            action={<Button disabled={reading} onClick={() => setReadAttempt(value => value + 1)}>重读批量任务</Button>} />}
          {request && <Alert type="warning" message={`单元 ${index + 1}：${request.submitting ? '正在核实视频请求' : '视频提交待核实'}`} description={request.error}
            action={<Button disabled={disabled || request.submitting} onClick={() => onVerify(unit.id)}>核实单元 {index + 1} 原视频请求</Button>} />}
          <p>{checked?.submitted ? '已交给逐项提交，请查看视频通知或核实原请求' : changed ? '输入已变化，请保存并重新预检' : checked?.error || (checked?.preparation ? '预检通过' : '尚未预检')}</p>
          {open && tasks.filter(target => target.unitId === unit.id).map(target => <SceneVideoBatchTask key={target.taskId} target={target} disabled={disabled} />)}
          <Button onClick={async () => { try { await onLocate(unit.id); setOpen(false) } catch (cause) { setError(directingError(cause)) } }}>定位单元 {index + 1}</Button>
        </section>
      })}
      <p>可提交 {eligible.length} 项 · 受阻 {selected.filter(id => checks[id] && !checks[id].submitted && !eligible.includes(id)).length} 项</p>
      <Space>
        <Button disabled={disabled || busy || !selected.length} loading={busy} onClick={() => void preflight()}>预检所选 {selected.length} 项</Button>
        <Button type="primary" disabled={disabled || busy || !eligible.length} onClick={() => {
          const submitted = eligible.filter(id => onSubmit(checks[id].preparation!))
          setChecks(previous => Object.fromEntries(Object.entries(previous).map(([id, value]) => [id, submitted.includes(id) ? { ...value, submitted: true } : value])))
        }}>提交可执行 {eligible.length} 项</Button>
      </Space>
    </Modal>
  </>
}
