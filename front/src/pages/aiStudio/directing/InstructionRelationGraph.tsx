import { graphNodeAppearance, GraphNodeType } from './graphAppearance'
import { useEffect, useRef, useState } from 'react'
import { Button } from 'antd'
import type { ReactNode } from 'react'
import type { EditableRevisionField, Prompt, ReviewPacket, ReviewRevisionCandidate, RevisionFieldTarget } from '../../../services/generated'
import type { ReadableContext } from './readableText'
import { readablePath } from './readableText'
import { ReadableText } from './ReadableContent'
import { FrozenDesignValue } from './PromptReader'
import { ReferencePreview } from './ReferencePreview'
import { referencePurposes } from './referenceInput'
import { instructionRelations, instructionRelationBrowse, instructionRelationKey as relationKey, type InstructionRelation, type InstructionRelationBrowse } from './instructionRelations'
import type { InstructionBlock } from './instructionContent'
import { scopeForBlock, blockShotLabels } from './instructionContent'
import { CanvasEdge, CanvasNodeButton, useCanvasConnections } from '../../../components/canvas/Canvas'

const columnLabels = { source: '固定依据', current: '当前指令与检查', revision: '调整与预览' }
const roleLabels: Record<string, string> = { direction: '导演设计', performance: '表演动作', staging: '场面调度', cinematography: '摄影构图', continuity: '连续性', prompt: '提示词' }

