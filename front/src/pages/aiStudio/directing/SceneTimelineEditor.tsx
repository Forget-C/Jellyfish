import { WorkbenchModal as Modal } from './ui/WorkbenchModal'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, InputNumber, Select, Space } from 'antd'
import type { SceneTakeLibraryRead, SceneTimeline_Output, SceneVersionContent_Output } from '../../../services/generated'
import { SceneTimelinePreview } from './SceneTimelinePreview'
import { invalidTakeRange } from './sceneTakeIssues'

type Item = SceneTimeline_Output['items'][number]
type TimelineEditing = {
  editing?: Item; replacement?: SceneTakeLibraryRead; mode: 'media' | 'planned'; shotId?: string
  estimate: number | null; start: number | null; end: number | null; position: number | null
  error: string; selectionKey: string; navigationSerial?: number
}
// 仅保存本页会话的操作表单；切画布不应用，刷新仍以已保存业务内容为准。
const editingSessions = new Map<string, TimelineEditing>()
const duration = (item: Item) => 'media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms
const itemKey = (item: Item | undefined) => JSON.stringify(item, (_, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) : value)

/** 明确采用与片段编辑按独立身份写入；默认保留其他位置和空白。 */
export function SceneTimelineEditor({ take, takes, content, disabled, onChange, onPreviewStart, previewStop, children, navigationSerial, contextKey, selectionKey }: {
  take?: SceneTakeLibraryRead; takes: SceneTakeLibraryRead[]; content: SceneVersionContent_Output; disabled: boolean
  contextKey: string; selectionKey: string; navigationSerial?: number
  children?: ReactNode
  onPreviewStart: () => void; previewStop: number
  onChange: (content: SceneVersionContent_Output) => void
}) {
  const [initial] = useState(() => editingSessions.get(contextKey))
  const previousTarget = useRef({ selectionKey: initial?.selectionKey ?? selectionKey, navigationSerial: initial?.navigationSerial ?? navigationSerial })
  const [packing, setPacking] = useState<{ original: Item[]; packed: Item[] }>()
  const [packingError, setPackingError] = useState('')
  const [editing, setEditing] = useState<Item | undefined>(initial?.editing)
  const [replacement, setReplacement] = useState<SceneTakeLibraryRead | undefined>(initial?.replacement)
  const [mode, setMode] = useState<'media' | 'planned'>(initial?.mode || 'media')
  const [shotId, setShotId] = useState<string | undefined>(initial?.shotId)
  const [estimate, setEstimate] = useState<number | null>(initial?.estimate ?? null)
  const [start, setStart] = useState<number | null>(initial?.start ?? null)
  const [end, setEnd] = useState<number | null>(initial?.end ?? null)
  const [position, setPosition] = useState<number | null>(initial?.position ?? null)
  const [error, setError] = useState(initial?.error || '')
  const items = content.timeline.items
  const original = editing && 'media_range' in editing ? editing : undefined
  const origin = replacement || original
  const source = origin ? takes.find(row => row.take_kind === origin.take_kind && row.take_id === origin.take_id) : take
  const editingInvalid = !!editing && itemKey(items.find(row => row.id === editing.id)) !== itemKey(editing)
  const valid = !editingInvalid && position != null && Number.isInteger(position) && position >= 0 && (mode === 'planned'
    ? content.design.direction.shots.some(row => row.id === shotId) && estimate != null && Number.isInteger(estimate) && estimate > 0
    : !!source?.available && start != null && end != null && !invalidTakeRange({ source_in_ms: start, source_out_ms: end }, source.duration_ms))
  const clear = () => {
    setEditing(undefined); setReplacement(undefined); setMode('media'); setShotId(undefined); setEstimate(null)
    setStart(null); setEnd(null); setPosition(null); setError('')
  }
  useEffect(() => {
    const previous = previousTarget.current
    if (previous.selectionKey === selectionKey && previous.navigationSerial === navigationSerial) return
    previousTarget.current = { selectionKey, navigationSerial }
    clear()
  }, [selectionKey, navigationSerial])
  useEffect(() => {
    editingSessions.set(contextKey, { editing, replacement, mode, shotId, estimate, start, end, position, error, selectionKey, navigationSerial })
  }, [contextKey, editing, replacement, mode, shotId, estimate, start, end, position, error, selectionKey, navigationSerial])
  const apply = () => {
    if (disabled || !valid || position == null) return
    const id = editing?.id || crypto.randomUUID()
    let next: Item
    if (mode === 'planned') {
      if (!shotId || estimate == null) return
      next = { kind: 'planned', id, shot_id: shotId, estimated_duration_ms: estimate, timeline_start_ms: position }
    } else {
      if (!source || start == null || end == null) return
      next = { kind: 'media', id, fit: original?.fit || 'contain', take_kind: source.take_kind, take_id: source.take_id,
        file_id: source.file_id, media_range: { source_in_ms: start, source_out_ms: end }, timeline_start_ms: position }
    }
    const updated = editing ? items.map(row => row.id === editing.id ? next : row) : [...items, next]
    const ordered = [...updated].sort((left, right) => left.timeline_start_ms - right.timeline_start_ms)
    if (ordered.some((row, index) => index > 0 && row.timeline_start_ms < ordered[index - 1].timeline_start_ms + duration(ordered[index - 1]))) {
      setError('片段时间位置重叠，请调整起点或源区间；原时间线保持不变。'); return
    }
    onChange({ ...content, timeline: { items: updated } }); clear()
  }
  let cursor = 0
  return <section className="canvas-workbench-card" aria-label="场次时间线">
    <Select aria-label="场次输出画幅" style={{ width: '100%' }} disabled={disabled} value={content.output_aspect_ratio}
      options={[{ value: '16:9', label: '16:9 横屏' }, { value: '9:16', label: '9:16 竖屏' }, { value: '1:1', label: '1:1 方形' }]}
      onChange={output_aspect_ratio => onChange({ ...content, output_aspect_ratio })} />
    <p>输出画幅用于整场构图；已有单元生成画幅保持原值，新建单元使用当前默认画幅。导出像素尺寸另行选择。</p>
    <SceneTimelinePreview key={JSON.stringify([content.output_aspect_ratio, items, previewStop])}
      outputAspectRatio={content.output_aspect_ratio} items={items} takes={takes} onStart={onPreviewStart} />
    <p>采用须明确选择源区间和时间位置；素材审查与剪辑采用分别表达。</p>
    <Button disabled={disabled || !items.length} onClick={() => {
      let nextStart = 0
      const packed = [...items].sort((left, right) => left.timeline_start_ms - right.timeline_start_ms).map(row => {
        const next = { ...row, timeline_start_ms: nextStart }
        nextStart += duration(row)
        return next
      })
      setPacking({ original: items, packed }); setPackingError('')
    }}>预览紧排整条时间线</Button>
    <Modal title="紧排预览" open={!!packing} onCancel={() => setPacking(undefined)} cancelText="取消"
      okText="确认紧排整条时间线" okButtonProps={{ disabled }} onOk={() => {
        if (disabled || !packing) return
        if (items.length !== packing.original.length || items.some((row, index) => itemKey(row) !== itemKey(packing.original[index]))) {
          setPackingError('时间线已变化，请关闭并重新预览；当前时间线保持不变。'); return
        }
        onChange({ ...content, timeline: { items: packing.packed } }); clear(); setPacking(undefined)
      }}>
      <p>范围：整条主视频轨，从 0 毫秒开始；保留当前顺序、片段身份和源区间。</p>
      {packing?.packed.map((row, index) => <p key={row.id}>片段 {index + 1}：{packing.original.find(item => item.id === row.id)?.timeline_start_ms} → {row.timeline_start_ms} 毫秒</p>)}
      {packingError && <Alert type="error" message={packingError} />}
    </Modal>
    {!items.length && <p>空时间线，尚未采用素材。</p>}
    {[...items].sort((left, right) => left.timeline_start_ms - right.timeline_start_ms).map((row, index) => {
      const gap = row.timeline_start_ms > cursor ? <p>空白 {cursor}–{row.timeline_start_ms} 毫秒</p> : null
      cursor = row.timeline_start_ms + duration(row)
      return <div key={row.id} id={`scene-clip-${row.id}`} role="region" aria-label={`时间线片段 ${index + 1}`} tabIndex={-1}>{gap}<h3>片段 {index + 1} · {'media_range' in row ? '真实媒体' : '待拍占位'}</h3>
        <p>时间位置：{row.timeline_start_ms}–{row.timeline_start_ms + duration(row)} 毫秒</p>
        {'media_range' in row ? <><p>原素材：{row.take_id}</p><p>源区间：{row.media_range.source_in_ms}–{row.media_range.source_out_ms} 毫秒</p></> : <p>镜头：{row.shot_id} · 预计 {row.estimated_duration_ms} 毫秒</p>}
        <Space wrap><Button disabled={disabled} onClick={() => {
          clear(); setEditing(row); setPosition(row.timeline_start_ms)
          if ('media_range' in row) { setStart(row.media_range.source_in_ms); setEnd(row.media_range.source_out_ms) }
          else { setMode('planned'); setShotId(row.shot_id); setEstimate(row.estimated_duration_ms) }
        }}>编辑片段 {index + 1}</Button>
          <Button disabled={disabled || !take?.available} onClick={() => {
            if (!take) return
            clear(); setEditing(row); setReplacement(take); setPosition(row.timeline_start_ms)
          }}>用当前素材替换片段 {index + 1}</Button>
          <Button disabled={disabled} onClick={() => { onChange({ ...content, timeline: { items: items.filter(item => item.id !== row.id) } }); if (editing?.id === row.id) clear() }}>删除片段 {index + 1}</Button></Space>
        {'media_range' in row && <>
          <Select aria-label={`片段 ${index + 1} 构图`} style={{ width: '100%' }} disabled={disabled} value={row.fit}
            options={[{ value: 'contain', label: '完整显示' }, { value: 'cover', label: '居中填满' }]}
            onChange={fit => onChange({ ...content, timeline: { items: items.map(item => item.id === row.id ? { ...row, fit } : item) } })} />
          <p>{row.fit === 'cover' ? '等比例铺满输出画幅，居中裁切边缘。' : '等比例保留完整画面，剩余区域显示黑边。'}</p>
        </>}
        <details><summary>查看片段身份 {index + 1}</summary><p>{row.id}</p></details>
      </div>
    })}
    <Space wrap><Button disabled={disabled} onClick={clear}>准备新采用</Button>
      <Button disabled={disabled} onClick={() => { clear(); setMode('planned') }}>准备待拍占位</Button></Space>
    <h3>{replacement ? '替换原片段' : editing ? '修改原片段' : mode === 'planned' ? '新增待拍占位' : '明确采用当前素材'}</h3>
    {editingInvalid && <Alert type="warning" message="原片段已变化或失效，请重新选择；当前时间线保持不变。" />}
    {mode === 'planned' ? <>
      <Select aria-label="占位所属镜头" style={{ width: '100%' }} placeholder="明确选择当前镜头" disabled={disabled} value={shotId}
        options={content.design.direction.shots.map((shot, index) => ({ value: shot.id, label: `镜头 ${index + 1}：${shot.visible_result.text || '动作待填写'}` }))}
        onChange={value => { setShotId(value); setError('') }} />
      <InputNumber aria-label="占位预计时长毫秒" placeholder="预计时长（毫秒）" disabled={disabled} value={estimate} onChange={value => { setEstimate(value); setError('') }} />
      <p>占位不包含真实源区间；替换素材时须重新明确选择。</p>
    </> : <>
      <p>{source ? `原文件：${source.file_id} · 实测 ${source.duration_ms ?? '待核实'} 毫秒` : '先在素材库明确选择素材，或选择已有媒体片段。'}</p>
      {replacement && <p>替换素材已固定为点击时的选择；请选择有效源区间，后续片段位置保持不变。</p>}
      <Space wrap>
        <InputNumber aria-label="片段源入点毫秒" placeholder="源入点（毫秒）" disabled={disabled} value={start} onChange={value => { setStart(value); setError('') }} />
        <InputNumber aria-label="片段源出点毫秒" placeholder="源出点（毫秒）" disabled={disabled} value={end} onChange={value => { setEnd(value); setError('') }} />
      </Space>
    </>}
    <InputNumber aria-label="片段时间线起点毫秒" placeholder="时间线起点（毫秒）" disabled={disabled} value={position} onChange={value => { setPosition(value); setError('') }} />
    {!valid && (start != null || end != null || position != null || estimate != null) && <p>{mode === 'planned' ? '请选择当前镜头、正整数预计时长和非负整数时间位置。' : '请填写实测范围内的整数源区间和非负整数时间位置。'}</p>}
    {error && <Alert type="error" message={error} />}
    <Button disabled={disabled || !valid} onClick={apply}>{replacement ? '应用替换' : editing ? '保存片段修改' : mode === 'planned' ? '添加待拍占位' : '采用当前素材'}</Button>
    <p>采用及片段修改纳入工作台保存、撤销；裁短和删除不会移动其他片段。</p>
    {children}
  </section>
}
