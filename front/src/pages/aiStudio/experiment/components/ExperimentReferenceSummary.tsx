import { useUiText } from '../../../../uiText'
import { useState, useSyncExternalStore } from 'react'
import { Button, Tooltip } from 'antd'
import { PlayCircleOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { resolveAssetUrl } from '../../assets/utils'
import { ExperimentReferenceImage } from './ExperimentReferenceImage'

export type ReferenceSummaryItem = {
  key: string
  id: string
  name: string
  label: string
  kind: 'image' | 'video'
  badge?: string
  thumbnail?: string
}
const countQuery = '(max-width: 480px), (max-height: 540px)'
const narrowQuery = '(max-width: 767px)'
const summaryLimit = () => window.matchMedia(countQuery).matches ? 0 : window.matchMedia(narrowQuery).matches ? 1 : 3
const subscribe = (update: () => void) => {
  const queries = [countQuery, narrowQuery].map(query => window.matchMedia(query))
  queries.forEach(query => query.addEventListener('change', update))
  return () => queries.forEach(query => query.removeEventListener('change', update))
}

function VideoThumbnail({ item }: { item: ReferenceSummaryItem }) {
  const [failed, setFailed] = useState(false)
  const src = resolveAssetUrl(item.thumbnail)
  return <span className="experiment-summary-video">
    {src && !failed ? <><img src={src} alt="" onError={() => setFailed(true)} /><PlayCircleOutlined aria-hidden="true" /></> : <VideoCameraOutlined aria-hidden="true" />}
  </span>
}

/** 输入区仅保留识别素材的摘要，角色、顺序与移除在预览或配置面板处理。 */
export function ExperimentReferenceSummary({ items, label, disabled, onPreview, onOpen }: {
  items: ReferenceSummaryItem[]
  label: string
  disabled: boolean
  onPreview: (item: ReferenceSummaryItem, trigger: HTMLElement) => void
  onOpen: (trigger: HTMLElement) => void
}) {
  const uiText = useUiText()
  const limit = useSyncExternalStore(subscribe, summaryLimit)
  if (!items.length) return null
  return <div className="experiment-reference-summary-bar">
    {limit > 0 && <ul className="experiment-reference-summary" aria-label={label}>
      {items.slice(0, limit).map(item => <li key={item.key}>
        <Tooltip title={item.label} trigger={['hover', 'focus']}>
          <button type="button" className="experiment-summary-thumb" aria-label={uiText("预览{{label}}", { label: item.label })} onClick={event => onPreview(item, event.currentTarget)}>
            <span className="experiment-summary-visual">
              {item.kind === 'image' ? <ExperimentReferenceImage id={item.id} name={item.name} /> : <VideoThumbnail key={item.thumbnail} item={item} />}
              {item.badge && <span className="experiment-summary-badge">{item.badge}</span>}
            </span>
          </button>
        </Tooltip>
      </li>)}
    </ul>}
    {items.length > limit && <Button type="text" className="experiment-summary-more" disabled={disabled}
      aria-label={uiText("查看全部 {{length}} 项素材", { length: items.length })} onClick={event => onOpen(event.currentTarget)}>{limit ? `+${items.length - limit}` : uiText("素材 {{length}}", { length: items.length })}</Button>}
  </div>
}
