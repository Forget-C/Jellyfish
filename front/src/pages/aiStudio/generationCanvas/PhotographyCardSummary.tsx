import { Tooltip } from 'antd'
import type { DesignMediaExample, DesignField, PhotographyCard, PhotographyFields, VisualStyleCard } from '../../../services/generated'
import { designSummary } from './designSummary'
import { photographyRegions, shotSizeLabels } from './photographyDesign'
import { MediaPreview } from './MediaContentEditor'
import { DesignPurposeIllustration } from './DesignPurposeIllustration'
import './photographyCard.css'

/** 固定区域顺序只读取本卡真实字段；状态与阶段也是有效设计内容。 */
export function photographyRows(card: PhotographyCard) {
  const fields = card.fields || {}
  return (['composition', 'camera', 'movement', 'lighting', 'focus'] as const).flatMap(region => {
    const values = Object.keys(photographyRegions[region].fields).map(key => {
      const field = fields[key as keyof PhotographyFields]
      if (!field) return undefined
      const text = key === 'shot_size' && fields.shot_size?.size ? field.text || shotSizeLabels[fields.shot_size.size] : field.text
      return { ...field, text: text || '', state: field.state || 'proposal' } as DesignField
    })
    const text = [designSummary([], values), region === 'movement' ? designSummary([], (card.phases || []).map(item => item.frame)) : ''].filter(Boolean).join(' · ')
    return text ? [{ label: photographyRegions[region].label, text }] : []
  })
}

function SummaryRows({ rows }: { rows: { label: string; text: string }[] }) {
  return rows.length ? <><dl>{rows.slice(0, 2).map(row => <div key={row.label}><dt>{row.label}</dt><Tooltip title={row.text} trigger={['hover', 'focus']} overlayStyle={{ pointerEvents: 'none' }}><dd tabIndex={0} aria-label={`${row.label}：${row.text}`}>{row.text}</dd></Tooltip></div>)}</dl>{rows.length > 2 && <small>另有 {rows.length - 2} 项设计</small>}</> : null
}

/** 只展示本卡明确关联的正向图片示例；候选、反例和文本输出不生成效果图。 */
export function DesignCardPreview({ examples = [], style = false }: { examples?: DesignMediaExample[]; style?: boolean }) {
  const example = examples.find(item => item.purpose !== 'negative' && item.file_id && ['image', 'image_example'].includes(item.source.port_id))
  return example ? <figure className="design-card-reference" aria-label="已关联图片示例"><MediaPreview fileId={example.file_id} type="image" /><figcaption>已关联图片示例</figcaption></figure> : <DesignPurposeIllustration style={style} />
}

export function PhotographyCardSummary({ card }: { card: PhotographyCard }) {
  const rows = photographyRows(card)
  return <section className="design-card-summary" aria-label="摄影设计摘要">
    <DesignCardPreview examples={card.examples} />
    {rows.length ? <SummaryRows rows={rows} /> : <div className="design-card-empty"><strong>尚未填写摄影设计</strong><p>定义构图、机位、运动和光线</p></div>}
    {!!card.phases?.length && <small>{card.phases.length} 个运镜阶段</small>}
  </section>
}

export function VisualStyleCardSummary({ card }: { card: VisualStyleCard }) {
  const fields = card.fields || {}
  const rows = [{ label: '风格方向', text: designSummary([], [fields.direction, fields.visual_features]) }, { label: '色彩与材质', text: designSummary([], [fields.colors, fields.materials, fields.notes]) }].filter(row => row.text)
  return <section className="design-card-summary" aria-label="画面风格摘要">
    <DesignCardPreview examples={card.examples} style />
    {rows.length ? <SummaryRows rows={rows} /> : <div className="design-card-empty"><strong>尚未填写风格设计</strong><p>定义风格方向、色彩与材质倾向</p></div>}
  </section>
}
