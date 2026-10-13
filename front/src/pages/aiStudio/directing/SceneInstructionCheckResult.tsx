import type { InstructionCheckRead } from '../../../services/generated'
import { designLabels } from './designLabels'

/** 展示检查的原始判断与诊断；不确认结果或改变当前适用性。 */
export function SceneInstructionCheckResult({ selected }: { selected: InstructionCheckRead }) {
  return <>{selected.result?.rows.map(row => <section key={`${row.role}:${row.occurrence_id}`}><h4>{designLabels[row.role]} · 覆盖 {selected.inputs.unit.coverage.findIndex(item => item.id === row.occurrence_id) + 1} · {row.verdict === 'pass' ? '通过' : '需修改'}</h4>
          <p>{row.rationale}</p>{row.findings.map((finding, index) => <div key={index}><p>{finding.observation}</p><p>建议：{finding.suggestion.text || finding.suggestion.reason || '未填写'}</p><p>验收：{finding.acceptance.text || finding.acceptance.reason || '未填写'}</p></div>)}
        </section>)}</>
}
