import { useUiText } from '../../../../uiText'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Image, Input, Modal, Tag, Tooltip, Tabs } from 'antd'
import { AppstoreOutlined, CheckCircleOutlined, EditOutlined, EyeOutlined, PictureOutlined, StarOutlined } from '@ant-design/icons'
import { ASSET_FIELDS, type AssetFacts, type StructuredAssetType } from './AssetFactsFields'
import { ResourceImage } from './ResourceImage'
import { buildFileDownloadUrl } from '../utils'
import { AssetImageParameters } from './AssetImageParameters'
import './actorDetail.css'

type Picture = { id: number; file_id?: string | null; view_angle?: string; is_primary?: boolean; is_view_default?: boolean }
const views = [['FRONT', '正面'], ['LEFT', '侧面'], ['TOP', '俯视'], ['BACK', '背面']] as const

/** 固定高度的分类资产设定；长内容与检测结果通过显式展开保留完整编辑能力。 */
export function AssetFields({ type, name, onName, facts, onFacts, description, onDescription, styles, onAnalysis, analysisBusy, analysisCancelling, analysisCompleted, analysisError, onCancelAnalysis, disabled, factsReadOnly = false }: {
  analysisError?: string; analysisCancelling?: boolean; analysisBusy?: boolean; analysisCompleted?: boolean; onCancelAnalysis?: () => void
  type: StructuredAssetType; name: string; onName: (value: string) => void; facts: AssetFacts; onFacts: (value: AssetFacts) => void
  description: string; onDescription: (value: string) => void; factsReadOnly?: boolean; styles: ReactNode; onAnalysis?: () => void; disabled: boolean
}) {
  const uiText = useUiText()
  const [expanded, setExpanded] = useState<string>()
  const field = ASSET_FIELDS[type].find(item => item.key === expanded)
  const label = uiText(field?.label ?? "补充信息")
  return <div className="actor-fields">
    <label>{uiText("名称")}<Input aria-label={uiText("名称")} value={name} onChange={event => onName(event.target.value)} disabled={disabled} /></label>
    <div className="actor-facts-grid">{[...ASSET_FIELDS[type]].sort((a, b) => a.maxLength - b.maxLength).map(item => <label key={item.key} className={(type === 'actor' ? item.maxLength > 200 : item.fullWidth || ['scene_type', 'costume_type'].includes(item.key)) ? 'actor-long-field' : undefined}>
      <span>{uiText(item.label)}{<Button type="text" size="small" aria-label={uiText("展开{{label}}", { label: uiText(item.label) })} icon={factsReadOnly || disabled ? <EyeOutlined /> : <EditOutlined />} onClick={() => setExpanded(item.key)} />}</span>
      {item.maxLength > 200 ? <Input.TextArea aria-label={uiText(item.label)} rows={type === 'actor' || item.fullWidth ? 2 : 1} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? uiText("未提供") : undefined} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} /> : <Input aria-label={uiText(item.label)} maxLength={item.maxLength} value={facts[item.key] ?? ''} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? uiText("未提供") : undefined} onChange={event => onFacts({ ...facts, [item.key]: event.target.value })} />}
    </label>)}</div>
    <label><span>{uiText("补充信息")}{<Button type="text" size="small" aria-label={uiText("展开补充信息")} icon={factsReadOnly || disabled ? <EyeOutlined /> : <EditOutlined />} onClick={() => setExpanded('supplement')} />}</span>
      <Input.TextArea aria-label={uiText("补充信息")} rows={2} maxLength={8000} value={description} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? uiText("未提供") : undefined} onChange={event => onDescription(event.target.value)} /></label>
    <div className="actor-style-fields">{styles}</div>
    {factsReadOnly && <small>{uiText("详情暂不可编辑，不影响图片管理与参考生成。")}</small>}
    {!factsReadOnly && onAnalysis && <div><Button loading={analysisBusy} disabled={analysisBusy || disabled || type === 'actor' && !Object.values(facts).some(value => value?.trim()) && !description.trim()} onClick={onAnalysis}>{type !== 'actor' ? uiText("智能检测与结果") : analysisCancelling ? uiText("等待取消确认") : analysisBusy ? uiText("检测中…") : analysisError ? uiText("检测失败，查看详情") : analysisCompleted ? uiText("查看检测结果") : uiText("智能检测")}</Button>{analysisBusy && <Button disabled={analysisCancelling} onClick={onCancelAnalysis}>{uiText("取消检测")}</Button>}{type === 'actor' && <small>{analysisError || uiText("检查文字设定，不核对图片一致性")}</small>}</div>}
    <Modal title={expanded === 'analysis' ? uiText("智能检测") : label} open={!!expanded && expanded !== 'analysis'} onCancel={() => setExpanded(undefined)} footer={<Button aria-label={uiText("完成")} onClick={() => setExpanded(undefined)}>{uiText("完成")}</Button>}>
      {expanded !== 'analysis' && <Input.TextArea aria-label={uiText("完整{{label}}", { label })} rows={10} maxLength={field?.maxLength ?? 8000} value={field ? facts[field.key] ?? '' : description}
        onChange={event => field ? onFacts({ ...facts, [field.key]: event.target.value }) : onDescription(event.target.value)} readOnly={disabled || factsReadOnly} />}
    </Modal>
  </div>
}

