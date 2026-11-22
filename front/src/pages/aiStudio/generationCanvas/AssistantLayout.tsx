import { useState } from 'react'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import type { CanvasAssistantLayout } from '../../../services/generated'
import { useUiText } from '../../../uiText'

export function AssistantLayout({ layout, disabled, decide }: {
  layout: CanvasAssistantLayout
  disabled: boolean
  decide: (action: 'approve' | 'reject') => Promise<void>
}) {
  const uiText = useUiText()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const submit = async (action: 'approve' | 'reject') => {
    setBusy(true); setFailed(false)
    try { await decide(action) } catch { setFailed(true) } finally { setBusy(false) }
  }
  const positions = layout.placement && 'positions' in layout.placement ? layout.placement.positions : undefined
  return <section className="canvas-assistant-proposal" aria-label={uiText('布局建议')}>
    <strong>{uiText('布局建议')}</strong>
    {layout.group && <div>{uiText('分组 {{name}}', { name: layout.group.name })}</div>}
    {layout.placement?.kind === 'arrange' && <div>{uiText('整理布局')}</div>}
    <ul>
      {Object.entries(layout.before).map(([id, before]) => <li key={id}>
        {id} · {before.x}, {before.y}{positions?.[id] && <> → {positions[id].x}, {positions[id].y}</>}
      </li>)}
    </ul>
    {layout.state === 'proposed' && <>
      <WorkbenchButton variant="primary" disabled={disabled || busy} onClick={() => void submit('approve')}>{uiText('确认布局')}</WorkbenchButton>
      <WorkbenchButton variant="quiet" disabled={busy} onClick={() => void submit('reject')}>{uiText('拒绝布局')}</WorkbenchButton>
    </>}
    <small role="status">
      {layout.state === 'waiting' && uiText('等待画布执行布局')}
      {layout.state === 'applied' && uiText('布局已执行')}
      {layout.state === 'stale' && uiText('布局未执行，请核对当前卡片和位置')}
      {layout.state === 'rejected' && uiText('建议已拒绝')}
    </small>
    {failed && <small role="alert">{uiText('布局决定提交失败')}</small>}
  </section>
}
