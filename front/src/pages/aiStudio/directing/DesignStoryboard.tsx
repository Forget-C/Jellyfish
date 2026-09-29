import { createPortal } from 'react-dom'
import { readWorkspaceContext, readDesignPosition, saveWorkspaceContext } from './workspaceContext'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Select, Switch } from 'antd'
import type { SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { noteText } from './DesignFields'
import { shotIssues } from './designWorkspace'
import type { DesignScope } from './designWorkspace'
import { buildFileDownloadUrl } from '../assets/utils'

/** 分镜直接展示原镜头；只复用用户选择的持久化预演绑定，范围编排不复制对象。 */
export function DesignStoryboard({ settingsTarget, value, shots, relatedShotIds, emptyDescription, onClearFilters, selected, onSelect, revisionId, cuts = [], scope = 'all', revealId, onMove, rememberContext, active = true, onRevealed, onIssue }: { settingsTarget?: HTMLElement; relatedShotIds?: Set<string>;  emptyDescription?: string; onClearFilters?: () => void; value: SceneDesign_Input; onIssue?: (id: string, issue: string) => void; active?: boolean; onRevealed?: () => void; rememberContext?: { projectId: string; sequenceId: string }; shots: SceneDesign_Input['direction']['shots']; selected?: string; onSelect: (id: string) => void; revisionId?: string; cuts?: WorkspaceRead['cuts']; scope?: DesignScope; revealId?: string; onMove?: (id: string, delta: number) => void }) {
  const initial = useRef(readDesignPosition(rememberContext ? readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId).designStoryboardPosition : undefined, revisionId, scope))
  const [density, setDensity] = useState(initial.current.density)
  const [showImages, setShowImages] = useState(() => rememberContext ? readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId).designShowImages === 'true' : false)
  useEffect(() => { if (rememberContext) saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, { designShowImages: String(showImages) }) }, [showImages, rememberContext?.projectId, rememberContext?.sequenceId])
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
  const columns = Math.max(1, Math.floor((size.width - 12) / (density === 180 ? 170 : 220)))
  const rowHeight = (density === 180 ? 174 : 194) + (showImages ? (size.width / columns - 28) * 9 / 16 + 36 : 0)
  const layout = useMemo(() => ({
    entries: shots.map((shot, index) => ({ shot, top: Math.floor(index / columns) * rowHeight, column: index % columns })),
    height: Math.ceil(shots.length / columns) * rowHeight,
  }), [shots, columns, rowHeight])
  const reveal = (id: string) => {
    const entry = layout.entries.find(row => row.shot.id === id), element = viewport.current
    if (entry && element) element.scrollTop = Math.max(0, entry.top - element.clientHeight / 3)
  }
  useEffect(() => { if (active && revealId && size.width) { reveal(revealId); onRevealed?.() } }, [active, revealId, layout, size.width])
  const compatible = cuts.filter(cut => cut.content.items.some(item => 'design_revision_id' in item && item.design_revision_id === revisionId && item.preview_file_id))
  const source = compatible.find(cut => cut.id === previewCut)
  const controls = <div className="design-storyboard-tools"><Select aria-label="分镜卡片密度" value={density} onChange={setDensity} options={[{ value: 220, label: '标准卡片' }, { value: 180, label: '紧凑卡片' }]} /><Switch aria-label="显示画面" checked={showImages} onChange={setShowImages} /><span>显示画面</span>{showImages && <Select style={{ width: 240 }} aria-label="复用已绑定预演图片" allowClear value={source?.id} placeholder="选择已保存预演来源" options={compatible.map(cut => ({ value: cut.id, label: `剪辑 ${cuts.indexOf(cut) + 1} · ${cut.confirmed_at ? '已确认' : '草稿'} · 修订 ${cut.version}` }))} onChange={id => { setPreviewCut(id); setPreviewItems({}) }} />}{onMove && selected && shots.some(shot => shot.id === selected) && <span className="design-selected-order"><span>镜头 {value.direction.shots.findIndex(shot => shot.id === selected) + 1}</span><Button size="small" disabled={shots[0]?.id === selected} aria-label={`前移镜头 ${value.direction.shots.findIndex(shot => shot.id === selected) + 1}`} onClick={() => { onMove(selected, -1); reveal(selected) }}>前移</Button><Button size="small" disabled={shots[shots.length - 1]?.id === selected} aria-label={`后移镜头 ${value.direction.shots.findIndex(shot => shot.id === selected) + 1}`} onClick={() => { onMove(selected, 1); reveal(selected) }}>后移</Button><small title="调整筛选镜头在设计序列中的位置，其他镜头顺序保持">仅调整当前筛选序列</small></span>}</div>
  return <div className="design-storyboard">
    {settingsTarget ? active && createPortal(controls, settingsTarget) : controls}
    <div className="design-storyboard-viewport" ref={viewport} tabIndex={0} role="grid" aria-label="分镜编排" aria-rowcount={shots.length} onScroll={event => setScroll(event.currentTarget.scrollTop)} onKeyDown={event => {
      if ((event.target as HTMLElement).closest('.ant-select, .design-storyboard-order') || !['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const index = shots.findIndex(shot => shot.id === selected)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? shots.length - 1 : Math.max(0, Math.min(shots.length - 1, index + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns)))
      if (shots[next]) { onSelect(shots[next].id); reveal(shots[next].id) }
    }}>
      {!shots.length && <Empty description={emptyDescription || '没有匹配的镜头'}>{onClearFilters && <Button onClick={onClearFilters}>清除筛选</Button>}</Empty>}
      <div style={{ height: layout.height, position: 'relative' }}>
        {layout.entries.filter(row => row.top + rowHeight >= scroll - rowHeight && row.top < scroll + size.height + rowHeight).map(({ shot, top, column }) => {
          const number = value.direction.shots.indexOf(shot) + 1
          const issues = shotIssues(value, shot.id)
          const candidates = source?.content.items.filter(item => 'design_revision_id' in item && item.design_revision_id === revisionId && item.shot_id === shot.id && item.preview_file_id) || []
          const item = candidates.length === 1 ? candidates[0] : candidates.find(item => item.id === previewItems[shot.id])
          const image = item && 'preview_file_id' in item ? item.preview_file_id : undefined
          return <div key={shot.id} className={`design-storyboard-card${selected === shot.id ? ' is-selected' : relatedShotIds?.has(shot.id) ? ' is-related' : ''}`} style={{ position: 'absolute', top, left: `${column * 100 / columns}%`, width: `${100 / columns}%`, height: rowHeight - 12 }}>
            <button title={relatedShotIds?.has(shot.id) ? '与当前对象关联' : undefined} onClick={() => onSelect(shot.id)} aria-pressed={selected === shot.id} aria-label={`分镜 ${number}`}>
              {showImages && <div className="design-storyboard-image">{image ? <img loading="lazy" src={buildFileDownloadUrl(image)} alt={`已绑定预演 · 镜头 ${number}`} /> : <><span>▣</span><small>{candidates.length > 1 ? '多个已绑定画面，请选择来源片段' : '尚无绑定画面'}</small></>}</div>}
              <div className="design-storyboard-meta"><span>镜头 {String(number).padStart(2, '0')}</span><span>{shot.estimated_duration_ms ? `${shot.estimated_duration_ms / 1000} 秒` : '时长未填'}</span></div>
              <strong title={noteText(shot.visible_result)}>{noteText(shot.visible_result) || '动作待明确'}</strong>
              <span className="design-storyboard-purpose" title={noteText(shot.narrative_function)}>叙事：{noteText(shot.narrative_function) || '待明确'}</span>
              <small className="design-storyboard-beats" title={shot.beat_ids.map(id => noteText(value.direction.beats.find(beat => beat.id === id)?.objective) || '缺失节拍').join('、')}>{shot.beat_ids.map(id => { const index = value.direction.beats.findIndex(beat => beat.id === id); return index < 0 ? '缺失节拍' : `节拍 ${String(index + 1).padStart(2, '0')}` }).join(' · ') || '未分组'}{shot.beat_ids.length > 1 && ' · 跨节拍'}</small>
            </button>
            {showImages && candidates.length > 1 && <Select aria-label={`镜头 ${number} 预演来源片段`} value={previewItems[shot.id]} placeholder="选择已绑定片段" options={candidates.map((candidate, i) => ({ value: candidate.id, label: `预演片段 ${i+1}` }))} onChange={id => setPreviewItems(previous => ({ ...previous, [shot.id]: id }))} />}
            {!!issues.length && onIssue && <div className="design-storyboard-order"><Button size="small" aria-label={`查看镜头 ${number} 问题`} onClick={() => onIssue(shot.id, issues[0])}>问题 {issues.length}</Button></div>}
          </div>
        })}
      </div>
    </div>
  </div>
}
