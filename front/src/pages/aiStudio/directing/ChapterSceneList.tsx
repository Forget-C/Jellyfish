import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, List, Space, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { StudioDirectingService, type ChapterOverview } from '../../../services/generated'
import { directingError } from './common'
import { readChapterBrowse, saveChapterBrowse, sequenceAction, sequenceLocation } from './chapterNavigation'
import { readWorkspaceContext } from './workspaceContext'

/** 仅加载当前章节的轻量摘要；场次详情与业务编辑由各自入口承接。 */
export function ChapterSceneList({ projectId, chapterId, onDetails, onSource, selectedId, refreshKey = 0, onRestore }: {
  projectId: string; chapterId: string; onDetails: (sequenceId: string) => void; onSource: () => void
  selectedId?: string; refreshKey?: number; onRestore: (sequenceId: string) => void
}) {
  const navigate = useNavigate()
  const [overview, setOverview] = useState<ChapterOverview>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [query, setQuery] = useState(() => readChapterBrowse(projectId, chapterId).query || '')
  const restored = useRef(false)
  const root = useRef<HTMLDivElement>(null)
  const selection = useRef({ selectedId, onRestore })
  selection.current = { selectedId, onRestore }
  useEffect(() => {
    if (!overview || !root.current) return
    let scroll = root.current.parentElement
    while (scroll && !['auto', 'scroll'].includes(getComputedStyle(scroll).overflowY)) scroll = scroll.parentElement
    if (!scroll) return
    const element = scroll
    element.scrollTop = readChapterBrowse(projectId, chapterId).top || 0
    const save = () => saveChapterBrowse(projectId, chapterId, { top: element.scrollTop })
    element.addEventListener('scroll', save)
    return () => element.removeEventListener('scroll', save)
  }, [overview, projectId, chapterId])
  useEffect(() => {
    let active = true
    setOverview(undefined); setError(''); setLoading(true)
    StudioDirectingService.directingChapterOverview({ projectId, chapterId }).then(response => {
      if (!response.data) throw new Error('章节概览读取失败')
      if (active) {
        setOverview(response.data)
        const remembered = readChapterBrowse(projectId, chapterId).sequence
        if (!restored.current) {
          restored.current = true
          const rows = [...response.data.sequences].sort((a, b) => a.position - b.position)
          const initialId = rows.find(row => row.id === remembered)?.id || rows[0]?.id
          if (!selection.current.selectedId && initialId) selection.current.onRestore(initialId)
        }
      }
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, chapterId, retry, refreshKey])
  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />
  const matching = overview?.sequences.filter(sequence => `${sequence.position + 1} ${sequence.title} ${sequence.source_excerpt}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) || []
  return <div ref={root}>{query && selectedId && !matching.some(row => row.id === selectedId) && <Alert type="info" message="当前场次不在筛选结果中" action={<Button onClick={() => { setQuery(''); saveChapterBrowse(projectId, chapterId, { query: '' }) }}>清除筛选</Button>} />}<Input.Search aria-label="搜索本章场次" placeholder="搜索场次标题或原文摘要" allowClear value={query} onChange={event => {
    setQuery(event.target.value); saveChapterBrowse(projectId, chapterId, { query: event.target.value, top: 0 })
  }} style={{ marginBottom: 16 }} /><List loading={loading} dataSource={matching}
    locale={{ emptyText: <Empty description={query ? '没有匹配的场次' : '本章尚无场次，请先从原文划分场次'}>{query ? <Button onClick={() => { setQuery(''); saveChapterBrowse(projectId, chapterId, { query: '', top: 0 }) }}>清除搜索</Button> : <Button onClick={onSource}>从原文划分场次</Button>}</Empty> }}
    renderItem={sequence => {
      const action = sequenceAction(sequence, readWorkspaceContext(projectId, sequence.id).view)
      return <List.Item key={sequence.id} className={selectedId === sequence.id ? 'chapter-scene-selected' : ''} style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Button type="link" onClick={() => onDetails(sequence.id)} style={{ padding: 0, height: 'auto', maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'left', fontWeight: 600 }}>{sequence.position + 1}. {sequence.title}</Button>
          <p style={{ color: '#64748b', overflowWrap: 'anywhere', margin: '8px 0' }}>{sequence.source_excerpt}</p>
          <Space wrap size={4}>
            {sequence.source_changed && <Tag color="warning">原文已变化</Tag>}
            {!!sequence.unreviewed_take_count && <Tag color="processing">{sequence.unreviewed_take_count} 个候选待审</Tag>}
            {sequence.active_cut_revision_id && <Tag color="success">已有确认粗剪</Tag>}
            {!sequence.confirmed_design_count && <Tag>设计待确认</Tag>}
          </Space>
        </div>
        <Space wrap>
          <Button onClick={() => onDetails(sequence.id)}>详情</Button>
          <Button type="primary" onClick={() => action.view
            ? navigate(sequenceLocation(projectId, chapterId, sequence.id, action.view))
            : onDetails(sequence.id)}>{action.label}</Button>
        </Space>
      </List.Item>
    }} /></div>
}
