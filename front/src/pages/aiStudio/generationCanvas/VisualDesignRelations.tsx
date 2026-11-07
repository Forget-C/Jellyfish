import { Alert } from 'antd'
import type { CameraCard, LightingCard, FocusCard, MovementCard, CompositionCard, CanvasDocument, CanvasResolvedOutput } from '../../../services/generated'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import type { GenerationCard } from './graphRules'

type RelatedDesign = CameraCard | LightingCard | FocusCard | MovementCard | CompositionCard

/** 五类画面设计复用明确对象／镜头／验收关系；多用途来源在对应位置明确采用，取消用途保留来源连接。 */
export function VisualDesignRelations({ card, document, item, disabled, onChange }: {
  onLocateDesign?: (cardId: string, fieldId: string) => void; card: RelatedDesign; document: CanvasDocument; item: CanvasResolvedOutput; disabled?: boolean; onChange: (card: GenerationCard) => void
}) {
  const { connectionPolicy, cardDefinitions } = useGraphRules()
  const bindings = card.input_bindings || []
  const ports = card.type === 'direction.focus' ? ['attention_object', 'focus_object'] : card.type === 'direction.movement' ? ['attention_object'] : []
  const retained = bindings.filter(binding => sourceKey(binding.source) === sourceKey(item.source))
  if (item.available === false) return <>{retained.map(binding => <div key={binding.id}><Alert type="warning" message="已采用关系来源缺失，请替换或取消" /><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}</>
  const eligible = item.payload?.kind === 'object_reference' || item.payload?.kind === 'narrative_reference' && 'category' in item.payload && item.payload.category === 'shot'
  if (!eligible) return null
  return <section className="static-design-relations" aria-label="对象与所属镜头">
    {[...ports, 'shot'].filter(port => document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id && connectionPolicy(document, edge)?.adoption_allowed)).map(port => {
      const bound = retained.find(binding => binding.input_port === port)
      const label = { attention_object: '关注对象', focus_object: '焦点对象', shot: '所属镜头' }[port]
      const single = cardDefinitions[card.type || '']?.inputs.some(input => input.id === port && input.max_sources === 1)
    const prior = single && bindings.some(binding => binding.input_port === port)
    return <WorkbenchButton key={port} disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bound ? bindings.filter(binding => binding.id !== bound.id) : [...bindings.filter(binding => !single || binding.input_port !== port), { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{bound ? '取消' : prior ? '替换' : '选择'}{label} {item.payload && 'name' in item.payload ? item.payload.name : ''}</WorkbenchButton>
    })}
  </section>
}
