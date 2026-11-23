import { useUiText } from '../../../uiText'
import { EditorAttribute } from './EditorAttribute'
import { useEffect, useId, useRef, useState } from 'react'
import { Select } from 'antd'
import { DisconnectOutlined, DeleteOutlined, SwapOutlined } from '@ant-design/icons'
import { StudioFilesService } from '../../../services/generated'
import type { CanvasResolvedOutput, NamedImageReferenceCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { CustomValueSelect } from './CustomValueSelect'
import { ReferenceCardEditor, ReferenceImagePlaceholder } from './ReferenceCard'
import { referenceImageCompatible, referenceImageKey, referenceNameError } from './referenceCardRules'
import { referenceProtection, sourceKey } from './promptRules'
import { useCardCandidates } from './useCardCandidates'
import type { CardRendererProps } from './rendererRegistry'

const angles = ['正面', '侧面', '背面', '俯视', '仰视', '三分之四侧面']

function ImageOption({ fileId, name }: { fileId: string; name: string }) {
  return <span className="generation-reference-option"><img alt="" src={buildFileDownloadUrl(fileId)} /><span title={name}>{name}</span></span>
}

/** 四类共用名称与单图选择；新图片只从图片内容卡采用，旧的固定图片继续展示。 */
export function NamedImageReferenceEditor({ card: raw, document, projectId, savedRevision, modelOutputs, onChange, disabled }: CardRendererProps) {
  const uiText = useUiText()
  const fieldId = useId()
  const card = raw as NamedImageReferenceCard
  const resolved = useCardCandidates(projectId, document.id, card.id, savedRevision, modelOutputs, false)
  const [canvasPicker, setCanvasPicker] = useState(false)
  const [selectionError, setSelectionError] = useState('')
  const [fileInfo, setFileInfo] = useState<{ id: string; name: string }>()
  const latest = useRef({ card, onChange, disabled }); latest.current = { card, onChange, disabled }
  const pendingName = useRef<string>()
  const fileId = card.image_binding?.file_id
  useEffect(() => {
    if (!fileId) return
    let active = true
    void StudioFilesService.getFileDetailApiV1StudioFilesFileIdGet({ fileId }).then(response => {
      if (!active || !response.data) return
      setFileInfo({ id: fileId, name: response.data.name })
      const current = latest.current
      if (pendingName.current === fileId && current.card.image_binding?.file_id === fileId && !current.disabled && !current.card.name?.trim() && !current.card.name_binding && response.data.name) {
        pendingName.current = undefined
        current.onChange({ ...current.card, name: response.data.name })
      }
    }).catch(() => { /* 文件元数据不可用时保留固定图片，名称仍可自行选择。 */ })
    return () => { active = false }
  }, [fileId])
  const nameError = referenceNameError(card, document.cards || [])
  const source = (image: CanvasResolvedOutput) => document.cards?.find(item => item.id === image.source.card_id)
  const usable = (image: CanvasResolvedOutput) => image.modality === 'image' && !!image.file_id && image.available !== false && referenceImageCompatible(card, source(image))
  const connected = resolved.candidates.filter(usable)
  const nameCandidates = resolved.candidates.filter(item => item.available !== false && item.source.port_id === 'object' && source(item)?.type === 'content.' + card.type.split('.')[1] && item.payload && 'name' in item.payload && item.payload.name)
  const linkedSource = card.name_binding && document.cards?.find(item => item.id === card.name_binding?.card_id)
  const name = (linkedSource && 'name' in linkedSource ? linkedSource.name : card.name) || ''
  const changeNameBinding = (candidate?: CanvasResolvedOutput) => {
    if (disabled) return
    // 改绑会替换输出对象身份，仍在使用的弱关联也需要先解除。
    const protection = referenceProtection(document, undefined, card.id)
    if (protection) { setSelectionError(uiText("请先取消下游采用，再切换或取消名称关联")); return }
    pendingName.current = undefined
    setSelectionError('')
    onChange({ ...card, name: candidate?.payload && 'name' in candidate.payload ? candidate.payload.name || '' : name, name_binding: candidate?.source || null })
  }
  const caption = (image: CanvasResolvedOutput) => {
    const owner = source(image)
    return (owner && 'title' in owner && typeof owner.title === 'string' && owner.title.trim()) || image.token || `图片 ${image.source.position + 1}`
  }
  const chooseCandidate = (image: CanvasResolvedOutput) => {
    if (disabled || !usable(image)) return
    const current = latest.current.card
    const name = current.name_binding ? current.name || '' : current.name?.trim() ? current.name : fileInfo && fileInfo.id === image.file_id ? fileInfo.name : ''
    pendingName.current = !name && !current.name_binding ? image.file_id! : undefined
    onChange({ ...current, name, scene_object_source: null, image_binding: { source: image.source, file_id: image.file_id!, result_set_id: image.result_set_id } })
  }
  const allImages = new Map<string, CanvasResolvedOutput>()
  for (const outputs of Object.values(modelOutputs || {})) for (const image of outputs) if (usable(image)) allImages.set(referenceImageKey(image), image)
  for (const item of document.cards || []) {
    if (item.type !== 'content.image' || !('file_id' in item) || !item.file_id || item.uploading || (modelOutputs?.[item.id] || []).some(image => image.available === false)) continue
    const image: CanvasResolvedOutput = { source: { canvas_id: document.id, card_id: item.id, port_id: 'image', position: 0 }, modality: 'image', available: true, file_id: item.file_id }
    allImages.set(referenceImageKey(image), image)
  }
  const unconnected = [...allImages.values()].filter(image => !(document.edges || []).some(edge => edge.target_card === card.id && edge.target_port === 'image_source' && edge.source_card === image.source.card_id && edge.source_port === image.source.port_id))
  const selected = card.image_binding
  const selectedImage = selected && connected.find(image => referenceImageKey(image) === referenceImageKey(selected))
  const selectedName = selectedImage ? caption(selectedImage) : '已保留图片'
  const boundNameKey = card.name_binding && sourceKey(card.name_binding)
  const nameOptions = nameCandidates.filter(item => sourceKey(item.source) !== boundNameKey).map(item => ({ value: sourceKey(item.source), label: item.payload && 'name' in item.payload ? item.payload.name || '' : '' }))
  if (boundNameKey) nameOptions.unshift({ value: boundNameKey, label: name || uiText("未命名描述") })
  const parameters = <>
    <EditorAttribute id={`${fieldId}-name`} label={uiText("参考名称")} required readOnly={disabled} value={card.name_binding ? `来源：${name}` : name} locked={!!card.name_binding} help={uiText("可输入名称，也可选择已有描述")} error={selectionError || nameError}>
    <span className="generation-reference-name">
      <CustomValueSelect id={`${fieldId}-name`} describedBy={`${fieldId}-name-hint`} placeholder={uiText("输入参考名称")} label={uiText("参考名称")} value={boundNameKey || name} options={nameOptions} disabled={disabled || !!card.name_binding} required allowClear={!card.name_binding} maxLength={255} status={nameError ? 'error' : undefined}
        onChange={(value, custom) => {
          if (disabled || card.name_binding) return
          if (!custom) {
            const candidate = nameCandidates.find(item => sourceKey(item.source) === value)
            if (candidate) { changeNameBinding(candidate); return }
          }
          pendingName.current = undefined
          setSelectionError('')
          onChange({ ...card, name: value })
        }} />
      {card.name_binding && <span className="generation-reference-linked">{uiText("已关联")}</span>}
      {card.name_binding && <WorkbenchIconButton label={uiText("取消名称关联")} icon={<DisconnectOutlined />} variant="quiet" disabled={disabled} onClick={() => changeNameBinding()} />}
    </span></EditorAttribute>
    <EditorAttribute id={`${fieldId}-angle`} label={uiText("角度")}><CustomValueSelect id={`${fieldId}-angle`} label={uiText("参考角度")} value={card.angle || '正面'} options={[...new Set([...angles, card.angle || '正面'])].map(value => ({ value, label: angles.includes(value) ? uiText(value) : value }))} disabled={disabled} onChange={angle => onChange({ ...card, angle })} /></EditorAttribute>
    <EditorAttribute id={`${fieldId}-image`} label={uiText("关联图片")} value={selected ? fileInfo?.id === selected.file_id ? fileInfo.name : selectedName : undefined} error={resolved.error}>
    <Select classNames={{ popup: { root: "generation-attribute-image-options" } }} id={`${fieldId}-image`} aria-describedby={`${fieldId}-image-hint`} labelInValue showSearch={false} aria-label={uiText("关联图片")} placeholder={uiText("选择已连线图片")} disabled={disabled} value={selected ? { value: referenceImageKey(selected), label: <ImageOption fileId={selected.file_id} name={selectedName || uiText("已保留图片")} /> } : undefined}
      notFoundContent={uiText("暂无已连线图片内容卡，可从当前画布选择")} options={connected.map(image => ({ value: referenceImageKey(image), label: <ImageOption fileId={image.file_id!} name={caption(image)} /> }))}
      onSelect={value => { const image = connected.find(item => referenceImageKey(item) === value.value); if (image) chooseCandidate(image) }} />
    </EditorAttribute>
  </>
  const missed = document.storyboard?.objects.some(item => item.reference_card_id === card.id && item.origin === 'missed')
  const status = [disabled && '只读', missed && '补漏对象', selected ? '1 张参考图' : '未选择图片'].filter(Boolean).join(' · ')
  if (card.scene_object_source) {
    const current = resolved.outputs.find(output => output.modality === 'image' && output.source.position === 0 && output.available !== false)
    return <ReferenceCardEditor parameters={<span>{uiText("场次对象参考 · 使用当前资源主图")}</span>} status={<span>{resolved.error || (current?.file_id ? uiText("主图随对象选用更新") : uiText("未选用资源或暂无主图"))}</span>}>
      <div className="generation-reference-image">{current?.file_id && <img alt={uiText("当前资源主图")} src={buildFileDownloadUrl(current.file_id)} />}</div>
      <WorkbenchButton variant="quiet" disabled={disabled} onClick={() => setCanvasPicker(true)}>{uiText("改用固定图片")}</WorkbenchButton>
      <WorkbenchModal title={uiText("从当前画布选择参考图")} open={canvasPicker} onCancel={() => setCanvasPicker(false)} footer={null}>
        <div className="generation-reference-picker">{unconnected.map(image => <WorkbenchButton key={referenceImageKey(image)} disabled={disabled} onClick={() => { chooseCandidate(image); setCanvasPicker(false) }}><img alt={uiText("参考候选")} src={buildFileDownloadUrl(image.file_id!)} />{uiText("选择参考图")} {caption(image)}</WorkbenchButton>)}</div>
        {!unconnected.length && <p>{uiText("当前画布没有可关联的未连线图片内容卡。")}</p>}
      </WorkbenchModal>
    </ReferenceCardEditor>
  }
  return <ReferenceCardEditor parameters={parameters} status={<span>{status}</span>}>
    <div className="generation-reference-image" data-empty={!selected}>
      {selected ? <><img alt={uiText("当前参考图")} src={buildFileDownloadUrl(selected.file_id)} /><div className="generation-reference-image-actions">
        <WorkbenchIconButton label={uiText("更换参考图")} icon={<SwapOutlined />} variant="quiet" disabled={disabled} onClick={() => setCanvasPicker(true)} />
        <WorkbenchIconButton label={uiText("移除参考图")} icon={<DeleteOutlined />} variant="quiet" disabled={disabled} onClick={() => { pendingName.current = undefined; onChange({ ...card, image_binding: null }) }} />
      </div></> : <ReferenceImagePlaceholder onChoose={() => setCanvasPicker(true)} disabled={disabled} />}
    </div>
    <WorkbenchModal title={uiText("从当前画布选择参考图")} open={canvasPicker} onCancel={() => setCanvasPicker(false)} footer={null}>
      <div className="generation-reference-picker">{unconnected.map(image => <WorkbenchButton key={referenceImageKey(image)} data-reference-source-card={image.source.card_id} disabled={disabled} onClick={() => { chooseCandidate(image); setCanvasPicker(false) }}><img alt={uiText("参考候选")} src={buildFileDownloadUrl(image.file_id!)} />{uiText("选择参考图")} {caption(image)}</WorkbenchButton>)}</div>
      {!unconnected.length && <p>{uiText("当前画布没有可关联的未连线图片内容卡。")}</p>}
    </WorkbenchModal>
  </ReferenceCardEditor>
}
