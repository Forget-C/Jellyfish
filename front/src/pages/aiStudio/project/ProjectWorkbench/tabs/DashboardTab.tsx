import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Space, Spin } from 'antd'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StudioDirectingService, type ChapterOverview } from '../../../../../services/generated'
import { useChapters } from '../hooks/useProjectData'
import { directingError } from '../../../directing/common'
import { chapterActionLocation, chapterLocation, sequenceAction, sequenceLocation } from '../../../directing/chapterNavigation'
import { readRecentWork, readWorkspaceContext } from '../../../directing/workspaceContext'
import { chapterProduction } from '../../chapterProduction'
import { ProjectCanvasPreview } from '../ProjectCanvasPreview'
import '../project-production.css'

/** 项目概览使用真实章节和已有场次入口呈现当前制作。 */
export function DashboardTab() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { chapters, loading, error: chapterError, refresh } = useChapters(projectId)
  const [rows, setRows] = useState<ChapterOverview[]>([])
  const [sceneError, setSceneError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setRows([])
    setSceneError('')
    void Promise.all(chapters.map(chapter => StudioDirectingService.directingChapterOverview({ projectId, chapterId: chapter.id })))
      .then(results => { if (active) setRows(results.flatMap(result => result.data ? [result.data] : [])) })
      .catch(cause => { if (active) setSceneError(directingError(cause)) })
    return () => { active = false }
  }, [chapters, projectId, retry])

  const recentChapterId = readRecentWork(projectId)?.chapterId
  const chapter = chapters.find(row => row.id === recentChapterId)
    ?? chapters.find(row => row.status !== 'done') ?? chapters[0]
  const production = chapter && chapterProduction(chapter)
  return <div className="project-overview">
    <div className="project-overview-grid">
      <section aria-labelledby="project-current-production">
        <h2 id="project-current-production" className="project-section-title">当前制作</h2>
        <div className="project-production-surface">
          {loading ? <Spin /> : chapterError
            ? <Alert type="error" message={chapterError} action={<Button onClick={() => void refresh()}>重试</Button>} />
            : chapter && production ? <div className="project-current-chapter">
              <span className="chapter-production-state" data-tone={production.tone}>{production.state}</span>
              <h3>第 {chapter.index} 章 · {chapter.title}</h3>
              <p>{chapter.sequenceCount === undefined ? '场次数量待核对' : `${chapter.sequenceCount} 个场次`}</p>
              <Space wrap>
                <Button type="primary" onClick={() => navigate(chapterActionLocation(projectId, chapter.id, production.target))}>{production.primaryAction}</Button>
                <Link to={chapterLocation(projectId)}>查看章节列表 →</Link>
              </Space>
            </div> : <Empty description="创建第一章开始创作">
              <Button type="primary" onClick={() => navigate(`${chapterLocation(projectId)}&create=1`)}>创建第一章</Button>
            </Empty>}
        </div>
      </section>
      <ProjectCanvasPreview projectId={projectId} />
    </div>
    {sceneError && <Alert type="error" message={sceneError} action={<Button onClick={() => setRetry(value => value + 1)}>重试读取场次</Button>} />}
    {!loading && !chapterError && rows.some(row => row.sequences.length > 0) && <section aria-labelledby="project-overview-sequences">
      <h2 id="project-overview-sequences" className="project-section-title">章节场次</h2>
      <div className="project-overview-sequences">
        {rows.filter(row => row.sequences.length > 0).map(row => <article key={row.chapter_id} className="project-production-surface">
          <div className="project-section-heading">
            <h3>{row.title}</h3>
            <Link to={chapterLocation(projectId, row.chapter_id)}>场次管理</Link>
          </div>
          <Space wrap>{row.sequences.map(scene => {
            const action = sequenceAction(scene, readWorkspaceContext(projectId, scene.id).view)
            return <Button key={scene.id} onClick={() => navigate(action.view ? sequenceLocation(projectId, row.chapter_id, scene.id, action.view) : chapterLocation(projectId, row.chapter_id, scene.id))}>{scene.title} · {action.label}</Button>
          })}</Space>
        </article>)}
      </div>
    </section>}
  </div>
}
