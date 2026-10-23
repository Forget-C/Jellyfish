import type { ComponentType, ReactNode } from 'react'
import { Alert, Input, Select } from 'antd'
import type { CanvasDocument, CanvasModelCapability, ImageModelCard, ModelRead, TextContentCard, TextModelCard, VideoModelCard } from '../../../services/generated'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { ImageModelParameters, VideoModelParameters } from './ModelParameters'
import type { GenerationCard } from './graphRules'

export type CardRendererProps = { card: GenerationCard; document: CanvasDocument; projectId: string; onChange: (card: GenerationCard) => void;
  models?: ModelRead[]; capability?: CanvasModelCapability; capabilityError?: string; references?: ReactNode; disabled?: boolean }

/** 模型卡共享受控 Composer 布局，参数由各模态组件表达。 */
function ModelRenderer({ card: raw, onChange, models, capability, capabilityError, references }: CardRendererProps) {
  const card = raw as TextModelCard | ImageModelCard | VideoModelCard
  const category = card.type?.split('.')[1]
  let parameters: ReactNode = <span>使用模型管理中的文本参数 · 仅接收文本</span>
  if (card.type === 'model.image') parameters = <ImageModelParameters card={card as ImageModelCard} capability={capability} onChange={onChange} />
  if (card.type === 'model.video') parameters = <VideoModelParameters card={card as VideoModelCard} capability={capability} onChange={onChange} />
  return <>
    {capabilityError && <Alert type="warning" message={capabilityError} />}
    {card.model_id && !models?.some(model => model.id === card.model_id) && <Alert type="warning" message="已选模型当前不可用，原配置和连线已保留" />}
    <section aria-label="候选参考区">{references || <small>连接仅提供候选，正文或用途配置决定实际使用</small>}</section>
    <ExperimentComposer options={<><Select aria-label="选择模型" placeholder="选择模型" allowClear value={card.model_id || undefined} style={{ minWidth: 180 }}
      options={models?.filter(model => model.category === category).map(model => ({ value: model.id, label: model.name }))}
      onChange={id => onChange({ ...card, model_id: id ?? null })} />{parameters}</>}
      onSubmit={() => {}} submitDisabled submitLabel="运行尚未接入">
      <Input.TextArea aria-label="模型正文" rows={5} value={card.prompt} onChange={event => onChange({ ...card, prompt: event.target.value })} />
    </ExperimentComposer>
  </>
}

/** 显式类型入口，无供应商卡片族或通用表单引擎。 */
export const rendererRegistry: Record<string, ComponentType<CardRendererProps>> = {
  'content.text': ({ card: raw, onChange }) => {
    const card = raw as TextContentCard
    return <Input.TextArea aria-label="文本内容" value={card.text} rows={6} onChange={event => onChange({ ...card, text: event.target.value })} />
  },
  'model.text': ModelRenderer,
  'model.image': ModelRenderer,
  'model.video': ModelRenderer,
}
