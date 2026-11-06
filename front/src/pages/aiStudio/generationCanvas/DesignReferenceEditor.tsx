import { DesignCandidateRelations } from './DesignCandidateRelations'
import { candidateRelationPorts } from './designRelationRules'
import { CompositionFrameCandidate, movementFrameOptions } from './CompositionFrameCandidate'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Alert, Popover, Typography } from 'antd'
import type { CompositionCard, MovementCard, DesignReferenceIssue, CanvasDocument, CanvasResolvedOutput, ReferenceDesignField, DesignFieldDocument } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { DesignFieldEditor } from './DesignFieldEditor'
import { designFieldMetadata, userDesignField } from './designFieldMetadata'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor'
import type { EditorPromptDocument } from './inputBindings'
import { sourceKey, type Candidate } from './promptRules'
import { designReferences, isReferenceDesign, isFlatDesign, designFieldEntries } from './designFieldReferences'
import { useGraphRules } from './CanvasCatalogContext'
import { useCardCandidates } from './useCardCandidates'
import { referenceLabels } from './referenceLabels'
import { MaterialReferenceButton } from './MaterialReferenceButton'
import { MediaPreview } from './MediaContentEditor'
import { AcceptanceBasisSelector } from './AcceptanceBasisSelector'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

type TargetField = { fieldId: string; serial: number }
interface ReferenceContext {
  savedRevision?: number; targetField?: TargetField; issues: DesignReferenceIssue[];
  document: CanvasDocument; card: GenerationCard; candidates: Candidate[]; disabled?: boolean;
  focus: (handle: React.RefObject<PromptEditorHandle>, label: string) => void;
  changeMode: () => void;
  renderCandidates: (advanced: boolean) => ReactNode;
}
export const DesignReferenceContext = createContext<ReferenceContext | undefined>(undefined)

