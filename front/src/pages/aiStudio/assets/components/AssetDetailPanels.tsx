import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Image, Input, Modal, Tag, Tooltip, Tabs } from 'antd'
import { AppstoreOutlined, CheckCircleOutlined, EditOutlined, PictureOutlined, StarOutlined } from '@ant-design/icons'
import { ASSET_FIELDS, type AssetFacts, type StructuredAssetType } from './AssetFactsFields'
import { ResourceImage } from './ResourceImage'
import { buildFileDownloadUrl } from '../utils'
import { AssetImageParameters } from './AssetImageParameters'
import './actorDetail.css'

type Picture = { id: number; file_id?: string | null; view_angle?: string; is_primary?: boolean; is_view_default?: boolean }
const views = [['FRONT', '正面'], ['LEFT', '侧面'], ['TOP', '俯视'], ['BACK', '背面']] as const

/** 固定高度的分类资产设定；长内容与检测结果通过显式展开保留完整编辑能力。 */
export function AssetFields({ type, name, onName, facts, onFacts, description, onDescription, styles, onAnalysis, disabled, factsReadOnly = false }: {
  type: StructuredAssetType; name: string; onName: (value: string) => void; facts: AssetFacts; onFacts: (value: AssetFacts) => void
  description: string; onDescription: (value: string) => void; factsReadOnly?: boolean; styles: ReactNode; onAnalysis?: () => void; disabled: boolean
}) {
  const [expanded, setExpanded] = useState<string>()
  const field = ASSET_FIELDS[type].find(item => item.key === expanded)
  const label = field?.label ?? '补充信息'
  return <div className="actor-fields">
    <label>名称<Input aria-label="名称" value={name} onChange={event => onName(event.target.value)} disabled={disabled} /></label>
    <div className="actor-facts-grid">{[...ASSET_FIELDS[type]].sort((a, b) => a.maxLength - b.maxLength).map(item => <label key={item.key} className={(type === 'actor' ? item.maxLength > 200 : item.fullWidth || ['scene_type', 'costume_type'].includes(item.key)) ? 'actor-long-field' : undefined}>
      <span>{item.label}{!factsReadOnly && <Button type="text" size="small" aria-label={`展开${item.label}`} icon={<EditOutlined />} disabled={disabled} onClick={() => setExpanded(item.key)} />}</span>
      {item.maxLength > 200 ? <Input.TextArea aria-label={item.label} rows={type === 'actor' || item.fullWidth ? 2 : 1} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? '未提供' : undefined} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} /> : <Input aria-label={item.label} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? '未提供' : undefined} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} />}
    </label>)}</div>
    <label><span>补充信息{!factsReadOnly && <Button type="text" size="small" aria-label="展开补充信息" icon={<EditOutlined />} disabled={disabled} onClick={() => setExpanded('supplement')} />}</span>
      <Input.TextArea aria-label="补充信息" rows={2} maxLength={8000} value={description} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? '未提供' : undefined} onChange={event => onDescription(event.target.value)} /></label>
    <div className="actor-style-fields">{styles}</div>
    {!factsReadOnly && onAnalysis && <Button onClick={onAnalysis}>智能检测与结果</Button>}
    <Modal title={expanded === 'analysis' ? '智能检测' : label} open={!!expanded && expanded !== 'analysis'} onCancel={() => setExpanded(undefined)} footer={<Button aria-label="完成" onClick={() => setExpanded(undefined)}>完成</Button>}>
      {expanded !== 'analysis' && <Input.TextArea aria-label={`完整${label}`} rows={10} maxLength={field?.maxLength ?? 8000} value={field ? facts[field.key] ?? '' : description}
        onChange={event => field ? onFacts({ ...facts, [field.key]: event.target.value }) : onDescription(event.target.value)} disabled={disabled} />}
    </Modal>
  </div>
}

