import { Alert, Button, Input, InputNumber, Select, Space } from 'antd'
import type { EditableDirection_Output, EditableShotCoverage_Output } from '../../../services/generated'
import { humanNote } from './common'
import { CanvasTextPreview } from './CanvasTextPreview'
import { WorkbenchModal } from './ui/WorkbenchModal'
import type { ReactNode } from 'react'

/** 镜头起稿只建立真实工作对象；列表顺序由明确操作修改，未分配节拍仍可保存。 */
export function ManualSceneShots({ value, disabled, onChange, selectedId, onSelect, editing, onEdit, onClose, summary, compact = false }: {
  summary?: ReactNode
  compact?: boolean
  value: EditableDirection_Output
  disabled: boolean
  onChange: (value: EditableDirection_Output) => void
  selectedId?: string
  onSelect: (id: string) => void
  editing: boolean
  onEdit: () => void
  onClose: () => void
}) {
  const index = value.shots.findIndex(shot => shot.id === selectedId)
  const selected = value.shots[index]
  const update = (patch: Partial<EditableShotCoverage_Output>) => {
    if (!selected || disabled) return
    onChange({ ...value, shots: value.shots.map(shot => shot.id === selected.id ? { ...shot, ...patch } : shot) })
  }
  const move = (delta: number) => {
    if (!selected || disabled || index + delta < 0 || index + delta >= value.shots.length) return
    const shots = [...value.shots]
    shots.splice(index + delta, 0, ...shots.splice(index, 1))
    onChange({ ...value, shots })
  }
  return <section className="canvas-workbench-card canvas-manual-shots" aria-label="人工镜头设计">
    {!value.shots.length && <p>当前不存在镜头。可先写下可见结果，稍后补充节拍与关系。</p>}
    {!compact && <Button disabled={disabled} onClick={() => {
      const id = crypto.randomUUID()
      onChange({ ...value, shots: [...value.shots, { id, beat_ids: [], event_ids: [], blocking_state_ids: [],
        participant_ids: null, criterion_ids: [], narrative_function: { state: 'unset' },
        visible_result: { state: 'unset' }, estimated_duration_ms: null }] })
      onSelect(id)
      onEdit()
    }}>手动添加镜头</Button>}
    {!compact && <details className="canvas-shot-picker"><summary>选择镜头 · {value.shots.length} 个</summary><nav aria-label="镜头选择"><Space direction="vertical">{value.shots.map((shot, i) => <Button key={shot.id}
      type="text" className="canvas-choice" aria-pressed={shot.id === selectedId} onClick={() => onSelect(shot.id)}>
      镜头 {i + 1}：{shot.visible_result.text || '未填写可见结果'}
    </Button>)}</Space></nav></details>}
    {selectedId && !selected && <Alert type="warning" message="原对象不可用，请重新选择镜头" />}
    {selected && <>{summary || <CanvasTextPreview text={selected.visible_result.text || '可见结果尚未填写'} label="镜头描述" />}
      {!compact && <Button onClick={onEdit}>编辑当前镜头</Button>}</>}
    {selected && editing && <WorkbenchModal title={`镜头 ${index + 1} · 镜头编辑`} open onCancel={onClose} footer={<Button onClick={onClose}>关闭编辑区</Button>}>
      <label htmlFor="manual-shot-result">镜头可见结果</label>
      <Input.TextArea id="manual-shot-result" disabled={disabled} value={selected.visible_result.text || ''}
        onChange={event => update({ visible_result: humanNote(event.target.value) })} />
      <label htmlFor="manual-shot-function">镜头叙事功能</label>
      <Input.TextArea id="manual-shot-function" disabled={disabled} value={selected.narrative_function.text || ''}
        onChange={event => update({ narrative_function: humanNote(event.target.value) })} />
      <label>覆盖节拍</label>
      <Select aria-label="覆盖节拍" mode="multiple" disabled={disabled} value={selected.beat_ids}
        options={value.beats.map((beat, i) => ({ value: beat.id, label: `节拍 ${i + 1}：${beat.objective.text || '未填写目标'}` }))}
        onChange={beat_ids => update({ beat_ids })} style={{ width: '100%' }} />
      <label>预计时长（毫秒）</label>
      <InputNumber aria-label="预计时长（毫秒）" min={1} precision={0} disabled={disabled} value={selected.estimated_duration_ms}
        onChange={estimated_duration_ms => update({ estimated_duration_ms })} />
      <p>镜头排序只调整设计顺序，不建立依赖或剪辑顺序。</p>
      <Space><Button disabled={disabled || index === 0} onClick={() => move(-1)}>镜头前移</Button>
        <Button disabled={disabled || index === value.shots.length - 1} onClick={() => move(1)}>镜头后移</Button></Space>
    </WorkbenchModal>}
  </section>
}
