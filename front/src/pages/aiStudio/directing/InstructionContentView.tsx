import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Radio, Select, Tag } from 'antd'
import type { EditableRevisionField, Prompt, ReviewPacket, ReviewRevisionCandidate, RevisionFieldTarget, WorkspaceRead } from '../../../services/generated'
import { InstructionRelationGraph } from './InstructionRelationGraph'
import { ProductionDetailContext } from './ProductionWorkbench'
import { decisionRanges } from './readableText'
import { ReadableText } from './ReadableContent'
import { contextForPrompt, readablePath } from './readableText'
import { blockChanges, blockFindings, blockPaths, blockShotLabels, instructionBlocks, instructionGraphBlocks, relatedInstructionPath, scopeForBlock } from './instructionContent'

/** 卡片始终展示固定正文；候选的真实字段变化附在对应内容旁，不替换当前版本。 */
export function InstructionContent({ prompt, promptId, workspace, fields, candidate, stale, scope, packet, instruction, frozenInstruction, reviewSource, candidateReviewSource, readOnly = false, onAdjust, onSuggestion, onEdit, onDesign, onPrepare }: {
  prompt: Prompt; promptId: string; workspace: WorkspaceRead; fields: EditableRevisionField[];
  candidate?: ReviewRevisionCandidate | null; stale: boolean; scope: RevisionFieldTarget[] | null;
  instruction: string; frozenInstruction?: string; reviewSource?: string; candidateReviewSource?: string; readOnly?: boolean; onSuggestion: (text: string) => void; packet?: ReviewPacket; onAdjust: (scope: RevisionFieldTarget[] | null, label: string) => void; onEdit: () => void; onDesign?: () => void; onPrepare?: () => void;
}) {
  const detail = useContext(ProductionDetailContext)
  const storageKey = `instruction-view:${workspace.sequence.project_id}:${workspace.sequence.id}:${prompt.plan_revision_id}:${prompt.unit_id}:${promptId}${readOnly ? ':history' : ''}`
  const [remembered] = useState(() => { try { const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} } })
  const [view, setView] = useState<'structured' | 'graph' | 'raw'>(['structured', 'graph', 'raw'].includes(remembered.view) ? remembered.view : readOnly ? 'graph' : 'structured')
  const [selected, setSelected] = useState<string>(typeof remembered.selected === 'string' ? remembered.selected : '')
  const [locationError, setLocationError] = useState('')
  const [missingPaths, setMissingPaths] = useState<string[]>([])
  const [locatedPaths, setLocatedPaths] = useState<string[]>([])
  const [locations, setLocations] = useState<string[]>([])
  const root = useRef<HTMLElement>(null)
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify({ view, selected })) } catch { /* 浏览记忆不影响业务操作。 */ } }, [storageKey, view, selected])
  const [copied, setCopied] = useState('')
  const context = contextForPrompt(workspace, promptId)
  const blocks = instructionBlocks(prompt, promptId)
  const previewBlocks = candidate?.preview_text && candidate.preview_decisions ? instructionBlocks({ ...prompt, text: candidate.preview_text, decisions: candidate.preview_decisions }, candidate.candidate_identity || 'preview') : []
  const graphBlocks = instructionGraphBlocks(prompt, promptId, blocks)
  const focused = graphBlocks.find(block => block.id === selected) || blocks.find(block => block.section === 'execution' && block.decisions.length) || blocks.find(block => block.section === 'execution') || blocks[0]
  const [focusTarget, setFocusTarget] = useState<{ id: string; mode: 'structured' | 'graph' }>()
  useEffect(() => {
    if (!focusTarget) return
    const frame = requestAnimationFrame(() => {
      const element = focusTarget.mode === 'structured' ? [...(root.current?.querySelectorAll<HTMLElement>('[data-instruction-block]') || [])].find(row => row.dataset.instructionBlock === focusTarget.id)?.querySelector<HTMLElement>('h3') : root.current?.querySelector<HTMLElement>('.instruction-relations')
      element?.scrollIntoView({ block: 'nearest' }); element?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTarget, view])
  const navigate = (id: string, mode: 'structured' | 'graph') => {
    setSelected(id); setView(mode); setLocationError('')
    setFocusTarget({ id, mode })
  }
  useEffect(() => {
    if (readOnly || detail.request?.tab !== 'content') return
    const paths = detail.request.paths || []
    const matches = blocks.filter(block => blockPaths(block, prompt.decisions).some(path => paths.some(affected => relatedInstructionPath(path, affected))))
    setLocations(matches.map(block => block.id)); setLocatedPaths(paths)
    if (matches.length) navigate(matches[0].id, view === 'graph' ? 'graph' : 'structured')
    else { setMissingPaths(paths); setLocationError('该问题没有可定位的正文映射，请核对固定依据。') }
    detail.consume()
  }, [detail.request])
  const changes = candidate?.changes || []
  const primaryBlock = (change: typeof changes[number]) => { const matches = blocks.filter(block => blockChanges(block, prompt.decisions, [change]).length); return matches.find(block => block.section === 'execution') || matches[0] }
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt.text); setCopied('已复制模型原文') }
    catch { setCopied('复制失败，请选择正文复制') }
  }
  return <><section ref={root} className="instruction-content" aria-label="本次指令正文">
    <header><h2>本次指令</h2>{!readOnly && <Button onClick={onEdit}>直接编辑</Button>}</header>
    <div className="prompt-view-toolbar"><Radio.Group aria-label="主区指令展示方式" value={view} optionType="button" options={[{ label: '结构化阅读', value: 'structured' }, { label: '关联图', value: 'graph' }, { label: '模型原文', value: 'raw' }]} onChange={event => setView(event.target.value)} /><Button onClick={() => { void copy() }}>复制模型原文</Button><span role="status">{copied}</span></div>
    <p className="design-secondary">{readOnly ? '历史只读；查看不改变当前工作对象。' : '当前固定指令；修改预览尚未采用。背景信息不能追加为本次执行动作。'}</p>
    {locationError && <p role="status">{locationError}<Button onClick={() => detail.show({ tab: 'text', paths: missingPaths })}>查看完整固定依据</Button></p>}
    {locations.length > 1 && <div aria-label="问题关联的正文位置"><p>该问题涉及 {locations.length} 处正文：</p>{locations.map((id, index) => { const block = blocks.find(row => row.id === id)!; return <Button key={id} onClick={() => navigate(id, view === 'graph' ? 'graph' : 'structured')}>{index + 1} · {blockShotLabels(block, prompt.decisions, context).join('、') || block.title}</Button> })}</div>}
    {view === 'graph' && focused ? <><Select aria-label="选择关联图内容" className="w-full" value={focused.id} options={graphBlocks.map((block, index) => ({ value: block.id, label: `${index + 1} · ${blockShotLabels(block, prompt.decisions, context).join('、') || '单元'} · ${block.title}${!block.text ? ' · ' + readablePath(blockPaths(block, prompt.decisions)[0], context) : ''} · ${block.section === 'background' ? '场次背景' : block.section === 'execution' ? '本次执行' : '指令内容'}` }))} onChange={setSelected} /><InstructionRelationGraph prompt={prompt} promptId={promptId} block={focused} packet={packet} reviewSource={reviewSource} candidateReviewSource={candidateReviewSource} candidate={candidate} stale={stale} instruction={instruction} scope={scope} frozenInstruction={frozenInstruction} context={context} fields={fields} readOnly={readOnly} onDesign={onDesign} onPrepare={onPrepare} onAdjust={onAdjust} onSuggestion={onSuggestion} onEditField={path => detail.show({ tab: 'revision', paths: [path] })} onLocate={() => navigate(focused.id, 'structured')} /></> : view === 'raw' ? <pre className="prompt-reader">{prompt.text}</pre> : <div className="instruction-card-grid">{blocks.map(block => {
      const targets = context.design && context.unit ? scopeForBlock(block, prompt.decisions, fields) : []
      const active = !!scope?.length && targets.some(target => scope.some(item => item.target === target.target && item.path === target.path))
      const issues = packet?.rows.filter(row => row.verdict !== 'pass' && packet.occurrences.some(occurrence => occurrence.id === row.occurrence_id && occurrence.prompt_revision_id === promptId)).flatMap(row => row.findings.filter(finding => blockFindings(block, prompt.decisions, finding))) || []
      const related = blockChanges(block, prompt.decisions, changes).filter(change => primaryBlock(change)?.id === block.id)
      const elsewhere = [...new Set(blockChanges(block, prompt.decisions, changes).flatMap(change => primaryBlock(change)?.id !== block.id ? [primaryBlock(change)!.id] : []))]
      return <section key={block.id} className={`instruction-card${selected === block.id ? ' is-focused' : ''}${active ? ' is-selected' : ''}`} data-instruction-block={block.id}>
        <header><h3 tabIndex={-1}>{block.title}</h3>{blockShotLabels(block, prompt.decisions, context).map(label => <span className="design-secondary" key={label}>{label}</span>)}<Tag>{block.section === 'background' ? '场次背景' : block.section === 'execution' ? '本次执行' : block.section === 'input' ? '固定输入' : '未分类'}</Tag>{active && <Tag color="blue">正在调整</Tag>}{!!issues.length && <Tag color="orange">{issues.length} 项问题</Tag>}</header>
        <div className="instruction-card-text"><ReadableText text={block.text} context={context} compiled={prompt.format_version === 'jellyfish-scene-v4'} selection={prompt.decisions.flatMap((decision, index) => locatedPaths.some(path => relatedInstructionPath(path, decision.section_path)) ? [index] : [])} ranges={decisionRanges(prompt.text, prompt.decisions).filter(range => range.start < block.end && range.end > block.start).map(range => ({ ...range, start: Math.max(0, range.start - block.start), end: Math.min(block.text.length, range.end - block.start) }))} onInspect={() => navigate(block.id, 'graph')} /></div>
        {!!related.length && <div className="instruction-card-preview"><strong>{stale ? '上次方案 · 待更新' : '拟修改字段'}</strong>{related.map((change, index) => <div key={index}><p>{change.target === 'unit' ? change.path === '/duration_ms' ? '时长（毫秒）' : '画幅' : readablePath(change.path, context)}</p><div><del>{typeof change.before === 'object' ? change.before?.text || change.before?.reason || JSON.stringify(change.before) : String(change.before)}</del> → <ins>{typeof change.after === 'object' ? change.after?.text || change.after?.reason || JSON.stringify(change.after) : String(change.after)}</ins></div><p>{change.reason}</p></div>)}</div>}
        {elsewhere.map(id => <p key={id}>此内容也涉及方案变化。<Button type="link" onClick={() => navigate(id, 'structured')}>查看主要差异位置</Button></p>)}
        {!!related.length && !!previewBlocks.length && <details className="instruction-preview-text"><summary>新指令相关片段{stale ? ' · 待更新' : ''}</summary>{previewBlocks.filter(next => next.section === block.section && blockChanges(next, candidate?.preview_decisions || [], related).length).map(next => <div className="instruction-card-text" key={next.id}><ReadableText text={next.text} context={context} compiled={prompt.format_version === 'jellyfish-scene-v4'} /></div>)}</details>}
        <Button type="link" onClick={() => navigate(block.id, 'graph')}>查看关联依据</Button>
        {!readOnly && <Button type="link" disabled={!fields.length} onClick={() => { setSelected(block.id); onAdjust(targets.length ? targets : null, targets.length ? [...blockShotLabels(block, prompt.decisions, context), block.title].join(' · ') : '') }}>{targets.length ? '调整这部分' : '说明整体修改要求'}</Button>}
      </section>
    })}{changes.filter(change => !blocks.some(block => blockChanges(block, prompt.decisions, [change]).length)).map((change, index) => <section className="instruction-card instruction-card-preview" key={`unmapped-${index}`}><h3>其他变化{stale ? ' · 待更新' : ''}</h3><p>{change.target === 'unit' ? change.path : readablePath(change.path, context)}</p><p>{change.reason}</p><p>完整差异与预览见下方修改方案。</p></section>)}</div>}
  </section>{!readOnly && detail.relationTarget && view !== 'graph' && focused && createPortal(<section className="instruction-relation-summary" aria-label="关联依据摘要"><h3>关联依据</h3><p>{focused.title} · {focused.section === 'background' ? '场次背景' : '当前固定指令'}</p><p>{blockPaths(focused, prompt.decisions).slice(0, 1).map(path => readablePath(path, context)).join('') || '该内容没有准确编译映射'}</p>{candidate && <p>{stale ? '修改预览待更新' : '修改预览尚未采用'}</p>}<Button onClick={() => navigate(focused.id, 'graph')}>展开关联图</Button></section>, detail.relationTarget)}</>
}
