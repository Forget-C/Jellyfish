import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopePopover } from './DesignScopePopover'
import { soundConstraintPresets } from './soundConstraintPresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import type { DialogueCard, SoundArrangementCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'
import { useGraphRules } from './CanvasCatalogContext'

export type SoundCard = DialogueCard | SoundArrangementCard

/** 声音设计的对象、制作安排与固定素材分别编辑；示例关联本身不形成模型输入。 */
export function SoundDirectionEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions } = useGraphRules()
  const card = raw as SoundCard
  const sound = raw as SoundArrangementCard
  const update = (next: SoundCard) => onChange(next)
  const fields = Object.fromEntries(designFieldEntries(card))
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} disabled={disabled} onChange={onChange} editorOpen={editorOpen} />} fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={soundConstraintPresets(card)} direct={card.type === 'direction.dialogue'} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as typeof card)}>

    {card.type === 'direction.dialogue' ? <>
      <section aria-label="对白条目" className="design-preset-fields design-single-field">
        <FieldEditor compact label="对白正文" value={card.content} onChange={content => update({ ...card, content })} />
      </section>
      <section aria-label="对白要求" className="design-preset-fields design-preset-fields-compact">
        <FieldEditor compact label="语言／发音要求" value={card.language_pronunciation} onChange={language_pronunciation => update({ ...card, language_pronunciation })} />
        <FieldEditor compact label="声画关系说明" value={card.audiovisual_relation} onChange={audiovisual_relation => update({ ...card, audiovisual_relation })} />
      </section>
    </> : <section aria-label="声音条目" className="design-preset-fields design-preset-fields-compact">
      <FieldEditor compact label="声源说明" value={sound.source_description} onChange={source_description => update({ ...sound, source_description })} />
      <FieldEditor compact label="环境声" value={sound.environment} onChange={environment => update({ ...sound, environment })} />
      <FieldEditor compact label="动作声" value={sound.action_sound} onChange={action_sound => update({ ...sound, action_sound })} />
      <FieldEditor compact label="音乐约束" purpose="constraint" value={sound.music} onChange={music => update({ ...sound, music })} />
      <FieldEditor compact label="声音层次／主次关系" value={sound.hierarchy} onChange={hierarchy => update({ ...sound, hierarchy })} />

    </section>}

  </DesignPresetEditor>
}
