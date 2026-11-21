import { useUiText } from '../../../uiText'
import { CheckStatus } from './CheckStatus'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { useCheckCard, reportPending } from './CheckCardSession'
import './checkCard.css'

/** 卡面仅执行生成前检查；历史产物必须在详情中核对具体身份。 */
export function CheckCardFace({ onOpen }: { onOpen: (trigger: HTMLElement) => void }) {
  const uiText = useUiText()
  const state = useCheckCard()
  const { card, items, enabledItems, faceItems, itemState, itemName, latest, blocked, ready, reports } = state
  const counts = new Map<string, number>()
  enabledItems.forEach(item => counts.set(itemState(item), (counts.get(itemState(item)) || 0) + 1))
  const pending = state.currentPending
  const post = reports.find(report => report.product)
  const postStatus = post && (reportPending(post) ? '检查中' : post.executions?.some(row => row.status === 'failed') ? '执行失败'
    : post.results.some(row => row.outcome === 'nonconforming') ? '有明确问题'
      : post.results.some(row => row.outcome === 'indeterminate') ? '有无法判断项'
        : post.results.some(row => row.outcome === 'risk') ? '有风险建议' : '查看结果与范围')
  const open = (trigger: HTMLElement, itemId?: string) => {
    if (itemId) state.openItem(itemId)
    else state.setTab('pre')
    onOpen(trigger)
  }
  return <section className="generation-check-face" aria-label={uiText("生成前检查摘要")}>
    <p className="generation-check-target" title={state.cardName(state.targetId)}>{uiText("目标 ·")} {state.cardName(state.targetId)}</p>
    <p className="generation-check-counts" role="status">{uiText("已启用")} {enabledItems.length} {uiText("项")}{[...counts].map(([label, count]) => ` · ${uiText(label)} ${count}`).join('')}</p>
    <div className="generation-check-face-items">
      {faceItems.slice(0, 4).map(item => <div key={item.id} className="generation-check-face-row">
        <Button variant="quiet" className="generation-check-item-link" aria-label={uiText("查看检查项：{{value1}}", { value1: itemName(item) })} title={`${itemName(item)}：${item.requirement}`}
          onClick={event => open(event.currentTarget, item.id)}><span className="generation-check-face-title"><span>{itemName(item)}</span><CheckStatus status={itemState(item)}>{item.label} · {uiText(itemState(item))}</CheckStatus></span></Button>
        <Button size="small" aria-label={`${uiText(latest(item.id) ? '重新检查此项' : '检查此项')}：${itemName(item)}`}
          disabled={blocked || !!pending || item.availability === 'unavailable'} onClick={() => void state.run(item.id)}>{latest(item.id) ? uiText("重查") : uiText("检查")}</Button>
      </div>)}
      {!enabledItems.length && <p>{state.reason || uiText("尚未启用检查项，可在详情中配置")}</p>}
    </div>
    {enabledItems.length > 0 && (state.reason || state.error) && <p className="generation-check-face-reason" title={state.error || state.reason}>{state.error || state.reason}</p>}
    <div className="generation-check-face-actions">
      <Button variant="quiet" onClick={event => open(event.currentTarget)}>{uiText("全部")} {items.length} {uiText("项")}</Button>
      {pending ? <Button disabled={state.disabled || state.cancelling || pending.executions?.every(row => !['queued', 'running'].includes(row.status) || row.cancel_requested)} loading={state.cancelling} onClick={() => void state.cancel(pending.id)}>{uiText("取消本轮检查")}</Button>
        : <Button variant="primary" loading={state.running} disabled={blocked || !ready} onClick={() => void state.run()}>{reports.some(report => !report.product) ? uiText("重新检查") : uiText("检查")}</Button>}
    </div>
    <Button variant="quiet" className="generation-check-post-link" onClick={event => {
      if (post && post.basis.target_card_id !== state.targetId) state.openReport(post.id)
      else { state.setTab('post'); if (post) state.setPostTarget({ reportId: post.id, serial: Date.now() }) }
      onOpen(event.currentTarget)
    }}>{uiText("自动检查：")}{card.auto_post_check ? uiText("已开启") : uiText("已关闭")}{state.automaticWaitExpired ? uiText(" · 自动报告待刷新") : ''}{post ? uiText(" · {{value1}}产物 {{value2}}：{{postStatus}}", { value1: post.basis.target_card_id !== state.targetId ? '原目标' : '', value2: post.product!.position + 1, postStatus: uiText(postStatus || '') }) : ''}</Button>
  </section>
}
