import { CanvasAssociations, type AssociationEntry, type AssociationDetailContext } from './CanvasAssociations'
import { associationSources, includeConnectedSources, associationIssues } from './associationSources'
import { InputBindingReferences } from './InputBindingReferences'
import { DesignVideoMediaUses } from './DesignVideoMediaUses'
import { Alert, Select, Space, Switch } from 'antd'
import { ArrowUpOutlined } from '@ant-design/icons'
import type { AudioCapability, CanvasResolvedOutput, ImageModelCard, TextModelCard, VideoModelCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useGraphRules } from './CanvasCatalogContext'
import { PhotographyInputScope } from './PhotographyInputScope'
import { NamedImageSummary } from './NamedImageSummary'
import { VideoInputBindings } from './VideoInputBindings'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor'
import type { EditorPromptDocument } from './inputBindings'
import { WorkbenchModal } from '../directing/ui/WorkbenchModal'
import { editorPrompt, promptInputPort, withEditorPrompt, withoutInputBinding } from './inputBindings'
import { useCardCandidates } from './useCardCandidates'
import { MediaPreview } from './MediaContentEditor'
import { MediaResultsPreview } from './MediaResultsPreview'
import { ImageModelParameters, VideoModelParameters } from './ModelParameters'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { sourceKey, referencesIn } from './promptRules'
import { referenceLabels } from './referenceLabels'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { activeNode, canvasNodeStatusLabels } from './useGenerationCanvasRuntime'
import { PromptEditingContext } from './PromptEditingContext'
import { useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CardComposer } from './CardComposer'
import { availableDefaultModel, defaultVideoRatio } from './modelCardDefaults'
import './materialComposer.css'

function audioCapabilityStatus(capability?: AudioCapability) {
  if (capability?.declaration === 'supported') return capability.connected ? '可用' : '模型支持，当前适配器未接入'
  return capability?.declaration === 'unsupported' ? '不支持' : '未知'
}

