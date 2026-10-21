import { Alert } from 'antd'
import type { CanvasBasisTarget, CanvasTarget, UnitScopeProjection_Output, UnitScopeUse_Output } from '../../../services/generated'
import { SourceLinks } from './Sources'
import { WorkbenchButton } from './ui/WorkbenchButton'

function ScopeRows({ title, rows, section, targets = [], onLocate }: {
  title: string; rows: UnitScopeUse_Output[]; section: CanvasBasisTarget['section']
  targets?: CanvasBasisTarget[]; onLocate?: (target: CanvasTarget) => void
}) {
  return <section aria-label={title}><h5>{title}</h5>{rows.length ? <ul>{rows.map((row, index) => {
    const address = targets.find(item => item.section === section && item.index === index)
    const target = address?.target
    return <li key={`${row.owner}:${row.field}:${index}`}><strong>{row.text}</strong> · {row.reason}
      {row.phase && <span> · 阶段：{({ video: '视频', sound: '声音', postproduction: '后期' })[row.phase]}</span>}
      {row.condition && <span> · 条件：{row.condition}</span>}
      <small> · {row.owner} / {row.field}{row.coverage_item_ids?.length ? ` · 覆盖：${row.coverage_item_ids.join('、')}` : ''}</small>
      {!!row.sources.length && <SourceLinks sources={row.sources} />}
      {target && onLocate && <WorkbenchButton variant="quiet" onClick={() => onLocate(target)}>定位来源字段</WorkbenchButton>}
      {address?.unavailable_reason && <small>{address.unavailable_reason}</small>}
    </li>
  })}</ul> : <p>无</p>}</section>
}

/** 指令历史与画布读取同一种实际范围；可定位地址只由当前 graph 明确提供。 */
export function UnitScopeSummary({ value, fieldTargets, onLocate }: {
  value: UnitScopeProjection_Output; fieldTargets?: CanvasBasisTarget[]; onLocate?: (target: CanvasTarget) => void
}) {
  return <div aria-label="本单元实际依据">
    <ScopeRows title="本次执行项" section="execution" rows={value.execution} targets={fieldTargets} onLocate={onLocate} />
    <ScopeRows title="适用约束" section="constraints" rows={value.constraints} targets={fieldTargets} onLocate={onLocate} />
    <ScopeRows title="解释背景" section="background" rows={value.background} targets={fieldTargets} onLocate={onLocate} />
    <section aria-label="未解决项"><h5>未解决项</h5>{value.unresolved.length
      ? <Alert type="warning" message="适用范围待核对" description={value.unresolved.join('；')} /> : <p>无</p>}</section>
  </div>
}
