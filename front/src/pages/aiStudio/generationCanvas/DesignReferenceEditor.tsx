import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { Popover } from 'antd'
import type { CanvasDocument, CanvasResolvedOutput, ReferenceDesignField, DesignFieldDocument } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { DesignFieldEditor } from './DesignFieldEditor'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor'
import type { EditorPromptDocument } from './inputBindings'
import { sourceKey, type Candidate } from './promptRules'
import { designReferences, isVisualDesign } from './designFieldReferences'
import { useCardCandidates } from './useCardCandidates'
import { referenceLabels } from './referenceLabels'
import { MaterialReferenceButton } from './MaterialReferenceButton'
import { MediaPreview } from './MediaContentEditor'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

type TargetField = { fieldId: string; serial: number }
interface ReferenceContext {
  targetField?: TargetField;
  document: CanvasDocument; card: GenerationCard; candidates: Candidate[]; disabled?: boolean;
  focus: (handle: React.RefObject<PromptEditorHandle>) => void;
  changeMode: () => void;
  renderCandidates: (advanced: boolean) => ReactNode;
}
export const DesignReferenceContext = createContext<ReferenceContext | undefined>(undefined)

/** Reference session belongs to one retained design card, not a model prompt binding set. */
export function DesignReferenceEditor({ card, document, savedRevision, modelOutputs, sourceActions, disabled, editorOpen, children, targetField }: { targetField?: TargetField; card: GenerationCard; document: CanvasDocument; savedRevision?: number; modelOutputs?: Record<string, CanvasResolvedOutput[]>; sourceActions?: ReactNode; disabled?: boolean; editorOpen?: boolean; children: ReactNode }) {
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const focused = useRef<React.RefObject<PromptEditorHandle>>(), owner = useRef<HTMLDivElement>(null)
  const [inspect, setInspect] = useState<string>()
  useEffect(() => { if (!editorOpen) { focused.current = undefined; setInspect(undefined) } }, [editorOpen])
  const used = new Set(designReferences(card, true).map(item => sourceKey(item.reference.source)))
  const retained = new Set(designReferences(card).map(item => sourceKey(item.reference.source)))
  const sources = [...resolved.candidates]
  for (const { reference } of designReferences(card)) if (!sources.some(item => sourceKey(item.source) === sourceKey(reference.source))) sources.push({ source: reference.source, modality: ['image', 'video', 'audio'].includes(reference.source.port_id) ? reference.source.port_id as 'image' | 'video' | 'audio' : 'text', available: false })
  const labels = referenceLabels(document, sources, card.id)
  const labelFor = (item: CanvasResolvedOutput) => labels.get(sourceKey(item.source)) || item.token || '@缺失来源'
  const candidates: Candidate[] = sources.map(item => {
    const source = document.cards?.find(value => value.id === item.source.card_id)
    const connected = item.source.canvas_id === document.id && document.edges?.some(edge => edge.target_card === card.id && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)
    const forbidden = source?.type?.startsWith('direction.') && item.source.port_id === 'text'
    return { source: item.source, token: item.token || '@缺失来源', displayLabel: labelFor(item), available: item.available !== false && !!connected && !forbidden, fileId: item.modality === 'image' ? item.file_id : undefined, name: source && 'name' in source && source.name || labelFor(item), disabledReason: forbidden ? '设计正文不支持互相引用' : !connected ? '来源未连接' : item.available === false ? '来源输出缺失' : undefined }
  })
  const changeMode = () => { focused.current = undefined; setInspect(undefined) }
  const renderCandidates = (advanced: boolean) => <div className="generation-material-references design-field-candidates" aria-label="设计候选内容">
    {sources.map(item => {
      const key = sourceKey(item.source), candidate = candidates.find(value => sourceKey(value.source) === key)!
      const state = used.has(key) ? '使用中' : retained.has(key) ? '已引用 · 未生效' : '候选'
      return <Popover key={key} placement="bottomLeft" trigger="click" open={inspect === key} onOpenChange={next => { if (!next) setInspect(undefined) }} overlayClassName="canvas-workbench-dialog design-source-inspect" content={<div><strong>{candidate.name}</strong><p>{state}{candidate.disabledReason && ` · ${candidate.disabledReason}`}</p>{item.file_id && item.modality !== 'text' ? <MediaPreview fileId={item.file_id} type={item.modality} /> : <CanvasTextPreview text={item.text || candidate.disabledReason || '来源尚未提供可用内容'} label="来源内容" lines={6} />}</div>}>
        <MaterialReferenceButton output={item} label={labelFor(item)} selected={used.has(key)} selectedLabel="使用中" data-design-source={key} aria-label={`候选 ${candidate.name} · ${state}`} title={`${labelFor(item)} · ${state}`} onMouseDown={event => { if (advanced && focused.current?.current) event.preventDefault() }} onClick={() => {
          if (advanced && focused.current?.current && !disabled && candidate.available) { setInspect(undefined); focused.current.current.insertReference(item.source) }
          else setInspect(previous => previous === key ? undefined : key)
        }}>{retained.has(key) && !used.has(key) && <span className="design-reference-inactive">未生效</span>}</MaterialReferenceButton>
      </Popover>
    })}
    <div className="generation-material-add">{sourceActions}</div>
    <small className="design-reference-hint">{advanced ? '输入 @ 或点击素材引用当前编辑字段' : `${sources.length} 个候选 · ${used.size} 个使用中`}</small>
  </div>
  return <DesignReferenceContext.Provider value={{ card, document, candidates, disabled, targetField, focus: handle => { focused.current = handle }, changeMode, renderCandidates }}><div className="design-reference-owner" ref={owner} onKeyDownCapture={event => {
    if (event.key !== 'Escape' || !inspect) return
    event.preventDefault(); event.stopPropagation()
    owner.current?.querySelector<HTMLButtonElement>(`[data-design-source="${CSS.escape(inspect)}"]`)?.focus({ preventScroll: true })
    setInspect(undefined)
  }}>{children}</div></DesignReferenceContext.Provider>
}

