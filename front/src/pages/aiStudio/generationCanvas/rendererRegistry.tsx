import type { ComponentType, ReactNode } from 'react'
import { Alert, Input, Select } from 'antd'
import type { CanvasDocument, CanvasModelCapability, ImageModelCard, ModelRead, TextContentCard, TextModelCard, VideoModelCard } from '../../../services/generated'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { PromptEditor } from './PromptEditor'
import { MediaContentEditor } from './MediaContentEditor'
import type { MediaCard } from './MediaContentEditor'
import { ImageModelParameters, VideoModelParameters } from './ModelParameters'
import type { GenerationCard } from './graphRules'

export type CardRendererProps = { card: GenerationCard; document: CanvasDocument; projectId: string; onChange: (card: GenerationCard) => void;
  models?: ModelRead[]; capability?: CanvasModelCapability; capabilityError?: string; references?: ReactNode; disabled?: boolean }

/** 模型卡共享受控 Composer 布局，参数由各模态组件表达。 */
function ModelRenderer({ card: raw, document, disabled, onChange, models, capability, capabilityError, references }: CardRendererProps) {
  const card = raw as TextModelCard | ImageModelCard | VideoModelCard
  const category = card.type?.split('.')[1]
  let parameters: ReactNode = <span>使用模型管理中的文本参数 · 仅接收文本</span>
  if (card.type === 'model.image') parameters = <ImageModelParameters card={card as ImageModelCard} capability={capability} onChange={onChange} />
  if (card.type === 'model.video') parameters = <VideoModelParameters card={card as VideoModelCard} capability={capability} onChange={onChange} />
  const config = card.config || {}
  const diagnostics: string[] = []
  if (capability && card.type === 'model.image') {
    const value = (card as ImageModelCard).config || {}
    if (value.target_ratio && !capability.ratios?.includes(value.target_ratio)) diagnostics.push('当前模型不支持已有图片画幅，配置已保留')
    if ((value.count ?? 1) < (capability.min_count ?? 1) || (value.count ?? 1) > (capability.max_count ?? 10)) diagnostics.push('图片数量超出模型范围，配置已保留')
    if (value.resolution_profile && value.target_ratio && !capability.resolution_profiles?.[value.target_ratio]?.[value.resolution_profile]) diagnostics.push('当前模型不支持已有分辨率，配置已保留')
  }
  if (capability && card.type === 'model.video') {
    const value = (card as VideoModelCard).config || {}
    if (!value.ratio) diagnostics.push('请选择视频画幅')
    else if (!capability.ratios?.includes(value.ratio)) diagnostics.push('当前模型不支持已有视频画幅，配置已保留')
    if (value.seconds != null && (value.seconds < (capability.min_seconds ?? 1) || capability.max_seconds != null && value.seconds > capability.max_seconds)) diagnostics.push('视频时长超出模型范围，配置已保留')
    if ('seed' in config && config.seed != null && !capability.supports_seed) diagnostics.push('当前模型不支持已有随机种子，配置已保留')
  }
  return <>
    {diagnostics.length > 0 && <Alert type="warning" message={<ul>{diagnostics.map(message => <li key={message}>{message}</li>)}</ul>} />}
    {capabilityError && <Alert type="warning" message={capabilityError} />}
    {card.model_id && !models?.some(model => model.id === card.model_id) && <Alert type="warning" message="已选模型当前不可用，原配置和连线已保留" />}
    <section aria-label="候选参考区">{references || <small>连接仅提供候选，正文或用途配置决定实际使用</small>}</section>
    <ExperimentComposer options={<><Select aria-label="选择模型" placeholder="选择模型" allowClear value={card.model_id || undefined} style={{ minWidth: 180 }}
      options={models?.filter(model => model.category === category).map(model => ({ value: model.id, label: model.name }))}
      onChange={id => onChange({ ...card, model_id: id ?? null })} />{parameters}</>}
      onSubmit={() => {}} submitDisabled submitLabel="运行尚未接入">
      <PromptEditor document={document} card={card} value={card.prompt || { segments: [] }} disabled={disabled} onChange={prompt => onChange({ ...card, prompt })} />
    </ExperimentComposer>
  </>
}

/** 显式类型入口，无供应商卡片族或通用表单引擎。 */
export const rendererRegistry: Record<string, ComponentType<CardRendererProps>> = {
  'content.text': ({ card: raw, onChange }) => {
    const card = raw as TextContentCard
    return <Input.TextArea aria-label="文本内容" value={card.text} rows={6} onChange={event => onChange({ ...card, text: event.target.value })} />
  },
  'content.image': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.video': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.audio': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'model.text': ModelRenderer,
  'model.image': ModelRenderer,
  'model.video': ModelRenderer,
}
