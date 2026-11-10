import { useEffect, useState } from 'react'
import { ArrowRightOutlined, FolderOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { StudioChaptersService, StudioProjectsService } from '../../services/generated'
import { summarizeProjectChapters, type ProjectStageSummary } from '../aiStudio/project/projectStageSummary'
import changanCover from './sample-covers/changan.svg'

type ProjectRow = { id: string; name: string; stage: ProjectStageSummary | null }
type ProjectActivity =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; rows: ProjectRow[] }

/** 首页只读取最近三个项目的一页章节，用真实章节状态提供继续入口。 */
async function readProjectActivity(): Promise<ProjectRow[]> {
  const response = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({
    page: 1, pageSize: 3, order: 'updated_at', isDesc: true,
  })
  if (!response.data?.items) throw new Error('项目列表不可用')
  return Promise.all(response.data.items.slice(0, 3).map(async ({ id, name }) => {
    try {
      const chapters = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({
        projectId: id, page: 1, pageSize: 10, order: 'index',
      })
      const items = chapters.data?.items
      if (!items || items.some(chapter => chapter.project_id !== id)) return { id, name, stage: null }
      return { id, name, stage: summarizeProjectChapters(id, items) }
    } catch {
      return { id, name, stage: null }
    }
  }))
}

export function HomeProjectProgress() {
  const [activity, setActivity] = useState<ProjectActivity>({ status: 'loading' })
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setActivity({ status: 'loading' })
    void readProjectActivity().then(
      rows => { if (active) setActivity({ status: 'ready', rows }) },
      () => { if (active) setActivity({ status: 'error' }) },
    )
    return () => { active = false }
  }, [retry])

  const hasChapterFailure = activity.status === 'ready' && activity.rows.some(row => !row.stage)
  const showExample = activity.status === 'ready' && activity.rows.some(row => row.stage && !row.stage.tone)

  return <section aria-labelledby="home-project-progress">
    <header className="home-section-heading">
      <h2 id="home-project-progress">项目进展</h2>
    </header>
    <div className="home-activity-surface">
      <div className="home-activity-scroll">
        {activity.status === 'loading' && <p className="home-feedback" role="status">正在读取项目…</p>}
        {activity.status === 'error' && <div className="home-feedback home-feedback-error" role="alert">
          <span>读取项目失败</span>
          <button type="button" className="home-text-action" onClick={() => setRetry(value => value + 1)}>重试</button>
        </div>}
        {activity.status === 'ready' && (
          activity.rows.length ? <ul className="home-activity-list">
            {activity.rows.map(({ id, name, stage }) => <li className="home-project-row" key={id}>
              <span className="home-activity-icon" aria-hidden="true"><FolderOutlined /></span>
              <div className="home-activity-copy">
                <Link className="home-activity-title home-project-link" title={name} to={`/projects/${encodeURIComponent(id)}`}>{name}</Link>
                <div className="home-project-meta">
                  {stage?.chapterLabel && <span className="home-project-chapter" title={stage.chapterLabel}>{stage.chapterLabel}</span>}
                  {stage ? <span className="home-project-state" data-tone={stage.tone}>{stage.status}</span>
                    : <span className="home-feedback-error">读取章节失败</span>}
                </div>
              </div>
              {stage && <Link className="home-text-action home-project-action" to={stage.href}>
                {stage.action}<ArrowRightOutlined aria-hidden="true" />
              </Link>}
            </li>)}
          </ul> : <p className="home-feedback" role="status">暂无项目</p>
        )}
        {showExample && <section className="home-project-example" aria-label="项目进展示例">
          <div className="home-section-heading">
            <h3>项目进展示例</h3>
            <span className="home-sample-label">示例数据</span>
          </div>
          <div className="home-project-row">
            <img className="home-activity-icon home-example-cover" src={changanCover} alt="" />
            <div className="home-activity-copy">
              <span className="home-activity-title">长安夜行</span>
              <div className="home-project-meta">
                <span>第 2 章 · 夜入长安</span>
                <span className="home-project-state" data-tone="gold">待补原文</span>
              </div>
            </div>
          </div>
        </section>}
      </div>
      <div className="home-activity-footer">
        <Link className="home-text-action" to="/projects">查看全部项目<ArrowRightOutlined aria-hidden="true" /></Link>
        {hasChapterFailure && <button type="button" className="home-text-action" onClick={() => setRetry(value => value + 1)}>重试</button>}
      </div>
    </div>
  </section>
}
