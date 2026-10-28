import { NamedImageSummary } from './NamedImageSummary'
import { useState } from 'react'
import { Input, Space } from 'antd'
import type { CanvasModelCapability, CanvasResolvedOutput, InputBinding, VideoModelCard } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { editorPrompt, withEditorPrompt } from './inputBindings'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'

/** 直接候选只在明确选择用途和主体后采用；所有实际顺序及分组保存在绑定中。 */
export function VideoInputBindings({ card, candidates, capability, loading, disabled, onChange }: {
  card: VideoModelCard; candidates: CanvasResolvedOutput[]; capability?: CanvasModelCapability; loading?: boolean; disabled?: boolean; onChange: (card: VideoModelCard) => void
}) {
  const { portLabels } = useGraphRules()
  const [names, setNames] = useState<Record<string, string>>({})
  const bindings = card.input_bindings || []
  const change = (input_bindings: InputBinding[]) => onChange({ ...card, input_bindings })
  const remove = (id: string) => {
    const prompt = editorPrompt(card)
    const next = withEditorPrompt(card, { segments: prompt.segments?.filter(segment => segment.kind !== 'reference' || segment.binding_id !== id)
      .map(segment => segment.kind === 'instruction' ? { ...segment, references: segment.references?.filter(reference => reference.binding_id !== id) } : segment) }) as VideoModelCard
    onChange({ ...next, input_bindings: next.input_bindings?.filter(binding => binding.id !== id) })
  }
  return <section role="region" aria-label="视频实际输入">
    <small>连接只提供候选。明确采用用途；关键帧与同组媒体按下列顺序提交。视频保留原音轨，不自动取帧。</small>
    {loading && <p role="status">正在读取直接候选，实际绑定已保留</p>}
    {!capability && <p>选择模型并加载能力后可采用输入</p>}
    {candidates.map(output => {
      const key = sourceKey(output.source)
      const ports = output.modality === 'text' ? ['text'] : output.modality === 'image' ? ['first_frame', 'last_frame', 'key_frame', 'subject_image'] : output.modality === 'video' ? ['subject_video'] : []
      const supported = ports.filter(port => capability?.input_ports.includes(port))
      return <div key={key}>
        <strong>{output.token} · {output.available ? '候选' : '来源输出缺失'}</strong>
        <NamedImageSummary output={output} />
        {supported.some(port => port.startsWith('subject_')) && <Input aria-label={`主体分组 ${output.token}`} placeholder="明确填写主体分组名称" value={names[key] || ''}
          disabled={disabled} onChange={event => setNames({ ...names, [key]: event.target.value })} />}
        <Space wrap>{supported.map(port => {
          const subject_name = port.startsWith('subject_') ? (names[key] || '').trim() : undefined
          const selected = bindings.some(binding => sourceKey(binding.source) === key && binding.input_port === port && (binding.subject_name || '') === (subject_name || ''))
          return <WorkbenchButton key={port} size="small" disabled={disabled || loading || !output.available || selected || port.startsWith('subject_') && !subject_name}
            onClick={() => change([...bindings, { id: crypto.randomUUID(), source: output.source, input_port: port, subject_name }])}>采用 {output.token} 为{portLabels[port]}</WorkbenchButton>
        })}</Space>
        {!supported.length && <small>当前模型不支持此候选用途</small>}
      </div>
    })}
    {bindings.map((binding, index) => {
      const output = candidates.find(candidate => sourceKey(candidate.source) === sourceKey(binding.source))
      const label = output?.token || binding.source.card_id
      const move = (offset: number) => { const next = [...bindings]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; change(next) }
      return <div key={binding.id} data-input-binding-id={binding.id} tabIndex={-1}>
        <strong>{portLabels[binding.input_port]} · {label}</strong>
        {binding.input_port.startsWith('subject_') && <Input aria-label={`已采用主体分组 ${label}`} value={binding.subject_name || ''} disabled={disabled}
          onChange={event => change(bindings.map(value => value.id === binding.id ? { ...value, subject_name: event.target.value } : value))} />}
        {!loading && !output?.available && <small role="alert">来源输出缺失，请替换或取消采用</small>}
        <Space wrap>
          <WorkbenchButton size="small" disabled={disabled || index === 0} onClick={() => move(-1)}>前移{portLabels[binding.input_port]} {label}</WorkbenchButton>
          <WorkbenchButton size="small" disabled={disabled || index === bindings.length - 1} onClick={() => move(1)}>后移{portLabels[binding.input_port]} {label}</WorkbenchButton>
          <WorkbenchButton size="small" disabled={disabled} onClick={() => remove(binding.id)}>取消{portLabels[binding.input_port]} {label}</WorkbenchButton>
        </Space>
      </div>
    })}
  </section>
}
