import { SourceLinks } from './Sources'
import { Button, Card, Input, InputNumber, Select, Space, Typography } from 'antd'
import type { Note_Input, ObservedRange, WorkspaceRead } from '../../../services/generated'
import { humanNote } from './common'

/** 保留未知/明确无/不适用，人工编辑同时记录本次判断来源。 */
export function FeedbackNote({ label, value, onChange }: { label: string; value: Note_Input; onChange: (value: Note_Input) => void }) {
  return <Space direction="vertical" className="w-full"><Typography.Text>{label}</Typography.Text>
    <Select aria-label={`${label}状态`} className="w-full" value={value.state || 'unset'} options={[
      { value: 'unset', label: '未填写' }, { value: 'unknown', label: '待观察' }, { value: 'proposal', label: '人工判断 / 假设' },
      { value: 'fact', label: '已观察事实' }, { value: 'none', label: '明确没有' }, { value: 'not_applicable', label: '不适用' },
    ]} onChange={state => onChange(state === 'fact' || state === 'proposal' ? { ...humanNote(value.text || ''), state } : { state, reason: value.reason || '' })} />
    <Input.TextArea aria-label={label} value={value.text || value.reason || ''} onChange={event => onChange(value.state === 'none' || value.state === 'not_applicable'
      ? { state: value.state, reason: event.target.value } : { ...humanNote(event.target.value), ...(value.state === 'fact' ? { state: 'fact' as const } : {}) })} />
    {!!value.sources?.length && <SourceLinks sources={value.sources} />}
  </Space>
}

/** 所有区间编辑复用真实毫秒语义，不默默采用计划时长。 */
export function RangeFields({ label, value, onChange }: { label: string; value: ObservedRange['media_range']; onChange: (value: ObservedRange['media_range']) => void }) {
  return <Space wrap><span>{label}（秒）</span><InputNumber aria-label={`${label}入点`} min={0} step={0.1} value={value.source_in_ms / 1000} onChange={number => onChange({ ...value, source_in_ms: Math.round((number || 0) * 1000) })} />
    <span>至</span><InputNumber aria-label={`${label}出点`} min={0} step={0.1} value={value.source_out_ms / 1000} onChange={number => onChange({ ...value, source_out_ms: Math.round((number || 0) * 1000) })} /></Space>
}

/** 可增删有来源的好区间和问题证据，不另存复制的视频。 */
export function ObservedRanges({ label, value, workspace, onChange }: { label: string; value: ObservedRange[]; workspace: WorkspaceRead; onChange: (value: ObservedRange[]) => void }) {
  return <Card size="small" title={label}>{value.map((row, index) => <Space key={index} direction="vertical" className="w-full">
    <Select aria-label={`${label}素材 ${index + 1}`} className="w-full" value={row.take_id} options={workspace.takes.map((take, i) => ({ value: take.id, label: `Take ${i + 1} · ${take.unit_id}` }))} onChange={id => onChange(value.map((item, i) => i === index ? { ...item, take_id: id } : item))} />
    <RangeFields label={`${label} ${index + 1}`} value={row.media_range} onChange={range => onChange(value.map((item, i) => i === index ? { ...item, media_range: range } : item))} />
    <Button danger onClick={() => onChange(value.filter((_, i) => i !== index))}>移除此区间</Button>
  </Space>)}<Button disabled={!workspace.takes.length} onClick={() => onChange([...value, { take_id: workspace.takes[0].id, media_range: { source_in_ms: 0, source_out_ms: 1000 } }])}>添加{label}</Button></Card>
}
