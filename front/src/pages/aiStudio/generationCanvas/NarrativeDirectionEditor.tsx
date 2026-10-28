import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { NarrativeOverviewCard, NarrativeBeatCard, NarrativeEventCard, ShotDesignCard, DesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { MediaPreview } from './MediaContentEditor'
import { FieldEditor } from './PerformanceDirectionEditor'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { inputPorts, portLabels } from './graphRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

export type NarrativeCard = NarrativeOverviewCard | NarrativeBeatCard | NarrativeEventCard | ShotDesignCard

/** 四种叙事卡保留自己的字段；关系只选择直接候选身份。 */
export function NarrativeDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const card = raw as NarrativeCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const field = (key: string, label: string) => <FieldEditor key={key} label={label} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />
  const identity = 'beat_id' in card ? card.beat_id : 'event_id' in card ? card.event_id : 'shot_id' in card ? card.shot_id : undefined
  return <>
    <p>完整采用本卡叙事设计。关联仅保留身份与名称；全文和媒体需在模型端分别直接采用。预计时长是设计信息，关系不代表实际覆盖或自动执行，生成不自动确认设计。</p>
    <Input aria-label="叙事名称" value={card.name} onChange={event => onChange({ ...card, name: event.target.value })} />
    {identity && <small>稳定身份：{identity}</small>}
    {card.type === 'direction.narrative' && <>{field('viewpoint', '观察视点')}{field('information_change', '信息变化')}{field('relationship_change', '人物关系变化')}{field('turning_point', '关键转折')}{field('open_questions', '待确定问题')}</>}
    {card.type === 'direction.beat' && <>{field('objective', '行动目标')}{field('obstacle', '阻碍')}{field('expected_change', '预期变化')}{field('audience_must_see', '必须让观众看到')}</>}
    {card.type === 'direction.event' && field('action_change', '动作或变化说明')}
    {card.type === 'direction.shot' && <>{field('narrative_role', '叙事作用')}{field('visible_result', '可见结果')}{field('estimated_duration', '预计时长')}</>}
    {resolved.error && <Alert type="warning" message={resolved.error} />}
    <section aria-label="叙事关系"><h3>直接关系候选与已采用</h3>
      {resolved.candidates.map(item => {
        const payload = item.payload
        if (!payload || !['object_reference', 'spatial_reference', 'narrative_reference'].includes(payload.kind || '') || !('name' in payload)) return null
        return <div key={sourceKey(item.source)}><span>{payload.name} · {'category' in payload ? payload.category : ''}</span>{inputPorts(card).filter(port => document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)).map(port => {
          if (port === 'participant' && (payload.kind !== 'object_reference' || payload.category === 'place')) return null
          const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
          return <WorkbenchButton key={port} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{`${binding ? '取消' : '选择'}${portLabels[port]} ${payload.name}`}</WorkbenchButton>
        })}</div>
      })}
      {bindings.filter(binding => !resolved.candidates.some(item => item.available && sourceKey(item.source) === sourceKey(binding.source))).map(binding => <div key={binding.id}><small role="alert">已选关系失效</small><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}
    </section>
    {card.type === 'direction.shot' && <details><summary>参考画面与预演示例</summary><p>示例不代表实际覆盖；媒体不会随叙事设计传给模型。</p>
      {resolved.candidates.filter(item => ['image', 'video'].includes(item.modality) && item.file_id).map(item => <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available} onClick={() => onChange({ ...card, examples: [...(card.examples || []), { id: crypto.randomUUID(), source: item.source, file_id: item.file_id!, purpose: 'positive' }] })}>关联素材 {item.token}</WorkbenchButton>)}
      {(card.examples || []).map(example => {
        const change = (patch: Partial<typeof example>) => onChange({ ...card, examples: card.examples?.map(value => value.id === example.id ? { ...value, ...patch } : value) })
        return <section key={example.id}><MediaPreview fileId={example.file_id} type={example.source.port_id === 'video' ? 'video' : 'image'} /><Select aria-label="素材用途" value={example.purpose} options={[{ value: 'positive', label: '正向示例' }, { value: 'negative', label: '反例' }]} onChange={purpose => change({ purpose })} /><Input aria-label="素材说明" value={example.description} onChange={event => change({ description: event.target.value })} />
          {example.source.port_id === 'video' && <Space wrap><InputNumber aria-label="素材起点毫秒" min={0} value={example.start_ms} onChange={start => change(start === null ? { start_ms: null, end_ms: null } : { start_ms: start, end_ms: Math.max(example.end_ms || 0, start + 1) })} /><InputNumber aria-label="素材终点毫秒" min={(example.start_ms || 0) + 1} value={example.end_ms} onChange={end => change(end === null ? { start_ms: null, end_ms: null } : { start_ms: example.start_ms || 0, end_ms: end })} /></Space>}
          <WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, examples: card.examples?.filter(value => value.id !== example.id) })}>取消素材</WorkbenchButton></section>
      })}</details>}
    <details><summary>适用范围与来源</summary><Input aria-label="适用范围" value={card.scope?.description} onChange={event => onChange({ ...card, scope: { ...card.scope, description: event.target.value } })} /><Select aria-label="制作阶段" allowClear value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => onChange({ ...card, scope: { ...card.scope, phase: phase ?? null } })} /><Input aria-label="适用条件" value={card.scope?.condition} onChange={event => onChange({ ...card, scope: { ...card.scope, condition: event.target.value } })} /><Input aria-label="设计来源" value={card.source_locator} onChange={event => onChange({ ...card, source_locator: event.target.value })} /></details>
    <section aria-label="完整叙事设计输出"><h3>已保存完整设计 · revision {resolved.revision}</h3>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整叙事设计" />)}</section>
  </>
}

export function narrativeSummary(card: NarrativeCard) {
  const value = card.type === 'direction.narrative' ? (card as NarrativeOverviewCard).information_change : card.type === 'direction.beat' ? (card as NarrativeBeatCard).expected_change : card.type === 'direction.event' ? (card as NarrativeEventCard).action_change : (card as ShotDesignCard).visible_result
  return `${card.name || '未命名设计'} · ${value?.text || '内容待定'} · ${value?.state === 'fact' ? '事实' : value?.state === 'undecided' ? '待确定' : '设计'}`
}
