import { useEffect, useState } from 'react'
import { ArrowRightOutlined } from '@ant-design/icons'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import { Alert, Button, Empty, Space, Spin } from 'antd'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StudioDirectingService, type ChapterOverview } from '../../../../../services/generated'
import { useChapters } from '../hooks/useProjectData'
import { apiErrorMessage } from '../../../../../services/apiErrorMessage'
import { chapterActionLocation, chapterLocation, workbenchManagementLocation } from '../../../directing/chapterNavigation'
import { readRecentWork } from '../../../directing/workspaceContext'
import { chapterProduction } from '../../chapterProduction'
import '../project-production.css'

/** 项目概览使用真实章节和已有场次入口呈现当前制作。 */
export function DashboardTab() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { chapters, loading, error: chapterError, refresh } = useChapters(projectId)
  const [rows, setRows] = useState<ChapterOverview[]>([])
  const [sceneError, setSceneError] = useState('')
  const [retry, setRetry] = useState(0)
  const [scenesLoading, setScenesLoading] = useState(true)
  useEffect(() => {
    let active = true
    setRows([])
    setSceneError('')
    setScenesLoading(true)
    void Promise.all(chapters.map(async chapter => {
      const result = await StudioDirectingService.directingChapterOverview({ projectId, chapterId: chapter.id })
      if (!result.data || result.data.chapter_id !== chapter.id) throw new Error('场次列表读取失败，请重试')
      return result.data
    }))
      .then(results => { if (active) setRows(results) })
      .catch(cause => { if (active) setSceneError(apiErrorMessage(cause)) })
      .finally(() => { if (active) setScenesLoading(false) })
    return () => { active = false }
  }, [chapters, projectId, retry])

  const recentChapterId = readRecentWork(projectId)?.chapterId
  const chapter = chapters.find(row => row.id === recentChapterId)
    ?? chapters.find(row => row.status !== 'done') ?? chapters[0]
  const production = chapter && chapterProduction(chapter)
  const ordered = [...chapters].sort((a, b) => a.index - b.index)
    .flatMap(item => rows.filter(row => row.chapter_id === item.id && row.sequences.length > 0))
  const currentRow = ordered.find(row => row.chapter_id === chapter?.id)
  const previewRows = (currentRow ? [currentRow, ...ordered.filter(row => row !== currentRow)] : ordered).slice(0, 3)
  return <div className="project-overview">
    <ProjectContentToolbar><h1 className="app-page-title">项目概览</h1></ProjectContentToolbar>
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
                <Button type="primary" onClick={() => navigate(chapterActionLocation(projectId, chapter.id, production.target))}>{{ edit: '编辑原文', source: '划分场次', manage: '工作台管理' }[production.target]}</Button>
                <Link to={chapterLocation(projectId)}>查看章节列表 →</Link>
              </Space>
            </div> : <Empty description="创建第一章开始创作">
              <Button type="primary" onClick={() => navigate(`${chapterLocation(projectId)}&create=1`)}>创建第一章</Button>
            </Empty>}
        </div>
      </section>
    </div>
    <section aria-labelledby="project-overview-sequences">
      <div className="project-section-heading">
        <h2 id="project-overview-sequences" className="project-section-title">章节场次</h2>
        <Link to={chapterLocation(projectId)}>查看全部章节 <ArrowRightOutlined aria-hidden /></Link>
      </div>
      {loading || scenesLoading ? <div className="project-production-surface"><Spin aria-label="正在读取章节场次" /></div>
        : chapterError ? <Alert type="error" message="章节读取失败，暂无法展示场次" action={<Button onClick={() => void refresh()}>重试读取章节</Button>} />
        : sceneError ? <Alert type="error" message={sceneError} action={<Button onClick={() => setRetry(value => value + 1)}>重试读取场次</Button>} />
        : previewRows.length ? <div className="project-overview-sequences">
          {previewRows.map(row => <article key={row.chapter_id} className="project-production-surface">
            <div className="project-section-heading">
              <h3>{row.title}</h3>
              {row.sequences.length > 3 && <Link to={workbenchManagementLocation(projectId, row.chapter_id)}>查看本章全部场次 <ArrowRightOutlined aria-hidden /></Link>}
            </div>
            <ul className="project-overview-scene-list">
              {row.sequences.slice(0, 3).map(scene => <li key={scene.id}>
                <Link to={workbenchManagementLocation(projectId, row.chapter_id, scene.id)}>
                  <span>{scene.title}</span><ArrowRightOutlined aria-hidden />
                </Link>
              </li>)}
            </ul>
          </article>)}
        </div> : <div className="project-production-surface"><Empty description="暂无章节场次" /></div>}
    </section>
  </div>
}
