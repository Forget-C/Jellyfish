import { Alert } from 'antd'
import type { UnitScopeProjection_Output, UnitScopeUse_Output } from '../../../services/generated'
import { SourceLinks } from './Sources'

function ScopeRows({ title, rows }: { title: string; rows: UnitScopeUse_Output[] }) {
  return <section aria-label={title}><h5>{title}</h5>{rows.length ? <ul>{rows.map((row, index) =>
    <li key={`${row.owner}:${row.field}:${index}`}><strong>{row.text}</strong> · {row.reason}
      {row.phase && <span> · 阶段：{({ video: '视频', sound: '声音', postproduction: '后期' })[row.phase]}</span>}
      {row.condition && <span> · 条件：{row.condition}</span>}
      <small> · {row.owner} / {row.field}{row.coverage_item_ids?.length ? ` · 覆盖：${row.coverage_item_ids.join('、')}` : ''}</small>
      {!!row.sources.length && <SourceLinks sources={row.sources} />}
    </li>)}</ul> : <p>无</p>}</section>
}

/** 同一份固定投影供正文依据和历史指令任务查看。 */
export function UnitScopeSummary({ value }: { value: UnitScopeProjection_Output }) {
  return <div aria-label="本单元实际依据">
    <ScopeRows title="本次执行项" rows={value.execution} />
    <ScopeRows title="适用约束" rows={value.constraints} />
    <ScopeRows title="解释背景" rows={value.background} />
    {!!value.unresolved.length && <Alert type="warning" message="适用范围待核对" description={value.unresolved.join('；')} />}
  </div>
}
