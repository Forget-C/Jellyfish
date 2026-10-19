import type { InstructionCheckRead } from '../../../services/generated'
import { designLabels } from './designLabels'

/** 展示检查的原始判断与诊断；不确认结果或改变当前适用性。 */
export function SceneInstructionCheckResult({ selected }: { selected: InstructionCheckRead }) {
  return <>{selected.result?.destinations && <section><h4>视频要求去向</h4><p>逐项核对只说明本次指令或参考的表达情况，不能保证模型最终遵从。</p>
    {selected.result.destinations.map((item, index) => <div key={`${item.owner}:${item.field}:${index}`}><strong>{item.owner} · {item.field} · {item.destination === 'instruction' ? '正文' : item.destination === 'reference' ? '实际参考' : '待处理'}</strong>
      <p>覆盖：{item.coverage_item_ids.join('、') || '全场'}；{item.instruction_excerpt && `正文：“${item.instruction_excerpt}”；`}{item.reference_id && `参考：${item.reference_id}；`}{item.rationale}</p></div>)}</section>}
    {selected.result?.rows.map(row => <section key={`${row.role}:${row.occurrence_id}`}><h4>{designLabels[row.role]} · 覆盖 {selected.inputs.unit.coverage.findIndex(item => item.id === row.occurrence_id) + 1} · {row.verdict === 'pass' ? '通过' : '需修改'}</h4>
          <p>{row.rationale}</p>{row.findings.map((finding, index) => <div key={index}><p>{finding.observation}</p><p>建议：{finding.suggestion.text || finding.suggestion.reason || '未填写'}</p><p>验收：{finding.acceptance.text || finding.acceptance.reason || '未填写'}</p></div>)}
        </section>)}</>
}