/** Reference session belongs to one retained design card, not a model prompt binding set. */
export function DesignReferenceEditor({ card, document, savedRevision, modelOutputs, sourceActions, disabled, editorOpen, children, targetField, onDisconnect, onLocateDesign, onChange }: { onChange?: (card: GenerationCard) => void; onDisconnect?: (edgeId: string) => void; onLocateDesign?: (cardId: string, fieldId: string) => void; targetField?: TargetField; card: GenerationCard; document: CanvasDocument; savedRevision?: number; modelOutputs?: Record<string, CanvasResolvedOutput[]>; sourceActions?: ReactNode; disabled?: boolean; editorOpen?: boolean; children: ReactNode }) {
  const { cardDefinitions } = useGraphRules()
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const focused = useRef<React.RefObject<PromptEditorHandle>>(), owner = useRef<HTMLDivElement>(null)
  const focusedLabel = useRef<string>()
  const [inspect, setInspect] = useState<string>()
  useEffect(() => { if (!editorOpen) { focused.current = undefined; focusedLabel.current = undefined; setInspect(undefined) } }, [editorOpen])
  const used = new Set(designReferences(card, true).map(item => sourceKey(item.reference.source)))
  const bindings = 'input_bindings' in card ? card.input_bindings || [] : []
  for (const binding of bindings) if (binding.input_port !== 'acceptance_basis') used.add(sourceKey(binding.source))
  const retained = new Set(designReferences(card).map(item => sourceKey(item.reference.source)))
  const sources = resolved.candidates.filter(item => document.cards?.find(source => source.id === item.source.card_id)?.type !== 'direction.criterion')
  for (const { reference } of designReferences(card)) if (!sources.some(item => sourceKey(item.source) === sourceKey(reference.source))) sources.push({ source: reference.source, modality: ['image', 'video', 'audio'].includes(reference.source.port_id) ? reference.source.port_id as 'image' | 'video' | 'audio' : 'text', available: false })
  for (const binding of bindings) if (binding.input_port !== 'acceptance_basis' && !sources.some(item => sourceKey(item.source) === sourceKey(binding.source))) sources.push({ source: binding.source, modality: 'text', available: false })
  const composition = card.type === 'direction.composition' ? card as CompositionCard : undefined
  if (composition?.frame_target && !sources.some(item => item.source.card_id === composition!.frame_target!.card_id)) sources.push({ source: { canvas_id: document.id, card_id: composition!.frame_target.card_id, port_id: 'text', position: 0 }, modality: 'text', available: false })
  const labels = referenceLabels(document, sources, card.id, isFlatDesign(card))
  const labelFor = (item: CanvasResolvedOutput) => labels.get(sourceKey(item.source)) || item.token || '@缺失来源'
  const candidates: Candidate[] = sources.map(item => {
    const source = document.cards?.find(value => value.id === item.source.card_id)
    const connected = item.source.canvas_id === document.id && document.edges?.some(edge => edge.target_card === card.id && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)
    const identityOnly = isFlatDesign(card) && !['text', 'image', 'video', 'audio', 'anchor'].includes(item.source.port_id)
    const reason = card.type === 'direction.dialogue' && (item.modality !== 'text' || item.source.port_id !== 'text') ? '对白正文仅支持文本引用，媒体仅作本地参考' : identityOnly ? '请打开候选选择用途' : item.modality === 'audio' ? '本期不支持音频字段引用与携带' : item.source.port_id === 'anchor' && !isFlatDesign(card) ? '设计正文不支持互相引用' : undefined
    const forbidden = !!reason
    return { source: item.source, token: item.token || '@缺失来源', displayLabel: labelFor(item), available: item.available !== false && !!connected && !forbidden, fileId: item.modality === 'image' ? item.file_id : undefined, name: source && 'name' in source && source.name || labelFor(item), disabledReason: forbidden ? reason : !connected ? '来源未连接' : item.available === false ? '来源输出缺失' : undefined }
  })
  const usageFor = (key: string) => {
    const definition = cardDefinitions[card.type!]
    const roles = bindings.filter(binding => binding.input_port !== 'acceptance_basis' && sourceKey(binding.source) === key).map(binding => '已用作' + (definition.inputs.find(port => port.id === binding.input_port)?.label || binding.input_port))
    const fields = designReferences(card).filter(item => sourceKey(item.reference.source) === key).map(item => {
      const value = designFieldEntries(card).find(([field]) => field === item.field)?.[1]
      const label = definition.fields.find(field => field.id === item.field)?.label || ('phases' in card ? card.phases?.find(phase => 'phase:' + phase.id === item.field)?.name : undefined) || item.field
      return `已引用于${label}${['empty', 'not_applicable'].includes(value?.state || 'empty') ? ' · 未生效' : ''}`
    })
    return [...new Set([...roles, ...fields])]
  }
  const activeCount = sources.filter(item => (item.available !== false && used.has(sourceKey(item.source)) || composition?.frame_target?.card_id === item.source.card_id)).length
  const changeMode = () => { focused.current = undefined; focusedLabel.current = undefined; setInspect(undefined) }
  const renderCandidates = (advanced: boolean) => <div className="design-candidate-layout"><div className="generation-material-references design-field-candidates" aria-label="设计候选内容">
    {sources.map(item => {
      const key = sourceKey(item.source), candidate = candidates.find(value => sourceKey(value.source) === key)!
      const localExample = 'examples' in card && card.examples?.some(example => sourceKey(example.source) === key)
      const movement = document.cards?.find(source => source.id === item.source.card_id && source.type === 'direction.movement') as MovementCard | undefined
      const relationCandidate = candidateRelationPorts(card, document, item).length > 0
      const frameCandidate = card.type === 'direction.composition' && (movement?.type === 'direction.movement' || composition!.frame_target?.card_id === item.source.card_id)
      const target = card.type === 'direction.composition' && composition!.frame_target?.card_id === item.source.card_id ? composition!.frame_target : undefined
      const frameLabel = target ? movementFrameOptions(movement).find(option => option.value === target.state_id)?.label : undefined
      const usages = [...usageFor(key), ...(target ? [frameLabel ? '已定位 · ' + frameLabel : '定位失效'] : [])]
      const state = usages.length ? usages.join('；') : item.modality === 'audio' ? '本地参考' : localExample ? '本地示例' : '候选'
      const selected = !!target || item.available !== false && used.has(key)
      return <Popover key={key} placement="bottomLeft" trigger="click" open={inspect === key} onOpenChange={next => { if (!next) setInspect(undefined) }} overlayClassName="canvas-workbench-dialog design-source-inspect" content={<div><strong>{candidate.name}</strong>{item.modality === 'video' && 'examples' in card && card.examples?.some(example => sourceKey(example.source) === key && example.start_ms !== null && example.start_ms !== undefined) && <p>生成引用完整视频，参考区间不裁剪素材</p>}<p>{state}{localExample && ' · 已关联本地示例，关联本身不进入模型输入'}{candidate.disabledReason && ` · ${candidate.disabledReason}`}</p>{item.file_id && item.modality !== 'text' ? <MediaPreview fileId={item.file_id} type={item.modality} /> : <CanvasTextPreview text={item.text || candidate.disabledReason || '来源尚未提供可用内容'} label="来源内容" lines={6} />}{relationCandidate && onChange && <><DesignCandidateRelations card={card} document={document} item={item} disabled={disabled} onChange={onChange} /><WorkbenchButton disabled={disabled || !advanced || !focused.current?.current || !candidate.available} onClick={() => { focused.current?.current?.insertReference(item.source); setInspect(undefined) }}>引用当前字段{focusedLabel.current ? `「${focusedLabel.current}」` : '（请先选择字段）'}</WorkbenchButton>{onDisconnect && document.edges?.filter(edge => edge.source_card === item.source.card_id && edge.target_card === card.id).slice(0, 1).map(edge => <WorkbenchButton key={edge.id} variant="quiet" disabled={disabled} onClick={() => onDisconnect(edge.id)}>断开候选连接</WorkbenchButton>)}</>}{frameCandidate && card.type === 'direction.composition' && onChange && <CompositionFrameCandidate card={composition!} movement={movement} sourceId={item.source.card_id} disabled={disabled} onChange={onChange} onLocate={onLocateDesign} reference={<><WorkbenchButton disabled={disabled || !advanced || !focused.current?.current || !candidate.available} onClick={() => { focused.current?.current?.insertReference(item.source); setInspect(undefined) }}>引用当前字段{focusedLabel.current ? `「${focusedLabel.current}」` : '（请先选择字段）'}</WorkbenchButton>{onDisconnect && document.edges?.filter(edge => edge.source_card === item.source.card_id && edge.target_card === card.id).slice(0, 1).map(edge => <WorkbenchButton key={edge.id} variant="quiet" disabled={disabled} onClick={() => onDisconnect(edge.id)}>断开候选连接</WorkbenchButton>)}</>} />}</div>}>
        <MaterialReferenceButton output={item} label={target ? `${labelFor(item)} · ${frameLabel ? '已定位 · ' + frameLabel : '定位失效'}` : labelFor(item)} selected={selected} selectedLabel="使用中" data-frame-target={target ? true : undefined} data-design-source={key} aria-label={`候选 ${candidate.name} · ${state}`} title={`${labelFor(item)} · ${state}`} onMouseDown={event => { if (advanced && focused.current?.current) event.preventDefault() }} onClick={() => {
          if (!frameCandidate && !relationCandidate && advanced && focused.current?.current && !disabled && candidate.available) { setInspect(undefined); focused.current.current.insertReference(item.source) }
          else setInspect(previous => previous === key ? undefined : key)
        }}>{retained.has(key) && !used.has(key) && <span className="design-reference-inactive">未生效</span>}</MaterialReferenceButton>
      </Popover>
    })}
    {resolved.loading && <small role="status">正在读取候选来源…</small>}
    {!resolved.loading && resolved.error && <Alert type="warning" message="候选来源读取失败，请保存或重开后重试。" />}
  </div><div className="generation-material-add">{sourceActions}</div>
    {(!resolved.loading && !resolved.error || resolved.candidates.length > 0) && <small className="design-reference-hint">{advanced ? '输入 @ 或点击素材引用当前编辑字段' : `${sources.length} 个候选 · ${activeCount} 个使用中`}</small>}
  {onDisconnect && <AcceptanceBasisSelector editorOpen={editorOpen} card={card} document={document} disabled={disabled} onDisconnect={onDisconnect} onLocateDesign={onLocateDesign} />}</div>
  return <DesignReferenceContext.Provider value={{ card, document, savedRevision, candidates, disabled, targetField, issues: resolved.outputs.flatMap(output => output.payload && 'reference_issues' in output.payload ? output.payload.reference_issues || [] : []), focus: (handle, label) => { focused.current = handle; focusedLabel.current = label }, changeMode, renderCandidates }}><div className="design-reference-owner" ref={owner} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !inspect) return
    event.preventDefault(); event.stopPropagation()
    owner.current?.querySelector<HTMLButtonElement>(`[data-design-source="${CSS.escape(inspect)}"]`)?.focus({ preventScroll: true })
    setInspect(undefined)
  }}>{children}</div></DesignReferenceContext.Provider>
}

