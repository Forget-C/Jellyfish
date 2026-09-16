import { readWorkspaceContext, readDesignPosition, saveWorkspaceContext } from './workspaceContext'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Select } from 'antd'
import type { SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { noteText } from './DesignFields'
import { shotIssues } from './designWorkspace'
import type { DesignScope } from './designWorkspace'
import { buildFileDownloadUrl } from '../assets/utils'

/** 分镜直接展示原镜头；只复用用户选择的持久化预演绑定，范围编排不复制对象。 */
export function DesignStoryboard({ value, shots, selected, onSelect, revisionId, cuts = [], scope = 'all', revealId, onMove, rememberContext, active = true, onRevealed, onIssue }: { value: SceneDesign_Input; onIssue?: (id: string, issue: string) => void; active?: boolean; onRevealed?: () => void; rememberContext?: { projectId: string; sequenceId: string }; shots: SceneDesign_Input['direction']['shots']; selected?: string; onSelect: (id: string) => void; revisionId?: string; cuts?: WorkspaceRead['cuts']; scope?: DesignScope; revealId?: string; onMove?: (id: string, delta: number) => void }) {
  const initial = useRef(readDesignPosition(rememberContext ? readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId).designStoryboardPosition : undefined, revisionId, scope))
  const [density, setDensity] = useState(initial.current.density)
  const [previewCut, setPreviewCut] = useState<string>()
  const [previewItems, setPreviewItems] = useState<Record<string, string>>({})
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scroll, setScroll] = useState(initial.current.top)
  const restored = useRef(false)
  const previousLayout = useRef(`${scope}:${density}`)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(() => { if (element.clientWidth) setSize({ width: element.clientWidth, height: element.clientHeight }) }); observer.observe(element); return () => observer.disconnect() }, [])
  useEffect(() => {
    if (!restored.current && size.width && viewport.current) { restored.current = true; viewport.current.scrollTop = initial.current.top; setScroll(viewport.current.scrollTop) }
  }, [size.width])
  useEffect(() => { if (previousLayout.current !== `${scope}:${density}`) { setScroll(0); if (viewport.current) viewport.current.scrollTop = 0; previousLayout.current = `${scope}:${density}` } }, [scope, density])
  useEffect(() => { if (rememberContext && restored.current) saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, { designStoryboardPosition: JSON.stringify({ revisionId, scope, top: scroll, density }) }) }, [scroll, density, scope, revisionId, rememberContext?.projectId, rememberContext?.sequenceId])
  const columns = Math.max(1, Math.floor((size.width - 16) / density))
  const rowHeight = density === 180 ? 268 : 300
  const layout = useMemo(() => {
    const groups = new Map<string, typeof shots>()
    for (const shot of shots) {
      const beat = scope === 'all' ? shot.beat_ids.find(id => value.direction.beats.some(row => row.id === id)) || '' : scope
      groups.set(beat, [...(groups.get(beat) || []), shot])
    }
    let top = 0
    const entries: Array<{ shot: typeof shots[number]; top: number; column: number }> = []
    const headings: Array<{ key: string; top: number; label: string }> = []
    for (const [key, rows] of groups) {
      if (scope === 'all') {
        const beat = value.direction.beats.find(row => row.id === key)
        headings.push({ key, top, label: beat ? `节拍 ${value.direction.beats.indexOf(beat) + 1} · ${noteText(beat.objective) || '未命名节拍'}` : '未分组' }); top += 36
      }
      rows.forEach((shot, index) => entries.push({ shot, top: top + Math.floor(index / columns) * rowHeight, column: index % columns }))
      top += Math.ceil(rows.length / columns) * rowHeight
    }
    return { entries, headings, height: top }
  }, [shots, scope, value.direction.beats, columns, rowHeight])
  const reveal = (id: string) => {
    const entry = layout.entries.find(row => row.shot.id === id), element = viewport.current
    if (entry && element) element.scrollTop = Math.max(0, entry.top - element.clientHeight / 3)
  }
  useEffect(() => { if (active && revealId && size.width) { reveal(revealId); onRevealed?.() } }, [active, revealId, layout, size.width])
  const compatible = cuts.filter(cut => cut.content.items.some(item => 'design_revision_id' in item && item.design_revision_id === revisionId && item.preview_file_id))
  const source = compatible.find(cut => cut.id === previewCut)
  return <div className="design-storyboard">
    <div className="design-storyboard-tools"><Select aria-label="分镜卡片密度" value={density} onChange={setDensity} options={[{ value: 220, label: '标准卡片' }, { value: 180, label: '紧凑卡片' }]} /><Select aria-label="复用已绑定预演图片" allowClear value={source?.id} placeholder="选择已保存预演来源（可不选）" options={compatible.map(cut => ({ value: cut.id, label: `剪辑 ${cuts.indexOf(cut) + 1} · ${cut.confirmed_at ? '已确认' : '草稿'} · 修订 ${cut.version}` }))} onChange={id => { setPreviewCut(id); setPreviewItems({}) }} /><span>无图时显示动作计划</span></div>
    <div className="design-storyboard-viewport" ref={viewport} tabIndex={0} role="grid" aria-label="分镜编排" aria-rowcount={shots.length} onScroll={event => setScroll(event.currentTarget.scrollTop)} onKeyDown={event => {
      if ((event.target as HTMLElement).closest('.ant-select') || !['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const index = shots.findIndex(shot => shot.id === selected)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? shots.length - 1 : Math.max(0, Math.min(shots.length - 1, index + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns)))
      if (shots[next]) { onSelect(shots[next].id); reveal(shots[next].id) }
    }}>
      {!shots.length && <Empty description="没有匹配的镜头" />}
      <div style={{ height: layout.height, position: 'relative' }}>
        {layout.headings.filter(row => row.top >= scroll - 36 && row.top < scroll + size.height).map(row => <h3 className="design-storyboard-group" key={row.key} style={{ top: row.top }}>{row.label}</h3>)}
        {layout.entries.filter(row => row.top + rowHeight >= scroll - rowHeight && row.top < scroll + size.height + rowHeight).map(({ shot, top, column }) => {
          const number = value.direction.shots.indexOf(shot) + 1, index = shots.indexOf(shot)
          const issues = shotIssues(value, shot.id)
          const candidates = source?.content.items.filter(item => 'design_revision_id' in item && item.design_revision_id === revisionId && item.shot_id === shot.id && item.preview_file_id) || []
          const item = candidates.length === 1 ? candidates[0] : candidates.find(item => item.id === previewItems[shot.id])
          const image = item && 'preview_file_id' in item ? item.preview_file_id : undefined
          return <div key={shot.id} className={`design-storyboard-card${selected === shot.id ? ' is-selected' : ''}`} style={{ position: 'absolute', top, left: `${column * 100 / columns}%`, width: `${100 / columns}%`, height: rowHeight - 12 }}>
            <button onClick={() => onSelect(shot.id)} aria-pressed={selected === shot.id} aria-label={`分镜 ${number}`}>
              <div className="design-storyboard-image">{image ? <img loading="lazy" src={buildFileDownloadUrl(image)} alt={`已绑定预演 · 镜头 ${number}`} /> : <><span>▣</span><small>{candidates.length > 1 ? '多个已绑定画面，请选择来源片段' : '文字分镜 · 尚无画面'}</small></>}</div>
              <strong>{String(number).padStart(2, '0')} · {noteText(shot.visible_result) || '动作待明确'}</strong><div className="design-storyboard-meta"><span>{shot.estimated_duration_ms ? `${shot.estimated_duration_ms / 1000} 秒` : '时长未填'}</span><span>{shotIssues(value, shot.id)[0] || '未记录问题'}</span></div>
              {shot.beat_ids.length > 1 && <small>跨 {shot.beat_ids.length} 节拍 · 同一镜头</small>}
            </button>
            {candidates.length > 1 && <Select aria-label={`镜头 ${number} 预演来源片段`} value={previewItems[shot.id]} placeholder="选择已绑定片段" options={candidates.map((candidate, i) => ({ value: candidate.id, label: `预演片段 ${i+1}` }))} onChange={id => setPreviewItems(previous => ({ ...previous, [shot.id]: id }))} />}
            {(onMove || !!issues.length) && <div className="design-storyboard-order">{!!issues.length && onIssue && <Button size="small" aria-label={`查看镜头 ${number} 问题`} onClick={() => onIssue(shot.id, issues[0])}>问题 {issues.length}</Button>}{onMove && <><Button size="small" disabled={!index} aria-label={`前移镜头 ${number}`} onClick={() => onMove(shot.id, -1)}>前移</Button><Button size="small" disabled={index === shots.length - 1} aria-label={`后移镜头 ${number}`} onClick={() => onMove(shot.id, 1)}>后移</Button></>}</div>}
          </div>
        })}
      </div>
    </div>
    {onMove && <p className="design-order-hint">前移 / 后移调整当前筛选镜头在设计序列中的位置；其他镜头顺序保持。</p>}
  </div>
}
