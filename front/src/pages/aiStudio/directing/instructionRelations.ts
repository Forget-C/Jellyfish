import type { GenerationUnit_Output, Prompt, ReviewPacket, ReviewRevisionCandidate, RevisionFieldTarget } from '../../../services/generated'
import type { InstructionBlock } from './instructionContent'
import { blockChanges, blockFindings, blockPaths, relatedInstructionPath } from './instructionContent'
import { decisionRanges } from './readableText'
import { revisionIssueKey } from './reviewRevision'

export type InstructionRelationNode = {
  id: string; column: 'source' | 'current' | 'revision'; kind: 'source' | 'text' | 'issue' | 'request' | 'change' | 'reference';
  label: string; text: string; target?: 'design' | 'unit'; path?: string; changeIndex?: number; decisionIndex?: number; issueKey?: string; shotId?: string;
}
export type InstructionRelation = { from: string; to: string; label: string; kind: 'source' | 'issue' | 'target' | 'change'; via?: string[] }

export const instructionRelationKey = (edge: InstructionRelation) => JSON.stringify([edge.from, edge.to, edge.label, edge.via])
export type InstructionRelationBrowse = { selected?: string; selectedEdge?: string; expanded: string[]; allRelations: boolean }

/** 浏览记录只恢复当前投影中的身份；候选、检查或正文位置失效时不按名称替换。 */
export function instructionRelationBrowse(value: unknown, graph: { nodes: InstructionRelationNode[]; edges: InstructionRelation[] }): InstructionRelationBrowse {
  const empty = { expanded: [], allRelations: false }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty
  const record = value as Partial<InstructionRelationBrowse>
  return {
    selected: typeof record.selected === 'string' && graph.nodes.some(node => node.id === record.selected) ? record.selected : undefined,
    selectedEdge: typeof record.selectedEdge === 'string' && graph.edges.some(edge => instructionRelationKey(edge) === record.selectedEdge) ? record.selectedEdge : undefined,
    expanded: Array.isArray(record.expanded) ? [...new Set(record.expanded.filter(column => ['source', 'current', 'revision'].includes(column)))] : [],
    allRelations: record.allRelations === true,
  }
}

