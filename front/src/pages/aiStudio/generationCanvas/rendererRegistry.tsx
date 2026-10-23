import type { ComponentType, ReactNode } from 'react'
import { Alert, Input, Select } from 'antd'
import type { CanvasDocument, CanvasModelCapability, CanvasNodeRead, CanvasResolvedOutput, ImageModelCard, ModelRead, TextContentCard, TextModelCard, VideoModelCard } from '../../../services/generated'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { PromptEditor } from './PromptEditor'
import { MediaContentEditor } from './MediaContentEditor'
import type { MediaCard } from './MediaContentEditor'
import { ImageModelParameters, VideoModelParameters } from './ModelParameters'
import type { GenerationCard } from './graphRules'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { activeNode } from './useGenerationCanvasRuntime'

export type CardRendererProps = { card: GenerationCard; document: CanvasDocument; projectId: string; onChange: (card: GenerationCard) => void;
  models?: ModelRead[]; capability?: CanvasModelCapability; capabilityError?: string; references?: ReactNode; disabled?: boolean; modelOutputs?: Record<string, CanvasResolvedOutput[]>; node?: CanvasNodeRead; busy?: boolean; checking?: boolean; runDisabled?: boolean; onPrecheck?: () => void }

/** 模型卡共享受控 Composer 布局，参数由各模态组件表达。 */
function ModelRenderer({ card: raw, document, disabled, onChange, models, capability, capabilityError, references, modelOutputs, node, busy, checking, runDisabled, onPrecheck }: CardRendererProps) {
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
      onSubmit={() => onPrecheck?.()} submitting={checking} submitDisabled={disabled || busy || runDisabled || card.type !== 'model.text'} submitLabel={busy ? '运行中' : '预检运行'}>
      <PromptEditor document={document} card={card} value={card.prompt || { segments: [] }} modelOutputs={modelOutputs} disabled={disabled} onChange={prompt => onChange({ ...card, prompt })} />
    </ExperimentComposer>
    {card.type !== 'model.text' && <small>该模态执行尚未接入</small>}
    {node && <section aria-label="本次运行" data-run-id={node.run_id}>
      <p role="status">{({ waiting: '等待上游', queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败 · 未完成', cancelled: '已取消 · 未完成', blocked: '已阻止 · 未完成' } as Record<string, string>)[node.status] || node.status} · {({ queued: '等待执行', generating: '生成中', archiving: '归档中', cancelling: '取消中，等待任务终态', finished: '已结束' } as Record<string, string>)[node.stage] || node.stage}{node.progress != null && ` · ${node.progress}%`}</p>
      {node.text && <div role="region" aria-label="运行正文"><CanvasTextPreview text={node.text} label="生成正文" /></div>}
      {node.error_message && <Alert type="error" message={`${node.error_code || '运行失败'}: ${node.error_message}`} />}
      {node.status === 'succeeded' && !node.current_output_updated && <small>配置已改变，结果保留在本次运行，未替换当前输出</small>}
      {!activeNode(node) && node.status !== 'succeeded' && node.text && <small>未完成正文保留；未成为正式输出</small>}
    </section>}
    {(modelOutputs?.[card.id] || []).length > 0 && <section aria-label="当前正式输出">{modelOutputs![card.id].map(output => <div key={output.source.position}><CanvasTextPreview text={output.text || ''} label="正式输出" />{output.basis_current === false && <small>依据已变，旧正式输出仍保留</small>}</div>)}</section>}
  </>
}

/** 显式类型入口，无供应商卡片族或通用表单引擎。 */
export const rendererRegistry: Record<string, ComponentType<CardRendererProps>> = {
  'content.text': ({ card: raw, onChange }) => {
    const card = raw as TextContentCard
    return <>{card.origin && <p>来自运行 {card.origin.run_id} · {card.origin.incomplete ? '未完成成果副本' : '完整成果副本'}</p>}
      <Input.TextArea aria-label="文本内容" value={card.text} rows={6} onChange={event => onChange({ ...card, text: event.target.value })} /></>
  },
  'content.image': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.video': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.audio': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'model.text': ModelRenderer,
  'model.image': ModelRenderer,
  'model.video': ModelRenderer,
}
