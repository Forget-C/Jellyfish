import { useUiText } from '../../../uiText'
import { InputBindingReferences } from './InputBindingReferences'
import { NamedImageSummary } from './NamedImageSummary'
import { useState } from 'react'
import { Input, Space } from 'antd'
import type { CanvasDocument, CanvasModelCapability, CanvasResolvedOutput, InputBinding, VideoModelCard } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { bindingReferences, withoutInputBinding } from './inputBindings'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'

/** 直接候选只在明确选择用途和主体后采用；所有实际顺序及分组保存在绑定中。 */
export function VideoInputBindings({ document, card, candidates, labels, capability, loading, disabled, onChange, sourceOnly, onLocate }: {
  document: CanvasDocument; sourceOnly?: Set<string>; onLocate?: () => void; card: VideoModelCard; candidates: CanvasResolvedOutput[]; labels: Map<string, string>; capability?: CanvasModelCapability; loading?: boolean; disabled?: boolean; onChange: (card: VideoModelCard) => void
}) {
  const uiText = useUiText()
  const { portLabels, cardDefinitions, candidatePorts } = useGraphRules()
  const [names, setNames] = useState<Record<string, string>>({})
  const bindings = card.input_bindings || []
  const change = (input_bindings: InputBinding[]) => onChange({ ...card, input_bindings })
  const remove = (id: string) => onChange(withoutInputBinding(card, id) as VideoModelCard)
  return <section role="region" aria-label={uiText("视频实际输入")}>
    <small>{uiText("素材连接提供候选，需明确采用用途；关键帧与同组媒体按下列顺序提交。视频保留原音轨，不自动取帧。")}</small>
    {loading && <p role="status">{uiText("正在读取直接候选，实际绑定已保留")}</p>}
    {!capability && <p>{uiText("选择模型并加载能力后可采用输入")}</p>}
    {candidates.map(output => {
      const key = sourceKey(output.source)
      const label = labels.get(key) || output.token
      const supported = candidatePorts(document, output.source, card.id, capability)
      return <div key={key}>
        <strong>{label} · {output.available ? uiText("候选") : uiText("来源输出缺失")}</strong>
        <NamedImageSummary output={output} displayLabel={label} />
        {supported.some(port => port.startsWith('subject_')) && <Input aria-label={uiText("主体分组 {{label}}", { label })} placeholder={uiText("明确填写主体分组名称")} value={names[key] || ''}
          disabled={disabled} onChange={event => setNames({ ...names, [key]: event.target.value })} />}
        <Space wrap>{supported.map(port => {
          const subject_name = port.startsWith('subject_') ? (names[key] || '').trim() : undefined
          const selected = bindings.some(binding => sourceKey(binding.source) === key && binding.input_port === port && (binding.subject_name || '') === (subject_name || ''))
          const single = cardDefinitions[card.type || '']?.inputs.some(input => input.id === port && input.max_sources === 1)
          const prior = single ? bindings.filter(binding => binding.input_port === port) : []
          const protectedBinding = prior.find(binding => bindingReferences(card, binding.id).length)
          return <div key={port}><WorkbenchButton size="small" disabled={disabled || loading || !output.available || selected || !!protectedBinding || port.startsWith('subject_') && !subject_name}
            onClick={() => change([...bindings.filter(binding => !prior.includes(binding)), { id: crypto.randomUUID(), prompt_owned: false, source: output.source, input_port: port, subject_name }])}>{prior.length && !selected ? uiText("替换{{value1}}为 {{label}}", { value1: uiText(portLabels[port]), label }) : uiText("采用 {{label}} 为{{value2}}", { label, value2: uiText(portLabels[port]) })}</WorkbenchButton>
            {protectedBinding && !selected && <InputBindingReferences card={card} bindingId={protectedBinding.id} onLocate={onLocate} />}
          </div>
        })}</Space>
        {!supported.length && <small>{uiText("当前模型不支持此候选用途")}</small>}
      </div>
    })}
    {bindings.map((binding, index) => {
      if (sourceOnly && !sourceOnly.has(sourceKey(binding.source))) return null
      const output = candidates.find(candidate => sourceKey(candidate.source) === sourceKey(binding.source))
      const label = labels.get(sourceKey(binding.source)) || output?.token || binding.source.card_id
      const protectedReference = bindingReferences(card, binding.id).length > 0
      const move = (offset: number) => { const next = [...bindings]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; change(next) }
      return <div key={binding.id} data-input-binding-id={binding.id} tabIndex={-1}>
        <strong>{uiText(portLabels[binding.input_port])} · {label}</strong>
        {binding.input_port.startsWith('subject_') && <Input aria-label={uiText("已采用主体分组 {{label}}", { label })} value={binding.subject_name || ''} disabled={disabled}
          onChange={event => change(bindings.map(value => value.id === binding.id ? { ...value, subject_name: event.target.value } : value))} />}
        {capability && !capability.input_ports.includes(binding.input_port) && <small role="alert">{uiText("当前模型不支持此用途，已保留采用")}</small>}
        {!loading && !output?.available && <small role="alert">{uiText("来源输出缺失，请替换或取消采用")}</small>}
        <Space wrap>
          <WorkbenchButton size="small" disabled={disabled || index === 0} onClick={() => move(-1)}>{uiText("前移")}{uiText(portLabels[binding.input_port])} {label}</WorkbenchButton>
          <WorkbenchButton size="small" disabled={disabled || index === bindings.length - 1} onClick={() => move(1)}>{uiText("后移")}{uiText(portLabels[binding.input_port])} {label}</WorkbenchButton>
          <WorkbenchButton size="small" title={protectedReference ? uiText("请先清理正文引用再解除关联") : undefined} disabled={disabled || protectedReference} onClick={() => remove(binding.id)}>{uiText("取消")}{uiText(portLabels[binding.input_port])} {label}</WorkbenchButton>
          <InputBindingReferences card={card} bindingId={binding.id} onLocate={onLocate} />
        </Space>
      </div>
    })}
  </section>
}
