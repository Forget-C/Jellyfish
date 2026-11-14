import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Image, Input, Modal, Space, Tag, Tooltip, Tabs } from 'antd'
import { EditOutlined, StarOutlined } from '@ant-design/icons'
import { ASSET_FIELDS, type AssetFacts } from './AssetFactsFields'
import { ResourceImage } from './ResourceImage'
import { buildFileDownloadUrl } from '../utils'
import { ActorImageParameters } from './ActorImageParameters'
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
    <div className="actor-facts-grid">{[...ASSET_FIELDS.actor].sort((a, b) => a.maxLength - b.maxLength).map(item => <label key={item.key} className={item.maxLength > 200 ? 'actor-long-field' : undefined}>
      <span>{item.label}<Button type="text" size="small" aria-label={`展开${item.label}`} icon={<EditOutlined />} disabled={disabled} onClick={() => setExpanded(item.key)} /></span>
      {item.maxLength > 200 ? <Input.TextArea aria-label={item.label} rows={2} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} /> : <Input aria-label={item.label} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} />}
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

/** 默认主图、手动预览与主图身份分离；全部图片操作集中在多视角集合中。 */
export function ActorPictures({ actorId, images, disabled, primaryDisabled, readOnly, onPrimary, onEdit, onHistory, candidates, feedback, status, onGenerate }: {
  actorId: string; images: Picture[]; disabled: boolean; primaryDisabled: boolean; readOnly: boolean
  onPrimary: (image: Picture) => Promise<boolean>; onEdit: (image: Picture) => void; onHistory: (image: Picture) => void
  candidates: (angle: string) => ReactNode; feedback: ReactNode; status: (angle: string) => ReactNode; onGenerate: () => void
}) {
  const [selectedId, setSelectedId] = useState<number>()
  const [gallery, setGallery] = useState<string>()
  const primaryId = images.find(image => image.is_primary && image.file_id)?.id
  const ordered = useMemo(() => images.filter(image => image.file_id).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || b.id - a.id), [images])
  useEffect(() => {
    if (selectedId === undefined || !ordered.some(image => image.id === selectedId)) setSelectedId(ordered[0]?.id)
  }, [ordered, selectedId])
  const selected = ordered.find(image => image.id === selectedId) ?? ordered.find(image => image.id === primaryId) ?? ordered[0]
  const angleLabel = (angle: string) => ({ FRONT: '正面', LEFT: '侧面', TOP: '俯视', BACK: '背面', RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[angle] ?? angle
  const sorted = (angle: string) => images.filter(image => image.file_id && (image.view_angle ?? 'FRONT') === angle).sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary) || b.id - a.id)
  const card = (image: Picture, index: number, label: string) => <div key={image.id} className="actor-picture-card">
    <ResourceImage src={buildFileDownloadUrl(image.file_id!)!} alt={`${label}图片 ${index + 1}`} />
    <div className="actor-picture-actions">{image.is_primary && <Tag>主图</Tag>}{!readOnly && <>
      {!image.is_primary && <Tooltip title="设为主图"><Button type="text" size="small" aria-label={`设为主图${label}图片 ${index + 1}`} icon={<StarOutlined />} disabled={primaryDisabled} onClick={async () => { if (await onPrimary(image)) setSelectedId(image.id) }} /></Tooltip>}
      <Tooltip title="局部修改"><Button type="text" size="small" aria-label={`局部修改${label}图片 ${index + 1}`} icon={<EditOutlined />} disabled={disabled} onClick={() => { setGallery(undefined); onEdit(image) }} /></Tooltip>
    </>}</div>
  </div>
  const other = [...new Set(images.map(image => image.view_angle ?? 'FRONT'))].filter(angle => !views.some(([value]) => value === angle))
  const available = [...views.map(([value, label]) => ({ value, label })), ...other.map(value => ({ value, label: ({ RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[value] ?? value }))]
  return <div className="actor-pictures">
    <div className="actor-picture-heading"><h2>图片</h2><Button type="link" onClick={() => setGallery(selected?.view_angle ?? 'FRONT')}>查看全部</Button></div>
    {feedback}
    <div className="actor-feature-image">
      {selected ? <button className="actor-feature-trigger" aria-label="查看多角度图片" onClick={() => setGallery(selected.view_angle ?? 'FRONT')}>
        <Image key={selected.file_id} preview={false} src={buildFileDownloadUrl(selected.file_id!)} alt={`${angleLabel(selected.view_angle ?? 'FRONT')}图片 ${sorted(selected.view_angle ?? 'FRONT').findIndex(image => image.id === selected.id) + 1}`} />
      </button> : <span className="actor-empty">暂无图片，生成后在这里预览</span>}
    </div>
    {selected && <div className="actor-preview-caption"><span>{angleLabel(selected.view_angle ?? 'FRONT')} · 当前预览</span>{selected.is_primary && <Tag>主图</Tag>}</div>}
    <div className="actor-thumbnails" role="group" aria-label="多视角缩略图">{ordered.map(image => <button key={image.id} aria-label={`预览${angleLabel(image.view_angle ?? 'FRONT')}图片 ${image.id}`} aria-pressed={selected?.id === image.id} onClick={() => setSelectedId(image.id)}>
      <img src={buildFileDownloadUrl(image.file_id!)!} alt="" /><span>{angleLabel(image.view_angle ?? 'FRONT')}{image.is_primary ? ' · 主图' : ''}</span>
    </button>)}</div>
    {selected && <ActorImageParameters key={`${actorId}:${selected.id}:${selected.file_id}`} actorId={actorId} imageId={selected.id} />}
    <div className="actor-task-summary">{views.map(([angle, label]) => <div key={angle} role="status">{status(angle) && <><span>{label}：</span>{status(angle)}</>}</div>)}</div>
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
