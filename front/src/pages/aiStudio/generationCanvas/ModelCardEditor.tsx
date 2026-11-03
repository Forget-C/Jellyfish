import { MaterialReferenceButton } from './MaterialReferenceButton'
import { Alert, Select, Space } from 'antd'
import { ArrowUpOutlined } from '@ant-design/icons'
import type { CanvasResolvedOutput, ImageModelCard, TextModelCard, VideoModelCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useGraphRules } from './CanvasCatalogContext'
import { PhotographyInputScope } from './PhotographyInputScope'
import { NamedImageSummary } from './NamedImageSummary'
import { VideoInputBindings } from './VideoInputBindings'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor'
import { editorPrompt, withEditorPrompt, withoutInputBinding } from './inputBindings'
import { useCardCandidates } from './useCardCandidates'
import { MediaPreview } from './MediaContentEditor'
import { MediaResultsPreview } from './MediaResultsPreview'
import { ImageModelParameters, VideoModelParameters } from './ModelParameters'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { sourceKey } from './promptRules'
import { referenceLabels } from './referenceLabels'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { activeNode, canvasNodeStatusLabels } from './useGenerationCanvasRuntime'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CardComposer } from './CardComposer'
import './materialComposer.css'

/** 模型卡共享受控 Composer 布局，参数由各模态组件表达。 */
export function ModelRenderer({ card: raw, savedRevision, document, disabled, onChange, models, capability, capabilityError, references, modelOutputs, node, busy, checking, runDisabled, onPrecheck, sourceActions, defaultModelId }: CardRendererProps) {
  const promptEditor = useRef<PromptEditorHandle>(null)
  const management = useRef<HTMLDetailsElement>(null)
  const [referenceTools, setReferenceTools] = useState<HTMLDivElement | null>(null)
  const card = raw as TextModelCard | ImageModelCard | VideoModelCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs)
  const { cardTitles } = useGraphRules()
  const adopted = card.input_bindings || []
  const formalOutputs = resolved.loading ? modelOutputs?.[card.id] || [] : resolved.outputs
  const category = card.type?.split('.')[1]
  useEffect(() => {
    if (disabled) return
    if (!card.model_id && defaultModelId && models?.some(model => model.id === defaultModelId && model.category === category)) { onChange({ ...card, model_id: defaultModelId }); return }
    if (card.type === 'model.video' && !(card as VideoModelCard).config?.ratio && capability?.ratios?.length) onChange({ ...card, config: { ...card.config, ratio: capability.ratios.includes('16:9') ? '16:9' : capability.ratios[0] } })
  }, [capability, card, category, defaultModelId, disabled, models, onChange])
  let parameters: ReactNode = null
  if (card.type === 'model.image') parameters = <ImageModelParameters card={card as ImageModelCard} capability={capability} disabled={disabled} onChange={onChange} />
  if (card.type === 'model.video') parameters = <VideoModelParameters card={card as VideoModelCard} capability={capability} disabled={disabled} onChange={onChange} />
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
  const labelFor = (output: CanvasResolvedOutput) => {
    const source = output.source.canvas_id === document.id ? document.cards?.find(item => item.id === output.source.card_id) : undefined
    const name = source && ('name' in source ? source.name : undefined)
    const named = output.payload?.kind === 'named_image' && 'objects' in output.payload ? output.payload.objects?.map(object => object.name).join('、') : ''
    return name || named || cardTitles[source?.type || ''] || output.token || '来源'
  }
  const candidateIssue = (output: CanvasResolvedOutput) => {
    if (output.source.canvas_id !== document.id) return '来源属于其他画布'
    const source = document.cards?.find(item => item.id === output.source.card_id)
    if (!source || !(document.edges || []).some(edge => edge.target_card === card.id && edge.source_card === source.id && edge.source_port === output.source.port_id)) return '来源未连接'
    if (output.available === false) return '来源输出缺失'
    if (!capability?.input_ports?.includes(output.modality)) return '当前模型不支持此输入'
    if ('uploading' in source && source.uploading) return '上传中'
    if ('file_id' in source && source.file_id !== output.file_id) return '正在更新候选'
    if (output.basis_current === false) return '来源依据已变，需重新生成'
    return undefined
  }
  // 保存刷新期间仍展示已采用但暂未解析的来源，不将缺失来源误报为新候选。
  const sources: CanvasResolvedOutput[] = [...resolved.candidates]
  for (const binding of adopted) if (!sources.some(output => sourceKey(output.source) === sourceKey(binding.source))) sources.push({ source: binding.source, modality: 'text', available: false })
  const labels = referenceLabels(document, sources, card.id)
  const displayLabel = (output: CanvasResolvedOutput) => labels.get(sourceKey(output.source)) || output.token || '来源'
  const inspectSource = (output: CanvasResolvedOutput) => {
    if (!management.current) return
    management.current.open = true
    requestAnimationFrame(() => management.current?.querySelector<HTMLElement>(`[data-reference-source="${CSS.escape(sourceKey(output.source))}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
  const hasInput = adopted.length > 0 || (editorPrompt(card).segments || []).some(segment => segment.kind !== 'text' || segment.text?.trim())
  const submitDisabled = !!(disabled || busy || checking || runDisabled || !hasInput)
  const submit = () => { if (!submitDisabled) onPrecheck?.() }
  const modelParameters = <><Select className="generation-material-model" title={models?.find(model => model.id === card.model_id)?.name} size="small" bordered={false} aria-label="选择模型" placeholder="选择模型" disabled={disabled} value={card.model_id || undefined}
      options={models?.filter(model => model.category === category).map(model => ({ value: model.id, label: model.name }))}
      onChange={id => onChange({ ...card, model_id: id })} />{parameters}</>
  const status = <><details ref={management} className="generation-material-candidates"><summary aria-label="管理候选与采用" title="管理候选与采用">关联 {sources.length} · 已采用 {adopted.length}</summary>
    <div ref={setReferenceTools} />
    <section aria-label="候选参考区">{references}</section>
    <section role="region" aria-label="已保存直接输入">
      <small>已保存 revision {resolved.revision ?? savedRevision} · 本地修改保存后更新</small>
      {card.type === 'model.image' && capability && <small>参考图片上限：{capability.max_reference_images ?? '未声明'} · {capability.supports_duplicate_reference_images ? '允许重复图片文件' : '不允许重复图片文件'}</small>}
      {sources.map(output => {
        const binding = bindings.find(value => sourceKey(value.source) === sourceKey(output.source))
        const index = binding ? bindings.indexOf(binding) : -1
        return <div key={sourceKey(output.source)} data-reference-source={sourceKey(output.source)}>
          <strong>{displayLabel(output)} · {binding ? '已采用' : '候选'}</strong>
          {output.available === false ? <small>来源输出缺失</small> : output.modality === 'text'
            ? <CanvasTextPreview text={output.text || ''} label="已保存来源" /> : <small>{output.modality} · {output.file_id}</small>}
          <NamedImageSummary output={output} displayLabel={displayLabel(output)} />
          <PhotographyInputScope card={card} output={output} binding={binding} onChange={onChange} disabled={disabled} />
          {output.basis_current === false && <small>依据已变，需重新生成来源</small>}
          {card.type === 'model.image' && output.modality === 'image' && output.available !== false && output.file_id && <details><summary>预览 {displayLabel(output)}</summary><MediaPreview fileId={output.file_id} type="image" /></details>}
          {card.type !== 'model.video' && ['text', 'image'].includes(output.modality) && <Space wrap>
            <WorkbenchButton disabled={disabled || !binding && (resolved.loading || output.available === false || !capability?.input_ports?.includes(output.modality))}
              onClick={() => onChange(binding ? withoutInputBinding(card, binding.id) : { ...card, input_bindings: [...bindings, { id: crypto.randomUUID(), input_port: output.modality, source: output.source }] })}>
              {`${binding ? '取消采用' : '采用'} ${displayLabel(output)}`}
            </WorkbenchButton>
            {binding && <><span>采用顺序 {index + 1}</span>
              <WorkbenchButton aria-label={`前移 ${displayLabel(output)}`} disabled={disabled || index === 0} onClick={() => move(binding.id, -1)}>前移</WorkbenchButton>
              <WorkbenchButton aria-label={`后移 ${displayLabel(output)}`} disabled={disabled || index === bindings.length - 1} onClick={() => move(binding.id, 1)}>后移</WorkbenchButton></>}
          </Space>}
        </div>
      })}
      {(resolved.compiled?.diagnostics || []).map((diagnostic, index) => <Alert key={`${diagnostic.code}:${index}`} type={diagnostic.severity === 'warning' ? 'warning' : 'error'}
        message={`${diagnostic.code}: ${diagnostic.message}`} />)}
    </section>
    {card.type !== 'model.image' && resolved.candidates.map(output => <PhotographyInputScope key={sourceKey(output.source)} card={card} output={output} binding={bindings.find(value => sourceKey(value.source) === sourceKey(output.source))} onChange={onChange} disabled={disabled} />)}
    {card.type === 'model.video' && <VideoInputBindings labels={labels} card={card as VideoModelCard} candidates={resolved.candidates} loading={resolved.loading} capability={capability} disabled={disabled} onChange={onChange} />}
    <details className="generation-material-results"><summary>运行状态与正式输出</summary>

    {node && <section aria-label="本次运行" data-run-id={node.run_id}>
      <p role="status">{canvasNodeStatusLabels[node.status] || node.status} · {({ queued: '等待执行', generating: '生成中', archiving: '归档中', cancelling: '取消中，等待任务终态', finished: '已结束' } as Record<string, string>)[node.stage] || node.stage}{node.progress !== undefined && node.progress !== null && ` · ${node.progress}%`}</p>
      {node.text && <div role="region" aria-label="运行正文"><CanvasTextPreview text={node.text} label="生成正文" /></div>}
      {node.error_message && <Alert type="error" message={`${node.error_code || '运行失败'}: ${node.error_message}`} />}
      {node.status === 'succeeded' && !node.current_output_updated && <small>配置已改变，结果保留在本次运行，未替换当前输出</small>}
      {!activeNode(node) && node.status !== 'succeeded' && node.text && <small>未完成正文保留；未成为正式输出</small>}
    </section>}
    {formalOutputs.length > 0 && <section aria-label="当前正式输出">{card.type === 'model.text'
      ? formalOutputs.map(output => <div key={output.source.position}><CanvasTextPreview text={output.text || ''} label="正式输出" />{output.basis_current === false && <small>依据已变，旧正式输出仍保留</small>}</div>)
      : <MediaResultsPreview outputs={formalOutputs} />}</section>}
    </details>
    </details>{node && <span className="generation-material-runtime" role="status">{canvasNodeStatusLabels[node.status] || node.status}{typeof node.progress === 'number' ? ` ${node.progress}%` : ''}</span>}</>
  const associations = <div className="generation-material-references">
    {sources.map(output => {
      const selected = adopted.some(binding => sourceKey(binding.source) === sourceKey(output.source))
      const name = labelFor(output)
      return <MaterialReferenceButton output={output} label={displayLabel(output)} selected={selected} key={sourceKey(output.source)} aria-label={`${name} ${displayLabel(output)} · ${selected ? '已采用' : '候选'}`} title={displayLabel(output) !== output.token ? displayLabel(output) : name} disabled={card.type === 'model.image' && output.modality === 'image' && (disabled || !!candidateIssue(output))}
        onMouseDown={event => { if (card.type === 'model.image' && output.modality === 'image') event.preventDefault() }}
        onClick={() => { if (card.type === 'model.image' && output.modality === 'image') promptEditor.current?.insertReference(output.source); else inspectSource(output) }}>
      </MaterialReferenceButton>
    })}
    <div className="generation-material-add">{sourceActions}</div>
  </div>
  return <CardComposer associations={associations} parameters={modelParameters} status={status}
    submit={<WorkbenchIconButton className="generation-material-submit" variant="primary" label={busy ? '运行中' : '预检运行'} icon={<ArrowUpOutlined />} loading={checking} disabled={submitDisabled} onClick={submit} />}>
    {!!card.missing_designs?.length && <Alert type="warning" message="旧摄影设计已移除，需要补充设计依据" description={<><p>缺失设计：{card.missing_designs.join('、')}</p><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, missing_designs: [] })}>已处理缺失设计</WorkbenchButton></>} />}
    {diagnostics.length > 0 && <Alert type="warning" message={<ul>{diagnostics.map(message => <li key={message}>{message}</li>)}</ul>} />}
    {capabilityError && <Alert type="warning" message={capabilityError} />}
    {card.model_id && !models?.some(model => model.id === card.model_id) && <Alert type="warning" message="已选模型当前不可用，原配置和连线已保留" />}
    {node?.error_message && <Alert type="error" message={`${node.error_message} · 可在素材管理或运行历史查看详情`} />}

    <div className="generation-material-prompt">
      {resolved.error && <Alert type="warning" message={resolved.error} />}
      <PromptEditor referenceActionsRef={promptEditor} compact onSubmit={submit} submitDisabled={submitDisabled} toolsHost={referenceTools} document={document} card={card} value={editorPrompt(card)} candidates={sources.map(item => ({ source: item.source, token: item.token || '', displayLabel: displayLabel(item), available: item.available !== false, ...(card.type === 'model.image' ? { name: labelFor(item), fileId: item.modality === 'image' ? item.file_id : undefined, adopted: adopted.some(binding => sourceKey(binding.source) === sourceKey(item.source)), disabledReason: candidateIssue(item) } : {}) }))} disabled={disabled} onChange={prompt => onChange(withEditorPrompt(card, prompt))} />
    </div>
    {(disabled || busy || runDisabled) && <small role="status">{busy ? '当前模型运行中' : '当前不可提交，请核对保存与运行状态'}</small>}
  </CardComposer>
}

