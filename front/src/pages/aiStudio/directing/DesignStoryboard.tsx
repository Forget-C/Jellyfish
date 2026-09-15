import { useEffect, useRef, useState } from 'react'
import { Empty, Select } from 'antd'
import type { SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { noteText } from './DesignFields'
import { shotIssues } from './designWorkspace'
import { buildFileDownloadUrl } from '../assets/utils'

/** 只浏览剪辑版本中已持久化、精确匹配的预演图片绑定；不创建临时图片绑定。 */
export function DesignStoryboard({ value, shots, selected, onSelect, revisionId, cuts = [] }: { value: SceneDesign_Input; shots: SceneDesign_Input['direction']['shots']; selected?: string; onSelect: (id: string) => void; revisionId?: string; cuts?: WorkspaceRead['cuts'] }) {
  const [density, setDensity] = useState(220)
  const [previewCut, setPreviewCut] = useState<string>()
  const [previewItems, setPreviewItems] = useState<Record<string, string>>({})
  const [size, setSize] = useState({ width: 900, height: 600 })
  const [scroll, setScroll] = useState(0)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight })); observer.observe(element); return () => observer.disconnect() }, [])
  useEffect(() => { setScroll(0); if (viewport.current) viewport.current.scrollTop = 0 }, [shots.length, density])
  const columns = Math.max(1, Math.floor((size.width - 16) / density))
  const rowHeight = density === 180 ? 188 : 224
  const start = Math.max(0, Math.floor(scroll / rowHeight) - 1) * columns
  const count = (Math.ceil(size.height / rowHeight) + 2) * columns
  const compatible = cuts.filter(cut => cut.content.items.some(item => 'design_revision_id' in item && item.design_revision_id === revisionId && item.preview_file_id))
  const source = compatible.find(cut => cut.id === previewCut)
  return <div className="design-storyboard">
    <div className="design-storyboard-tools"><Select aria-label="分镜卡片密度" value={density} onChange={setDensity} options={[{ value: 220, label: '标准卡片' }, { value: 180, label: '紧凑卡片' }]} /><Select aria-label="复用已绑定预演图片" allowClear value={source?.id} placeholder="选择已保存预演来源（可不选）" options={compatible.map(cut => ({ value: cut.id, label: `剪辑 ${cuts.indexOf(cut) + 1} · ${cut.confirmed_at ? '已确认' : '草稿'} · 修订 ${cut.version}` }))} onChange={id => { setPreviewCut(id); setPreviewItems({}) }} /><span>无图时显示动作计划</span></div>
    <div className="design-storyboard-viewport" ref={viewport} onScroll={event => setScroll(event.currentTarget.scrollTop)}>
      {!shots.length && <Empty description="没有匹配的镜头" />}
      <div style={{ height: Math.ceil(shots.length / columns) * rowHeight, position: 'relative' }}>{shots.slice(start, start + count).map((shot, offset) => {
        const index = start + offset
        const candidates = source?.content.items.filter(item => 'design_revision_id' in item && item.design_revision_id === revisionId && item.shot_id === shot.id && item.preview_file_id) || []
        const item = candidates.length === 1 ? candidates[0] : candidates.find(item => item.id === previewItems[shot.id])
        const image = item && 'preview_file_id' in item ? item.preview_file_id : undefined
        return <div key={shot.id} className={`design-storyboard-card${selected === shot.id ? ' is-selected' : ''}`} style={{ position: 'absolute', top: Math.floor(index / columns) * rowHeight, left: `${index % columns * 100 / columns}%`, width: `${100 / columns}%`, height: rowHeight - 12 }}>
          <button onClick={() => onSelect(shot.id)} aria-pressed={selected === shot.id} aria-label={`分镜 ${value.direction.shots.indexOf(shot) + 1}`}>
            <div className="design-storyboard-image">{image ? <img loading="lazy" src={buildFileDownloadUrl(image)} alt={`已绑定预演 · 镜头 ${value.direction.shots.indexOf(shot) + 1}`} /> : <><span>▣</span><small>{candidates.length > 1 ? '多个已绑定画面，请选择来源片段' : '文字分镜 · 尚无画面'}</small></>}</div>
            <strong>{String(value.direction.shots.indexOf(shot) + 1).padStart(2, '0')} · {noteText(shot.visible_result) || '动作待明确'}</strong><div className="design-storyboard-meta"><span>{shot.estimated_duration_ms ? `${shot.estimated_duration_ms / 1000} 秒` : '时长未填'}</span><span>{shotIssues(value, shot.id)[0] || '未记录问题'}</span></div>
          </button>
          {candidates.length > 1 && <Select aria-label={`镜头 ${value.direction.shots.indexOf(shot) + 1} 预演来源片段`} value={previewItems[shot.id]} placeholder="选择已绑定片段" options={candidates.map((item, i) => ({ value: item.id, label: `预演片段 ${i+1}` }))} onChange={id => setPreviewItems(previous => ({ ...previous, [shot.id]: id }))} />}
        </div>
      })}</div>
    </div>
  </div>
}
