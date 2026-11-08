import { CanvasAssociations, type AssociationEntry, type AssociationDetailContext } from './CanvasAssociations'
import { associationSources, includeConnectedSources, associationIssues } from './associationSources'
import { VisualDesignRelations } from './VisualDesignRelations'
import type { AcceptanceCriterionCard, CameraCard, LightingCard, FocusCard } from '../../../services/generated'
import { SoundReferenceCandidate } from './SoundReferenceCandidate'
import { AnchorReferenceCandidate } from './AnchorReferenceCandidate'
import { DesignCandidateRelations } from './DesignCandidateRelations'
import { CompositionFrameCandidate, movementFrameOptions } from './CompositionFrameCandidate'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Typography } from 'antd'
import type { DialogueCard, SoundArrangementCard, SpatialAnchorCard, CompositionCard, MovementCard, DesignReferenceIssue, CanvasDocument, CanvasResolvedOutput, ReferenceDesignField, DesignFieldDocument } from '../../../services/generated'
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
import { MediaPreview } from './MediaContentEditor'
import { AcceptanceBasisDetails } from './AcceptanceBasisDetails'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

type TargetField = { fieldId: string; segmentId?: string; serial: number }
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
  const focused = useRef<React.RefObject<PromptEditorHandle>>()
  const focusedLabel = useRef<string>()
  const [expandedSource, setExpandedSource] = useState<string>()
  useEffect(() => { if (!editorOpen) { focused.current = undefined; focusedLabel.current = undefined } }, [editorOpen])
  const used = new Set(designReferences(card, true).map(item => sourceKey(item.reference.source)))
  const bindings = 'input_bindings' in card ? card.input_bindings || [] : []
  for (const binding of bindings) used.add(sourceKey(binding.source))
  let sources = [...resolved.candidates]
  for (const { reference } of designReferences(card)) if (!sources.some(item => sourceKey(item.source) === sourceKey(reference.source))) sources.push({ source: reference.source, modality: ['image', 'video', 'audio'].includes(reference.source.port_id) ? reference.source.port_id as 'image' | 'video' | 'audio' : 'text', available: false })
  for (const binding of bindings) if (!sources.some(item => sourceKey(item.source) === sourceKey(binding.source))) sources.push({ source: binding.source, modality: 'text', available: false })
  const composition = card.type === 'direction.composition' ? card as CompositionCard : undefined
  if (composition?.frame_target && !sources.some(item => item.source.card_id === composition!.frame_target!.card_id)) sources.push({ source: { canvas_id: document.id, card_id: composition!.frame_target.card_id, port_id: 'text', position: 0 }, modality: 'text', available: false })
  if ('examples' in card) for (const example of card.examples || []) if (!sources.some(item => sourceKey(item.source) === sourceKey(example.source))) sources.push({ source: example.source, file_id: example.file_id, modality: example.source.port_id === 'video' ? 'video' : example.source.port_id === 'audio' ? 'audio' : 'image', available: false })
  sources = includeConnectedSources(document, card.id, sources)
  const labels = referenceLabels(document, sources, card.id, isFlatDesign(card))
  const labelFor = (item: CanvasResolvedOutput) => item.token ? labels.get(sourceKey(item.source)) || item.token : cardDefinitions[document.cards?.find(source => source.id === item.source.card_id)?.type || '']?.title || '@缺失来源'
  const candidates: Candidate[] = sources.filter(item => document.cards?.find(source => source.id === item.source.card_id)?.type !== 'direction.criterion').map(item => {
    const source = document.cards?.find(value => value.id === item.source.card_id)
    const connected = item.source.canvas_id === document.id && document.edges?.some(edge => edge.target_card === card.id && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)
    const identityOnly = isFlatDesign(card) && !['text', 'image', 'video', 'audio', 'anchor'].includes(item.source.port_id)
    const reason = card.type === 'direction.dialogue' && (item.modality !== 'text' || item.source.port_id !== 'text') ? '对白正文仅支持文本引用，媒体仅作本地参考' : identityOnly ? '请明确选择关联用途' : item.modality === 'audio' ? '本期不支持音频字段引用与携带' : item.source.port_id === 'anchor' && !isFlatDesign(card) ? '设计正文不支持互相引用' : undefined
    const forbidden = !!reason
    return { source: item.source, token: item.token || '@缺失来源', displayLabel: labelFor(item), available: item.available !== false && !!connected && !forbidden, fileId: item.modality === 'image' ? item.file_id : undefined, name: source && 'name' in source && source.name || labelFor(item), disabledReason: forbidden ? reason : !connected ? '来源未连接' : item.available === false ? '来源输出缺失' : undefined }
  })
  const usageFor = (key: string) => {
    const definition = cardDefinitions[card.type!]
    const roles = bindings.filter(binding => sourceKey(binding.source) === key).map(binding => '已用作' + (definition.inputs.find(port => port.id === binding.input_port)?.label || binding.input_port))
    const fields = designReferences(card).filter(item => sourceKey(item.reference.source) === key).map(item => {
      const value = designFieldEntries(card).find(([field]) => field === item.field)?.[1]
      const label = definition.fields.find(field => field.id === item.field)?.label || ('phases' in card ? card.phases?.find(phase => 'phase:' + phase.id === item.field)?.name : undefined) || item.field
      return `已引用于${label}${['empty', 'not_applicable'].includes(value?.state || 'empty') ? ' · 未生效' : ''}`
    })
    return [...new Set([...roles, ...fields])]
  }
  const changeMode = () => { focused.current = undefined; focusedLabel.current = undefined }
  const entries: AssociationEntry[] = associationSources(document, card.id, sources).map(entry => {
    const source = document.cards?.find(value => value.id === entry.outputs[0].source.card_id)
    const candidate = candidates.find(value => sourceKey(value.source) === sourceKey(entry.outputs[0].source))
    const name = source && 'name' in source && source.name || candidate?.name || labelFor(entry.outputs[0])
    const usages = [...new Set(entry.outputs.flatMap(output => usageFor(sourceKey(output.source))))]
    const example = 'examples' in card && card.examples?.some(value => entry.outputs.some(output => sourceKey(output.source) === sourceKey(value.source)))
    const target = composition?.frame_target?.card_id === source?.id
    const inUse = !!example || !!target || entry.outputs.some(output => used.has(sourceKey(output.source)))
    const empty = source && !inUse && entry.outputs.every(output => output.available === false)
    const issue = empty ? source.type?.startsWith('model.') ? '尚无生成结果' : '暂无可用内容' : [...new Set(entry.outputs.flatMap(output => associationIssues(output).map(issue => issue.message)))].join('；') || undefined
    return { ...entry, label: source && 'name' in source && source.name || (entry.kind === 'design' ? cardDefinitions[source?.type || '']?.title : undefined) || labelFor(entry.outputs[0]),
      description: `候选 ${entry.kind === 'design' ? `${cardDefinitions[source?.type || '']?.title || ''} ${name}`.trim() : name} · ${usages.length ? usages.join('；') : inUse ? '使用中' : '候选'}`,
      used: inUse, issue,
    }
  })
  const renderDetails = (entry: AssociationEntry, advanced: boolean, { close }: AssociationDetailContext) => {
    const source = document.cards?.find(value => value.id === entry.outputs[0].source.card_id)
    if (source?.type === 'direction.criterion') return <AcceptanceBasisDetails current={source as AcceptanceCriterionCard} receiverId={card.id} document={document} disabled={disabled} onDisconnect={onDisconnect} onLocateDesign={onLocateDesign} onClose={close} />
    return <>{entry.outputs.map(item => {
      const key = sourceKey(item.source), candidate = candidates.find(value => sourceKey(value.source) === key)
      if (!candidate) return null
      const anchorMedia = card.type === 'direction.anchor' && ['image', 'video'].includes(item.modality)
      const soundMedia = (card.type === 'direction.dialogue' && ['audio', 'video'].includes(item.modality) || card.type === 'direction.sound' && item.modality === 'audio')
      const connected = !!document.edges?.some(edge => edge.target_card === card.id && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)
      const localExample = 'examples' in card ? card.examples?.find(example => sourceKey(example.source) === key) : undefined
      const exampleConnected = document.edges?.some(edge => edge.target_card === card.id && edge.target_port === item.source.port_id + '_example' && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)
      const movement = source?.type === 'direction.movement' ? source as MovementCard : undefined
      const frameCandidate = card.type === 'direction.composition' && (!!movement || composition!.frame_target?.card_id === item.source.card_id)
      const target = frameCandidate && composition!.frame_target?.card_id === item.source.card_id ? composition!.frame_target : undefined
      const frameLabel = target ? movementFrameOptions(movement).find(option => option.value === target.state_id)?.label : undefined
      const usages = [...usageFor(key), ...(target ? [frameLabel ? '已定位 · ' + frameLabel : '定位失效'] : [])]
      const marked = card.type === 'direction.anchor' && 'markers' in card && 'examples' in card && card.markers?.some(marker => card.examples?.some(example => example.id === marker.example_id && sourceKey(example.source) === key))
      const state = marked ? '本地参考 · 已标记' : usages.length ? usages.join('；') : localExample ? '本地示例' : '候选'
      const reference = <WorkbenchButton disabled={disabled || !advanced || !focused.current?.current || !candidate.available} onClick={() => {
        close(false)
        focused.current?.current?.insertReference(item.source)
      }}>引用当前字段{focusedLabel.current ? `「${focusedLabel.current}」` : '（请先选择字段）'}</WorkbenchButton>
      return <div className="canvas-association-output" key={key}>
        <strong>{candidate.name}</strong><p>{state}</p>
        {candidate.disabledReason && <p>{candidate.disabledReason}</p>}
        {!soundMedia && item.modality === 'video' && localExample && <p>生成引用完整视频，参考区间不裁剪素材</p>}
        {soundMedia && onChange ? <SoundReferenceCandidate key={key} card={card as DialogueCard | SoundArrangementCard} item={item} disabled={disabled} connected={connected} onChange={onChange} />
          : anchorMedia && onChange ? <AnchorReferenceCandidate key={key} card={card as SpatialAnchorCard} item={item} disabled={disabled} onChange={onChange} expanded={expandedSource === key} onExpand={next => setExpandedSource(next ? key : undefined)} />
          : item.file_id && item.modality !== 'text' ? <MediaPreview fileId={item.file_id} type={item.modality} />
          : <CanvasTextPreview text={item.text || candidate.disabledReason || '来源尚未提供可用内容'} label="来源内容" lines={6} />}
        {onChange && <>
          {!anchorMedia && !soundMedia && 'examples' in card && (exampleConnected || localExample) && <WorkbenchButton
            disabled={disabled || !localExample && (!item.available || !item.file_id)}
            onClick={() => {
              if (localExample) onChange({ ...card, examples: card.examples?.filter(example => example.id !== localExample.id) } as GenerationCard)
              else if (item.file_id) onChange({ ...card, examples: [...(card.examples || []), { id: crypto.randomUUID(), source: item.source, file_id: item.file_id }] } as GenerationCard)
            }}>{localExample ? '取消本地参考' : '设为本地参考'}</WorkbenchButton>}
          <DesignCandidateRelations card={card} document={document} item={item} disabled={disabled} onChange={onChange} />
          {['direction.camera', 'direction.lighting', 'direction.focus', 'direction.movement', 'direction.composition'].includes(card.type || '') && <VisualDesignRelations card={card as CameraCard | LightingCard | FocusCard | MovementCard | CompositionCard} document={document} item={item} disabled={disabled} onChange={onChange} />}
          {frameCandidate ? <CompositionFrameCandidate card={composition!} movement={movement} sourceId={item.source.card_id} disabled={disabled} onChange={onChange} onLocate={(id, field) => { close(false); onLocateDesign?.(id, field) }} reference={reference} /> : reference}
        </>}
      </div>
    })}
      {onDisconnect && document.edges?.filter(edge => edge.source_card === entry.outputs[0].source.card_id && edge.target_card === card.id).slice(0, 1).map(edge => <WorkbenchButton key={edge.id} variant="quiet" disabled={disabled} onClick={() => { onDisconnect(edge.id); close() }}>断开候选连接</WorkbenchButton>)}
    </>
  }
  const renderCandidates = (advanced: boolean) => <CanvasAssociations entries={entries} sourceActions={sourceActions} loading={resolved.loading} error={resolved.error} sessionKey={`${card.id}:${editorOpen}:${advanced}`} expanded={!!expandedSource} onLocateSource={onLocateDesign} onInspect={() => setExpandedSource(undefined)} renderDetails={(entry, context) => renderDetails(entry, advanced, context)} />
  return <DesignReferenceContext.Provider value={{ card, document, savedRevision, candidates, disabled, targetField, issues: resolved.outputs.flatMap(output => output.payload && 'reference_issues' in output.payload ? output.payload.reference_issues || [] : []), focus: (handle, label) => { focused.current = handle; focusedLabel.current = label }, changeMode, renderCandidates }}><div className="design-reference-owner">{children}</div></DesignReferenceContext.Provider>
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
    // The editor drops empty text nodes on blur. Locating an empty field must not become an edit.
    const content = (parts: NonNullable<DesignFieldDocument['segments']>) => parts.filter(part => part.kind === 'reference' || part.text).map(part => part.kind === 'reference' ? ['reference', part.source] : ['text', part.text])
    if (JSON.stringify(content(segments)) === JSON.stringify(content(prompt.segments as NonNullable<DesignFieldDocument['segments']> || []))) return
    props.onChange(userDesignField({ ...value, document: { segments }, text }))
  }
  const phase = 'phases' in context.card ? context.card.phases?.find(item => item.frame === props.value) : undefined
  const fieldId = designFieldEntries(context.card).find(([, value]) => value === props.value)?.[0] || (phase ? 'phase:' + phase.id : cardDefinitions[context.card.type!]?.fields.find(field => field.label === props.label)?.id)
  const defaults = cardDefinitions[context.card.type!]?.fields.find(field => field.id === fieldId)?.default_value
  const hasMetadata = !!designFieldMetadata(value, defaults || { purpose: props.purpose || 'design' })
  return <div data-design-field={fieldId} onFocusCapture={event => { if ((event.target as HTMLElement).isContentEditable) context.focus(handle, props.label) }}><DesignFieldEditor {...props} metadataId={metadataId} defaults={defaults} editor={<PromptEditor referenceActionsRef={handle} compact allReferences fieldDescriptionId={hasMetadata ? metadataId : undefined} fieldLabel={`${props.label}内容`} fieldPlaceholder="输入设计参数，使用 @ 引用候选内容" document={context.document} card={context.card} value={prompt} candidates={context.candidates} disabled={context.disabled} onChange={onChange} />} />{context.issues.filter(issue => issue.field_id === fieldId).map(issue => <Typography.Text type="danger" role="alert" key={issue.reference_id} className="design-reference-issue">{issue.message}</Typography.Text>)}</div>
}
