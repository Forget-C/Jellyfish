import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty } from 'antd'
import type { SceneDesign_Input } from '../../../services/generated'
import { noteText } from './designValue'
import { sceneOverview, shotIssues } from './designWorkspace'
import type { DesignScope } from './designWorkspace'
import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'

/** 全场只选择对象和解释影响；进入局部范围必须使用明确入口。 */
export function DesignSceneOverview({ value, active, visibleShotIds, selected, onSelect, onEnter, onIssue, revisionId, rememberContext }: { value: SceneDesign_Input; active: boolean; visibleShotIds?: string[]; selected?: string; onSelect: (key: string) => void; onEnter: (scope: DesignScope) => void; onIssue?: (id: string, issue: string) => void; revisionId?: string; rememberContext?: { projectId: string; sequenceId: string } }) {
  const data = useMemo(() => sceneOverview(value, visibleShotIds), [value, visibleShotIds])
  const initial = useRef<{ top: number; expanded: string[] }>({ top: 0, expanded: [] })
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(rememberContext ? readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId).designOverview || '{}' : '{}')
      if (saved.revisionId === revisionId && Number.isFinite(saved.top) && saved.top >= 0 && Array.isArray(saved.expanded) && saved.expanded.every((key: unknown) => typeof key === 'string')) initial.current = saved
    } catch { /* 失效浏览位置不影响业务。 */ }
    return initial.current.expanded
  })
  const viewport = useRef<HTMLDivElement>(null)
  const [muted, setMuted] = useState(false)
  useEffect(() => { setMuted(false) }, [selected])
  const restored = useRef(false)
  useEffect(() => { if (active && viewport.current && !restored.current) { viewport.current.scrollTop = initial.current.top; restored.current = true } }, [active])
  const save = (top: number, keys = expanded) => { if (rememberContext) saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, { designOverview: JSON.stringify({ revisionId, top, expanded: keys }) }) }
  const toggle = (key: string) => { const next = expanded.includes(key) ? expanded.filter(item => item !== key) : [...expanded, key]; setExpanded(next); save(viewport.current?.scrollTop || 0, next) }
  const select = (key: string) => { setMuted(false); onSelect(key) }
  const affected = new Set(!muted && selected ? value.direction.shots.filter(shot => data.graphs.get(shot.id)?.nodes.some(node => node.key === selected)).map(shot => shot.id) : [])
  const total = value.direction.shots.filter(shot => !visibleShotIds || visibleShotIds.includes(shot.id))
  return <>
    <div className="design-overview-tools"><span>选择对象查看影响 · 节拍统计不可直接相加</span>{affected.size > 0 && <Button size="small" onClick={() => setMuted(true)}>清除高亮</Button>}</div>
    <div className="design-scene-overview" ref={viewport} onScroll={event => save(event.currentTarget.scrollTop)} aria-label="全场关系总览">
      {!total.length && <Empty description={value.direction.shots.length ? '没有匹配的镜头' : '暂无镜头，可在镜头视图新增'} />}
      {data.rows.filter(row => !visibleShotIds || row.shots.length || visibleShotIds.length === value.direction.shots.length).map(row => {
        const beatIndex = value.direction.beats.findIndex(beat => `beat:${beat.id}` === row.scope)
        const label = beatIndex < 0 ? '未分组' : `节拍 ${beatIndex + 1} · ${noteText(value.direction.beats[beatIndex].objective) || '未命名节拍'}`
        const shotKey = `${row.scope}:shots`, objectKey = `${row.scope}:objects`
        const issues = row.shots.flatMap(shot => shotIssues(value, shot.id).map(issue => ({ id: shot.id, issue })))
        const highlighted = row.shots.some(shot => affected.has(shot.id))
        return <section key={row.scope} data-beat-group={beatIndex < 0 ? 'unassigned' : value.direction.beats[beatIndex].id} className={`design-overview-row${highlighted ? ' is-highlighted' : affected.size ? ' is-muted' : ''}`}>
          <div className="design-overview-beat"><button onClick={() => select(beatIndex < 0 ? 'overview' : row.scope)} aria-pressed={selected === row.scope}>{label}</button><small>{row.shots.length} 个关联镜头 · {row.shots.reduce((sum, shot) => sum + (shot.estimated_duration_ms || 0), 0) / 1000} 秒</small></div>
          <div className="design-overview-shots">{row.shots.slice(0, expanded.includes(shotKey) ? undefined : 12).map(shot => <button key={shot.id} aria-label={`选择镜头 ${value.direction.shots.indexOf(shot) + 1}`} aria-pressed={selected === `shot:${shot.id}`} className={affected.has(shot.id) ? 'is-highlighted' : ''} onClick={() => select(`shot:${shot.id}`)} title={noteText(shot.visible_result)}>{String(value.direction.shots.indexOf(shot) + 1).padStart(2, '0')}</button>)}{row.shots.length > 12 && <button onClick={() => toggle(shotKey)}>{expanded.includes(shotKey) ? '收起镜头' : `展开剩余${row.shots.length - 12}镜`}</button>}</div>
          <div className="design-overview-objects">{row.objects.slice(0, expanded.includes(objectKey) ? undefined : 3).map(node => <button key={node.key} title={node.kind === 'missing' ? '缺失关联对象，请通过问题入口检查' : node.label} aria-pressed={selected === node.key} disabled={node.kind === 'missing'} onClick={() => select(node.key)}>{node.kind === 'missing' ? '缺失关联对象' : node.label.split(' · ').slice(1).join(' · ') || node.label}{(data.frequency.get(node.key) || 0) > 1 && <small> · 共享</small>}</button>)}{row.objects.length > 3 && <button onClick={() => toggle(objectKey)}>{expanded.includes(objectKey) ? '收起关联' : `更多关联 ${row.objects.length - 3}`}</button>}</div>
          <div className="design-overview-actions">{!!issues.length && <details><summary>问题 {issues.length}</summary>{issues.map(({ id, issue }) => <Button type="link" size="small" key={`${id}:${issue}`} onClick={() => onIssue?.(id, issue)}>镜头 {value.direction.shots.findIndex(shot => shot.id === id) + 1} · {issue}</Button>)}</details>}<Button type="text" size="small" onClick={() => onEnter(row.scope)}>{beatIndex < 0 ? '进入未分组关系' : `进入节拍 ${beatIndex + 1} 关系`}</Button></div>
        </section>
      })}
    </div>
  </>
}