/** 默认主图、手动预览与主图身份分离；全部图片操作集中在多视角集合中。 */
export function AssetPictures({ type, assetId, images, disabled, primaryDisabled, savingViewDefault, onViewDefault, onPrimary, onEdit, candidates, feedback, status, onGenerate }: {
  type: StructuredAssetType | 'character'; assetId: string; images: Picture[]; disabled: boolean; primaryDisabled: boolean
  savingViewDefault?: number
  onViewDefault: (image: Picture) => Promise<void>
  onPrimary: (image: Picture) => Promise<boolean>; onEdit: (image: Picture) => void
  candidates: (angle: string) => ReactNode; feedback: ReactNode; status: (angle: string) => ReactNode; onGenerate: () => void
}) {
  const uiText = useUiText()
  const [selectedId, setSelectedId] = useState<number>()
  const [gallery, setGallery] = useState<string>()
  const primaryId = images.find(image => image.is_primary && image.file_id)?.id
  const rank = (angle?: string) => { const index = views.findIndex(([value]) => value === angle); return index < 0 ? views.length : index }
  const ordered = useMemo(() => images.filter(image => image.file_id).sort((a, b) => Number(!!b.is_view_default) - Number(!!a.is_view_default) || (a.is_view_default && b.is_view_default ? rank(a.view_angle) - rank(b.view_angle) : 0) || b.id - a.id), [images])
  useEffect(() => {
    if (selectedId === undefined || !ordered.some(image => image.id === selectedId)) setSelectedId(primaryId ?? [...ordered].sort((a, b) => b.id - a.id)[0]?.id)
  }, [ordered, selectedId, primaryId])
  const selected = ordered.find(image => image.id === selectedId) ?? ordered.find(image => image.id === primaryId) ?? ordered[0]
  const angleLabel = (angle: string) => uiText(({ FRONT: '正面', LEFT: '侧面', TOP: '俯视', BACK: '背面', RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[angle] ?? angle)
  const sorted = (angle: string) => images.filter(image => image.file_id && (image.view_angle ?? 'FRONT') === angle).sort((a, b) => Number(!!b.is_view_default) - Number(!!a.is_view_default) || b.id - a.id)
  const card = (image: Picture, index: number, label: string) => <div key={image.id} className="actor-picture-card">
    <ResourceImage src={buildFileDownloadUrl(image.file_id!)!} alt={uiText("{{label}}图片 {{value2}}", { label, value2: index + 1 })} />
    <div className="actor-picture-actions">{image.is_primary && <Tag>{uiText("主图")}</Tag>}{image.is_view_default && <Tag>{uiText("视角默认")}</Tag>}
      {!image.is_view_default && <Tooltip title={uiText("设为{{label}}默认图", { label })}><Button type="text" size="small" aria-label={uiText("设为{{label}}默认图 {{id}}", { label, id: image.id })} icon={<CheckCircleOutlined />} loading={savingViewDefault === image.id} disabled={primaryDisabled} onClick={() => void onViewDefault(image)} /></Tooltip>}
      {!image.is_primary && <Tooltip title={uiText("设为主图")}><Button type="text" size="small" aria-label={uiText("设为主图{{label}}图片 {{value2}}", { label, value2: index + 1 })} icon={<StarOutlined />} disabled={primaryDisabled} onClick={async () => { if (await onPrimary(image)) setSelectedId(image.id) }} /></Tooltip>}
      <Tooltip title={uiText("局部修改")}><Button type="text" size="small" aria-label={uiText("局部修改{{label}}图片 {{value2}}", { label, value2: index + 1 })} icon={<EditOutlined />} disabled={disabled} onClick={() => { setGallery(undefined); onEdit(image) }} /></Tooltip>
    </div>
  </div>
  const other = [...new Set(images.map(image => image.view_angle ?? 'FRONT'))].filter(angle => !views.some(([value]) => value === angle))
  const available = [...views.map(([value, label]) => ({ value, label })), ...other.map(value => ({ value, label: ({ RIGHT: '右侧', DETAIL: '细节', THREE_QUARTER: '3/4侧面' } as Record<string, string>)[value] ?? value }))]
  return <div className="actor-pictures">
    <div className="actor-picture-heading"><h2>{uiText("图片")}</h2></div>
    {feedback}
    <div className="actor-feature-image">
      {selected ? <button className="actor-feature-trigger" aria-label={uiText("查看多角度图片")} onClick={() => setGallery(selected.view_angle ?? 'FRONT')}>
        <Image key={selected.file_id} preview={false} src={buildFileDownloadUrl(selected.file_id!)} alt={uiText("{{value1}}图片 {{value2}}", { value1: angleLabel(selected.view_angle ?? 'FRONT'), value2: sorted(selected.view_angle ?? 'FRONT').findIndex(image => image.id === selected.id) + 1 })} />
      </button> : <div className="actor-empty"><PictureOutlined aria-hidden="true" /><span>{uiText("暂无图片，生成后在这里预览")}</span></div>}
    </div>
    {selected && <div className="actor-preview-caption"><span>{angleLabel(selected.view_angle ?? 'FRONT')} {uiText("· 当前预览")}</span>{selected.is_primary && <Tag>{uiText("主图")}</Tag>}{selected.is_view_default && <Tag>{uiText("视角默认")}</Tag>}</div>}
    <div className="actor-thumbnail-row"><div className="actor-thumbnails" role="group" aria-label={uiText("多视角缩略图")}>{ordered.map(image => <button key={image.id} aria-label={uiText("预览{{value1}}图片 {{id}}", { value1: angleLabel(image.view_angle ?? 'FRONT'), id: image.id })} aria-pressed={selected?.id === image.id} onClick={() => setSelectedId(image.id)}>
      <img src={buildFileDownloadUrl(image.file_id!)!} alt="" /><span>{angleLabel(image.view_angle ?? 'FRONT')}{image.is_view_default ? uiText(" · 默认") : image.is_primary ? uiText(" · 主图") : ''}</span>
    </button>)}</div>
      {ordered.length > 0 && <Button className="actor-view-all" type="text" icon={<AppstoreOutlined aria-hidden="true" />} onClick={() => setGallery(selected?.view_angle ?? 'FRONT')}>{uiText("查看全部（{{count}}）", { count: ordered.length })}</Button>}
    </div>
    {selected && <AssetImageParameters type={type} key={`${assetId}:${selected.id}:${selected.file_id}`} assetId={assetId} imageId={selected.id} />}
    <div className="actor-task-summary">{views.map(([angle, label]) => <div key={angle} role="status">{status(angle) && <><span>{uiText(label)}：</span>{status(angle)}</>}</div>)}</div>
    {<div className="actor-generate-action"><Button type="primary" disabled={disabled} onClick={onGenerate}>{uiText("生成图片")}</Button></div>}
    <Modal title={uiText("图片集合")} open={!!gallery} width={900} onCancel={() => setGallery(undefined)} footer={<Button aria-label={uiText("关闭")} onClick={() => setGallery(undefined)}>{uiText("关闭")}</Button>}>
      <Tabs activeKey={gallery} onChange={setGallery} items={available.map(({ value, label }) => ({ key: value, label, children: <>
        <div className="actor-gallery">{sorted(value).map((image, index) => card(image, index, label))}</div>
        {candidates(value)}
      </> }))} />
    </Modal>
  </div>
}

/** 四类资产共用布局；小屏与矮屏允许在独立页签中滚动。 */
export function AssetDetailLayout({ compact, fields, pictures }: { compact: boolean; fields: ReactNode; pictures: ReactNode }) {
  const uiText = useUiText()
  return compact ? <Tabs className="actor-detail-tabs" items={[{ key: 'settings', label: uiText("设定"), children: fields }, { key: 'images', label: uiText("图片"), children: pictures }]} />
    : <div className="actor-detail-layout"><section>{fields}</section><section>{pictures}</section></div>
}

/** 角色只维护自身设定，不借用演员结构化外观字段。 */
export function CharacterFields({ name, onName, description, onDescription, styles, disabled, factsReadOnly = false }: {
  name: string; onName: (value: string) => void; description: string; onDescription: (value: string) => void; styles: ReactNode; disabled: boolean; factsReadOnly?: boolean
}) {
  const uiText = useUiText()
  const [expanded, setExpanded] = useState(false)
  return <div className="actor-fields character-fields">
    <label>{uiText("名称")}<Input aria-label={uiText("名称")} value={name} onChange={event => onName(event.target.value)} disabled={disabled} /></label>
    <label className="character-description"><span>{uiText("角色设定")}{!factsReadOnly && <Button type="text" size="small" aria-label={uiText("展开角色设定")} icon={<EditOutlined />} onClick={() => setExpanded(true)} disabled={disabled} />}</span>
      <Input.TextArea aria-label={uiText("角色设定")} value={description} onChange={event => onDescription(event.target.value)} disabled={disabled || factsReadOnly} placeholder={factsReadOnly ? uiText("未提供") : undefined} rows={12} /></label>
    <div className="actor-style-fields">{styles}</div>
    <Modal title={uiText("角色设定")} open={expanded} onCancel={() => setExpanded(false)} footer={<Button onClick={() => setExpanded(false)}>{uiText("完成")}</Button>}>
      <Input.TextArea aria-label={uiText("完整角色设定")} rows={12} value={description} onChange={event => onDescription(event.target.value)} disabled={disabled} />
    </Modal>
  </div>
}
