import { designSummary } from './designSummary'
import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { DialogueCard, SoundArrangementCard, ObjectReferencePayload } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignFieldEditor as FieldEditor } from './DesignFieldEditor'
import { useCardCandidates } from './useCardCandidates'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { MediaPreview } from './MediaContentEditor'

export type SoundCard = DialogueCard | SoundArrangementCard

/** 声音设计的对象、制作安排与固定素材分别编辑；不会把示例当作模型输入。 */
export function SoundDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const { cardDefinitions } = useGraphRules()
  const card = raw as SoundCard
  const sound = raw as SoundArrangementCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || [], examples = card.examples || []
  const update = (next: SoundCard) => onChange(next)
  const relation = card.type === 'direction.dialogue' ? 'speaker' : 'effect_object'
  const label = relation === 'speaker' ? '说话对象' : '声源对象'
  const exampleUpdate = (id: string, patch: Partial<(typeof examples)[number]>) => update({ ...card, examples: examples.map(item => item.id === id ? { ...item, ...patch } : item) })
  return <>
    <p>完整采用设计；声音文本不等于音频。图片仅表达可见声源或说话状态。同期意图按模型能力执行，待后期安排保留为待后期。</p>
    {resolved.error && <Alert type="warning" message={resolved.error} />}
    {card.type === 'direction.dialogue' ? <section aria-label="对白条目"><p>对白身份：{card.dialogue_id}</p>
      <strong>对白版本</strong><InputNumber aria-label="对白版本" min={1} value={card.version || 1} onChange={version => update({ ...card, version: version || 1 })} />
      <FieldEditor label="对白正文" value={card.content} onChange={content => update({ ...card, content })} />
    </section> : <section aria-label="声音条目">
      <FieldEditor label="声源说明" value={sound.source_description} onChange={source_description => update({ ...sound, source_description })} />
      <FieldEditor label="环境声" value={sound.environment} onChange={environment => update({ ...sound, environment })} />
      <FieldEditor label="动作声" value={sound.action_sound} onChange={action_sound => update({ ...sound, action_sound })} />
      <FieldEditor label="音乐约束" purpose="constraint" value={sound.music} onChange={music => update({ ...sound, music })} />
      <strong>制作安排</strong><Select aria-label="声音制作安排" value={sound.production || 'undecided'} options={[{ value: 'synchronous', label: '同期生成意图' }, { value: 'postproduction', label: '待后期' }, { value: 'undecided', label: '待确定' }]} onChange={production => update({ ...sound, production })} />
    </section>}
    <section aria-label={label}><h3>{label}</h3>
      {resolved.candidates.filter(item => item.payload?.kind === 'object_reference').map(item => {
        const object = item.payload as ObjectReferencePayload
        if (relation === 'speaker' && !['character', 'prop'].includes(object.category)) return null
        if (!document.edges?.some(edge => edge.target_card === card.id && edge.target_port === relation && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)) return null
        const binding = bindings.find(value => value.input_port === relation && sourceKey(value.source) === sourceKey(item.source))
        return <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available || !binding && relation === 'speaker' && bindings.some(value => value.input_port === relation)} onClick={() => update({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), source: item.source, input_port: relation }] })}>{`${binding ? '取消' : '选择'}${label} ${object.name}`}</WorkbenchButton>
      })}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><small role="alert">已采用对象缺失</small><WorkbenchButton disabled={disabled} onClick={() => update({ ...card, input_bindings: bindings.filter(item => item.id !== binding.id) })}>取消失效对象关系</WorkbenchButton></div>)}
    </section>
    <details><summary>适用范围、阶段与来源</summary>
      <Input aria-label="适用范围" value={card.scope?.description} onChange={event => update({ ...card, scope: { ...card.scope, description: event.target.value } })} />
      <Input aria-label="适用条件" value={card.scope?.condition} onChange={event => update({ ...card, scope: { ...card.scope, condition: event.target.value } })} />
      <Select aria-label="制作阶段" allowClear value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => update({ ...card, scope: { ...card.scope, phase: phase ?? null } })} />
      <Input aria-label="设计来源" value={card.source_locator} onChange={event => update({ ...card, source_locator: event.target.value })} />
    </details>
    <details><summary>直接素材参考</summary><p>参考仅在当前卡播放。模型需要媒体时须另行直接采用；不传递上游内容、不替换音轨、不转写。</p>
      {resolved.candidates.filter(item => item.file_id && (item.modality === 'audio' || card.type === 'direction.dialogue' && item.modality === 'video')).map(item => <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available} onClick={() => update({ ...card, examples: [...examples, { id: crypto.randomUUID(), source: item.source, file_id: item.file_id!, purpose: 'positive' }] })}>关联参考 {item.token}</WorkbenchButton>)}
      {examples.map(example => <section key={example.id} aria-label={`参考 ${example.id}`}><MediaPreview fileId={example.file_id} type={example.source.port_id === 'audio' ? 'audio' : 'video'} />
        <Select aria-label="参考用途" value={example.purpose} options={[{ value: 'positive', label: '正向参考' }, { value: 'negative', label: '反例' }]} onChange={purpose => exampleUpdate(example.id, { purpose })} />
        <Select aria-label="参考定位字段" placeholder="选择定位字段" style={{width:180,maxWidth:'100%'}} disabled={disabled} allowClear value={example.field_id || undefined} options={cardDefinitions[card.type!].fields.map(field=>({value:field.id,label:field.label}))} onChange={field_id=>exampleUpdate(example.id,{field_id:field_id??null})}/>
        <Input aria-label="参考说明" value={example.description} onChange={event => exampleUpdate(example.id, { description: event.target.value })} />
        <Space wrap><InputNumber aria-label="参考起点毫秒" min={0} value={example.start_ms} onChange={start => exampleUpdate(example.id, start === null ? { start_ms: null, end_ms: null } : { start_ms: start, end_ms: Math.max(example.end_ms || 0, start + 1) })} />
          <InputNumber aria-label="参考终点毫秒" min={(example.start_ms || 0) + 1} value={example.end_ms} onChange={end => exampleUpdate(example.id, end === null ? { start_ms: null, end_ms: null } : { start_ms: example.start_ms || 0, end_ms: end })} /></Space>
        <WorkbenchButton disabled={disabled} onClick={() => update({ ...card, examples: examples.filter(value => value.id !== example.id) })}>取消参考</WorkbenchButton>
      </section>)}
    </details>
    <section aria-label="完整设计输出"><h3>已保存完整设计 · revision {resolved.revision}</h3>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整设计" />)}</section>
  </>
}

export function soundSummary(card: SoundCard) {
  if (card.type === 'direction.dialogue') return `${designSummary([card.content], Object.values(card)) || '未填写对白'} · 版本 ${card.version || 1}`
  const sound = card as SoundArrangementCard
  return `${designSummary([sound.source_description, sound.environment], Object.values(card)) || '未填写声音安排'} · ${{ synchronous: '同期生成意图', postproduction: '待后期', undecided: '待确定' }[sound.production || 'undecided']}`
}