/** Reuse the model's editing surface; field source identities are persisted directly. */
export function ReferencedDesignFieldEditor(props: ComponentProps<typeof DesignFieldEditor>) {
  const context = useContext(DesignReferenceContext), handle = useRef<PromptEditorHandle>(null)
  if (!context || !isVisualDesign(context.card)) return <DesignFieldEditor {...props} />
  const value = props.value as ReferenceDesignField | undefined
  const prompt: EditorPromptDocument = value?.document as EditorPromptDocument || { segments: [{ id: 'text', kind: 'text', text: value?.text || '' }] }
  const onChange = (next: EditorPromptDocument) => {
    // A pasted model instruction is literal field data; it cannot configure this design's consumer.
    const segments: NonNullable<DesignFieldDocument['segments']> = (next.segments || []).flatMap<NonNullable<DesignFieldDocument['segments']>[number]>(segment => segment.kind === 'instruction' ? [{ id: segment.id, kind: 'text' as const, text: `/${segment.command} ${JSON.stringify(segment.parameters || {})} ` }, ...(segment.references || []).map(reference => ({ id: reference.id, kind: 'reference' as const, source: reference.source }))] : segment.kind === 'reference' ? [{ id: segment.id, kind: 'reference' as const, source: segment.source }] : [segment])
    const text = segments.map(segment => segment.kind === 'text' ? segment.text : context.candidates.find(item => sourceKey(item.source) === sourceKey(segment.source))?.displayLabel || '@缺失来源').join('')
    props.onChange({ ...value, document: { segments }, text, state: value?.state === 'empty' || !value?.state ? 'proposal' : value.state } as ReferenceDesignField)
  }
  const phase = 'phases' in context.card ? context.card.phases?.find(item => item.frame === props.value) : undefined
  const fieldId = Object.entries('fields' in context.card ? context.card.fields || {} : {}).find(([, value]) => value === props.value)?.[0] || (phase ? 'phase:' + phase.id : undefined)
  return <div data-design-field={fieldId} onFocusCapture={event => { if ((event.target as HTMLElement).isContentEditable) context.focus(handle) }}><DesignFieldEditor {...props} editor={<PromptEditor referenceActionsRef={handle} compact allReferences fieldLabel={`${props.label}内容`} fieldPlaceholder="输入设计参数，使用 @ 引用候选内容" document={context.document} card={context.card} value={prompt} candidates={context.candidates} disabled={context.disabled} onChange={onChange} />} /></div>
}
