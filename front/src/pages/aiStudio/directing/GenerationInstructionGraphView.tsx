import { graphNodeAppearance, GraphNodeType } from './graphAppearance'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetailsHTMLAttributes } from 'react'
import { Alert, Button, Empty, Input, Select, Tag } from 'antd'
import type { EditableRevisionField, Note_Input, RevisionFieldTarget, WorkspaceRead } from '../../../services/generated'
import { CanvasEdge, CanvasNodeButton, useCanvasConnections } from '../../../components/canvas/Canvas'
import { generationInstructionGraph, requirementOccurrences } from './generationInstructionGraph'
import type { InstructionExpression, InstructionRequirementGroup } from './generationInstructionGraph'
import { contextForPrompt, readablePath } from './readableText'
import { instructionGraphBlocks, relatedInstructionPath } from './instructionContent'
import { DesignNote } from './DesignNote'
import { FrozenDesignValue } from './PromptReader'
import { SourceLinks } from './Sources'
import { ReferencePreview } from './ReferencePreview'
import { referencePurposes, referenceRoles } from './referenceInput'
import { revisionName } from './workspaceUsage'

const expressionLabels: Record<InstructionExpression, string> = { execution: '执行正文', background: '背景说明', input: '输入说明', text: '正文范围未分类', reference: '由固定参考表达', unexpressed: '编译明确未表达', 'not-expressed': '没有表达记录', unmapped: '表达映射待核对' }
type Browse = { layer: 'design' | 'production' | 'instruction' | 'detail'; scope: string; selected?: string; query: string; scroll?: number; expanded?: string[] }
const initial: Browse = { layer: 'instruction', scope: 'all', query: '' }

