import type { VisualStyleCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignFieldEditor } from './DesignFieldEditor'
import { DesignMediaExamples } from './DesignMediaExamples'
import { VisualPresetPicker } from './VisualPresetPicker'
import { applyPreset, styleLabels, stylePresets } from './visualPresets'
import { useCardCandidates } from './useCardCandidates'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

/** 风格拥有自己的设计字段；预设只填入本卡，不创建第二份数据。 */
export function VisualStyleEditor({card:raw,document,savedRevision,modelOutputs,onChange,disabled}:CardRendererProps) {
  const card=raw as VisualStyleCard,fields=card.fields||{}
  const resolved=useCardCandidates(document.project_id,document.id,card.id,savedRevision,modelOutputs,false)
  return <><VisualPresetPicker label="风格" presets={stylePresets} disabled={disabled} onApply={preset=>onChange({...card,fields:applyPreset(fields,preset)})}/>
    <section aria-label="已选风格摘要"><CanvasTextPreview text={Object.values(fields).map(value=>value.text).filter(Boolean).join(' · ')||'尚未填写风格设计'} label="风格摘要"/></section>
    {Object.entries(styleLabels).map(([key,label])=><DesignFieldEditor key={key} label={label} value={fields[key as keyof typeof fields]} onChange={value=>onChange({...card,fields:{...fields,[key]:value}})}/>)}
    <DesignMediaExamples ports={['image_example','video_example']} examples={card.examples||[]} candidates={resolved.candidates} disabled={disabled} onChange={examples=>onChange({...card,examples})}/>
    <section aria-label="已保存风格输出">{resolved.outputs.map(item=><CanvasTextPreview key={item.source.card_id} text={item.text||''} label="完整风格设计"/>)}</section>
  </>
}
