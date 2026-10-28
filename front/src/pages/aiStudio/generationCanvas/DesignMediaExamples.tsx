import { Input, InputNumber, Select, Space } from 'antd'
import type { CanvasResolvedOutput, DesignMediaExample } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { MediaPreview } from './MediaContentEditor'
import { sourceKey } from './promptRules'

/** 示例是固定文件关联，按卡片声明接收模态，音视频区间沿用同一契约，不自动提交给模型。 */
type MediaExample<FieldId extends string> = Omit<DesignMediaExample, 'field_id'> & { field_id?: FieldId | null }

export function DesignMediaExamples<FieldId extends string>({ examples, candidates, disabled, onChange, fieldOptions, ports }: { ports: string[]; fieldOptions?: {value:FieldId;label:string}[]; examples: MediaExample<FieldId>[]; candidates: CanvasResolvedOutput[]; disabled?: boolean; onChange: (examples: MediaExample<FieldId>[]) => void }) {
  const update = (id: string, patch: Partial<MediaExample<FieldId>>) => onChange(examples.map(item => item.id === id ? { ...item, ...patch } : item))
  return <details><summary>正向示例与反例</summary><p>示例不随设计文本传给模型；需要时请在模型端直接采用。</p>
    {candidates.filter(item => ports.includes(item.modality + '_example') && item.file_id).map(item => <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || item.available === false} onClick={() => onChange([...examples, { id: crypto.randomUUID(), source: item.source, file_id: item.file_id!, purpose: 'positive' }])}>关联示例 {item.token}</WorkbenchButton>)}
    {examples.map(example => <section key={example.id} aria-label={`示例 ${example.id}`}><MediaPreview fileId={example.file_id} type={example.source.port_id === 'audio' ? 'audio' : example.source.port_id === 'video' ? 'video' : 'image'} />
      <Select aria-label="示例用途" disabled={disabled} value={example.purpose} options={[{ value: 'positive', label: '正向示例' }, { value: 'negative', label: '反例' }]} onChange={purpose => update(example.id, { purpose })} />
      {fieldOptions && <Select aria-label="示例定位字段" placeholder="选择定位字段" style={{ width: 180, maxWidth: '100%' }} disabled={disabled} allowClear value={example.field_id || undefined} options={fieldOptions} onChange={field_id => update(example.id, {field_id:field_id ?? null})} />}
      <Input aria-label="示例说明" disabled={disabled} value={example.description} onChange={event => update(example.id, { description: event.target.value })} />
      {['video', 'audio'].includes(example.source.port_id) && <Space><InputNumber aria-label="示例起点毫秒" disabled={disabled} min={0} value={example.start_ms} onChange={start => update(example.id, start === null ? { start_ms: null, end_ms: null } : { start_ms: start, end_ms: Math.max(example.end_ms || 0, start + 1) })} />
        <InputNumber aria-label="示例终点毫秒" disabled={disabled} min={(example.start_ms || 0) + 1} value={example.end_ms} onChange={end => update(example.id, end === null ? { start_ms: null, end_ms: null } : { start_ms: example.start_ms || 0, end_ms: end })} /></Space>}
      <WorkbenchButton disabled={disabled} onClick={() => onChange(examples.filter(value => value.id !== example.id))}>取消示例</WorkbenchButton>
    </section>)}
  </details>
}
