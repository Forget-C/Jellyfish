import { useEffect, useRef, useState } from 'react'
import { AutoComplete, Dropdown, Input, Select } from 'antd'
import { AimOutlined, DisconnectOutlined, DeleteOutlined, FolderOpenOutlined, SwapOutlined, UploadOutlined } from '@ant-design/icons'
import { StudioFilesService } from '../../../services/generated'
import type { CanvasResolvedOutput, NamedImageReferenceCard, NamedImageObject, ReferenceImageBinding } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { WorkbenchModal } from '../directing/ui/WorkbenchModal'
import { CustomValueSelect } from './CustomValueSelect'
import { MediaContentEditor } from './MediaContentEditor'
import { ReferenceCardEditor, ReferenceImageUpload } from './ReferenceCard'
import { referenceImageCompatible, referenceImageKey, referenceImageName, referenceNameError } from './referenceCardRules'
import { referenceProtection } from './promptRules'
import { useCardCandidates } from './useCardCandidates'
import type { CardRendererProps } from './rendererRegistry'

const angles = ['正面', '侧面', '背面', '俯视', '仰视', '三分之四侧面']

function ImageOption({ fileId, name }: { fileId: string; name: string }) {
  return <span className="generation-reference-option"><img alt="" src={buildFileDownloadUrl(fileId)} /><span>{name}</span></span>
}

