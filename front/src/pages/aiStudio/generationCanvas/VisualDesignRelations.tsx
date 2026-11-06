import { Alert } from 'antd'
import type { CameraCard, LightingCard, FocusCard, MovementCard, CompositionCard, CanvasDocument, CanvasResolvedOutput } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { sourceKey } from './promptRules'
import { useCardCandidates } from './useCardCandidates'
import type { GenerationCard } from './graphRules'

type RelatedDesign = CameraCard | LightingCard | FocusCard | MovementCard | CompositionCard

/** 五类画面设计复用明确对象／镜头／验收关系；多用途来源在对应位置明确采用，取消用途保留来源连接。 */
export function VisualDesignRelations({ card, document, savedRevision, modelOutputs, disabled, onChange }: {
  onLocateDesign?: (cardId: string, fieldId: string) => void; card: RelatedDesign; document: CanvasDocument; savedRevision?: number; modelOutputs?: Record<string, CanvasResolvedOutput[]>; disabled?: boolean; onChange: (card: GenerationCard) => void
}) {
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const ports = card.type === 'direction.focus' ? ['attention_object', 'focus_object'] : card.type === 'direction.movement' ? ['attention_object'] : []
  const hasRelations = bindings.some(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)) || resolved.candidates.some(item => document.edges?.some(edge => edge.target_card === card.id && [...ports, 'shot'].includes(edge.target_port) && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id))
  if (!hasRelations) return null
  return (
    <section className="static-design-relations" aria-label="对象与所属镜头">
      {resolved.candidates.filter(item => item.payload?.kind === 'object_reference' || item.payload?.kind === 'narrative_reference' && 'category' in item.payload && item.payload.category === 'shot').map(item => <div key={sourceKey(item.source)}>{[...ports, 'shot'].filter(port => document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)).map(port => {
        const bound = bindings.find(binding => binding.input_port === port && sourceKey(binding.source) === sourceKey(item.source))
        const label = { attention_object: '关注对象', focus_object: '焦点对象', shot: '所属镜头' }[port]
        return <WorkbenchButton key={port} disabled={disabled || !item.available || port === 'shot' && !bound && bindings.some(binding => binding.input_port === 'shot')} onClick={() => onChange({ ...card, input_bindings: bound ? bindings.filter(binding => binding.id !== bound.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{bound ? '取消' : '选择'}{label} {item.payload && 'name' in item.payload ? item.payload.name : ''}</WorkbenchButton>
      })}</div>)}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><Alert type="warning" message="已采用关系来源缺失，请替换或取消" /><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}
    </section>
  )
}
