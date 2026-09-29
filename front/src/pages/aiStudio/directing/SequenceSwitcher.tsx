import { useEffect, useState } from 'react'
import { Button, Select, Space } from 'antd'
import { useNavigate } from 'react-router-dom'
import { StudioDirectingService, type SequenceOverview } from '../../../services/generated'
import { chapterLocation, sequenceAction, sequenceLocation } from './chapterNavigation'
import { readWorkspaceContext, saveRecentWork } from './workspaceContext'

/** 同章导航只携带目标场次自己的阶段，不复制当前场次的版本或单元参数。 */
export function SequenceSwitcher({ projectId, chapterId, sequenceId, title, stage }: {
  projectId: string; chapterId: string; sequenceId: string; title: string; stage: 'design' | 'shoot' | 'cut'
}) {
  const navigate = useNavigate()
  const [rows, setRows] = useState<SequenceOverview[]>([])
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => { saveRecentWork(projectId, { chapterId, sequenceId, view: stage }) }, [projectId, chapterId, sequenceId, stage])
  useEffect(() => {
    let active = true
    setRows([]); setLoading(true); setFailed(false)
    StudioDirectingService.directingChapterOverview({ projectId, chapterId }).then(response => {
      if (!response.data?.sequences) throw new Error('场次列表读取失败')
      if (active) setRows(response.data.sequences)
    }).catch(() => { if (active) setFailed(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, chapterId, retry])
  const current = rows.findIndex(row => row.id === sequenceId)
  const open = (id: string) => {
    const row = rows.find(item => item.id === id)
    if (!row || row.id === sequenceId) return
    const action = sequenceAction(row, readWorkspaceContext(projectId, id).view)
    navigate(action.view ? sequenceLocation(projectId, chapterId, id, action.view) : chapterLocation(projectId, chapterId, id))
  }
  return <Space wrap className="sequence-switcher" size={4}>
    <Button type="text" onClick={() => navigate(chapterLocation(projectId, chapterId, sequenceId))}>返回章节</Button>
    <Select aria-label="切换场次" showSearch optionFilterProp="label" loading={loading} value={sequenceId}
      style={{ width: 220, maxWidth: '100%' }} onChange={open}
      options={rows.length ? rows.map(row => ({ value: row.id, label: `${row.position + 1}. ${row.title}` })) : [{ value: sequenceId, label: title }]} />
    <Button type="text" disabled={current <= 0} onClick={() => open(rows[current - 1].id)}>上一场</Button>
    <Button type="text" disabled={current < 0 || current >= rows.length - 1} onClick={() => open(rows[current + 1].id)}>下一场</Button>
    {failed && <Button size="small" onClick={() => setRetry(value => value + 1)}>重试场次列表</Button>}
  </Space>
}
