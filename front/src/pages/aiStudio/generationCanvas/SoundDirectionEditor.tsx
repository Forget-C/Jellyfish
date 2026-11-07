import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopePopover } from './DesignScopePopover'
import { soundConstraintPresets } from './soundConstraintPresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { DialogueCard, SoundArrangementCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'
import { useCardCandidates } from './useCardCandidates'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { MediaPreview } from './MediaContentEditor'

export type SoundCard = DialogueCard | SoundArrangementCard

/** 声音设计的对象、制作安排与固定素材分别编辑；示例关联本身不形成模型输入。 */
export function SoundDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions } = useGraphRules()
  const card = raw as SoundCard
  const sound = raw as SoundArrangementCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const examples = card.examples || []
  const update = (next: SoundCard) => onChange(next)
  const exampleUpdate = (id: string, patch: Partial<(typeof examples)[number]>) => update({ ...card, examples: examples.map(item => item.id === id ? { ...item, ...patch } : item) })
  const fields = Object.fromEntries(designFieldEntries(card))
  const relations = card.type === 'direction.sound' && <label>制作安排 <Select size="small" aria-label="声音制作安排" value={sound.production || 'undecided'} options={[{ value: 'synchronous', label: '同期生成意图' }, { value: 'postproduction', label: '待后期' }, { value: 'undecided', label: '待确定' }]} onChange={production => update({ ...sound, production })} /></label>
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} disabled={disabled} onChange={onChange} editorOpen={editorOpen} />} fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={soundConstraintPresets(card)} direct={card.type === 'direction.dialogue'} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} relations={relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as typeof card)}>

    {resolved.error && <Alert type="warning" message={resolved.error} />}
    {card.type === 'direction.dialogue' ? <section aria-label="对白条目">
      <strong>对白版本</strong><InputNumber aria-label="对白版本" min={1} value={card.version || 1} onChange={version => update({ ...card, version: version || 1 })} />
      <FieldEditor compact label="对白正文" value={card.content} onChange={content => update({ ...card, content })} />
    </section> : <section aria-label="声音条目" className="design-preset-fields design-preset-fields-compact">
      <FieldEditor compact label="声源说明" value={sound.source_description} onChange={source_description => update({ ...sound, source_description })} />
      <FieldEditor compact label="环境声" value={sound.environment} onChange={environment => update({ ...sound, environment })} />
      <FieldEditor compact label="动作声" value={sound.action_sound} onChange={action_sound => update({ ...sound, action_sound })} />
      <FieldEditor compact label="音乐约束" purpose="constraint" value={sound.music} onChange={music => update({ ...sound, music })} />

    </section>}

    <details><summary>直接素材参考</summary>
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
  </DesignPresetEditor>
}