/** 默认主图、手动预览与主图身份分离；全部图片操作集中在多视角集合中。 */
export function AssetPictures({ type, assetId, images, disabled, primaryDisabled, readOnly, savingViewDefault, onViewDefault, onPrimary, onEdit, candidates, feedback, status, onGenerate }: {
  type: StructuredAssetType | 'character'; assetId: string; images: Picture[]; disabled: boolean; primaryDisabled: boolean; readOnly: boolean
  savingViewDefault?: number
  onViewDefault: (image: Picture) => Promise<void>
  onPrimary: (image: Picture) => Promise<boolean>; onEdit: (image: Picture) => void
  candidates: (angle: string) => ReactNode; feedback: ReactNode; status: (angle: string) => ReactNode; onGenerate: () => void
}) {
  const [selectedId, setSelectedId] = useState<number>()
  const [gallery, setGallery] = useState<string>()
  const primaryId = images.find(image => image.is_primary && image.file_id)?.id
  const rank = (angle?: string) => { const index = views.findIndex(([value]) => value === angle); return index < 0 ? views.length : index }
  const ordered = useMemo(() => images.filter(image => image.file_id).sort((a, b) => Number(!!b.is_view_default) - Number(!!a.is_view_default) || (a.is_view_default && b.is_view_default ? rank(a.view_angle) - rank(b.view_angle) : 0) || b.id - a.id), [images])
  useEffect(() => {
    if (selectedId === undefined || !ordered.some(image => image.id === selectedId)) setSelectedId(primaryId ?? [...ordered].sort((a, b) => b.id - a.id)[0]?.id)
  }, [ordered, selectedId, primaryId])
  const selected = ordered.find(image => image.id === selectedId) ?? ordered.find(image => image.id === primaryId) ?? ordered[0]
  const angleLabel = (angle: string) => ({ FRONT: '正面', LEFT: '侧面', TOP: '俯视', BACK: '背面', RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[angle] ?? angle
  const sorted = (angle: string) => images.filter(image => image.file_id && (image.view_angle ?? 'FRONT') === angle).sort((a, b) => Number(!!b.is_view_default) - Number(!!a.is_view_default) || b.id - a.id)
  const card = (image: Picture, index: number, label: string) => <div key={image.id} className="actor-picture-card">
    <ResourceImage src={buildFileDownloadUrl(image.file_id!)!} alt={`${label}图片 ${index + 1}`} />
    <div className="actor-picture-actions">{image.is_primary && <Tag>主图</Tag>}{image.is_view_default && <Tag>视角默认</Tag>}{!readOnly && <>
      {!image.is_view_default && <Tooltip title={`设为${label}默认图`}><Button type="text" size="small" aria-label={`设为${label}默认图 ${image.id}`} icon={<CheckCircleOutlined />} loading={savingViewDefault === image.id} disabled={primaryDisabled} onClick={() => void onViewDefault(image)} /></Tooltip>}
      {!image.is_primary && <Tooltip title="设为主图"><Button type="text" size="small" aria-label={`设为主图${label}图片 ${index + 1}`} icon={<StarOutlined />} disabled={primaryDisabled} onClick={async () => { if (await onPrimary(image)) setSelectedId(image.id) }} /></Tooltip>}
      <Tooltip title="局部修改"><Button type="text" size="small" aria-label={`局部修改${label}图片 ${index + 1}`} icon={<EditOutlined />} disabled={disabled} onClick={() => { setGallery(undefined); onEdit(image) }} /></Tooltip>
    </>}</div>
  </div>
  const other = [...new Set(images.map(image => image.view_angle ?? 'FRONT'))].filter(angle => !views.some(([value]) => value === angle))
  const available = [...views.map(([value, label]) => ({ value, label })), ...other.map(value => ({ value, label: ({ RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[value] ?? value }))]
  return <div className="actor-pictures">
    <div className="actor-picture-heading"><h2>图片</h2></div>
    {feedback}
    <div className="actor-feature-image">
      {selected ? <button className="actor-feature-trigger" aria-label="查看多角度图片" onClick={() => setGallery(selected.view_angle ?? 'FRONT')}>
        <Image key={selected.file_id} preview={false} src={buildFileDownloadUrl(selected.file_id!)} alt={`${angleLabel(selected.view_angle ?? 'FRONT')}图片 ${sorted(selected.view_angle ?? 'FRONT').findIndex(image => image.id === selected.id) + 1}`} />
      </button> : <div className="actor-empty"><PictureOutlined aria-hidden="true" /><span>暂无图片，生成后在这里预览</span></div>}
    </div>
    {selected && <div className="actor-preview-caption"><span>{angleLabel(selected.view_angle ?? 'FRONT')} · 当前预览</span>{selected.is_primary && <Tag>主图</Tag>}{selected.is_view_default && <Tag>视角默认</Tag>}</div>}
    <div className="actor-thumbnail-row"><div className="actor-thumbnails" role="group" aria-label="多视角缩略图">{ordered.map(image => <button key={image.id} aria-label={`预览${angleLabel(image.view_angle ?? 'FRONT')}图片 ${image.id}`} aria-pressed={selected?.id === image.id} onClick={() => setSelectedId(image.id)}>
      <img src={buildFileDownloadUrl(image.file_id!)!} alt="" /><span>{angleLabel(image.view_angle ?? 'FRONT')}{image.is_view_default ? ' · 默认' : image.is_primary ? ' · 主图' : ''}</span>
    </button>)}</div>
      {ordered.length > 0 && <Button className="actor-view-all" type="text" icon={<AppstoreOutlined aria-hidden="true" />} onClick={() => setGallery(selected?.view_angle ?? 'FRONT')}>查看全部（{ordered.length}）</Button>}
    </div>
    {selected && <AssetImageParameters type={type} key={`${assetId}:${selected.id}:${selected.file_id}`} assetId={assetId} imageId={selected.id} />}
    <div className="actor-task-summary">{views.map(([angle, label]) => <div key={angle} role="status">{status(angle) && <><span>{label}：</span>{status(angle)}</>}</div>)}</div>
    {!readOnly && <div className="actor-generate-action"><Button type="primary" disabled={disabled} onClick={onGenerate}>生成图片</Button></div>}
    <Modal title="图片集合" open={!!gallery} width={900} onCancel={() => setGallery(undefined)} footer={<Button aria-label="关闭" onClick={() => setGallery(undefined)}>关闭</Button>}>
      <Tabs activeKey={gallery} onChange={setGallery} items={available.map(({ value, label }) => ({ key: value, label, children: <>
        <div className="actor-gallery">{sorted(value).map((image, index) => card(image, index, label))}</div>
        {candidates(value)}
      </> }))} />
    </Modal>
  </div>
}

/** 四类资产共用布局；小屏与矮屏允许在独立页签中滚动。 */
export function AssetDetailLayout({ compact, fields, pictures }: { compact: boolean; fields: ReactNode; pictures: ReactNode }) {
  return compact ? <Tabs className="actor-detail-tabs" items={[{ key: 'settings', label: '设定', children: fields }, { key: 'images', label: '图片', children: pictures }]} />
    : <div className="actor-detail-layout"><section>{fields}</section><section>{pictures}</section></div>
}

/** 角色只维护自身设定，不借用演员结构化外观字段。 */
export function CharacterFields({ name, onName, description, onDescription, styles, disabled, factsReadOnly = false }: {
  name: string; onName: (value: string) => void; description: string; onDescription: (value: string) => void; styles: ReactNode; disabled: boolean; factsReadOnly?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  return <div className="actor-fields character-fields">
    <label>名称<Input aria-label="名称" value={name} onChange={event => onName(event.target.value)} disabled={disabled} /></label>
    <label className="character-description"><span>角色设定{!factsReadOnly && <Button type="text" size="small" aria-label="展开角色设定" icon={<EditOutlined />} onClick={() => setExpanded(true)} disabled={disabled} />}</span>
      <Input.TextArea aria-label="角色设定" value={description} onChange={event => onDescription(event.target.value)} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? '未提供' : undefined} rows={12} /></label>
    <div className="actor-style-fields">{styles}</div>
    <Modal title="角色设定" open={expanded} onCancel={() => setExpanded(false)} footer={<Button onClick={() => setExpanded(false)}>完成</Button>}>
      <Input.TextArea aria-label="完整角色设定" rows={12} value={description} onChange={event => onDescription(event.target.value)} disabled={disabled} />
    </Modal>
  </div>
}
