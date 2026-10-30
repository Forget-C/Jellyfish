import { designSummary } from './designSummary'
import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { SpaceRuleCard, ContinuityCard, ImmutableFactCard, ConstraintMediaExample, DesignField, CanvasResolvedOutput } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignFieldEditor } from './DesignFieldEditor'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { MediaPreview } from './MediaContentEditor'

export type ConstraintCard = SpaceRuleCard | ContinuityCard | ImmutableFactCard
const categoryOptions = [{ value: 'space', label: '空间' }, { value: 'appearance', label: '造型' }, { value: 'hands_props', label: '手部与道具' }, { value: 'environment', label: '环境' }, { value: 'photography', label: '摄影' }, { value: 'dialogue_sound', label: '对白与声音' }]
const labels = { spatial_basis: '空间依据', shootable_area: '可拍区域', axis: '轴线', scale: '空间尺度', before: '前态', change: '变化', after: '后态', following_constraints: '后续约束', fact: '不可改事实', source_basis: '来源依据' }

function eligible(port: string, item: CanvasResolvedOutput) {
  const payload = item.payload
  if (!payload) return false
  if (payload.kind === 'object_reference' && 'category' in payload) return port === 'effect_object' || port === 'space' && payload.category === 'place' || port === 'participant' && payload.category !== 'place'
  return port === 'effect_object' && ['narrative_reference', 'spatial_reference'].includes(payload.kind || '') || payload.kind === 'narrative_reference' && 'category' in payload && port === 'related_event' && payload.category === 'event'
}

/** 约束卡分别编辑本卡设计、直接身份及固定证据；没有跨级正文或媒体采用。 */
export function ConstraintDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const { inputPorts, portLabels } = useGraphRules()
  const card = raw as ConstraintCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || [], examples = card.examples || []
  const keys = (card.type === 'direction.space_rule' ? ['spatial_basis', 'shootable_area', 'axis', 'scale'] : card.type === 'direction.continuity' ? ['before', 'change', 'after', 'following_constraints'] : ['fact', 'source_basis']) as (keyof typeof labels)[]
  const updateExample = (id: string, patch: Partial<ConstraintMediaExample>) => onChange({ ...card, examples: examples.map(value => value.id === id ? { ...value, ...patch } : value) })
  return <>

    {card.type === 'direction.continuity' && <Select aria-label="连续性分类" value={card.category || 'space'} options={categoryOptions} onChange={category => onChange({ ...card, category })} />}
    {keys.map(key => <DesignFieldEditor key={key} label={labels[key]} purpose={['spatial_basis', 'source_basis'].includes(key) ? 'background' : ['before', 'change', 'after'].includes(key) ? 'design' : 'constraint'} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />)}
    {resolved.error && <Alert type="warning" message={resolved.error} />}
    <section aria-label="约束关系"><h3>直接关系候选与已采用</h3>{resolved.candidates.map(item => {
      const payload = item.payload
      if (!payload || !('name' in payload)) return null
      return <div key={sourceKey(item.source)}><span>{payload.name}</span>{inputPorts(card).filter(port => eligible(port, item) && document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)).map(port => {
        const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
        return <WorkbenchButton key={port} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{`${binding ? '取消' : '选择'}${portLabels[port]} ${payload.name}`}</WorkbenchButton>
      })}</div>
    })}{bindings.filter(binding => !resolved.candidates.some(item => item.available && sourceKey(item.source) === sourceKey(binding.source))).map(binding => <div key={binding.id}><span role="alert">已选关系失效</span><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}</section>
    <details><summary>固定证据与前后态素材</summary>
      {resolved.candidates.filter(item => item.file_id && inputPorts(card).includes(item.modality + '_example')).map(item => <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available} onClick={() => onChange({ ...card, examples: [...examples, { id: crypto.randomUUID(), source: item.source, file_id: item.file_id!, purpose: 'evidence' }] })}>关联证据 {item.token}</WorkbenchButton>)}
      {examples.map(example => <section key={example.id} aria-label="固定证据"><MediaPreview fileId={example.file_id} type={example.source.port_id === 'video' ? 'video' : example.source.port_id === 'audio' ? 'audio' : 'image'} /><Select aria-label="证据用途" value={example.purpose} options={[{ value: 'evidence', label: '来源证据' }, { value: 'positive', label: '正向示例' }, { value: 'negative', label: '反例' }, ...(card.type === 'direction.continuity' ? [{ value: 'before', label: '前态' }, { value: 'after', label: '后态' }] : [])]} onChange={purpose => updateExample(example.id, { purpose, ...(['before', 'after'].includes(purpose) ? { field_id: purpose as 'before' | 'after' } : {}) })} />
      <Select aria-label="证据定位字段" allowClear value={example.field_id || undefined} options={keys.map(key => ({ value: key, label: labels[key] }))} onChange={field_id => updateExample(example.id, { field_id: field_id ?? null })} /><Input aria-label="证据说明" value={example.description} onChange={event => updateExample(example.id, { description: event.target.value })} />
      {['video', 'audio'].includes(example.source.port_id) && <Space><InputNumber aria-label="证据起点毫秒" min={0} value={example.start_ms} onChange={start => updateExample(example.id, start === null ? { start_ms: null, end_ms: null } : { start_ms: start, end_ms: Math.max(example.end_ms || 0, start + 1) })} /><InputNumber aria-label="证据终点毫秒" min={(example.start_ms || 0) + 1} value={example.end_ms} onChange={end => updateExample(example.id, end === null ? { start_ms: null, end_ms: null } : { start_ms: example.start_ms || 0, end_ms: end })} /></Space>}
      <WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, examples: examples.filter(value => value.id !== example.id) })}>取消证据</WorkbenchButton></section>)}
    </details>
    <details><summary>适用范围与来源</summary><Input aria-label="适用范围" value={card.scope?.description} onChange={event => onChange({ ...card, scope: { ...card.scope, description: event.target.value } })} /><Select aria-label="制作阶段" allowClear value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => onChange({ ...card, scope: { ...card.scope, phase: phase ?? null } })} /><Input aria-label="适用条件" value={card.scope?.condition} onChange={event => onChange({ ...card, scope: { ...card.scope, condition: event.target.value } })} /><Input aria-label="设计来源" value={card.source_locator} onChange={event => onChange({ ...card, source_locator: event.target.value })} /></details>
    <section aria-label="完整约束输出"><h3>已保存完整设计 · revision {resolved.revision}</h3>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整约束设计" />)}</section>
  </>
}

export function constraintSummary(card: ConstraintCard) {
  const preferred = card.type === 'direction.space_rule' ? [card.shootable_area] : card.type === 'direction.continuity' ? [card.before, card.after] : [(card as ImmutableFactCard).fact]
  return designSummary(preferred, Object.values(card)) || (card.type === 'direction.space_rule' ? '可拍区域待定' : card.type === 'direction.continuity' ? '前态待定 → 后态待定' : '事实待填写')
}
