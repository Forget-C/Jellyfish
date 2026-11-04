import type { CanvasDocument } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'

/** 连线维护关联；这里只读展示当前标准，并定位来源编辑。 */
export function AcceptanceBasisSelector({ card, document, onLocateDesign }: { card: GenerationCard; document: CanvasDocument; onLocateDesign?: (cardId: string, fieldId: string) => void }) {
  if (!('input_bindings' in card)) return null
  const bindings = (card.input_bindings || []).filter(binding => binding.input_port === 'acceptance_basis')
  return <section aria-label="关联的验收要求"><h3>关联的验收要求</h3>
    {!bindings.length && <small>连接验收要求卡以建立关联</small>}
    {bindings.map(binding => {
      const source = document.cards?.find(item => item.id === binding.source.card_id)
      const criterion = source && 'standard' in source ? source : undefined
      const standard = criterion?.standard
      const text = standard?.document ? standard.document.segments?.map(segment => {
        if (segment.kind === 'text') return segment.text
        const referenced = document.cards?.find(item => item.id === segment.source.card_id)
        return '@' + (referenced && 'name' in referenced && referenced.name || segment.source.card_id)
      }).join('') : standard?.text
      return <div key={binding.id}>
        <span>{criterion?.name || '未命名验收要求'}</span>
        <WorkbenchButton variant="quiet" disabled={!criterion || !onLocateDesign} onClick={() => onLocateDesign?.(binding.source.card_id, 'standard')}>查看验收要求</WorkbenchButton>
        <details><summary>展开标准</summary><CanvasTextPreview text={standard?.state === 'not_applicable' ? '不适用' : text || '标准尚未填写'} label="验收标准" /></details>
      </div>
    })}
  </section>
}
