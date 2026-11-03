import { DesignCardPreview } from './PhotographyCardSummary'
import { DesignEditorFrame } from './DesignEditorFrame'
import { designSummary } from './designSummary'
import type { VisualStyleCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignFieldEditor } from './DesignFieldEditor'
import { useGraphRules } from './CanvasCatalogContext'
import { DesignMediaExamples } from './DesignMediaExamples'
import { VisualPresetPicker } from './VisualPresetPicker'
import { applyPreset, styleLabels, stylePresets } from './visualPresets'
import { useCardCandidates } from './useCardCandidates'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

/** 风格拥有自己的设计字段；预设只填入本卡，不创建第二份数据。 */
export function VisualStyleEditor({card:raw,document,savedRevision,modelOutputs,onChange,disabled,references,editorOpen}:CardRendererProps) {
  const { cardDefinitions } = useGraphRules()
  const card=raw as VisualStyleCard,fields=card.fields||{}
  const resolved=useCardCandidates(document.project_id,document.id,card.id,savedRevision,modelOutputs,false)
  return <DesignEditorFrame disabled={disabled} references={<><details><summary>候选连接管理</summary>{references}</details>    <DesignMediaExamples fieldOptions={cardDefinitions[card.type!].fields.map(field => ({value:field.id,label:field.label}))} ports={['image_example','video_example']} examples={card.examples||[]} candidates={resolved.candidates} disabled={disabled} onChange={examples=>onChange({...card,examples})}/>
    <section aria-label="已保存风格输出">{resolved.outputs.map(item=><CanvasTextPreview key={item.source.card_id} text={item.text||''} label="完整风格设计"/>)}</section>
</>}><VisualPresetPicker currentPreview={<DesignCardPreview examples={card.examples} style />} editorOpen={editorOpen} fields={{...fields}} fieldLabels={styleLabels} label="风格" presets={stylePresets} currentName={designSummary([],Object.values(fields))} disabled={disabled} onApply={preset=>onChange({...card,fields:applyPreset(fields,preset)})}>
      <section className="canvas-effect-key-settings" aria-label="关键设置"><h3>关键设置</h3>{(["direction","colors"] as const).map(key=><DesignFieldEditor compact key={key} label={styleLabels[key]} value={fields[key]} onChange={value=>onChange({...card,fields:{...fields,[key]:value}})}/>)}</section>
    <details className="canvas-effect-professional"><summary>更多参数与来源</summary>
    {Object.entries(styleLabels).filter(([key])=>key!=='direction'&&key!=='colors').map(([key,label])=><DesignFieldEditor compact key={key} label={label} value={fields[key as keyof typeof fields]} onChange={value=>onChange({...card,fields:{...fields,[key]:value}})}/>)}
    </details>
    </VisualPresetPicker>
  </DesignEditorFrame>
}