/** 完整指令以要求关系为主体，固定输入和共享约束始终可达；浏览不建立修订范围。 */
export function GenerationInstructionGraphView({ workspace, promptId, fields, readOnly, onProvenance, onLocate, onAdjust, onDesign, onPrepare }: {
  workspace: WorkspaceRead; promptId: string; fields: EditableRevisionField[]; readOnly: boolean;
  onProvenance: (blockId: string) => void; onLocate: (blockId: string) => void;
  onAdjust: (scope: RevisionFieldTarget[] | null, label: string) => void; onDesign?: () => void; onPrepare?: () => void;
}) {
  const graph = useMemo(() => generationInstructionGraph(workspace, promptId), [workspace, promptId])
  const context = useMemo(() => contextForPrompt(workspace, promptId), [workspace, promptId])
  const storageKey = `generation-instruction-graph:${graph.contextKey}:${readOnly ? 'history' : 'working'}`
  const disclosureIds = ['shared', 'unit-context', 'relations', 'inputs', 'unit', 'gaps', 'raw', ...graph.groups.map(group => `object:${group.id}`), ...(graph.unit?.references.map(reference => `reference:${reference.id}`) || [])]
  const validBrowse = (value: Browse) => value && ['design', 'production', 'instruction', 'detail'].includes(value.layer) && typeof value.query === 'string' && (value.scope === 'all' || graph.coverage.some(row => row.occurrenceId === value.scope)) && (value.selected === undefined ? value.layer !== 'detail' : graph.groups.some(row => row.id === value.selected)) && (value.scroll === undefined || Number.isFinite(value.scroll) && value.scroll >= 0) && (value.expanded === undefined || Array.isArray(value.expanded) && value.expanded.every(id => disclosureIds.includes(id)) && new Set(value.expanded).size === value.expanded.length)
  const [browse, setBrowse] = useState<{ current: Browse; previous: Browse[] }>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) || '{}')
      if (validBrowse(value.current) && Array.isArray(value.previous) && value.previous.every(validBrowse)) return value
    } catch { /* 浏览记录损坏时保留固定上下文，不影响业务草稿。 */ }
    return { current: initial, previous: [] }
  })
  useEffect(() => { try { sessionStorage.setItem(storageKey, JSON.stringify(browse)) } catch { /* 浏览记忆不可用不影响当前输入和业务草稿。 */ } }, [storageKey, browse])
  const root = useRef<HTMLElement>(null), returnTrigger = useRef<HTMLElement>()
  const relationTrigger = useRef<HTMLElement | SVGElement>()
  const [relationId, setRelationId] = useState<string>()
  const state = browse.current
  const change = (next: Partial<Browse> | ((current: Browse) => Partial<Browse>), push = false) => {
    const scroller = root.current?.closest('.production-content, .workbench-primary-scroll')
    setBrowse(previous => ({ current: { ...previous.current, ...(typeof next === 'function' ? next(previous.current) : next) }, previous: push ? [...previous.previous, { ...previous.current, scroll: scroller?.scrollTop || 0 }] : previous.previous }))
  }
  const disclosure = (id: string): Pick<DetailsHTMLAttributes<HTMLDetailsElement>, 'open' | 'onToggle'> => ({
    open: !!state.expanded?.includes(id),
    onToggle: event => {
      const open = event.currentTarget.open
      if (open !== !!state.expanded?.includes(id)) change(current => ({ expanded: open ? [...new Set([...(current.expanded || []), id])] : current.expanded?.filter(item => item !== id) }))
    },
  })
  const back = () => {
    const previous = browse.previous[browse.previous.length - 1]
    if (!previous) return
    const trigger = document.activeElement
    const value = { current: previous, previous: browse.previous.slice(0, -1) }; setBrowse(value)
    requestAnimationFrame(() => {
      if (document.activeElement !== trigger && document.activeElement !== document.body) return
      const scroller = root.current?.closest('.production-content, .workbench-primary-scroll')
      if (scroller) scroller.scrollTop = previous.scroll || 0
      const selectedNode = [...(root.current?.querySelectorAll<HTMLElement>('[data-canvas-node]') || [])].find(node => node.dataset.canvasNode === previous.selected)
      const focusElement = selectedNode || root.current?.querySelector<HTMLElement>('.generation-layer-path [aria-pressed="true"]')
      focusElement?.focus({ preventScroll: true })
    })
  }
  const scope = graph.coverage.find(row => row.occurrenceId === state.scope)
  const groupExpressions = (group: InstructionRequirementGroup) => [...new Set(graph.requirements.filter(row => row.groupId === group.id).flatMap(row => row.expressions))]
  const withinScope = (group: InstructionRequirementGroup) => group.shared || !scope || group.coverageIds.includes(scope.id)
  const relevant = graph.groups.filter(group => group.related && withinScope(group))
  const matches = (group: InstructionRequirementGroup) => !state.query.trim() || `${group.label} ${JSON.stringify(group.value)}`.toLowerCase().includes(state.query.trim().toLowerCase())
  const visible = relevant.filter(group => !group.shared && matches(group))
  const columns = [visible.filter(group => /^(event|participant|anchor):/.test(group.objectKey)), visible.filter(group => /^(shot|beat|blocking|performance|activity|situation):/.test(group.objectKey)), visible.filter(group => !/^(event|participant|anchor|shot|beat|blocking|performance|activity|situation):/.test(group.objectKey))]
  const visibleIds = new Set(visible.map(group => group.id))
  const edges = graph.relations.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to))
  const { container, lines } = useCanvasConnections(graph.contextKey, edges, JSON.stringify([state.layer, state.scope, visible.map(group => group.id)]))
  const selected = graph.groups.find(group => group.id === state.selected)
  const relatedEdges = selected ? graph.relations.filter(edge => edge.from === selected.id || edge.to === selected.id) : []
  const inspectedRelation = edges.find(edge => edge.id === relationId)
  const inspectRelation = (id: string) => { if (document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement) relationTrigger.current = document.activeElement; setRelationId(id) }
  const choose = (id: string, remember = false) => { if (document.activeElement instanceof HTMLElement) returnTrigger.current = document.activeElement; change({ selected: id }, remember) }
  const scopeName = (shotId: string) => context.entities.find(entity => entity.kind === '镜头' && entity.id === shotId)?.label || '固定镜头缺失'
  const node = (group: InstructionRequirementGroup) => <CanvasNodeButton key={group.id} nodeId={group.id} nodeType={group.objectKey.split(':')[0]} tone={graphNodeAppearance(group.objectKey.split(':')[0]).tone} selected={selected?.id === group.id} missing={group.missing} className="instruction-relation-node generation-requirement-group" onClick={() => choose(group.id)}><GraphNodeType type={group.objectKey.split(':')[0]} /><strong>{group.label}</strong><small>{group.shared ? '共享背景／约束' : '与本次有关'} · {group.requirementIds.length} 项要求{group.coverageIds.length > 1 ? ` · 关联 ${group.coverageIds.length} 个覆盖位置` : ''}</small><span>{groupExpressions(group).map(expression => expressionLabels[expression]).join(' · ') || '对象引用'}</span>{group.missing && <small>固定引用缺失</small>}</CanvasNodeButton>
  const unit = graph.unit
  return <section ref={root} className="generation-instruction-graph" aria-label="完整指令要求关系">
    <p>{context.snapshotLabel}</p>
    <p className="design-secondary">展示生成规格与固定输入；实际素材仍需审片。节点位置不表示动作顺序，浏览不会改变调整对象。</p>
    <nav className="generation-layer-path" aria-label="本次生成表达层次">{([['design', '设计依据'], ['production', '生产与输入'], ['instruction', '指令关系'], ['detail', '要求细节']] as const).map(([layer, label]) => <Button key={layer} aria-pressed={state.layer === layer} disabled={layer === 'detail' && !selected} onClick={() => change({ layer }, true)}>{label}</Button>)}{!!browse.previous.length && <Button onClick={back}>返回上一范围</Button>}</nav>
    <div className="generation-graph-tools"><Select aria-label="本次指令覆盖范围" value={state.scope} options={[{ value: 'all', label: '本次全部覆盖' }, ...graph.coverage.map((row, index) => ({ value: row.occurrenceId, label: `${index + 1} · ${scopeName(row.shot_id)} · ${row.action_scope}` }))]} onChange={scope => change({ scope, selected: undefined }, true)} /><Input aria-label="查找本次要求" allowClear value={state.query} placeholder="查找要求或对象" onChange={event => change({ query: event.target.value })} /></div>
    {graph.gaps.filter(gap => gap.kind === 'missing-source' && !gap.groupId || gap.kind === 'legacy').map(gap => <Alert key={gap.id} type="warning" message={gap.text} />)}
    <details className="generation-shared-requirements" {...disclosure('shared')}><summary>共享背景与约束 · {graph.groups.filter(group => group.shared).length} 组（局部浏览始终保留）</summary><div className="generation-shared-grid">{graph.groups.filter(group => group.shared).map(node)}</div></details>
    {!!scope && <details {...disclosure('unit-context')}><summary>未对应本次覆盖位置的关联依据 · {graph.groups.filter(group => group.related && !group.shared && !group.coverageIds.length).length} 组</summary><p>保留来源供核对，不视为当前动作段的追加执行要求。</p><div className="generation-shared-grid">{graph.groups.filter(group => group.related && !group.shared && !group.coverageIds.length).map(node)}</div></details>}
    {state.layer === 'design' ? <section aria-label="本次固定设计依据"><h3>设计意图与相关对象</h3><SourceLinks sources={workspace.designs.find(row => row.id === graph.designId)?.content.sources || []} /><div className="generation-shared-grid">{relevant.filter(group => !group.shared).map(group => <div key={group.id}>{node(group)}<Button onClick={() => change({ selected: group.id, layer: 'detail' }, true)}>下钻这组要求</Button></div>)}</div></section> : state.layer === 'production' ? <section aria-label="本次固定生产覆盖"><h3>固定单元的覆盖位置</h3>{graph.coverage.map((row, index) => <section className="instruction-relation-detail" key={row.occurrenceId}><h4>{index + 1} · {scopeName(row.shot_id)}</h4><p>{row.action_scope}</p><p>{row.groupIds.length} 组相关设计要求；计划覆盖不证明实际媒体完成。</p><Button onClick={() => change({ scope: row.occurrenceId, layer: 'instruction', selected: undefined }, true)}>下钻此覆盖的指令</Button></section>)}</section> : state.layer === 'instruction' ? <>
      {!visible.length && <Empty description={state.query ? '当前范围没有匹配要求；原文、共享约束和固定输入仍保留。' : '暂无可可靠映射的局部要求；请查看完整原文与映射核对。'} />}
      <div ref={container} className="instruction-relation-columns generation-requirement-columns"><svg className="instruction-relation-lines" aria-label="要求之间的明确关系">{lines.map(line => { const edge = edges.find(edge => edge.id === line.id); if (!edge) return null; return <CanvasEdge key={edge.id} d={line.d} selected={relationId === edge.id} label={`${edge.label}：${graph.groups.find(group => group.id === edge.from)?.label} → ${graph.groups.find(group => group.id === edge.to)?.label}`} onInspect={() => inspectRelation(edge.id)} muted={!!selected && edge.from !== selected.id && edge.to !== selected.id} /> })}</svg>{columns.map((column, index) => <div className="instruction-relation-column" key={index}><h3>{['对象与条件', '动作与调度', '摄影、声音与验收'][index]}</h3>{column.map(node)}</div>)}</div>
      <details {...disclosure('relations')}><summary>当前范围的明确要求关系 · {edges.length}</summary><ul>{edges.map(edge => <li key={edge.id}><Button type="link" onClick={() => inspectRelation(edge.id)}>{graph.groups.find(group => group.id === edge.from)?.label} → {edge.label} → {graph.groups.find(group => group.id === edge.to)?.label}</Button><p>{readablePath(edge.sourcePath, context)}</p></li>)}</ul></details>
      {inspectedRelation && <section className="instruction-relation-detail" aria-label="要求关系说明"><header><h3>{inspectedRelation.label}</h3><Button onClick={() => { setRelationId(undefined); requestAnimationFrame(() => { if (relationTrigger.current?.isConnected) relationTrigger.current.focus() }) }}>关闭要求关系说明</Button></header><p>{graph.groups.find(group => group.id === inspectedRelation.from)?.label} → {graph.groups.find(group => group.id === inspectedRelation.to)?.label}</p><p>直接引用，依据本次固定设计：{readablePath(inspectedRelation.sourcePath, context)}</p><Button onClick={() => choose(inspectedRelation.from)}>查看起点要求</Button><Button onClick={() => choose(inspectedRelation.to)}>查看终点要求</Button></section>}
    </> : !selected && <Empty description="先选择一组要求，再查看细节。" />}
    {selected && <section className="instruction-relation-detail generation-requirement-detail" aria-label="完整要求详情"><header><h3>{selected.label}</h3><Button onClick={() => { change({ selected: undefined, layer: state.layer === 'detail' ? 'instruction' : state.layer }); requestAnimationFrame(() => { const target = returnTrigger.current?.isConnected ? returnTrigger.current : [...(root.current?.querySelectorAll<HTMLElement>('[data-canvas-node]') || [])].find(node => node.dataset.canvasNode === selected.id) || root.current?.querySelector<HTMLElement>('.generation-layer-path [aria-pressed="true"]'); target?.focus({ preventScroll: true }) }) }}>收起要求详情</Button></header><p>{selected.shared ? '共享背景／约束；局部调整不能豁免。' : selected.coverageIds.length ? `关联 ${selected.coverageIds.length} 个覆盖位置。` : '单元相关依据，尚未对应到具体覆盖位置。'}</p>
      {graph.requirements.filter(requirement => requirement.groupId === selected.id).map(requirement => {
        const occurrences = requirementOccurrences(graph, requirement.id)
        const targets = !requirement.shared && requirement.exists && requirement.decisions.length && graph.prompt?.format_version === 'jellyfish-scene-v4' ? fields.filter(field => field.target === 'design' && relatedInstructionPath(field.path, requirement.path)).map(({ target, path }) => ({ target, path })) : []
        const sourceBlock = occurrences[0]?.blockIds[0] || (graph.prompt ? instructionGraphBlocks(graph.prompt, promptId, graph.blocks) : []).find(block => block.decisions.some(index => requirement.decisions.includes(index)))?.id
        return <section key={requirement.id} className="generation-requirement-field"><h4>{readablePath(requirement.path, context)}</h4><p>{requirement.expressions.map(expression => <Tag key={expression}>{expressionLabels[expression]}</Tag>)}</p>{requirement.value && typeof requirement.value === 'object' && 'state' in requirement.value ? <><DesignNote note={requirement.value as Note_Input} /><SourceLinks sources={(requirement.value as Note_Input).sources || []} /></> : requirement.exists ? <pre>{JSON.stringify(requirement.value, null, 2)}</pre> : <p>此固定来源不可用，不能精确编辑。</p>}
          {occurrences.map((occurrence, index) => <div key={occurrence.id}><p>正文位置 {index + 1} · {graph.prompt?.text.slice(occurrence.start, occurrence.end)}</p>{occurrence.blockIds.map(blockId => <Button key={blockId} onClick={() => onLocate(blockId)}>定位正文片段 {index + 1}</Button>)}</div>)}
          {sourceBlock && <Button onClick={() => onProvenance(sourceBlock)}>查看依据、检查与修订</Button>}
          {!readOnly && (targets.length ? <Button onClick={() => onAdjust(targets, `${selected.label} · ${requirement.label}`)}>调整此要求</Button> : onDesign && <Button onClick={onDesign}>前往导演设计核对</Button>)}
        </section>
      })}
      <h4>直接关联及范围外影响</h4><ul>{relatedEdges.map(edge => { const other = graph.groups.find(group => group.id === (edge.from === selected.id ? edge.to : edge.from))!; return <li key={edge.id}><Button type="link" onClick={() => choose(other.id, true)}>{edge.label} · {other.label}{!withinScope(other) ? ' · 当前范围外' : ''}</Button><p>{readablePath(edge.sourcePath, context)}</p></li> })}</ul>
      <details {...disclosure(`object:${selected.id}`)}><summary>固定对象完整记录</summary>{selected.path && selected.value !== undefined ? <FrozenDesignValue design={context.design} pointer={selected.path} /> : <p>此固定对象缺失，不能用其他对象或完整设计代替。</p>}</details>
    </section>}
    <details className="generation-fixed-inputs" {...disclosure('inputs')}><summary>全部固定输入 · {unit?.references.length || 0} 份参考 · {Object.keys(unit?.parameters || {}).length} 项模型参数</summary>{unit ? <>
      <dl><dt>模型固定身份</dt><dd>{unit.model_id}</dd><dt>预计时长</dt><dd>{unit.duration_ms / 1000} 秒</dd><dt>画幅</dt><dd>{unit.ratio}</dd></dl><h4>全部模型参数</h4>{Object.keys(unit.parameters || {}).length ? <dl>{Object.entries(unit.parameters || {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{JSON.stringify(value)}</dd></div>)}</dl> : <p>此单元没有额外模型参数。</p>}
      {[...unit.references].sort((a, b) => a.ordinal - b.ordinal).map(reference => <section className="instruction-relation-detail" key={reference.id}><h4>参考 {reference.ordinal + 1} · {referencePurposes[reference.purpose]} · {referenceRoles[reference.input_role || 'subject']}</h4><p>参与对象：{reference.participant_ids.map(id => context.entities.find(entity => entity.kind === '人物' && entity.id === id)?.label || '固定对象缺失').join('、') || '明确无绑定对象'}{reference.subject_group_id ? ` · 主体组 ${reference.subject_group_id}` : ''}</p><ReferencePreview reference={reference} /><SourceLinks sources={[reference.source]} /><details {...disclosure(`reference:${reference.id}`)}><summary>完整固定参考记录</summary><pre>{JSON.stringify(reference, null, 2)}</pre></details></section>)}
      <h4>实际落幅依赖</h4>{unit.dependencies?.length ? unit.dependencies.map((dependency, index) => <div key={JSON.stringify([dependency.plan_revision_id, dependency.unit_id])}><p>{index + 1} · {revisionName(workspace.plans, dependency.plan_revision_id, '计划')} · 固定来源单元 {dependency.unit_id}</p><p>落幅证据：{dependency.frame_id || '未配置'} · 本次参考：{dependency.reference_id || '未配置'}</p></div>) : <p>此单元没有落幅依赖。</p>}
      <details {...disclosure('unit')}><summary>完整固定单元记录（含能力与覆盖）</summary><pre>{JSON.stringify(unit, null, 2)}</pre></details>{!readOnly && onPrepare && <Button onClick={onPrepare}>前往拍摄准备核对</Button>}
    </> : <p>固定单元缺失，不能读取当前准备草稿补齐。</p>}</details>
    <details {...disclosure('gaps')}><summary>表达与映射核对 · {graph.gaps.length} 项</summary><p>已有明确引用的关系可查；先后、同步或表现关系缺乏可靠两端时保留原文，不自动推断。</p>{graph.gaps.map(gap => <p key={gap.id}>{gap.path && readablePath(gap.path, context)} · {gap.text}{gap.blockId && <Button onClick={() => onLocate(gap.blockId!)}>查看原文</Button>}</p>)}</details>
    <details {...disclosure('raw')}><summary>全部固定模型原文 · {graph.blocks.length} 段</summary><pre className="prompt-reader">{graph.prompt?.text || '固定指令不可用'}</pre>{graph.prompt && <SourceLinks sources={graph.prompt.sources} />}</details>
  </section>
}
