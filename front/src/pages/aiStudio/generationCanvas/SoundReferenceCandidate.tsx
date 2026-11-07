import { useEffect, useRef, useState } from 'react'
import { Alert, Select, Space } from 'antd'
import type { CanvasResolvedOutput, DialogueCard, SoundArrangementCard } from '../../../services/generated'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'
import { MediaPreview } from './MediaContentEditor'
import { DesignMediaReferenceSettings } from './DesignMediaReferenceSettings'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

type SoundCard = DialogueCard | SoundArrangementCard
const rangeLabel = (start?: number | null, end?: number | null) => (start === null || start === undefined) ? '全片' : `${(start / 1000).toFixed(3)}–${((end || 0) / 1000).toFixed(3)} 秒`

/** A source owns several fixed references; adopting current output never replaces an old file. */
export function SoundReferenceCandidate({ card, item, disabled, connected, onChange }: { card: SoundCard; item: CanvasResolvedOutput; disabled?: boolean; connected: boolean; onChange: (card: SoundCard) => void }) {
  const { cardDefinitions } = useGraphRules()
  const matches = (card.examples || []).filter(value => sourceKey(value.source) === sourceKey(item.source))
  const [selected, setSelected] = useState<string | undefined>(matches[0]?.id)
  const [failed, setFailed] = useState(false)
  const [duration, setDuration] = useState<number>()
  const owner = useRef<HTMLDivElement>(null)
  const example = matches.find(value => value.id === selected)
  const file = example?.file_id || item.file_id
  useEffect(() => { setFailed(false); setDuration(undefined) }, [file])
  const current = matches.find(value => value.file_id === item.file_id)
  const adopt = (additional = false) => {
    if (disabled || !connected || item.available === false || !item.file_id) return
    if (current && !additional) { setSelected(current.id); return }
    const next = { id: crypto.randomUUID(), source: item.source, file_id: item.file_id, purpose: 'positive' as const }
    onChange({ ...card, examples: [...(card.examples || []), next] }); setSelected(next.id)
  }
  return <div ref={owner} className="design-media-reference-settings">
    <Select aria-label="本地参考" value={example?.id || ''} options={[{ value: '', label: '当前候选素材' }, ...matches.map((value, index) => ({ value: value.id, label: `参考 ${index + 1} · ${rangeLabel(value.start_ms, value.end_ms)}` }))]} onChange={value => { setSelected(value) }} />
    <div key={file} onErrorCapture={() => setFailed(true)}>{file && <MediaPreview fileId={file} type={item.modality} onDuration={setDuration} />}</div>
    {failed && <Alert type="warning" message="原参考文件不可用，可取消本地参考。" />}
    {!example && <WorkbenchButton disabled={disabled || !connected || item.available === false || !file} onClick={() => adopt()}>设为本地参考</WorkbenchButton>}
    {example && <>
      <DesignMediaReferenceSettings key={example.id} example={example} fields={cardDefinitions[card.type!].fields} disabled={disabled} duration={duration} onChange={patch => onChange({ ...card, examples: card.examples?.map(value => value.id === example.id ? { ...value, ...patch } : value) })} />
      <Space wrap>
        <WorkbenchButton variant="quiet" disabled={failed || (example.start_ms === null || example.start_ms === undefined)} onClick={() => { const media = owner.current?.querySelector<HTMLMediaElement>('audio, video'); if (media) { media.currentTime = (example.start_ms || 0) / 1000; void media.play().catch(() => {}) } }}>从起点播放</WorkbenchButton>
        <WorkbenchButton variant="quiet" disabled={disabled || !connected || item.available === false || !item.file_id} onClick={() => adopt(true)}>新增一份参考</WorkbenchButton>
        <WorkbenchButton variant="quiet" disabled={disabled} onClick={() => { onChange({ ...card, examples: card.examples?.filter(value => value.id !== example.id) }); setSelected('') }}>取消本地参考</WorkbenchButton>
      </Space>
    </>}
  </div>
}
