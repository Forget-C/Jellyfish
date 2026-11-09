import { useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Space, Spin, Statistic } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioDirectingService } from '../../../../../services/generated'
import type { ChapterOverview } from '../../../../../services/generated'
import { useChapters } from '../hooks/useProjectData'
import type { TabKey } from '../constants'
import { directingError } from '../../../directing/common'
import { workbenchManagementLocation } from '../../../directing/chapterNavigation'

/** 项目概览以章节和场次为入口，不再用旧镜头准备状态判断新流程。 */
export function DashboardTab({ onSelectTab }: { onSelectTab: (tab: TabKey) => void }) {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { chapters, loading } = useChapters(projectId)
  const [rows, setRows] = useState<ChapterOverview[]>([])
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setRows([]); setError('')
    void Promise.all(chapters.map(chapter => StudioDirectingService.directingChapterOverview({ projectId, chapterId: chapter.id })))
      .then(results => { if (active) { setRows(results.flatMap(result => result.data ? [result.data] : [])); setError('') } })
      .catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [chapters, projectId, retry])
  if (loading) return <Spin />
  return <Space direction="vertical" size="large" className="w-full">
    {error && <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试读取场次</Button>} />}
    <Card title="场次创作" extra={<Button type="primary" onClick={() => onSelectTab('chapters')}>管理章节</Button>}>
      <p>在工作台管理确认场次、准备对象并生成分镜画布，再打开画布编辑和制作。</p>
      <Space size="large"><Statistic title="章节" value={chapters.length} /><Statistic title="场次" value={rows.reduce((sum, row) => sum + row.sequences.length, 0)} /></Space>
    </Card>
    {!chapters.length && <Empty description="创建第一章开始创作"><Button onClick={() => navigate(`/projects/${projectId}?tab=chapters&create=1`)}>创建第一章</Button></Empty>}
    {rows.map(row => <Card key={row.chapter_id} title={row.title} extra={<Button onClick={() => navigate(workbenchManagementLocation(projectId, row.chapter_id))}>工作台管理</Button>}>
      {row.sequences.length ? <Space wrap>{row.sequences.map(scene => <Button key={scene.id}
        onClick={() => navigate(workbenchManagementLocation(projectId, row.chapter_id, scene.id))}>{scene.title} · 打开工作台管理</Button>)}</Space> : <span>尚未确认场次</span>}
    </Card>)}
  </Space>
}
