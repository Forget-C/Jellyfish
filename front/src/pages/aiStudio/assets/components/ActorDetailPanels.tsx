import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Space, Tag, Tooltip, Tabs } from 'antd'
import { EditOutlined, StarOutlined } from '@ant-design/icons'
import { ASSET_FIELDS, type AssetFacts } from './AssetFactsFields'
import { ResourceImage } from './ResourceImage'
import { buildFileDownloadUrl } from '../utils'
import './actorDetail.css'

type Picture = { id: number; file_id?: string | null; view_angle?: string; is_primary?: boolean }
const views = [['FRONT', '正面'], ['LEFT', '侧面'], ['TOP', '俯视'], ['BACK', '背面']] as const

/** 固定高度的演员设定；长内容与检测结果通过显式展开保留完整编辑能力。 */
export function ActorFields({ name, onName, facts, onFacts, description, onDescription, styles, onAnalysis, disabled }: {
  name: string; onName: (value: string) => void; facts: AssetFacts; onFacts: (value: AssetFacts) => void
  description: string; onDescription: (value: string) => void; styles: ReactNode; onAnalysis: () => void; disabled: boolean
}) {
  const [expanded, setExpanded] = useState<string>()
  const field = ASSET_FIELDS.actor.find(item => item.key === expanded)
  const label = field?.label ?? '补充信息'
  return <div className="actor-fields">
    <label>名称<Input aria-label="名称" value={name} onChange={event => onName(event.target.value)} disabled={disabled} /></label>
    <div className="actor-facts-grid">{ASSET_FIELDS.actor.map(item => <label key={item.key}>
      <span>{item.label}<Button type="text" size="small" aria-label={`展开${item.label}`} icon={<EditOutlined />} disabled={disabled} onClick={() => setExpanded(item.key)} /></span>
      <Input aria-label={item.label} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} />
    </label>)}</div>
    <label><span>补充信息<Button type="text" size="small" aria-label="展开补充信息" icon={<EditOutlined />} disabled={disabled} onClick={() => setExpanded('supplement')} /></span>
      <Input.TextArea aria-label="补充信息" rows={2} maxLength={8000} value={description} disabled={disabled} onChange={event => onDescription(event.target.value)} /></label>
    <div className="actor-style-fields">{styles}</div>
    <Button onClick={onAnalysis}>智能检测与结果</Button>
    <Modal title={expanded === 'analysis' ? '智能检测' : label} open={!!expanded && expanded !== 'analysis'} onCancel={() => setExpanded(undefined)} footer={<Button aria-label="完成" onClick={() => setExpanded(undefined)}>完成</Button>}>
      {expanded !== 'analysis' && <Input.TextArea aria-label={`完整${label}`} rows={10} maxLength={field?.maxLength ?? 8000} value={field ? facts[field.key] ?? '' : description}
        onChange={event => field ? onFacts({ ...facts, [field.key]: event.target.value }) : onDescription(event.target.value)} disabled={disabled} />}
    </Modal>
  </div>
}

/** 四行只展示可完整容纳的图片；集合弹窗保留全部图片、历史和待采用产物。 */
export function ActorPictures({ images, disabled, primaryDisabled, readOnly, onPrimary, onEdit, onHistory, candidates, feedback, status, onGenerate }: {
  images: Picture[]; disabled: boolean; primaryDisabled: boolean; readOnly: boolean
  onPrimary: (image: Picture) => void; onEdit: (image: Picture) => void; onHistory: (image: Picture) => void
  candidates: (angle: string) => ReactNode; feedback: ReactNode; status: (angle: string) => ReactNode; onGenerate: () => void
}) {
  const row = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(2)
  const [gallery, setGallery] = useState<string>()
  useEffect(() => {
    if (!row.current) return
    const observer = new ResizeObserver(([entry]) => setCapacity(Math.max(1, Math.floor((entry.contentRect.width - 76) / 120))))
    observer.observe(row.current)
    return () => observer.disconnect()
  }, [])
  const sorted = (angle: string) => images.filter(image => image.file_id && (image.view_angle ?? 'FRONT') === angle).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || b.id - a.id)
  const card = (image: Picture, index: number, label: string) => <div key={image.id} className="actor-picture-card">
    <ResourceImage src={buildFileDownloadUrl(image.file_id!)!} alt={`${label}图片 ${index + 1}`} />
    <div className="actor-picture-actions">{image.is_primary && <Tag>主图</Tag>}{!readOnly && <>
      {!image.is_primary && <Tooltip title="设为主图"><Button type="text" size="small" aria-label={`设为主图${label}图片 ${index + 1}`} icon={<StarOutlined />} disabled={primaryDisabled} onClick={() => onPrimary(image)} /></Tooltip>}
      <Tooltip title="局部修改"><Button type="text" size="small" aria-label={`局部修改${label}图片 ${index + 1}`} icon={<EditOutlined />} disabled={disabled} onClick={() => { setGallery(undefined); onEdit(image) }} /></Tooltip>
    </>}</div>
  </div>
  const other = [...new Set(images.map(image => image.view_angle ?? 'FRONT'))].filter(angle => !views.some(([value]) => value === angle))
  const available = [...views.map(([value, label]) => ({ value, label })), ...other.map(value => ({ value, label: ({ RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[value] ?? value }))]
  return <div className="actor-pictures">
    <div className="actor-picture-heading"><h2>图片</h2>{other.length > 0 && <Button type="link" onClick={() => setGallery(other[0])}>其他视角</Button>}</div>
    {feedback}
    <div className="actor-picture-rows">{views.map(([angle, label], index) => {
      const rows = sorted(angle)
      return <section className="actor-picture-row" key={angle} aria-label={`${label}图片集合`}>
        <strong>{label}</strong><div className="actor-picture-strip" ref={index === 0 ? row : undefined}>
          {rows.slice(0, capacity).map((image, i) => card(image, i, label))}
          {!rows.length && <span className="actor-empty">暂无图片</span>}
          <Button className="actor-more" type="text" onClick={() => setGallery(angle)} aria-label={`更多${label}图片`}>{rows.length > capacity ? `更多 +${rows.length - capacity}` : '更多'}</Button>
        </div><div className="actor-row-status" role="status">{status(angle)}</div>
      </section>
    })}</div>
    {!readOnly && <div className="actor-generate-action"><Button type="primary" disabled={disabled} onClick={onGenerate}>生成图片</Button></div>}
    <Modal title="图片集合" open={!!gallery} width={900} onCancel={() => setGallery(undefined)} footer={<Button aria-label="关闭" onClick={() => setGallery(undefined)}>关闭</Button>}>
      <Tabs activeKey={gallery} onChange={setGallery} items={available.map(({ value, label }) => ({ key: value, label, children: <>
        <div className="actor-gallery">{sorted(value).map((image, index) => card(image, index, label))}</div>
        {!readOnly && <Space wrap>{sorted(value).map(image => <Button key={image.id} onClick={() => onHistory(image)}>查看图片 {image.id} 的候选</Button>)}</Space>}
        {candidates(value)}
      </> }))} />
    </Modal>
  </div>
}