/** 固定布局只读关联图；选择节点不改变修改范围，也不发起业务任务。 */
export function InstructionRelationGraph({ prompt, promptId, block, packet, reviewSource, candidateReviewSource, candidate, stale, instruction, scope, frozenInstruction, context, fields, readOnly = false, onAdjust, onLocate, onSuggestion, onEditField, onDesign, onPrepare }: {
  prompt: Prompt; promptId: string; block: InstructionBlock; packet?: ReviewPacket; reviewSource?: string; candidateReviewSource?: string; candidate?: ReviewRevisionCandidate | null;
  stale: boolean; instruction: string; scope: RevisionFieldTarget[] | null; frozenInstruction?: string; context: ReadableContext; fields: EditableRevisionField[]; readOnly?: boolean;
  onAdjust: (scope: RevisionFieldTarget[] | null, label: string) => void; onLocate: () => void; onSuggestion: (text: string) => void; onEditField: (path: string) => void; onDesign?: () => void; onPrepare?: () => void;
}) {
  const graph = instructionRelations({ prompt, promptId, block, packet, reviewSource, candidateReviewSource, candidate, stale, instruction, scope, frozenInstruction, unit: context.unit, referenceIds: context.unit?.references.map(row => row.id) })
  const storageKey = `instruction-relations:${JSON.stringify([context.identity, promptId, block.id, reviewSource, readOnly])}`
  const [browse, setBrowse] = useState<InstructionRelationBrowse>(() => {
    try { return instructionRelationBrowse(JSON.parse(sessionStorage.getItem(storageKey) || 'null'), graph) }
    catch { return instructionRelationBrowse(null, graph) }
  })
  const { selected, selectedEdge, expanded, allRelations } = browse
  const setSelected = (value?: string) => setBrowse(current => ({ ...current, selected: value }))
  const setSelectedEdge = (value?: string) => setBrowse(current => ({ ...current, selectedEdge: value }))
  const graphIdentity = JSON.stringify([graph.nodes.map(node => node.id), graph.edges.map(relationKey)])
  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(instructionRelationBrowse(browse, graph))) }
    catch { /* 浏览记忆不可用不影响当前选择、输入或业务草稿。 */ }
  }, [storageKey, browse, graphIdentity])
  const { container, lines } = useCanvasConnections(JSON.stringify([promptId, block.id]), graph.edges.map(edge => ({ ...edge, id: relationKey(edge) })), JSON.stringify([expanded, graph.nodes.map(node => node.id)]))
  const root = useRef<HTMLElement>(null)
  const relationTrigger = useRef<HTMLElement | SVGElement>()
  const inspectRelation = (edge: InstructionRelation) => {
    const element = document.activeElement
    if (element instanceof HTMLElement || element instanceof SVGElement) relationTrigger.current = element
    setSelectedEdge(relationKey(edge))
  }
  const closeRelation = () => {
    const entry = allRelations ? [...(root.current?.querySelectorAll<HTMLElement>('[data-relation-id]') || [])].find(element => element.dataset.relationId === selectedEdge) : undefined
    setSelectedEdge(undefined)
    const target = relationTrigger.current?.isConnected ? relationTrigger.current : entry || root.current
    target?.focus()
  }
  const selectedRelation = graph.edges.find(edge => relationKey(edge) === selectedEdge)
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
  return <section ref={root} className="instruction-relations" tabIndex={-1} aria-label="指令关联图">
    <div className="instruction-relation-columns" ref={container}>
      <svg className="instruction-relation-lines" aria-label="指令关联关系">{lines.map(line => { const edge = graph.edges.find(row => relationKey(row) === line.id); if (!edge) return null; return <CanvasEdge key={line.id} d={line.d} label={`${edge.label}：${label(graph.nodes.find(row => row.id === edge.from)!)} → ${label(graph.nodes.find(row => row.id === edge.to)!)}`} indirect={!!edge.via?.length} tone={stale && edge.kind === 'change' ? 'neutral' : edge.kind === 'issue' ? 'amber' : edge.kind === 'target' ? 'blue' : edge.kind === 'change' ? 'green' : 'neutral'} className={`relation-${stale && edge.kind === 'change' ? 'stale' : edge.kind}`} selected={selectedEdge === line.id} muted={!!node && line.from !== node.id && line.to !== node.id} onInspect={() => inspectRelation(edge)} /> })}</svg>
      {(['source', 'current', 'revision'] as const).map(column => {
        const nodes = graph.nodes.filter(row => row.column === column), open = expanded.includes(column)
        return <div className="instruction-relation-column" key={column}><h3>{columnLabels[column]}</h3>{(open ? nodes : nodes.slice(0, 3)).map(row => <CanvasNodeButton nodeId={row.id} nodeType={row.kind} tone={graphNodeAppearance(row.kind).tone} selected={selected === row.id} muted={!!node && !related.has(row.id)} stale={stale && row.kind === 'change'} className={`instruction-relation-node node-${row.kind}`} data-relation-node={row.id} key={row.id} onClick={() => { setSelected(row.id); setSelectedEdge(undefined) }}><GraphNodeType type={row.kind} /><strong>{label(row)}</strong><span><ReadableText text={row.kind === 'reference' ? context.entities.find(entity => entity.kind === '参考' && entity.id === row.text)?.label || '固定参考待核对' : row.text} context={context} compiled={row.kind === 'text' && prompt.format_version === 'jellyfish-scene-v4'} /></span>{graph.edges.some(edge => edge.to === row.id && edge.kind === 'target') && <small>正在调整</small>}{graph.edges.some(edge => edge.to === row.id) && <small>{[...new Set(graph.edges.filter(edge => edge.to === row.id).map(edge => edge.label))].join(' · ')}</small>}{row.kind === 'source' && <small>{context.snapshotLabel}</small>}{row.kind === 'reference' && <small>{(() => { const reference = context.unit?.references.find(item => item.id === row.text); return reference ? `${referencePurposes[reference.purpose]} · ${{ image: '图片', video: '视频', audio: '声音' }[reference.media_kind]}` : '固定参考绑定缺失' })()}</small>}{row.kind === 'text' && <small>{block.section === 'background' ? '场次背景' : '当前固定版本'}</small>}</CanvasNodeButton>)}{!nodes.length && <p className="design-secondary">{column === 'source' ? '没有可定位的编译依据' : column === 'current' ? block.text ? '尚无检查问题' : '该依据没有可定位的正文；请查看固定依据或参考详情。' : '尚无修改要求或候选变化'}</p>}{nodes.length > 3 && <Button aria-label={`${open ? '收起' : '展开'}${columnLabels[column]}`} onClick={() => setBrowse(value => ({ ...value, expanded: open ? value.expanded.filter(item => item !== column) : [...value.expanded, column] }))}>{open ? '收起' : `还有 ${nodes.length - 3} 项`}</Button>}</div>
      })}
    </div>
    <p className="design-secondary">实线：直接关系；虚线：经字段与编译映射的间接关系。拟修改不代表已经采用或检查通过。</p>
    {!packet && <p>尚无检查结果。</p>}
    {candidate && <p role="status">{stale ? '方案基于上次输入，待更新。' : '方案已更新，尚未采用。'}</p>}
    <details open={allRelations} onToggle={event => { const open = event.currentTarget.open; setBrowse(value => value.allRelations === open ? value : { ...value, allRelations: open }) }}><summary>全部关联关系 · {graph.edges.length}</summary><ul>{graph.edges.map((edge, index) => <li key={index}><Button type="link" data-relation-id={relationKey(edge)} onClick={() => inspectRelation(edge)}>{label(graph.nodes.find(row => row.id === edge.from)!)} → {edge.label} → {label(graph.nodes.find(row => row.id === edge.to)!)}</Button></li>)}</ul></details>
    {selectedRelation && <section className="instruction-relation-detail" aria-label="关联关系详情"><header><h3>{selectedRelation.label}</h3><Button onClick={closeRelation}>收起关系详情</Button></header><p>{label(graph.nodes.find(row => row.id === selectedRelation.from)!)} → {label(graph.nodes.find(row => row.id === selectedRelation.to)!)}</p>{selectedRelation.via?.length ? <><p>间接关系，经固定字段及编译映射定位：</p><ul>{[...new Set(selectedRelation.via)].map(path => <li key={path}>{path.startsWith('/duration_ms') || path === '/ratio' ? path === '/ratio' ? '单元画幅' : '单元预计时长' : readablePath(path, context)}</li>)}</ul></> : <p>直接关系，来自当前固定编译决定或明确的方案引用。</p>}</section>}
    {node && <section className="instruction-relation-detail" aria-label="关联节点详情"><header><h3>{label(node)}</h3><Button onClick={() => { ([...(container.current?.querySelectorAll<HTMLElement>('[data-relation-node]') || [])].find(element => element.dataset.relationNode === selected) || root.current)?.focus(); setSelected(undefined) }}>收起详情</Button></header>{details}{!readOnly && node.kind === 'source' && node.path && ((node.target === 'unit' ? context.unit : context.design) && fields.some(field => field.target === node.target && field.path === node.path) ? <Button onClick={() => onEditField(node.path!)}>直接编辑对应字段</Button> : <><p>此依据当前不可直接编辑，请核对固定来源。</p>{(node.target === 'unit' ? onPrepare : onDesign) && <Button onClick={node.target === 'unit' ? onPrepare : onDesign}>{node.target === 'unit' ? '前往拍摄准备' : '前往导演设计'}</Button>}</>)}{block.text && <Button onClick={onLocate}>定位正文卡片</Button>}{!readOnly && node.kind === 'text' && <Button onClick={() => { const targets = context.design && context.unit ? scopeForBlock(block, prompt.decisions, fields) : []; onAdjust(targets.length ? targets : null, targets.length ? [...blockShotLabels(block, prompt.decisions, context), block.title].join(' · ') : '') }}>{scopeForBlock(block, prompt.decisions, fields).length ? '调整这部分' : '说明整体修改要求'}</Button>}{!readOnly && node.kind === 'request' && <Button onClick={() => document.getElementById('revision-instruction')?.focus()}>编辑统一修改要求</Button>}</section>}
  </section>
}