/** 四类共用单图、名称和角度；下拉仅采用已连线图片，画布选图入口才创建新来源关系。 */
export function NamedImageReferenceEditor({ card: raw, document, projectId, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const card = raw as NamedImageReferenceCard
  const resolved = useCardCandidates(projectId, document.id, card.id, savedRevision, modelOutputs, false)
  const [canvasPicker, setCanvasPicker] = useState(false)
  const [selectionError, setSelectionError] = useState('')
  const latest = useRef({ card, onChange }); latest.current = { card, onChange }
  const operation = useRef(0)
  useEffect(() => () => { operation.current++ }, [card.id])
  const nameError = referenceNameError(card, document.cards || [])
  const source = (image: CanvasResolvedOutput) => document.cards?.find(item => item.id === image.source.card_id)
  const usable = (image: CanvasResolvedOutput) => image.modality === 'image' && !!image.file_id && image.available !== false && referenceImageCompatible(card, source(image))
  const connected = resolved.candidates.filter(usable)
  const nameCandidates = resolved.candidates.filter(item => item.available !== false && item.source.port_id === 'object' && source(item)?.type === 'content.' + card.type.split('.')[1] && item.payload && 'name' in item.payload && item.payload.name)
  const linkedSource = card.name_binding && document.cards?.find(item => item.id === card.name_binding?.card_id)
  const name = (linkedSource && 'name' in linkedSource ? linkedSource.name : card.name) || ''
  const changeNameBinding = (image?: CanvasResolvedOutput) => {
    const protection = referenceProtection(document, card.id)
    if (protection) { setSelectionError('请先取消下游采用，再切换或取消名称关联'); return }
    setSelectionError('')
    onChange({ ...card, name: image?.payload && 'name' in image.payload ? image.payload.name || '' : name, name_binding: image?.source || null })
  }
  const caption = (image: CanvasResolvedOutput) => referenceImageName(image) || ('name' in (source(image) || {}) ? (source(image) as { name?: string }).name : '') || image.token || `图片 ${image.source.position + 1}`
  const choose = (binding: ReferenceImageBinding, suggestedName = '') => {
    if (disabled) return
    const current = latest.current.card
    const name = current.name_binding ? current.name || '' : current.name?.trim() ? current.name : suggestedName.trim()
    latest.current.onChange({ ...current, name, image_binding: binding })
    const token = ++operation.current
    if (!name && !current.name_binding) void StudioFilesService.getFileDetailApiV1StudioFilesFileIdGet({ fileId: binding.file_id }).then(response => {
      const current = latest.current.card
      if (token === operation.current && current.image_binding?.file_id === binding.file_id && !current.name_binding && !current.name?.trim() && response.data?.name) latest.current.onChange({ ...current, name: response.data.name })
    }).catch(() => { /* 文件名读取失败仍保留图片，名称可手工填写。 */ })
  }
  const chooseCandidate = (image: CanvasResolvedOutput) => choose({ source: image.source, file_id: image.file_id!, result_set_id: image.result_set_id }, referenceImageName(image))
  const allImages = new Map<string, CanvasResolvedOutput>()
  for (const outputs of Object.values(modelOutputs || {})) for (const image of outputs) if (usable(image)) allImages.set(referenceImageKey(image), image)
  for (const item of document.cards || []) {
    if (!referenceImageCompatible(card, item) || (modelOutputs?.[item.id] || []).some(image => image.available === false)) continue
    const fileId = item.type === 'content.image' && 'file_id' in item && !item.uploading ? item.file_id
      : item.type === card.type && 'image_binding' in item && !referenceNameError(item as NamedImageReferenceCard, document.cards || []) ? item.image_binding?.file_id : undefined
    if (!fileId) continue
    const image: CanvasResolvedOutput = { source: { canvas_id: document.id, card_id: item.id, port_id: 'image', position: 0 }, modality: 'image', available: true, file_id: fileId }
    if (item.type?.startsWith('reference.') && 'image_binding' in item) {
      const reference = item as NamedImageReferenceCard
      image.payload = { kind: 'named_image', name: reference.name || '', file_id: fileId, angle: reference.angle || '正面', objects: [{ object_id: reference.name_binding?.object_id || reference.object_id || reference.id, name: reference.name || '', category: reference.type.split('.')[1] as NamedImageObject['category'] }] }
    }
    allImages.set(referenceImageKey(image), image)
  }
  const unconnected = [...allImages.values()].filter(image => !(document.edges || []).some(edge => edge.target_card === card.id && edge.target_port === 'image_source' && edge.source_card === image.source.card_id && edge.source_port === image.source.port_id))
  return <MediaContentEditor card={{ id: card.id, type: 'content.image', file_id: card.image_binding?.file_id }} projectId={projectId} disabled={disabled}
    onChange={(media, file) => { if (media.file_id && !media.uploading) choose({ file_id: media.file_id }, file?.name) }}
    renderContent={({ upload, uploadFile, openLibrary, uploading, fileName }) => {
      const selected = card.image_binding
      const selectedImage = selected && connected.find(image => referenceImageKey(image) === referenceImageKey(selected))
      const selectedName = selectedImage ? caption(selectedImage) : fileName || '已选图片'
      const parameters = <>
        <Select labelInValue showSearch aria-label="关联图片" placeholder="从已连线图片中选择" disabled={disabled || uploading} value={selected ? { value: referenceImageKey(selected), label: <ImageOption fileId={selected.file_id} name={selectedName || '已选图片'} /> } : undefined}
          notFoundContent="暂无已连线图片，请先连线或添加来源" options={connected.map(image => ({ value: referenceImageKey(image), label: <ImageOption fileId={image.file_id!} name={caption(image)} />, searchLabel: caption(image) }))}
          filterOption={(query, option) => !!option?.searchLabel.includes(query)} onSelect={value => { const image = connected.find(item => referenceImageKey(item) === value.value); if (image) chooseCandidate(image) }} />
        <span className="generation-reference-name">
          {card.name_binding ? <Input aria-label="参考名称" aria-required="true" readOnly value={name} disabled={disabled} suffix={<WorkbenchIconButton label="取消名称关联" icon={<DisconnectOutlined />} variant="quiet" disabled={disabled} onClick={() => changeNameBinding()} />} />
            : <AutoComplete value={name} disabled={disabled} options={nameCandidates.map(item => ({ value: item.payload && 'name' in item.payload ? item.payload.name || '' : '' }))}
              onChange={name => onChange({ ...card, name })} onSelect={value => { const candidate = nameCandidates.find(item => item.payload && 'name' in item.payload && item.payload.name === value); if (candidate) changeNameBinding(candidate) }}>
              <Input aria-label="参考名称" aria-required="true" aria-invalid={!!nameError} placeholder="输入名称或选择已连线描述" maxLength={255} status={nameError ? 'error' : undefined} />
            </AutoComplete>}
        </span>
        <CustomValueSelect label="参考角度" value={card.angle || '正面'} options={[...new Set([...angles, card.angle || '正面'])].map(value => ({ value, label: value }))} disabled={disabled} onChange={angle => onChange({ ...card, angle })} />
      </>
      const sources = <Dropdown trigger={['click']} placement="topRight" disabled={disabled || uploading} menu={{ items: [
        { key: 'upload', label: '上传参考图', icon: <UploadOutlined aria-hidden /> }, { key: 'library', label: '从素材库选择', icon: <FolderOpenOutlined aria-hidden /> }, { key: 'canvas', label: '从当前画布选择', icon: <AimOutlined aria-hidden /> },
      ], onClick: ({ key }) => { if (key === 'upload') upload(); else if (key === 'library') openLibrary(); else setCanvasPicker(true) } }}>
        <span className="generation-reference-source-trigger">{selected ? <WorkbenchIconButton label="更换参考图" icon={<SwapOutlined />} variant="quiet" disabled={disabled || uploading} loading={uploading} /> : <WorkbenchButton aria-label="添加参考图" variant="quiet" disabled={disabled || uploading} loading={uploading}>从其他来源选择</WorkbenchButton>}</span>
      </Dropdown>
      const status = [disabled && '只读', uploading ? '上传中' : selected ? '1 张参考图' : '未选择图片', selectionError || nameError || (card.name_binding ? '名称已关联描述' : '') || resolved.error].filter(Boolean).join(' · ')
      return <ReferenceCardEditor parameters={parameters} status={<span>{status}</span>}>
        <div className="generation-reference-image" data-empty={!selected}>
          {selected ? <><img alt="当前参考图" src={buildFileDownloadUrl(selected.file_id)} /><div className="generation-reference-image-actions">{sources}<WorkbenchIconButton label="移除参考图" icon={<DeleteOutlined />} variant="quiet" disabled={disabled || uploading} onClick={() => onChange({ ...card, image_binding: null })} /></div></> : <ReferenceImageUpload onBrowse={upload} onUpload={uploadFile} disabled={disabled} uploading={uploading} sources={sources} />}
        </div>
        <WorkbenchModal title="从当前画布选择参考图" open={canvasPicker} onCancel={() => setCanvasPicker(false)} footer={null}>
          <div className="generation-reference-picker">{unconnected.map(image => <WorkbenchButton key={referenceImageKey(image)} data-reference-source-card={image.source.card_id} data-reference-source-position={image.source.position} disabled={disabled} onClick={() => { chooseCandidate(image); setCanvasPicker(false) }}><img alt="参考候选" src={buildFileDownloadUrl(image.file_id!)} />选择参考图 {caption(image)}</WorkbenchButton>)}</div>
          {!unconnected.length && <p>当前画布没有可关联的未连线图片。</p>}
        </WorkbenchModal>
      </ReferenceCardEditor>
    }} />
}
