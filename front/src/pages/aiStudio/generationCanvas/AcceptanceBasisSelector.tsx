import type { CanvasDocument } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

/** 接收端从来源候选明确选择验收用途，取消用途保留多用途来源连接。 */
export function AcceptanceBasisSelector({ card, document, onLocateDesign, disabled, onChange }: { card: GenerationCard; document: CanvasDocument; disabled?: boolean; onChange: (card: GenerationCard) => void; onLocateDesign?: (cardId: string, fieldId: string) => void }) {
  if (!('input_bindings' in card)) return null
  const bindings = (card.input_bindings || []).filter(binding => binding.input_port === 'acceptance_basis')
  const candidates = document.cards?.filter(source => source.type === 'direction.criterion' && document.edges?.some(edge => edge.source_card === source.id && edge.target_card === card.id && edge.target_port === 'acceptance_basis')) || []
  return <section aria-label="关联的验收要求"><h3>关联的验收要求</h3>
    {!candidates.length && <small>连接验收要求卡，在此选择验收用途</small>}
    {candidates.map(source => {
      const binding = bindings.find(item => item.source.card_id === source.id)
      const criterion = source && 'standard' in source ? source : undefined
      const available = !!criterion?.criterion_id && !!criterion.name?.trim()
      const standard = criterion?.standard
      const text = standard?.document ? standard.document.segments?.map(segment => {
        if (segment.kind === 'text') return segment.text
        const referenced = document.cards?.find(item => item.id === segment.source.card_id)
        return '@' + (referenced && 'name' in referenced && referenced.name || segment.source.card_id)
      }).join('') : standard?.text
      return <div key={source.id}>
        <span>{criterion?.name || '未命名验收要求'}</span>
        <WorkbenchButton variant="quiet" disabled={!criterion || !onLocateDesign} onClick={() => onLocateDesign?.(source.id, 'standard')}>查看验收要求</WorkbenchButton>
        <WorkbenchButton disabled={disabled || !binding && !available} title={!binding && !available ? '填写验收要求名称后可关联' : undefined} onClick={() => onChange({ ...card, input_bindings: binding ? (card.input_bindings || []).filter(item => item.id !== binding.id) : [...(card.input_bindings || []), { id: crypto.randomUUID(), input_port: 'acceptance_basis', source: { canvas_id: document.id, card_id: source.id, port_id: 'criterion', position: 0, object_id: criterion?.criterion_id } }] })}>{binding ? '取消验收关联' : '关联验收要求'} {criterion?.name || '未命名验收要求'}</WorkbenchButton>
        {!binding && !available && <small>填写验收要求名称后可关联</small>}
        <details><summary>展开标准</summary><CanvasTextPreview text={standard?.state === 'not_applicable' ? '不适用' : text || '标准尚未填写'} label="验收标准" /></details>
      </div>
    })}
  </section>
}