/** Reuse the model's editing surface; field source identities are persisted directly. */
export function ReferencedDesignFieldEditor(props: ComponentProps<typeof DesignFieldEditor>) {
  const { cardDefinitions } = useGraphRules()
  const context = useContext(DesignReferenceContext), handle = useRef<PromptEditorHandle>(null)
  const metadataId = useId()
  if (!context || !isReferenceDesign(context.card)) return <DesignFieldEditor {...props} />
  const value = props.value as ReferenceDesignField | undefined
  const prompt: EditorPromptDocument = value?.document as EditorPromptDocument || { segments: [{ id: 'text', kind: 'text', text: value?.text || '', ...(isFlatDesign(context.card) && value?.text ? { literal: true } : {}) }] }
  const onChange = (next: EditorPromptDocument) => {
    // A pasted model instruction is literal field data; it cannot configure this design's consumer.
    const segments: NonNullable<DesignFieldDocument['segments']> = (next.segments || []).flatMap<NonNullable<DesignFieldDocument['segments']>[number]>(segment => segment.kind === 'instruction' ? [{ id: segment.id, kind: 'text' as const, text: `/${segment.command} ${JSON.stringify(segment.parameters || {})} ` }, ...(segment.references || []).map(reference => ({ id: reference.id, kind: 'reference' as const, source: reference.source }))] : segment.kind === 'reference' ? [{ id: segment.id, kind: 'reference' as const, source: segment.source }] : [segment])
    const text = segments.map(segment => segment.kind === 'text' ? segment.text : context.candidates.find(item => sourceKey(item.source) === sourceKey(segment.source))?.displayLabel || '@缺失来源').join('')
    const content = (parts: NonNullable<DesignFieldDocument['segments']>) => parts.map(part => part.kind === 'reference' ? ['reference', part.source] : ['text', part.text])
    if (JSON.stringify(content(segments)) === JSON.stringify(content(prompt.segments as NonNullable<DesignFieldDocument['segments']> || []))) return
    props.onChange(userDesignField({ ...value, document: { segments }, text }))
  }
  const phase = 'phases' in context.card ? context.card.phases?.find(item => item.frame === props.value) : undefined
  const fieldId = designFieldEntries(context.card).find(([, value]) => value === props.value)?.[0] || (phase ? 'phase:' + phase.id : cardDefinitions[context.card.type!]?.fields.find(field => field.label === props.label)?.id)
  const defaults = cardDefinitions[context.card.type!]?.fields.find(field => field.id === fieldId)?.default_value
  const hasMetadata = !!designFieldMetadata(value, defaults || { purpose: props.purpose || 'design' })
  return <div data-design-field={fieldId} onFocusCapture={event => { if ((event.target as HTMLElement).isContentEditable) context.focus(handle, props.label) }}><DesignFieldEditor {...props} metadataId={metadataId} defaults={defaults} editor={<PromptEditor referenceActionsRef={handle} compact allReferences fieldDescriptionId={hasMetadata ? metadataId : undefined} fieldLabel={`${props.label}内容`} fieldPlaceholder="输入设计参数，使用 @ 引用候选内容" document={context.document} card={context.card} value={prompt} candidates={context.candidates} disabled={context.disabled} onChange={onChange} />} />{context.issues.filter(issue => issue.field_id === fieldId).map(issue => <Typography.Text type="danger" role="alert" key={issue.reference_id} className="design-reference-issue">{issue.message}</Typography.Text>)}</div>
}
