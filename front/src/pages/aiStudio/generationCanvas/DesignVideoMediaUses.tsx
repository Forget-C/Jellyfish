import { useState } from 'react'
import { Input, Space } from 'antd'
import type { CanvasModelCapability, CanvasResolvedOutput, DesignMediaUse, VideoModelCard } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'

/** 用途只配置接收方式；设计引用决定素材是否参与，不创建额外连线。 */
export function DesignVideoMediaUses({ card, output, label, capability, disabled, onChange }: {
  card: VideoModelCard; output: CanvasResolvedOutput; label: string; capability?: CanvasModelCapability; disabled?: boolean; onChange: (card: VideoModelCard) => void
}) {
  const { portLabels } = useGraphRules()
  const [name, setName] = useState('')
  const uses = card.design_media_uses || []
  const key = sourceKey(output.source)
  const direct = (card.input_bindings || []).filter(binding => sourceKey(binding.source) === key)
  const current = uses.filter(use => sourceKey(use.source) === key)
  const ports: DesignMediaUse['input_port'][] = output.modality === 'image' ? ['first_frame', 'last_frame', 'key_frame', 'subject_image'] : output.modality === 'video' ? ['subject_video'] : []
  const supported = ports.filter(port => capability?.input_ports.includes(port))
  const change = (design_media_uses: DesignMediaUse[]) => onChange({ ...card, design_media_uses })
  return <div role="region" aria-label={`携带素材用途 ${label}`}>
    {!current.length && !direct.length && <small role="alert">请选择视频用途；主体参考需明确填写分组</small>}
    {supported.some(port => port.startsWith('subject_')) && <Input aria-label={`携带素材新主体分组 ${label}`} placeholder="主体分组名称" value={name} disabled={disabled} onChange={event => setName(event.target.value)} />}
    <Space wrap>{supported.map(port => {
      const subject = port.startsWith('subject_') ? name.trim() : undefined
      const selected = [...direct, ...current].some(use => use.input_port === port && (use.subject_name || '').trim().toLocaleLowerCase() === (subject || '').toLocaleLowerCase())
      return <WorkbenchButton key={port} size="small" disabled={disabled || !output.available || selected || port.startsWith('subject_') && !subject} onClick={() => change([...uses, { id: crypto.randomUUID(), source: output.source, input_port: port, subject_name: subject }])}>设置 {label} 为{portLabels[port]}</WorkbenchButton>
    })}</Space>
    {!supported.length && <small>当前模型不支持此素材的用途</small>}
    {direct.map(binding => <small key={binding.id}>沿用直接采用：{portLabels[binding.input_port]} {binding.subject_name}</small>)}
    {current.map(use => {
      const index = uses.indexOf(use)
      const move = (offset: number) => { const next = [...uses]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; change(next) }
      return <div key={use.id} data-design-media-use-id={use.id} tabIndex={-1}>
        <strong>{portLabels[use.input_port]}</strong>
        {use.input_port.startsWith('subject_') && <Input aria-label={`携带素材主体分组 ${label}`} value={use.subject_name || ''} disabled={disabled} onChange={event => change(uses.map(value => value.id === use.id ? { ...value, subject_name: event.target.value } : value))} />}
        {!supported.includes(use.input_port) && <small role="alert">当前模型不支持已保存的用途，请调整</small>}
        <Space wrap><WorkbenchButton size="small" disabled={disabled || index === 0} onClick={() => move(-1)}>前移携带用途 {label}</WorkbenchButton><WorkbenchButton size="small" disabled={disabled || index === uses.length - 1} onClick={() => move(1)}>后移携带用途 {label}</WorkbenchButton><WorkbenchButton size="small" disabled={disabled} onClick={() => change(uses.filter(value => value.id !== use.id))}>移除携带用途 {portLabels[use.input_port]} {label}</WorkbenchButton></Space>
      </div>
    })}
  </div>
}