/** 只绘制冻结数据中的明确关系；草稿修改后不能将新要求连到旧候选。 */
export function instructionRelations({ prompt, promptId, block, packet, reviewSource, candidateReviewSource, candidate, stale, instruction, scope, frozenInstruction, unit, referenceIds = [] }: {
  prompt: Prompt; promptId: string; block: InstructionBlock; packet?: ReviewPacket; reviewSource?: string; candidateReviewSource?: string;
  candidate?: ReviewRevisionCandidate | null; stale: boolean; instruction: string; scope: RevisionFieldTarget[] | null; frozenInstruction?: string; unit?: GenerationUnit_Output; referenceIds?: string[];
}) {
  const nodes: InstructionRelationNode[] = block.text ? [{ id: block.id, column: 'current', kind: 'text', label: block.title, text: block.text }] : []
  const edges: InstructionRelation[] = []
  const paths = blockPaths(block, prompt.decisions)
  block.decisions.forEach(index => {
    const decision = prompt.decisions[index]
    if (!decision) return
    const id = `${promptId}:source:${decision.section_path}:${index}`
    nodes.push({ id, column: 'source', kind: 'source', label: '固定依据', text: decision.explanation, target: 'design', path: decision.section_path, decisionIndex: index })
    if ((decision.disposition === 'text' || decision.disposition === 'equivalent') && decisionRanges(prompt.text, [decision]).some(range => range.start < block.end && range.end > block.start)) edges.push({ from: id, to: block.id, label: decision.disposition === 'text' ? '写入正文' : '等效表达', kind: 'source' })
    else if (decision.disposition === 'reference' && decision.reference_id) {
      const referenceId = `${promptId}:reference:${decision.reference_id}`
      if (!nodes.some(node => node.id === referenceId)) nodes.push({ id: referenceId, column: 'current', kind: 'reference', label: '由参考表达', text: decision.reference_id, decisionIndex: index })
      if (referenceIds.includes(decision.reference_id)) edges.push({ from: id, to: referenceId, label: '由参考表达', kind: 'source' })
    }
  })
  if (unit && prompt.format_version === 'jellyfish-scene-v4' && block.section === 'input' && block.text.includes(`时长 ${Math.floor(unit.duration_ms / 1000)} 秒，画幅 ${unit.ratio}。`)) {
    for (const [path, label, text] of [['/duration_ms', '单元预计时长', `${unit.duration_ms / 1000} 秒`], ['/ratio', '单元画幅', unit.ratio]]) {
      const id = `${promptId}:unit:${path}`
      nodes.push({ id, column: 'source', kind: 'source', target: 'unit', path, label, text })
      edges.push({ from: id, to: block.id, label: '固定单元参数', kind: 'source' })
    }
  }
  const relatedKeys: string[] = []
  packet?.rows.forEach(row => row.findings.forEach((finding, index) => {
    const occurrence = packet.occurrences.find(item => item.id === row.occurrence_id)
    if (occurrence?.prompt_revision_id !== promptId || !blockFindings(block, prompt.decisions, finding)) return
    const key = revisionIssueKey(row, index), id = `${reviewSource || 'selected-check'}:${key}`
    relatedKeys.push(key)
    nodes.push({ id, column: 'current', kind: 'issue', label: `${row.role} · 镜头 ${occurrence.local_number} · ${row.verdict === 'pass' ? '已通过检查' : '检查问题'}`, text: finding.observation, issueKey: key, shotId: occurrence.shot_id })
    if (block.text) edges.push({ from: id, to: block.id, label: finding.affected_paths.some(path => paths.includes(path)) ? '涉及字段' : '涉及此组内容', kind: 'issue', via: paths.filter(path => finding.affected_paths.some(affected => relatedInstructionPath(path, affected))) })
  }))
  const targetsBlock = !scope || scope.some(item => item.target === 'design' ? paths.some(path => relatedInstructionPath(path, item.path)) : block.section === 'input' && block.kind === 'input')
  const requestId = `${promptId}:draft`
  if (instruction.trim() && targetsBlock) {
    nodes.push({ id: requestId, column: 'revision', kind: 'request', label: scope ? '局部要求 · 草稿' : '整体要求 · 草稿', text: instruction })
    if (scope && block.text) edges.push({ from: requestId, to: block.id, label: '调整目标', kind: 'target', via: scope.flatMap(item => item.target === 'design' ? paths.filter(path => relatedInstructionPath(path, item.path)) : [item.path]) })
  }
  const relatedChanges = blockChanges(block, prompt.decisions, candidate?.changes || [])
  if (relatedChanges.length && frozenInstruction?.trim() && (stale || !nodes.some(node => node.id === requestId))) nodes.push({ id: `${candidate?.candidate_identity}:request`, column: 'revision', kind: 'request', label: '本次方案的冻结要求', text: frozenInstruction })
  relatedChanges.forEach(change => {
    const index = candidate!.changes!.indexOf(change), id = `${candidate!.candidate_identity}:change:${change.target}:${change.path}`
    nodes.push({ id, column: 'revision', kind: 'change', label: stale ? '拟修改字段 · 待更新' : '拟修改字段', text: change.reason, path: change.path, changeIndex: index })
    if (block.text) edges.push({ from: block.id, to: id, label: stale ? '上次方案 · 待更新' : '当前 → 拟修改', kind: 'change', via: change.target === 'design' ? paths.filter(path => relatedInstructionPath(path, change.path)) : [change.path] })
    const frozenId = stale ? `${candidate?.candidate_identity}:request` : nodes.some(node => node.id === requestId) ? requestId : `${candidate?.candidate_identity}:request`
    if (nodes.some(node => node.id === frozenId)) edges.push({ from: frozenId, to: id, label: '本次方案', kind: 'source' })
    if (reviewSource && reviewSource === candidateReviewSource) change.problem_keys?.filter(key => relatedKeys.includes(key)).forEach(key => edges.push({ from: `${reviewSource || 'selected-check'}:${key}`, to: id, label: '方案关联问题', kind: 'issue' }))
  })
  return { nodes, edges }
}
