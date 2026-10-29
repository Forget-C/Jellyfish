import { useId } from 'react'
import type { DesignField, PhotographyCard, PhotographyFields } from '../../../services/generated'
import { designSummary } from './designSummary'
import { photographyRegions, shotSizeLabels } from './PhotographyEditor'
import './photographyCard.css'

/** 原创光学图解只解释卡片身份，不表示真实器材、生成结果或可采用素材。 */
function OpticalIllustration() {
  const id = 'optics-' + useId().replace(/:/g, '')
  return <svg viewBox="0 0 260 240" role="img" aria-label="摄影光学示意">
    <defs>
      <linearGradient id={id + '-metal'} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#627278"/><stop offset=".22" stopColor="#273338"/><stop offset=".52" stopColor="#131d23"/><stop offset=".77" stopColor="#46575d"/><stop offset="1" stopColor="#162328"/></linearGradient>
      <linearGradient id={id + '-rim'}><stop stopColor="#b0c2c6"/><stop offset=".35" stopColor="#34474f"/><stop offset=".7" stopColor="#83989e"/><stop offset="1" stopColor="#182931"/></linearGradient>
      <radialGradient id={id + '-glass'} cx=".36" cy=".33"><stop stopColor="#a1ddd3"/><stop offset=".18" stopColor="#28666d"/><stop offset=".4" stopColor="#142a39"/><stop offset=".62" stopColor="#243548"/><stop offset=".78" stopColor="#735775"/><stop offset=".9" stopColor="#173641"/><stop offset="1" stopColor="#0a171e"/></radialGradient>
      <radialGradient id={id + '-glow'}><stop stopColor="#c5f5ec" stopOpacity=".65"/><stop offset="1" stopColor="#91d7d6" stopOpacity="0"/></radialGradient>
      <filter id={id + '-shadow'} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    </defs>
    <ellipse cx="127" cy="200" rx="82" ry="14" fill="#071014" opacity=".55" filter={'url(#' + id + '-shadow)'} />
    <g transform="rotate(-17 130 120)">
      <path d="M49 61L146 48Q191 53 199 113Q202 171 162 190L64 176Q35 132 49 61Z" fill={'url(#' + id + '-metal)'} stroke="#58686c"/>
      <path d="M59 65L73 63L87 178L72 175Z" fill="#19272c"/>
      {Array.from({ length: 15 }, (_, index) => <path key={index} d={`M${54 + index * 4.7} ${62 - index * .6}L${68 + index * 4.7} ${176 + index * .8}`} stroke={index % 3 ? '#6d7d7f' : '#a5b2b1'} strokeWidth="1.3" opacity={index % 3 ? '.38' : '.5'}/>)}
      <path d="M119 52L135 49L153 188L137 187Z" fill="#101d24" opacity=".8"/>
      <ellipse cx="161" cy="119" rx="59" ry="74" fill={'url(#' + id + '-rim)'} stroke="#b2c1c0" strokeWidth="1.2"/>
      <ellipse cx="161" cy="119" rx="53" ry="68" fill="#16232b" stroke="#546e79" strokeWidth="2"/>
      <ellipse cx="161" cy="119" rx="46" ry="60" fill={'url(#' + id + '-glass)'} stroke="#91a9af" strokeWidth="1"/>
      <ellipse cx="161" cy="119" rx="38" ry="51" fill="none" stroke="#86c5c9" strokeWidth="1" opacity=".4"/>
      <ellipse cx="161" cy="119" rx="27" ry="37" fill="#07151f" opacity=".65"/>
      <ellipse cx="151" cy="99" rx="21" ry="30" fill={'url(#' + id + '-glow)'}/>
      <path d="M138 75Q158 59 178 79" fill="none" stroke="#b1dad9" strokeWidth="3" opacity=".55"/>
      <path d="M145 166Q163 177 182 158" fill="none" stroke="#8e78a3" strokeWidth="2" opacity=".65"/>
    </g>
  </svg>
}

/** 卡面有限摘要只读取本卡字段；完整摄影输出与采用范围由原协议负责。 */
export function PhotographyCardSummary({ card }: { card: PhotographyCard }) {
  const fields = card.fields || {}
  const rows = (['composition', 'camera', 'lighting', 'focus', 'movement'] as const).flatMap(region => {
    const values = Object.keys(photographyRegions[region].fields).map(key => {
      const field = fields[key as keyof PhotographyFields]
      if (!field) return undefined
      const text = key === 'shot_size' && fields.shot_size?.size ? field.text || shotSizeLabels[fields.shot_size.size] : field.text
      return { ...field, text: text || '', state: field.state || 'proposal' } as DesignField
    })
    const text = designSummary([], values)
    return text ? [{ label: photographyRegions[region].label, text }] : []
  })
  if (!rows.length) {
    const phase = designSummary([], (card.phases || []).map(item => item.frame))
    if (phase) rows.push({ label: '运镜', text: phase })
  }
  return <section className="photography-card-summary" aria-label="摄影设计摘要">
    <figure><OpticalIllustration/><figcaption>原创光学示意</figcaption></figure>
    {rows.length ? <dl>{rows.slice(0, 4).map(row => <div key={row.label}><dt>{row.label}</dt><dd title={row.text}>{row.text}</dd></div>)}</dl>
      : <p className="photography-card-empty">尚未填写摄影设计</p>}
  </section>
}
