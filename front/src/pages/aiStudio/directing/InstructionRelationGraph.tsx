import { useEffect, useId, useRef, useState } from 'react'
import { Button } from 'antd'
import type { ReactNode } from 'react'
import type { EditableRevisionField, Prompt, ReviewPacket, ReviewRevisionCandidate, RevisionFieldTarget } from '../../../services/generated'
import type { ReadableContext } from './readableText'
import { readablePath } from './readableText'
import { ReadableText } from './ReadableContent'
import { FrozenDesignValue } from './PromptReader'
import { ReferencePreview } from './ReferencePreview'
import { referencePurposes } from './referenceInput'
import { instructionRelations } from './instructionRelations'
import type { InstructionBlock } from './instructionContent'
import { scopeForBlock, blockShotLabels } from './instructionContent'

const columnLabels = { source: '固定依据', current: '当前指令与检查', revision: '调整与预览' }
const roleLabels: Record<string, string> = { direction: '导演设计', performance: '表演动作', staging: '场面调度', cinematography: '摄影构图', continuity: '连续性', prompt: '提示词' }

/** 固定布局只读关联图；选择节点不改变修改范围，也不发起业务任务。 */
export function InstructionRelationGraph({ prompt, promptId, block, packet, reviewSource, candidateReviewSource, candidate, stale, instruction, scope, frozenInstruction, context, fields, readOnly = false, onAdjust, onLocate, onSuggestion, onEditField, onDesign, onPrepare }: {
  prompt: Prompt; promptId: string; block: InstructionBlock; packet?: ReviewPacket; reviewSource?: string; candidateReviewSource?: string; candidate?: ReviewRevisionCandidate | null;
  stale: boolean; instruction: string; scope: RevisionFieldTarget[] | null; frozenInstruction?: string; context: ReadableContext; fields: EditableRevisionField[]; readOnly?: boolean;
  onAdjust: (scope: RevisionFieldTarget[] | null, label: string) => void; onLocate: () => void; onSuggestion: (text: string) => void; onEditField: (path: string) => void; onDesign?: () => void; onPrepare?: () => void;
}) {
  const markerId = useId().replace(/:/g, '')
  const graph = instructionRelations({ prompt, promptId, block, packet, reviewSource, candidateReviewSource, candidate, stale, instruction, scope, frozenInstruction, unit: context.unit, referenceIds: context.unit?.references.map(row => row.id) })
  const [selected, setSelected] = useState<string>()
  const [expanded, setExpanded] = useState<string[]>([])
  const [lines, setLines] = useState<Array<{ d: string; from: string; to: string; kind: string }>>([])
  const container = useRef<HTMLDivElement>(null)
  const graphIdentity = JSON.stringify(graph)
  useEffect(() => {
    const root = container.current
    if (!root) return
    const measure = () => {
      const box = root.getBoundingClientRect()
      const positions = new Map([...root.querySelectorAll<HTMLElement>('[data-relation-node]')].map(node => [node.dataset.relationNode, node.getBoundingClientRect()]))
      setLines(graph.edges.flatMap(edge => {
        const from = positions.get(edge.from), to = positions.get(edge.to)
        if (!from || !to) return []
        const sameColumn = Math.abs(from.left - to.left) < 20
        const reverse = from.left > to.left
        const x1 = (sameColumn ? from.left : reverse ? from.left : from.right) - box.left
        const x2 = (sameColumn ? to.left : reverse ? to.right : to.left) - box.left
        const y1 = from.top + from.height / 2 - box.top, y2 = to.top + to.height / 2 - box.top
        const control = sameColumn ? Math.min(x1, x2) - 14 : (x1 + x2) / 2
        return [{ d: `M${x1},${y1} C${control},${y1} ${control},${y2} ${x2},${y2}`, from: edge.from, to: edge.to, kind: stale && edge.kind === 'change' ? 'stale' : edge.kind }]
      }))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root); root.querySelectorAll('[data-relation-node]').forEach(node => observer.observe(node)); measure()
    return () => observer.disconnect()
  }, [graphIdentity, expanded.join(',')])
  const node = graph.nodes.find(row => row.id === selected)
  const related = new Set(node ? [node.id, ...graph.edges.filter(edge => edge.from === node.id || edge.to === node.id).flatMap(edge => [edge.from, edge.to])] : [])
  const label = (row: typeof graph.nodes[number]) => row.kind === 'text' ? [row.label, ...blockShotLabels(block, prompt.decisions, context)].join(' · ') : row.kind === 'source' && row.path ? row.target === 'unit' ? row.label : readablePath(row.path, context) : row.kind === 'issue' ? row.label.replace(/^([a-z]+) /, (_, role: string) => `${roleLabels[role] || role} `) : row.label
  let details: ReactNode = null
  if (node?.kind === 'source' && node.target === 'unit') details = <><p>{context.snapshotLabel}</p><p>{node.text}</p><p>固定计划内的单元参数。</p></>
  else if (node?.kind === 'source' && node.path) details = <><p>{context.snapshotLabel}</p><FrozenDesignValue design={context.design} pointer={node.path} /><p>{prompt.decisions[node.decisionIndex!]?.disposition === 'unexpressed' ? '未写入正文' : node.text}</p></>
  else if (node?.kind === 'reference') {
    const reference = context.unit?.references.find(row => row.id === node.text)
    details = reference ? <ReferencePreview reference={reference} /> : <p>固定参考绑定缺失；不能以当前资产替代。</p>
  } else if (node?.kind === 'change' && node.changeIndex !== undefined) {
    const change = candidate?.changes?.[node.changeIndex]
    const value = (input: unknown) => input && typeof input === 'object' && 'text' in input ? String((input as { text?: string; reason?: string }).text || (input as { reason?: string }).reason || '') : typeof input === 'object' ? JSON.stringify(input) : String(input)
    details = change && <><p>{change.target === 'design' ? readablePath(change.path, context) : change.path === '/duration_ms' ? '时长（毫秒）' : '画幅'}</p><p><del>{value(change.before)}</del> → <ins>{value(change.after)}</ins></p><p>{change.reason}</p><p>{stale ? '基于上次要求，需要更新后才能采用。' : '拟修改尚未采用，问题需要重新检查。'}</p></>
  } else if (node?.kind === 'issue') {
    const issue = packet?.rows.flatMap(row => row.findings.map((finding, index) => ({ finding, key: JSON.stringify([row.occurrence_id, row.role, index]) }))).find(row => row.key === node.issueKey)
    details = issue && <><p>{issue.finding.observation}</p><p>建议：{issue.finding.suggestion.text || issue.finding.suggestion.reason || '未提供'}</p><p>验收条件：{issue.finding.acceptance.text || issue.finding.acceptance.reason || '未提供'}</p>{!readOnly && <Button onClick={() => onSuggestion(issue.finding.suggestion.text || issue.finding.suggestion.reason || issue.finding.observation)}>加入修改要求</Button>}</>
  } else if (node) details = <div className="instruction-card-text"><ReadableText text={node.text} context={context} compiled={node.kind === 'text' && prompt.format_version === 'jellyfish-scene-v4'} /></div>
  return <section className="instruction-relations" tabIndex={-1} aria-label="指令关联图">
    <div className="instruction-relation-columns" ref={container}>
      <svg className="instruction-relation-lines" aria-hidden="true"><defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" style={{ fill: '#92a0b5', stroke: 'none' }} /></marker></defs>{lines.map((line, index) => <g key={index} opacity={node && line.from !== node.id && line.to !== node.id ? 0.35 : 1}><path d={line.d} className={`relation-${line.kind}`} markerEnd={`url(#${markerId})`} /></g>)}</svg>
      {(['source', 'current', 'revision'] as const).map(column => {
        const nodes = graph.nodes.filter(row => row.column === column), open = expanded.includes(column)
        return <div className="instruction-relation-column" key={column}><h3>{columnLabels[column]}</h3>{(open ? nodes : nodes.slice(0, 3)).map(row => <button type="button" className={`instruction-relation-node node-${row.kind}${selected === row.id ? ' is-selected' : ''}${node && !related.has(row.id) ? ' is-muted' : ''}${stale && row.kind === 'change' ? ' is-stale' : ''}`} data-relation-node={row.id} key={row.id} aria-pressed={selected === row.id} onClick={() => setSelected(row.id)}><strong>{label(row)}</strong><span><ReadableText text={row.kind === 'reference' ? context.entities.find(entity => entity.kind === '参考' && entity.id === row.text)?.label || '固定参考待核对' : row.text} context={context} compiled={row.kind === 'text' && prompt.format_version === 'jellyfish-scene-v4'} /></span>{graph.edges.some(edge => edge.to === row.id && edge.kind === 'target') && <small>正在调整</small>}{graph.edges.some(edge => edge.to === row.id) && <small>{[...new Set(graph.edges.filter(edge => edge.to === row.id).map(edge => edge.label))].join(' · ')}</small>}{row.kind === 'source' && <small>{context.snapshotLabel}</small>}{row.kind === 'reference' && <small>{(() => { const reference = context.unit?.references.find(item => item.id === row.text); return reference ? `${referencePurposes[reference.purpose]} · ${{ image: '图片', video: '视频', audio: '声音' }[reference.media_kind]}` : '固定参考绑定缺失' })()}</small>}{row.kind === 'text' && <small>{block.section === 'background' ? '场次背景' : '当前固定版本'}</small>}</button>)}{!nodes.length && <p className="design-secondary">{column === 'source' ? '没有可定位的编译依据' : column === 'current' ? block.text ? '尚无检查问题' : '该依据没有可定位的正文；请查看固定依据或参考详情。' : '尚无修改要求或候选变化'}</p>}{nodes.length > 3 && <Button aria-label={`${open ? '收起' : '展开'}${columnLabels[column]}`} onClick={() => setExpanded(value => open ? value.filter(item => item !== column) : [...value, column])}>{open ? '收起' : `还有 ${nodes.length - 3} 项`}</Button>}</div>
      })}
    </div>
    <p className="design-secondary">实线：明确编译／方案关系；虚线：问题涉及／调整目标。拟修改不代表已经采用或检查通过。</p>
    {!packet && <p>尚无检查结果。</p>}
    {candidate && <p role="status">{stale ? '方案基于上次输入，待更新。' : '方案已更新，尚未采用。'}</p>}
    <details><summary>全部关联关系 · {graph.edges.length}</summary><ul>{graph.edges.map((edge, index) => <li key={index}>{label(graph.nodes.find(row => row.id === edge.from)!)} → {edge.label} → {label(graph.nodes.find(row => row.id === edge.to)!)}</li>)}</ul></details>
    {node && <section className="instruction-relation-detail" aria-label="关联节点详情"><header><h3>{label(node)}</h3><Button onClick={() => setSelected(undefined)}>收起详情</Button></header>{details}{!readOnly && node.kind === 'source' && node.path && ((node.target === 'unit' ? context.unit : context.design) && fields.some(field => field.target === node.target && field.path === node.path) ? <Button onClick={() => onEditField(node.path!)}>直接编辑对应字段</Button> : <><p>此依据当前不可直接编辑，请核对固定来源。</p>{(node.target === 'unit' ? onPrepare : onDesign) && <Button onClick={node.target === 'unit' ? onPrepare : onDesign}>{node.target === 'unit' ? '前往拍摄准备' : '前往导演设计'}</Button>}</>)}{block.text && <Button onClick={onLocate}>定位正文卡片</Button>}{!readOnly && node.kind === 'text' && <Button onClick={() => { const targets = context.design && context.unit ? scopeForBlock(block, prompt.decisions, fields) : []; onAdjust(targets.length ? targets : null, targets.length ? [...blockShotLabels(block, prompt.decisions, context), block.title].join(' · ') : '') }}>{scopeForBlock(block, prompt.decisions, fields).length ? '调整这部分' : '说明整体修改要求'}</Button>}{!readOnly && node.kind === 'request' && <Button onClick={() => document.getElementById('revision-instruction')?.focus()}>编辑统一修改要求</Button>}</section>}
  </section>
}
