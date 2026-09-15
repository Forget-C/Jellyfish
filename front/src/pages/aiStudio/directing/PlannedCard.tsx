import { Button, Image, InputNumber, Select, Space, Typography } from 'antd'
import type { PlannedCutItem, SceneDesign_Input } from '../../../services/generated'
import { DesignNote } from './DesignNote'
import { buildFileDownloadUrl } from '../assets/utils'

/** 同一预演项的文字、静态图与对白落点，所有时间均为计划而非媒体证据。 */
export function PlannedCard({ item, design, images, onImageSearch, onChange }: {
  item: PlannedCutItem; design?: SceneDesign_Input; images: Array<{ value: string; label: string }>;
  onImageSearch?: (q: string) => void;
  onChange?: (item: PlannedCutItem) => void
}) {
  const shot = design?.direction.shots.find(row => row.id === item.shot_id)
  const dialogueIds = new Set(design?.performance.beats.filter(row => shot?.beat_ids.includes(row.beat_id)).flatMap(row => row.dialogue_ids))
  const dialogues = design?.sound.dialogues.filter(row => dialogueIds.has(row.id)) || []
  return <Space direction="vertical" className="w-full">
    <Typography.Text strong>预演 · {item.shot_id}</Typography.Text>
    <Typography.Paragraph>叙事作用：<DesignNote note={shot?.narrative_function} /></Typography.Paragraph>
    <Typography.Paragraph>计划画面：<DesignNote note={shot?.visible_result} /></Typography.Paragraph><Typography.Text type="secondary">文字或静态图预演 · 预计 {item.estimated_duration_ms / 1000} 秒 · 不作为实际覆盖证据</Typography.Text>
    {item.preview_file_id && <Image src={buildFileDownloadUrl(item.preview_file_id)} alt="预演参考图" style={{ maxHeight: 300, objectFit: 'contain' }} />}
    {onChange && <Space wrap>
      <span>预计秒数</span><InputNumber aria-label="预演预计秒数" min={0.001} precision={3} value={item.estimated_duration_ms / 1000} onChange={seconds => {
        const duration = Math.max(1, ...(item.dialogue_cues || []).map(cue => cue.offset_ms + 1), Math.round((seconds || 0.001) * 1000))
        onChange({ ...item, estimated_duration_ms: duration })
      }} />
      <Select aria-label="预演静态图" allowClear placeholder="可选静态图，无图也可预演" className="min-w-64" showSearch filterOption={false} onSearch={onImageSearch} onFocus={() => onImageSearch?.('')} value={item.preview_file_id} options={images} onChange={id => onChange({ ...item, preview_file_id: id || null })} />
    </Space>}
    {item.dialogue_cues?.map((cue, index) => <Space key={index} wrap>
      <Typography.Text>对白：{dialogues.find(row => row.id === cue.dialogue_id)?.content.text || cue.dialogue_id}</Typography.Text>
      {onChange ? <><InputNumber aria-label="对白落点秒数" min={0} max={(item.estimated_duration_ms - 1) / 1000} precision={3} value={cue.offset_ms / 1000} onChange={seconds => onChange({ ...item, dialogue_cues: item.dialogue_cues?.map((row, i) => i === index ? { ...row, offset_ms: Math.round((seconds || 0) * 1000) } : row) })} />
        <Button onClick={() => onChange({ ...item, dialogue_cues: item.dialogue_cues?.filter((_, i) => i !== index) })}>移除落点</Button></> : <Typography.Text>计划 {cue.offset_ms / 1000} 秒</Typography.Text>}
    </Space>)}
    {onChange && !!dialogues.length && <Select<string> aria-label="添加对白落点" placeholder="添加对白落点" value={undefined} options={dialogues.map(row => ({ value: row.id, label: row.content.text || row.id }))} onChange={id => onChange({ ...item, dialogue_cues: [...(item.dialogue_cues || []), { dialogue_id: id, offset_ms: 0 }] })} />}
  </Space>
}
