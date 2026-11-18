import type { GenerationCard } from './graphRules'
import { bindingReferences } from './inputBindings'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'

/** 复用编辑器的片段定位标记，不通过取消采用删除正文或指令。 */
export function InputBindingReferences({ card, bindingId, onLocate }: { card: GenerationCard; bindingId: string; onLocate?: () => void }) {
  return <>{bindingReferences(card, bindingId).map(reference => <WorkbenchButton key={reference.referenceId} size="small" variant="quiet" onClick={event => {
    const host = event.currentTarget.closest('.generation-card-editor')
    const target = host?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(reference.segmentId)}"]`)
    const panel = event.currentTarget.closest('details')
    if (panel && target) panel.open = false
    if (target) { onLocate?.(); target.tabIndex = -1; target.scrollIntoView({ block: 'nearest' }); target.focus({ preventScroll: true }) }
  }}>定位{reference.label}</WorkbenchButton>)}</>
}
