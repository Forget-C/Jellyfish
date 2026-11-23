import { Popover, Typography } from 'antd'

/** 字段说明与整卡出处共用单行布局；完整说明仍可聚焦查看和复制。 */
export function DesignMetadataLine({ items, id }: { items: { label: string; text: string }[]; id?: string }) {
  if (!items.length) return null
  const source = items.find(item => item.label === '来源' || item.label === '卡片原始来源')
  const context = items.filter(item => item !== source).map(item => item.label ? `${item.label}：${item.text}` : item.text).join(' · ')
  const full = [context, source && `${source.label}：${source.text}`].filter(Boolean).join(' · ')
  const content = <div className="design-metadata-detail">{context && source && <p>{context}</p>}<Typography.Paragraph copyable={{ text: source?.text || full }}>{source ? `${source.label}：${source.text}` : full}</Typography.Paragraph></div>
  return <Popover trigger={['hover', 'focus', 'click']} placement="topLeft" content={content} classNames={{ root: "canvas-workbench-dialog" }}>
    <small id={id} className="design-field-metadata" tabIndex={0} aria-label={full}>
      {context && <span className="design-metadata-context">{context}</span>}
      {source && <span className="design-metadata-source">{context && ' · '}{source.label}：{source.text}</span>}
    </small>
  </Popover>
}
