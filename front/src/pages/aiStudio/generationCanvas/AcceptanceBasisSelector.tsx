import type { CanvasDocument, CanvasResolvedOutput } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { sourceKey } from './promptRules'

/** 验收关系仅采用必要身份；标准正文须由模型另行直接采用。 */
export function AcceptanceBasisSelector({ card, document, candidates, disabled, onChange }: { card: GenerationCard; document: CanvasDocument; candidates: CanvasResolvedOutput[]; disabled?: boolean; onChange: (card: GenerationCard) => void }) {
  if (!('input_bindings' in card)) return null
  const bindings = card.input_bindings || []
  return <section aria-label="验收依据"><h3>验收依据</h3>
    {candidates.filter(item => item.payload?.kind === 'criterion_reference' && document.edges?.some(edge => edge.target_card === card.id && edge.target_port === 'acceptance_basis' && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)).map(item => {
      const binding = bindings.find(value => value.input_port === 'acceptance_basis' && sourceKey(value.source) === sourceKey(item.source))
      const name = item.payload && 'name' in item.payload ? item.payload.name : ''
      return <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), source: item.source, input_port: 'acceptance_basis' }] })}>{`${binding ? '取消验收关联' : '关联验收要求'} ${name}`}</WorkbenchButton>
    })}
  </section>
}