/** 模型卡共享受控 Composer 布局，参数由各模态组件表达。 */
export function ModelRenderer({ card: raw, savedRevision, document, disabled, onChange, models, capability, capabilityError, references, modelOutputs, node, busy, checking, runDisabled, onPrecheck, sourceActions, defaultModelId, onLocateDesign, editorOpen, suppressAutomaticDefaults }: CardRendererProps) {
  const promptEditor = useRef<PromptEditorHandle>(null)
  const management = useRef<HTMLDetailsElement>(null)
  const attemptedDefault = useRef<string | undefined>(undefined)
  const [referenceTools, setReferenceTools] = useState<HTMLDivElement | null>(null)
  const card = raw as TextModelCard | ImageModelCard | VideoModelCard
  const generated = card.type === 'model.video' ? (card as VideoModelCard).generated_prompt : undefined
  const [promptDraft, setPromptDraft] = useState<EditorPromptDocument>()
  const promptSession = useId()
  const editingKey = card.id + ':' + promptSession
  const editingPrompt = !!promptDraft
  const reportEditing = useContext(PromptEditingContext)
  useEffect(() => {
    reportEditing(editingKey, editingPrompt)
    return () => reportEditing(editingKey, false)
  }, [editingKey, editingPrompt, reportEditing])
  const [editRisk, setEditRisk] = useState(false)
  const [confirmedHere, setConfirmedHere] = useState(false)
  const confirmationKey = JSON.stringify(['jellyfish:prompt-edit', document.project_id, document.id, card.id])
  const startPromptEdit = () => {
    let confirmed = confirmedHere || generated?.edit_confirmed
    try { confirmed ||= localStorage.getItem(confirmationKey) === '1' } catch { /* Saved card confirmation remains available. */ }
    if (!confirmed) setEditRisk(true)
    else setPromptDraft(editorPrompt(card))
  }
  useEffect(() => { setPromptDraft(undefined); setEditRisk(false); setConfirmedHere(false) }, [card.id])

  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs)
  const { isIndependentDesignEdge, cardTitles, cardDefinitions, candidatePorts } = useGraphRules()
  const adopted = card.input_bindings || []
  const formalOutputs = resolved.loading ? modelOutputs?.[card.id] || [] : resolved.outputs
  const category = card.type?.split('.')[1]
  useEffect(() => {
    if (disabled || suppressAutomaticDefaults) {
      attemptedDefault.current = undefined
      return
    }
    const modelId = availableDefaultModel(card, defaultModelId, models)
    if (modelId && attemptedDefault.current !== modelId) {
      attemptedDefault.current = modelId
      onChange({ ...card, model_id: modelId }, 'system-default')
      return
    }
    const ratio = defaultVideoRatio(capability)
    if (card.type === 'model.video' && !(card as VideoModelCard).config?.ratio && ratio) onChange({ ...card, config: { ...card.config, ratio } })
  }, [capability, card, defaultModelId, disabled, models, onChange, suppressAutomaticDefaults])
  let parameters: ReactNode = null
  if (card.type === 'model.image') parameters = <ImageModelParameters card={card as ImageModelCard} capability={capability} disabled={disabled} onChange={onChange} />
  if (card.type === 'model.video') parameters = <VideoModelParameters card={card as VideoModelCard} capability={capability} disabled={disabled} onChange={onChange} />
  const hasSavedSoundDesign = !resolved.loading && resolved.compiled?.used?.some(item =>
    item.available !== false && !!item.text && item.payload && 'design_type' in item.payload &&
    ['direction.dialogue', 'direction.sound'].includes(item.payload.design_type))
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
  const supportedPorts = (output: CanvasResolvedOutput) => candidatePorts(document, output.source, card.id, capability)
  const candidateIssue = (output: CanvasResolvedOutput) => {
    if (output.source.canvas_id !== document.id) return '来源属于其他画布'
    const source = document.cards?.find(item => item.id === output.source.card_id)
    if (!source || !(document.edges || []).some(edge => edge.target_card === card.id && edge.source_card === source.id && edge.source_port === output.source.port_id)) return '来源未连接'
    if (output.available === false) return '来源输出缺失'
    if (!supportedPorts(output).includes(promptInputPort(card, output.source))) return '当前模型不支持直接引用此输入'
    if ('uploading' in source && source.uploading) return '上传中'
    if ('file_id' in source && source.file_id !== output.file_id) return '正在更新候选'
    if (output.basis_current === false) return '来源依据已变，需重新生成'
    return undefined
  }
  // 保存刷新期间仍展示已采用但暂未解析的来源，不将缺失来源误报为新候选。
  let sources: CanvasResolvedOutput[] = [...resolved.candidates]
  for (const binding of adopted) if (!sources.some(output => sourceKey(output.source) === sourceKey(binding.source))) sources.push({ source: binding.source, modality: 'text', available: false })
  sources = includeConnectedSources(document, card.id, sources)
  const labels = referenceLabels(document, sources, card.id)
  const displayLabel = (output: CanvasResolvedOutput) => output.token ? labels.get(sourceKey(output.source)) || output.token : labelFor(output)
  const hasInput = adopted.length > 0 || (editorPrompt(card).segments || []).some(segment => segment.kind !== 'text' || segment.text?.trim())
  const submitDisabled = !!(disabled || busy || checking || runDisabled || promptDraft || !hasInput)
  const submit = () => { if (!submitDisabled) onPrecheck?.() }
  const modelParameters = <><Select className="generation-material-model" title={models?.find(model => model.id === card.model_id)?.name} size="small" bordered={false} aria-label="选择模型" data-diagnostic-control="model_id" placeholder="选择模型" disabled={disabled} value={card.model_id || undefined}
      options={models?.filter(model => model.category === category).map(model => ({ value: model.id, label: model.name }))}
      onChange={id => onChange({ ...card, model_id: id })} />{parameters}</>
  const resultDisplay = <label className="generation-result-display"><Switch size="small" aria-label="显示结果卡" checked={!!card.show_result_cards} disabled={disabled}
    onChange={checked => onChange({ ...card, show_result_cards: checked })} />显示结果卡</label>
  const compiledCriteria = resolved.compiled?.used?.filter(item => item.payload && 'design_type' in item.payload && item.payload.design_type === 'direction.criterion') || []
  const carriedInputs = (sourceId: string, close: AssociationDetailContext['close']) => {
    const media = resolved.compiled?.media?.filter(item => item.design_sources?.some(origin => origin.source.card_id === sourceId)) || []
    return !!media.length && <section className="generation-design-carried" aria-label="随设计携带的素材"><strong>随设计携带的素材</strong><small>来源由设计中的有效引用决定，无需补连素材</small>
      {media.map(item => <div key={sourceKey(item.source)}><strong>{labelFor(item)}</strong>{item.modality === 'image' && item.file_id && <details><summary>查看携带图片</summary><MediaPreview fileId={item.file_id} type="image" /></details>}
        {item.design_sources?.filter(origin => origin.source.card_id === sourceId).map(origin => {
          const design = document.cards?.find(value => value.id === origin.source.card_id)
          const phase = design && 'phases' in design ? design.phases?.find(value => 'phase:' + value.id === origin.field_id) : undefined
          const field = cardDefinitions[design?.type || '']?.fields?.find(value => value.id === origin.field_id)?.label || phase?.name || '设计参数'
          return <WorkbenchButton variant="quiet" key={origin.source.card_id + ':' + origin.field_id} onClick={() => { close(false); onLocateDesign?.(origin.source.card_id, origin.field_id) }}>查看 {cardTitles[design?.type || ''] || '设计卡'} · {field}</WorkbenchButton>
        })}
        {card.type === 'model.video' && <DesignVideoMediaUses card={card as VideoModelCard} output={item} label={labelFor(item)} capability={capability} disabled={disabled} onChange={onChange} />}
        {sources.some(output => sourceKey(output.source) === sourceKey(item.source) && bindings.some(binding => sourceKey(binding.source) === sourceKey(item.source))) && <small>此素材也由本卡直接采用</small>}
        {item.available === false && <small>来源已失效，请返回设计卡处理引用</small>}{item.basis_current === false && <small>来源依据已变，需重新生成</small>}
      </div>)}
    </section>
  }
  const directInput = (output: CanvasResolvedOutput, context?: AssociationDetailContext) => {

    const binding = bindings.find(value => sourceKey(value.source) === sourceKey(output.source))
    const independent = document.edges?.some(edge => edge.source_card === output.source.card_id && edge.source_port === output.source.port_id && edge.target_card === card.id && isIndependentDesignEdge(document, edge))
    const protectedReference = binding && referencesIn(editorPrompt(card)).some(reference => reference.binding_id === binding.id)
    const index = binding ? bindings.indexOf(binding) : -1
    return <div key={sourceKey(output.source)} data-reference-source={sourceKey(output.source)}>
      <strong>{displayLabel(output)} · {binding ? '已采用' : '候选'}</strong>
      {output.available === false ? <small>来源输出缺失</small> : output.modality === 'text'
        ? <CanvasTextPreview text={output.text || ''} label="已保存来源" /> : <small>{output.modality} · {output.file_id}</small>}
      <NamedImageSummary output={output} displayLabel={displayLabel(output)} />
      <PhotographyInputScope card={card} output={output} binding={binding} onChange={onChange} disabled={disabled} />
      {output.basis_current === false && <small>依据已变，需重新生成来源</small>}
      {context && output.modality !== 'text' && output.available !== false && output.file_id ? <MediaPreview fileId={output.file_id} type={output.modality} /> : card.type === 'model.image' && output.modality === 'image' && output.available !== false && output.file_id && <details><summary>预览 {displayLabel(output)}</summary><MediaPreview fileId={output.file_id} type="image" /></details>}
      {card.type !== 'model.video' && ['text', 'image'].includes(output.modality) && <Space wrap>
        <WorkbenchButton title={protectedReference ? '请先清理正文引用再解除关联' : undefined} disabled={disabled || !!protectedReference || !binding && (resolved.loading || output.available === false || !capability?.input_ports?.includes(output.modality))}
          onClick={() => onChange(binding ? withoutInputBinding(card, binding.id) : { ...card, input_bindings: [...bindings, { id: crypto.randomUUID(), prompt_owned: false, input_port: output.modality, source: output.source }] })}>
          {`${binding ? independent ? '解除关联' : '取消采用' : '采用'} ${displayLabel(output)}`}
        </WorkbenchButton>
        {binding && <InputBindingReferences card={card} bindingId={binding.id} onLocate={() => context?.close(false)} />}
        {binding && <><span>采用顺序 {index + 1}</span>
          <WorkbenchButton aria-label={`前移 ${displayLabel(output)}`} disabled={disabled || index === 0} onClick={() => move(binding.id, -1)}>前移</WorkbenchButton>
          <WorkbenchButton aria-label={`后移 ${displayLabel(output)}`} disabled={disabled || index === bindings.length - 1} onClick={() => move(binding.id, 1)}>后移</WorkbenchButton></>}
      </Space>}
    </div>
  }
  const entries: AssociationEntry[] = associationSources(document, card.id, sources).map(entry => {
    const selected = entry.outputs.some(output => bindings.some(binding => sourceKey(binding.source) === sourceKey(output.source)))
    const name = labelFor(entry.outputs[0])
    const empty = !selected && entry.outputs.every(output => output.available === false) && document.cards?.find(source => source.id === entry.outputs[0].source.card_id)
    const issue = empty ? empty.type?.startsWith('model.') ? '尚无生成结果' : '暂无可用内容' : [...new Set(entry.outputs.flatMap(output => associationIssues(output).map(issue => issue.message)))].join('；') || undefined
    return { ...entry, label: entry.kind === 'design' ? name : displayLabel(entry.outputs[0]), description: `${name} ${displayLabel(entry.outputs[0])} · ${selected ? '使用中' : '候选'}`, used: selected, issue }
  })
  const status = <><details ref={management} className="generation-material-candidates"><summary aria-label="管理候选与采用" title="管理候选与采用">关联 {entries.length} · 已采用 {adopted.length}{resolved.compiled?.media?.some(item => item.design_sources?.length) && ` · 携带 ${resolved.compiled.media.filter(item => item.design_sources?.length).length}`}</summary>
    <div ref={setReferenceTools} />
    <section aria-label="候选参考区">{references}</section>
    <section role="region" aria-label="已保存直接输入">
      <small>已保存 revision {resolved.revision ?? savedRevision} · 本地修改保存后更新</small>
      {card.type === 'model.image' && capability && <small>参考图片上限：{capability.max_reference_images ?? '未声明'} · {capability.supports_duplicate_reference_images ? '允许重复图片文件' : '不允许重复图片文件'}</small>}
      {sources.map(output => directInput(output))}
      {(resolved.compiled?.diagnostics || []).map((diagnostic, index) => <Alert key={`${diagnostic.code}:${index}`} type={diagnostic.severity === 'warning' ? 'warning' : 'error'}
        message={`${diagnostic.code}: ${diagnostic.message}`} />)}
    </section>
    {card.type !== 'model.image' && resolved.candidates.map(output => <PhotographyInputScope key={sourceKey(output.source)} card={card} output={output} binding={bindings.find(value => sourceKey(value.source) === sourceKey(output.source))} onChange={onChange} disabled={disabled} />)}
    {card.type === 'model.video' && <VideoInputBindings document={document} labels={labels} card={card as VideoModelCard} candidates={resolved.candidates} loading={resolved.loading} capability={capability} disabled={disabled} onChange={onChange} />}
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
  const renderDetails = (entry: AssociationEntry, context: AssociationDetailContext) => {
    const sourceId = entry.outputs[0].source.card_id
    const design = document.cards?.find(source => source.id === sourceId)
    const used = entry.outputs.some(output => bindings.some(binding => sourceKey(binding.source) === sourceKey(output.source)))
    const criteria = used && design && 'input_bindings' in design ? compiledCriteria.filter(criterion => design.input_bindings?.some(binding => binding.input_port === 'acceptance_basis' && binding.source.card_id === criterion.source.card_id)) : []
    const keys = new Set(entry.outputs.map(output => sourceKey(output.source)))
    return <>
      {entry.outputs.map(output => directInput(output, context))}
      {card.type === 'model.video' && <VideoInputBindings document={document} labels={labels} card={card as VideoModelCard} candidates={entry.outputs} sourceOnly={keys} onLocate={() => context.close(false)} loading={resolved.loading} capability={capability} disabled={disabled} onChange={onChange} />}
      {card.type !== 'model.video' && entry.outputs.map(output => <WorkbenchButton key={sourceKey(output.source)} disabled={disabled || resolved.loading || !!candidateIssue(output)} onClick={() => {
        context.close(false)
        promptEditor.current?.insertReference(output.source)
      }}>引用到正文 {displayLabel(output)}</WorkbenchButton>)}
      {used && carriedInputs(sourceId, context.close)}
      {!!criteria.length && <section aria-label="随设计采用的验收要求"><strong>随设计采用的验收要求</strong>{criteria.map(item => <div key={sourceKey(item.source)}><CanvasTextPreview text={item.text || ''} label="验收要求" />{adopted.some(binding => binding.source.card_id === item.source.card_id) && <small>此验收要求也由本卡直接采用</small>}<WorkbenchButton variant="quiet" onClick={() => { context.close(false); onLocateDesign?.(item.source.card_id, 'standard') }}>查看验收要求</WorkbenchButton></div>)}</section>}
    </>
  }
  const associations = <CanvasAssociations entries={entries} sourceActions={sourceActions} sessionKey={`${card.id}:${editorOpen}`} loading={resolved.loading} error={resolved.error} renderDetails={renderDetails} onLocateSource={onLocateDesign} onInspect={() => { if (management.current) management.current.open = false }} />
  return <CardComposer associations={associations} parameters={modelParameters} parameterAction={resultDisplay} status={status}
    submit={<WorkbenchIconButton className="generation-material-submit" variant="primary" label={busy ? '运行中' : '预检运行'} icon={<ArrowUpOutlined />} loading={checking} disabled={submitDisabled} onClick={submit} />}>
    {!!card.missing_designs?.length && <Alert type="warning" message="旧摄影设计已移除，需要补充设计依据" description={<><p>缺失设计：{card.missing_designs.join('、')}</p><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, missing_designs: [] })}>已处理缺失设计</WorkbenchButton></>} />}
    {diagnostics.length > 0 && <Alert type="warning" message={<ul>{diagnostics.map(message => <li key={message}>{message}</li>)}</ul>} />}
    {card.type === 'model.video' && card.model_id && <small aria-label="原生声音输出能力">
      {hasSavedSoundDesign && '已保存输入采用声音设计 · '}原生声音输出：{audioCapabilityStatus(capability?.native_audio_output)}
    </small>}
    {card.type === 'model.video' && card.model_id && <small aria-label="声音开关能力">
      声音开关：{audioCapabilityStatus(capability?.audio_switch)}
    </small>}
    {card.type === 'model.video' && card.model_id && <small aria-label="音频参考输入能力">
      音频参考输入：{audioCapabilityStatus(capability?.audio_reference_input)}
    </small>}
    {capabilityError && <Alert type="warning" message={capabilityError} />}
    {card.model_id && !models?.some(model => model.id === card.model_id) && <Alert type="warning" message="已选模型当前不可用，原配置和连线已保留" />}
    {node?.error_message && <Alert type="error" message={`${node.error_message} · 可在素材管理或运行历史查看详情`} />}


    <div className="generation-material-prompt">
      {resolved.error && <Alert type="warning" message={resolved.error} />}
      {generated && <Space>
        {promptDraft ? <><WorkbenchButton disabled={disabled} onClick={() => {
          const next = withEditorPrompt(card, promptDraft) as VideoModelCard
          onChange({ ...next, generated_prompt: { ...generated, edit_confirmed: true } })
          setPromptDraft(undefined)
        }}>保存修改</WorkbenchButton><WorkbenchButton onClick={() => setPromptDraft(undefined)}>取消编辑</WorkbenchButton></>
          : <WorkbenchButton disabled={disabled || busy} onClick={startPromptEdit}>编辑提示词</WorkbenchButton>}
        <details><summary>查看完整执行提示词</summary><CanvasTextPreview text={resolved.compiled?.text || '保存并读取后查看完整提示词'} label="完整执行提示词" /></details>
      </Space>}
      <WorkbenchModal title="编辑提示词" open={editRisk} okText="继续编辑" cancelText="取消" onCancel={() => setEditRisk(false)} onOk={() => {
        setConfirmedHere(true)
        try { localStorage.setItem(confirmationKey, '1') } catch { /* Confirmation is also saved with the card. */ }
        onChange({ ...card, generated_prompt: { ...generated!, edit_confirmed: true } } as VideoModelCard)
        setEditRisk(false)
        setPromptDraft(editorPrompt(card))
      }}><p>修改主体提示词可能改变分镜表达，已采用的设计仍会参与生成。修改不会同步更新设计卡。</p></WorkbenchModal>
      <PromptEditor referenceActionsRef={promptEditor} compact onSubmit={submit} submitDisabled={submitDisabled} toolsHost={referenceTools} document={document} card={card} value={promptDraft || editorPrompt(card)} candidates={sources.map(item => ({ source: item.source, token: item.token || '', displayLabel: displayLabel(item), available: item.available !== false, inputPorts: supportedPorts(item), disabledReason: candidateIssue(item), ...(card.type === 'model.image' ? { name: labelFor(item), fileId: item.modality === 'image' ? item.file_id : undefined, adopted: adopted.some(binding => sourceKey(binding.source) === sourceKey(item.source)) } : {}) }))} disabled={disabled || !!generated && !promptDraft} onChange={prompt => promptDraft ? setPromptDraft(prompt) : onChange(withEditorPrompt(card, prompt))} />
    </div>
    {(disabled || busy || runDisabled) && <small role="status">{busy ? '当前模型运行中' : '当前不可提交，请核对保存与运行状态'}</small>}
  </CardComposer>
}

