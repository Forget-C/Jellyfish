import { Alert, Button, Tag } from 'antd'
import type { RevisionFieldTarget } from '../../../services/generated'
import type { instructionOptimization } from './instructionOptimization'
import type { ReadableContext } from './readableText'
import { readablePath } from './readableText'
import { relatedInstructionPath } from './instructionContent'

/** 影响说明只读；授权范围由原修订入口建立，采用仍走原业务校验。 */
export function InstructionOptimizationPreview({ impact, scope, context, onLocate }: { impact: ReturnType<typeof instructionOptimization>; scope: RevisionFieldTarget[] | null; context: ReadableContext; onLocate: (path: string) => void }) {
  const fieldName = (target: string, path: string) => target === 'unit' ? path === '/duration_ms' ? '单元时长（毫秒）' : path === '/ratio' ? '单元画幅' : `单元参数 · ${path}` : readablePath(path, context)
  const groupName = (id: string) => impact.preview?.groups.find(group => group.id === id)?.label || impact.graph.groups.find(group => group.id === id)?.label || '固定对象缺失'
  const relationList = (edges: typeof impact.added) => <ul>{edges.map(edge => <li key={edge.id}>{groupName(edge.from)} → {edge.label} → {groupName(edge.to)}<p>{readablePath(edge.sourcePath, context)}</p></li>)}</ul>
  const positions = (graph: typeof impact.graph, path: string) => {
    const requirements = new Set(graph.requirements.filter(requirement => relatedInstructionPath(requirement.path, path)).map(requirement => requirement.id))
    return [...new Map(graph.occurrences.filter(occurrence => requirements.has(occurrence.requirementId)).map(occurrence => [`${occurrence.start}:${occurrence.end}`, occurrence])).values()]
  }
  return <section className="instruction-optimization-preview" aria-label="局部优化影响核对">
    <h3>范围与影响核对</h3>
    <p>关联背景用于核对，不会自动加入允许修改范围；候选实际变化单独列出。</p>
    <details><summary>允许修改范围 · {scope ? `${scope.length} 项明确字段` : '整份指令中的合法字段'}</summary>{scope ? <ul>{scope.map(target => <li key={`${target.target}:${target.path}`}>{fieldName(target.target, target.path)}</li>)}</ul> : <p>整体调整仍受允许修改字段、共享要求和固定来源约束。</p>}</details>
    <details><summary>关联背景 · {impact.background.length} 组（只读）</summary>{impact.background.length ? <ul>{impact.background.map(({ group, via }) => <li key={group.id}><strong>{group.label}</strong> · {via.length === 1 ? '直接关联' : '间接关联'}{group.missing && ' · 固定引用缺失'}<ol>{via.map(id => { const edge = impact.graph.relations.find(row => row.id === id)!; return <li key={id}>{groupName(edge.from)} → {edge.label} → {groupName(edge.to)}<p>{readablePath(edge.sourcePath, context)}</p></li> })}</ol></li>)}</ul> : <p>尚无可可靠映射的关联背景；原文和固定输入仍可核对。</p>}<p>这些路径说明明确引用，不证明修改会改变全部关联要求；文本关系缺口不能用于自动传播。</p></details>
    <details><summary>共享背景与约束 · {impact.graph.groups.filter(group => group.shared).length} 组</summary>{impact.graph.groups.filter(group => group.shared).map(group => <details key={group.id}><summary>{group.label}</summary><pre>{JSON.stringify(group.value, null, 2)}</pre></details>)}<p>共享内容继续有效，局部修改不能豁免；需要修改时前往导演设计。</p></details>
    {impact.issues.map((issue, index) => <Alert key={index} type="warning" message={`${issue.index === undefined ? '' : `候选变化 ${issue.index + 1}：`}${issue.message}`} />)}
    {!!impact.changes.length && <details><summary>候选全部实际字段差异 · {impact.changes.length} 处</summary>{impact.changes.map((change, index) => <section key={index}><h4>{fieldName(change.target, change.path)}</h4><Tag color={change.inScope ? 'blue' : 'orange'}>{change.inScope ? '调整范围内' : '调整范围外'}</Tag><p>{change.reason}</p><strong>修改前完整值</strong><pre>{JSON.stringify(change.before, null, 2)}</pre><strong>拟修改完整值</strong><pre>{JSON.stringify(change.after, null, 2)}</pre>{change.reasons.map(reason => <p key={reason}>{reason}</p>)}</section>)}</details>}
    {!!impact.changes.length && <details><summary>变化涉及的全部正文位置</summary>{impact.changes.filter(change => change.target === 'design').map((change, index) => <section key={index}><h4>{fieldName(change.target, change.path)}</h4><strong>当前固定正文</strong>{positions(impact.graph, change.path).map(occurrence => <blockquote key={`${occurrence.start}:${occurrence.end}`}>{impact.graph.prompt?.text.slice(occurrence.start, occurrence.end)}</blockquote>)}{positions(impact.graph, change.path).length ? <Button onClick={() => onLocate(change.path)}>定位当前正文的全部位置</Button> : <p>没有可靠正文映射，按固定字段及完整原文核对。</p>}<strong>候选正文</strong>{impact.preview ? positions(impact.preview, change.path).map(occurrence => <blockquote key={`${occurrence.start}:${occurrence.end}`}>{impact.preview!.prompt?.text.slice(occurrence.start, occurrence.end)}</blockquote>) : <p>没有可核实的新位置，保留候选全文供核对。</p>}</section>)}<p>单元参数以固定输入和完整新指令核对；不按相似句子猜测位置。</p></details>}
    {!!impact.changes.length && <details><summary>候选关系与关联核对</summary>{impact.preview ? <><h4>真实新增关系 · {impact.added.length}</h4>{relationList(impact.added)}<h4>真实移除关系 · {impact.removed.length}</h4>{relationList(impact.removed)}<h4>未变化的直接关联 · {impact.unchanged.length}</h4>{relationList(impact.unchanged)}<p>未变化关联仍需核对，不能标作已修改。纯文本条件的改变以字段差异和完整新指令为准，不推断新增关系。</p></> : <p>此候选缺少可核实的完整映射，或已失效、超范围。关系变化未计算；全部实际字段差异与新指令全文仍保留，不能据此宣称关系已修复。</p>}</details>}
  </section>
}
