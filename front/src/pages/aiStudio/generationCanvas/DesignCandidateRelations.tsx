import type { CanvasResolvedOutput, CanvasDocument } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import { candidateRelationPorts, withDesignRelation } from './designRelationRules'

/** Candidate host owns the popover; this area updates only explicit business roles. */
export function DesignCandidateRelations({ card, document, item, disabled, onChange }: { card: GenerationCard; document: CanvasDocument; item: CanvasResolvedOutput; disabled?: boolean; onChange: (card: GenerationCard) => void }) {
  const { portLabels, cardDefinitions, connectionPolicy } = useGraphRules()
  const bindings = 'input_bindings' in card ? card.input_bindings || [] : []
  return <div className="design-candidate-relations">{candidateRelationPorts(card, document, item).map(port => {
    const bound = bindings.find(binding => binding.input_port === port && sourceKey(binding.source) === sourceKey(item.source))
    const single = cardDefinitions[card.type || '']?.inputs.find(input => input.id === port)?.max_sources === 1
    const previous = single && bindings.find(binding => binding.input_port === port)
    const previousCard = previous && document.cards?.find(source => source.id === previous.source.card_id)
    const name = previousCard && 'name' in previousCard ? previousCard.name : '原来源'
    const label = portLabels[port] || port
    const connected = document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id && connectionPolicy(document, edge)?.adoption_allowed)
    return <WorkbenchButton key={port} variant="quiet" disabled={disabled || !bound && (!connected || item.available === false)} onClick={() => onChange(withDesignRelation(card, item, port, single))}>{bound ? `解除${label}` : previous ? `替换${label}：${name} → ${item.payload && 'name' in item.payload ? item.payload.name : item.token || '当前来源'}` : `用作${label}`}</WorkbenchButton>
  })}</div>
}
