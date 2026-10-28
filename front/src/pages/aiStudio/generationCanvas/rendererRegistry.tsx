import type { ComponentType, ReactNode } from 'react'
import { Alert, Button, Select, Space } from 'antd'
import type { CanvasDocument, CanvasModelCapability, CanvasNodeRead, CanvasResolvedOutput, CreativeBasisCard, ImageModelCard, ModelRead, ObjectDescriptionCard, PlaceDescriptionCard, TextContentCard, TextModelCard, VideoModelCard } from '../../../services/generated'
import { ExperimentComposer } from '../experiment/components/ExperimentComposer'
import { PromptEditor } from './PromptEditor'
import { editorPrompt, withEditorPrompt, withoutInputBinding } from './inputBindings'
import { useCardCandidates } from './useCardCandidates'
import { NamedImageReferenceEditor } from './NamedImageReferenceEditor'
import { ObjectDescriptionEditor } from './ObjectDescriptionEditor'
import { TextContentEditor } from './TextContentEditor'
import { MediaContentEditor, MediaPreview } from './MediaContentEditor'
import { MediaResultsPreview } from './MediaResultsPreview'
import type { MediaCard } from './MediaContentEditor'
import { ImageModelParameters, VideoModelParameters } from './ModelParameters'
import type { GenerationCard } from './graphRules'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { sourceKey } from './promptRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { activeNode } from './useGenerationCanvasRuntime'

export type CardRendererProps = { savedRevision?: number; savedCard?: GenerationCard; card: GenerationCard; document: CanvasDocument; projectId: string; onChange: (card: GenerationCard) => void;
  models?: ModelRead[]; capability?: CanvasModelCapability; capabilityError?: string; references?: ReactNode; disabled?: boolean; modelOutputs?: Record<string, CanvasResolvedOutput[]>; node?: CanvasNodeRead; busy?: boolean; checking?: boolean; runDisabled?: boolean; onPrecheck?: () => void; onTargetPrecheck?: () => void }

