import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopeEditor } from './DesignScopeEditor'
import { narrativePresets } from './narrativePresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert, Input } from 'antd'
import type { NarrativeOverviewCard, NarrativeBeatCard, NarrativeEventCard, ShotDesignCard, ReferenceDesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignMediaExamples } from './DesignMediaExamples'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

export type NarrativeCard = NarrativeOverviewCard | NarrativeBeatCard | NarrativeEventCard | ShotDesignCard

/** 四种叙事卡保留自己的字段；关系只选择直接候选身份。 */
export function NarrativeDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions, inputPorts, portLabels } = useGraphRules()
  const card = raw as NarrativeCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const beats = bindings.filter(binding => binding.input_port === 'covered_beat')
  const moveBeat = (id: string, offset: number) => {
    const from = beats.findIndex(binding => binding.id === id), to = from + offset
    if (from < 0 || to < 0 || to >= beats.length) return
    const next = [...bindings], first = bindings.indexOf(beats[from]), second = bindings.indexOf(beats[to])
    ;[next[first], next[second]] = [next[second], next[first]]
    onChange({ ...card, input_bindings: next })
  }
  const field = (key: string, label: string) => <FieldEditor compact key={key} label={label} value={(card as unknown as Record<string, ReferenceDesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />
  const identity = 'beat_id' in card ? card.beat_id : 'event_id' in card ? card.event_id : 'shot_id' in card ? card.shot_id : undefined
  const fields = Object.fromEntries(designFieldEntries(card))
  const relations = <>
    <label>名称<Input aria-label="叙事名称" value={card.name} onChange={event => onChange({ ...card, name: event.target.value })} /></label>
    {resolved.error && <Alert type="warning" message={resolved.error} />}
    <details><summary>叙事关系 · 已选 {bindings.length} 项</summary>
    {card.type === 'direction.shot' && beats.length > 0 && <section aria-label="已选覆盖节拍顺序"><h3>已选覆盖节拍顺序</h3>{beats.map((binding, index) => {
      const item = resolved.candidates.find(candidate => sourceKey(candidate.source) === sourceKey(binding.source))
      const name = item?.payload && 'name' in item.payload ? item.payload.name : binding.source.object_id || '失效节拍'
      return <div key={binding.id}><span>{index + 1}. {name}</span><WorkbenchButton aria-label={`上移覆盖节拍 ${name}`} disabled={disabled || index === 0} onClick={() => moveBeat(binding.id, -1)}>上移</WorkbenchButton><WorkbenchButton aria-label={`下移覆盖节拍 ${name}`} disabled={disabled || index === beats.length - 1} onClick={() => moveBeat(binding.id, 1)}>下移</WorkbenchButton></div>
    })}</section>}
    <section aria-label="叙事关系"><h3>直接关系候选与已采用</h3>
      {resolved.candidates.map(item => {
        const payload = item.payload
        if (!payload || !['object_reference', 'spatial_reference', 'narrative_reference'].includes(payload.kind || '') || !('name' in payload)) return null
        return <div key={sourceKey(item.source)}><span>{payload.name} · {'category' in payload ? payload.category : ''}</span>{inputPorts(card).filter(port => !['text', 'image', 'video', 'anchor', 'image_example', 'video_example'].includes(port) && document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)).map(port => {
          if (port === 'participant' && (payload.kind !== 'object_reference' || 'category' in payload && payload.category === 'place')) return null
          const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
          return <WorkbenchButton key={port} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{`${binding ? '取消' : '选择'}${portLabels[port]} ${payload.name}`}</WorkbenchButton>
        })}</div>
      })}
      {bindings.filter(binding => !resolved.candidates.some(item => item.available && sourceKey(item.source) === sourceKey(binding.source))).map(binding => <div key={binding.id}><small role="alert">已选关系失效</small><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}
    </section>
    </details>
  </>
  return <DesignPresetEditor fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={narrativePresets[card.type!] || []} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} relations={relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as NarrativeCard)}>
    {card.type === 'direction.narrative' && <>{field('viewpoint', '观察视点')}{field('information_change', '信息变化')}{field('relationship_change', '人物关系变化')}{field('turning_point', '关键转折')}{field('open_questions', '待确定问题')}</>}
    {card.type === 'direction.beat' && <>{field('objective', '行动目标')}{field('obstacle', '阻碍')}{field('expected_change', '预期变化')}{field('audience_must_see', '必须让观众看到')}</>}
    {card.type === 'direction.event' && field('action_change', '动作或变化说明')}
    {card.type === 'direction.shot' && <>{field('narrative_role', '叙事作用')}{field('visible_result', '可见结果')}{field('estimated_duration', '预计时长')}</>}
    <DesignScopeEditor card={card} disabled={disabled} onChange={onChange} />
    {identity && <details><summary>稳定身份</summary>{identity}</details>}
    {card.type === 'direction.shot' && <DesignMediaExamples fieldOptions={cardDefinitions[card.type!].fields.map(field => ({ value: field.id, label: field.label }))} ports={[...inputPorts(card), 'image_example', 'video_example']} examples={card.examples || []} candidates={resolved.candidates} disabled={disabled} onChange={examples => onChange({ ...card, examples })} />}
    <details><summary>查看已保存完整设计 · revision {resolved.revision}</summary>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整叙事设计" />)}</details>
  </DesignPresetEditor>
}
