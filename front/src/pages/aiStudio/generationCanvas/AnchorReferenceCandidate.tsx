import { DesignMediaReferenceSettings } from './DesignMediaReferenceSettings'
import { useEffect, useRef, useState } from 'react'
import { Alert, InputNumber, Select, Space } from 'antd'
import type { CanvasResolvedOutput, SpatialAnchorCard } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { buildFileDownloadUrl } from '../assets/utils'
import { MediaPreview } from './MediaContentEditor'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'

/** Local reference edits retain the fixed file; pointer gestures commit one history update. */
export function AnchorReferenceCandidate({ card, item, disabled, onChange, expanded, onExpand }: { card: SpatialAnchorCard; item: CanvasResolvedOutput; disabled?: boolean; onChange: (card: SpatialAnchorCard) => void; expanded: boolean; onExpand: (expanded: boolean) => void }) {
  const { cardDefinitions } = useGraphRules()
  const matches = (card.examples || []).filter(value => sourceKey(value.source) === sourceKey(item.source))
  const [selectedId, setSelectedId] = useState<string>()
  const example = selectedId === '' ? undefined : matches.find(value => value.id === selectedId) || matches[0]
  const marker = card.markers?.find(value => value.example_id === example?.id)
  const [editing, setEditing] = useState(false), [failed, setFailed] = useState(false)
  const [draft, setDraft] = useState<{ x: number; y: number }>()
  const gesture = useRef<{ pointer: number; x: number; y: number }>()
  const image = useRef<HTMLImageElement>(null)
  const fileId = example?.file_id || item.file_id
  useEffect(() => { setFailed(false); setEditing(false); setDraft(undefined); gesture.current = undefined }, [fileId])
  const video = (example?.source.port_id || item.source.port_id) === 'video'
  const update = (patch: Partial<NonNullable<SpatialAnchorCard['examples']>[number]>) => {
    if (example && !disabled) onChange({ ...card, examples: card.examples?.map(value => value.id === example.id ? { ...value, ...patch } : value) })
  }
  const saveMarker = (point?: { x: number; y: number }) => {
    if (!example || disabled) return
    onChange({ ...card, markers: [...(card.markers || []).filter(value => value.example_id !== example.id), ...(point ? [{ example_id: example.id, ...point }] : [])] })
  }
  const pointAt = (x: number, y: number) => {
    const rect = image.current!.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (x - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (y - rect.top) / rect.height)) }
  }
  const shown = draft || marker
  return <div className="anchor-reference-candidate" onErrorCapture={() => { setFailed(true); setEditing(false) }}>
    {matches.length > 0 && <Select aria-label="本地参考版本" value={example?.id || ''} options={[...matches.map((value, index) => ({ value: value.id, label: `本地参考 ${index + 1}` })), ...(item.file_id && !matches.some(value => value.file_id === item.file_id) ? [{ value: '', label: '当前候选素材' }] : [])]} onChange={id => { setSelectedId(id); setEditing(false); setDraft(undefined) }} />}
    {video && fileId ? <MediaPreview fileId={fileId} type="video" /> : fileId && <div className="anchor-marker-image" data-editing={editing && !disabled} onPointerDown={event => {
      if (!editing || disabled || failed || event.button !== 0 || !image.current || !(event.target === image.current || (event.target as HTMLElement).closest('[data-anchor-marker]'))) return
      const point = pointAt(event.clientX, event.clientY)
      gesture.current = { pointer: event.pointerId, x: point.x, y: point.y }
      event.currentTarget.setPointerCapture(event.pointerId); setDraft(point); event.preventDefault()
    }} onPointerMove={event => { if (gesture.current?.pointer === event.pointerId) setDraft(pointAt(event.clientX, event.clientY)) }} onPointerUp={event => {
      if (gesture.current?.pointer !== event.pointerId) return
      const point = pointAt(event.clientX, event.clientY)
      gesture.current = undefined; setDraft(undefined); saveMarker(point)
    }} onPointerCancel={() => { gesture.current = undefined; setDraft(undefined) }}>
      <img ref={image} src={buildFileDownloadUrl(fileId)} alt="锚点参考图片" draggable={false} onLoad={() => setFailed(false)} onError={() => { setFailed(true); setEditing(false) }} />
      {shown && !failed && <span data-anchor-marker aria-label="锚点图片标记" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}>⊕</span>}
    </div>}
    {failed && <Alert type="warning" message="原参考文件不可用，可取消本地参考。" />}
    <Space wrap><WorkbenchButton variant="quiet" onClick={() => { onExpand(!expanded) }}>{expanded ? '收起预览' : '展开预览'}</WorkbenchButton>
      {!example && <WorkbenchButton disabled={disabled || item.available === false || !fileId} onClick={() => { if (fileId) { const id = crypto.randomUUID(); setSelectedId(id); onChange({ ...card, examples: [...(card.examples || []), { id, source: item.source, file_id: fileId }] }) } }}>设为本地参考</WorkbenchButton>}
    </Space>
    {example && <>
      <DesignMediaReferenceSettings key={example.id} example={example} fields={cardDefinitions['direction.anchor'].fields} disabled={disabled} onChange={update} />
      {!video ? <><Space wrap><WorkbenchButton disabled={disabled || failed} variant="quiet" aria-pressed={editing} onClick={() => setEditing(!editing)}>{editing ? '完成标记' : marker ? '调整标记' : '标记位置'}</WorkbenchButton>
        <WorkbenchButton disabled={disabled || !marker} variant="quiet" onClick={() => saveMarker()}>清除标记</WorkbenchButton></Space>
        <details><summary>精确坐标</summary><Space wrap>{(['x', 'y'] as const).map(axis => <label key={axis}>{axis === 'x' ? '横向' : '纵向'} % <InputNumber aria-label={axis === 'x' ? '标记横坐标百分比' : '标记纵坐标百分比'} disabled={disabled || failed} min={0} max={100} step={1} value={marker ? marker[axis] * 100 : undefined} onChange={value => { if (value !== null) saveMarker({ x: marker?.x ?? 0.5, y: marker?.y ?? 0.5, [axis]: value / 100 }) }} /></label>)}</Space></details>
      </> : null}
      <WorkbenchButton variant="quiet" disabled={disabled} onClick={() => onChange({ ...card, examples: card.examples?.filter(value => value.id !== example.id), markers: card.markers?.filter(value => value.example_id !== example.id) })}>取消本地参考</WorkbenchButton>
    </>}
  </div>
}