/** 模型卡共享受控 Composer 布局，参数由各模态组件表达。 */
function ModelRenderer({ card: raw, savedRevision, savedCard, document, disabled, onChange, models, capability, capabilityError, references, modelOutputs, node, busy, checking, runDisabled, onPrecheck, onTargetPrecheck }: CardRendererProps) {
  const card = raw as TextModelCard | ImageModelCard | VideoModelCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs)
  const savedBindings = savedCard && 'input_bindings' in savedCard ? savedCard.input_bindings || [] : []
  const formalOutputs = resolved.loading ? modelOutputs?.[card.id] || [] : resolved.outputs
  const category = card.type?.split('.')[1]
  let parameters: ReactNode = <span>使用模型管理中的文本参数 · 仅接收文本</span>
  if (card.type === 'model.image') parameters = <ImageModelParameters card={card as ImageModelCard} capability={capability} onChange={onChange} />
  if (card.type === 'model.video') parameters = <VideoModelParameters card={card as VideoModelCard} capability={capability} onChange={onChange} />
  const bindings = card.input_bindings || []
  const adoptedImages = resolved.candidates.filter(output => output.modality === 'image' && bindings.some(binding => sourceKey(binding.source) === sourceKey(output.source)))
  const move = (id: string, offset: number) => {
    const next = [...bindings], index = next.findIndex(binding => binding.id === id), target = index + offset
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ ...card, input_bindings: next })
  }
  const config = card.config || {}
  const diagnostics: string[] = []
  if (capability && card.type === 'model.image') {
    const value = (card as ImageModelCard).config || {}
    if (capability.max_reference_images !== null && capability.max_reference_images !== undefined && adoptedImages.length > capability.max_reference_images) diagnostics.push('实际提交图片数量超出模型允许范围')
    if (!capability.supports_duplicate_reference_images && new Set(adoptedImages.map(output => output.file_id)).size < adoptedImages.length) diagnostics.push('当前模型不支持不同来源使用同一图片文件')
    if (value.target_ratio && !capability.ratios?.includes(value.target_ratio)) diagnostics.push('当前模型不支持已有图片画幅，配置已保留')
    if ((value.count ?? 1) < (capability.min_count ?? 1) || (value.count ?? 1) > (capability.max_count ?? 10)) diagnostics.push('图片数量超出模型范围，配置已保留')
    if (value.resolution_profile && value.target_ratio && !capability.resolution_profiles?.[value.target_ratio]?.[value.resolution_profile]) diagnostics.push('当前模型不支持已有分辨率，配置已保留')
  }
  if (capability && card.type === 'model.video') {
    const value = (card as VideoModelCard).config || {}
    if (!value.ratio) diagnostics.push('请选择视频画幅')
    else if (!capability.ratios?.includes(value.ratio)) diagnostics.push('当前模型不支持已有视频画幅，配置已保留')
    if (value.seconds !== undefined && value.seconds !== null && (value.seconds < (capability.min_seconds ?? 1) || capability.max_seconds !== undefined && capability.max_seconds !== null && value.seconds > capability.max_seconds)) diagnostics.push('视频时长超出模型范围，配置已保留')
    if ('seed' in config && config.seed !== undefined && config.seed !== null && !capability.supports_seed) diagnostics.push('当前模型不支持已有随机种子，配置已保留')
  }
  return <>
    {diagnostics.length > 0 && <Alert type="warning" message={<ul>{diagnostics.map(message => <li key={message}>{message}</li>)}</ul>} />}
    {capabilityError && <Alert type="warning" message={capabilityError} />}
    {card.model_id && !models?.some(model => model.id === card.model_id) && <Alert type="warning" message="已选模型当前不可用，原配置和连线已保留" />}
    <section aria-label="候选参考区">{references || <small>连接仅提供候选，正文或用途配置决定实际使用</small>}</section>
    <section role="region" aria-label="已保存直接输入">
      <small>已保存 revision {resolved.revision ?? savedRevision} · 本地修改保存后更新</small>
      {card.type === 'model.image' && <p>文本依据与参考图片分别采用；采用顺序决定图片提交顺序。当前输出位置随新结果更新，固定图片请在运行历史中明确另存。</p>}
      {card.type === 'model.image' && capability && <small>参考图片上限：{capability.max_reference_images ?? '未声明'} · {capability.supports_duplicate_reference_images ? '允许重复图片文件' : '不允许重复图片文件'}</small>}
      {!resolved.loading && resolved.candidates.map(output => {
        const binding = bindings.find(value => sourceKey(value.source) === sourceKey(output.source))
        const index = binding ? bindings.indexOf(binding) : -1
        return <div key={sourceKey(output.source)}>
          <strong>{output.token} · {savedBindings.some(value => sourceKey(value.source) === sourceKey(output.source)) ? '已采用' : '候选'}</strong>
          {output.available === false ? <small>来源输出缺失</small> : output.modality === 'text'
            ? <CanvasTextPreview text={output.text || ''} label="已保存来源" /> : <small>{output.modality} · {output.file_id}</small>}
          {output.basis_current === false && <small>依据已变，需重新生成来源</small>}
          {card.type === 'model.image' && output.modality === 'image' && output.available !== false && output.file_id && <details><summary>预览 {output.token}</summary><MediaPreview fileId={output.file_id} type="image" /></details>}
          {card.type === 'model.image' && ['text', 'image'].includes(output.modality) && <Space wrap>
            <WorkbenchButton disabled={disabled || !binding && (output.available === false || !capability?.input_ports?.includes(output.modality))}
              onClick={() => onChange(binding ? withoutInputBinding(card, binding.id) : { ...card, input_bindings: [...bindings, { id: crypto.randomUUID(), input_port: output.modality, source: output.source }] })}>
              {`${binding ? '取消采用' : '采用'} ${output.token}`}
            </WorkbenchButton>
            {binding && <><span>采用顺序 {index + 1}</span>
              <WorkbenchButton aria-label={`前移 ${output.token}`} disabled={disabled || index === 0} onClick={() => move(binding.id, -1)}>前移</WorkbenchButton>
              <WorkbenchButton aria-label={`后移 ${output.token}`} disabled={disabled || index === bindings.length - 1} onClick={() => move(binding.id, 1)}>后移</WorkbenchButton></>}
          </Space>}
        </div>
      })}
      {(resolved.compiled?.diagnostics || []).map((diagnostic, index) => <Alert key={`${diagnostic.code}:${index}`} type={diagnostic.severity === 'warning' ? 'warning' : 'error'}
        message={`${diagnostic.code}: ${diagnostic.message}`} />)}
    </section>
    <Button disabled={disabled || busy || runDisabled} onClick={() => onTargetPrecheck?.()}>运行到此处</Button>
    <ExperimentComposer options={<><Select aria-label="选择模型" placeholder="选择模型" allowClear value={card.model_id || undefined} style={{ minWidth: 180 }}
      options={models?.filter(model => model.category === category).map(model => ({ value: model.id, label: model.name }))}
      onChange={id => onChange({ ...card, model_id: id ?? null })} />{parameters}</>}
      onSubmit={() => onPrecheck?.()} submitting={checking} submitDisabled={disabled || busy || runDisabled} submitLabel={busy ? '运行中' : '预检运行'}>
      {resolved.loading && <small role="status">正在读取直接候选</small>}
      {resolved.error && <Alert type="warning" message={resolved.error} />}
      <PromptEditor document={document} card={card} value={editorPrompt(card)} candidates={resolved.candidates.map(item => ({ source: item.source, token: item.token || '', available: item.available !== false }))} disabled={disabled} onChange={prompt => onChange(withEditorPrompt(card, prompt))} />
    </ExperimentComposer>
    {node && <section aria-label="本次运行" data-run-id={node.run_id}>
      <p role="status">{({ waiting: '等待上游', queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败 · 未完成', cancelled: '已取消 · 未完成', blocked: '已阻止 · 未完成' } as Record<string, string>)[node.status] || node.status} · {({ queued: '等待执行', generating: '生成中', archiving: '归档中', cancelling: '取消中，等待任务终态', finished: '已结束' } as Record<string, string>)[node.stage] || node.stage}{node.progress !== undefined && node.progress !== null && ` · ${node.progress}%`}</p>
      {node.text && <div role="region" aria-label="运行正文"><CanvasTextPreview text={node.text} label="生成正文" /></div>}
      {node.error_message && <Alert type="error" message={`${node.error_code || '运行失败'}: ${node.error_message}`} />}
      {node.status === 'succeeded' && !node.current_output_updated && <small>配置已改变，结果保留在本次运行，未替换当前输出</small>}
      {!activeNode(node) && node.status !== 'succeeded' && node.text && <small>未完成正文保留；未成为正式输出</small>}
    </section>}
    {formalOutputs.length > 0 && <section aria-label="当前正式输出">{card.type === 'model.text'
      ? formalOutputs.map(output => <div key={output.source.position}><CanvasTextPreview text={output.text || ''} label="正式输出" />{output.basis_current === false && <small>依据已变，旧正式输出仍保留</small>}</div>)
      : <MediaResultsPreview outputs={formalOutputs} />}</section>}
  </>
}

/** 显式类型入口，无供应商卡片族或通用表单引擎。 */
export const rendererRegistry: Record<string, ComponentType<CardRendererProps>> = {
  'reference.character': NamedImageReferenceEditor,
  'reference.place': NamedImageReferenceEditor,
  'reference.prop': NamedImageReferenceEditor,
  'reference.costume': NamedImageReferenceEditor,
  'content.text': ({ card, onChange, disabled }) => <TextContentEditor card={card as TextContentCard} onChange={onChange} disabled={disabled} />,
  'content.object': ({ card, onChange, disabled }) => <ObjectDescriptionEditor card={card as ObjectDescriptionCard} onChange={onChange} disabled={disabled} />,
  'content.place': ({ card, onChange, disabled }) => <ObjectDescriptionEditor card={card as PlaceDescriptionCard} onChange={onChange} disabled={disabled} />,
  'content.basis': ({ card, onChange, disabled }) => <TextContentEditor card={card as CreativeBasisCard} onChange={onChange} disabled={disabled} />,
  'content.image': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.video': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'content.audio': ({ card, onChange, projectId, disabled }) => <MediaContentEditor card={card as MediaCard} projectId={projectId} onChange={onChange} disabled={disabled} />,
  'model.text': ModelRenderer,
  'model.image': ModelRenderer,
  'model.video': ModelRenderer,
}
