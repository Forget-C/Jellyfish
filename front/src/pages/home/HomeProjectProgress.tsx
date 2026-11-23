import { uiText, useUiText } from '../../uiText'
import { useEffect, useState } from 'react'
import { ArrowRightOutlined, FolderOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { StudioChaptersService, StudioProjectsService } from '../../services/generated'
import { summarizeProjectChapters, type ProjectStageSummary } from '../aiStudio/project/projectStageSummary'
import { HomeRecentFeedback } from './HomeRecentList'
import changanCover from './sample-covers/changan.svg'
import { HomePlaceholders } from './HomePlaceholders'

type ProjectRow = { id: string; name: string; stage: ProjectStageSummary | null }
type ProjectActivity =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; rows: ProjectRow[] }

/** 首页只读取最近三个项目的一页章节，用真实章节状态提供继续入口。 */
async function readProjectActivity(): Promise<ProjectRow[]> {
  const response = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({
    page: 1, pageSize: 3, order: 'updated_at', isDesc: true,
  })
  if (!response.data?.items) throw new Error(uiText("项目列表不可用"))
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
  useUiText()
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

  const rows = activity.status === 'ready' ? activity.rows : []
  const hasChapterFailure = activity.status === 'ready' && activity.rows.some(row => !row.stage)
  const showExample = activity.status === 'ready' && activity.rows.some(row => row.stage && !row.stage.tone)

  return <section aria-labelledby="home-project-progress">
    <header className="home-section-heading">
      <h2 id="home-project-progress">{uiText("项目进展")}</h2>
    </header>
    <div className="home-activity-surface">
      <div className="home-activity-scroll">
        <div className="home-slot-frame">
          <ul className="home-activity-list">
            {rows.map(({ id, name, stage }) => {
              const chapterLabel = stage?.chapter && uiText("第 {{index}} 章 · {{title}}", stage.chapter)
              return <li className="home-project-row" key={id}>
              <span className="home-activity-icon" aria-hidden="true"><FolderOutlined /></span>
              <div className="home-activity-copy">
                <Link className="home-activity-title home-project-link" title={name} to={`/projects/${encodeURIComponent(id)}`}>{name}</Link>
                <div className="home-project-meta">
                  {chapterLabel && <span className="home-project-chapter" title={chapterLabel}>{chapterLabel}</span>}
                  {stage ? <span className="home-project-state" data-tone={stage.tone}>{uiText(stage.status)}</span>
                    : <span className="home-feedback-error">{uiText("读取章节失败")}</span>}
                </div>
              </div>
              {stage && <Link className="home-text-action home-project-action" to={stage.href}>
                {uiText(stage.action)}<ArrowRightOutlined aria-hidden="true" />
              </Link>}
            </li>
            })}
            {activity.status === 'loading' && <HomePlaceholders kind="activity" />}
          </ul>
          {!rows.length && <HomeRecentFeedback status={activity.status} label={uiText("项目")} onRetry={() => setRetry(value => value + 1)} />}
        </div>
        {showExample && <section className="home-project-example" aria-label={uiText("项目进展示例")}>
          <div className="home-section-heading">
            <h3>{uiText("项目进展示例")}</h3>
            <span className="home-sample-label">{uiText("示例数据")}</span>
          </div>
          <div className="home-project-row">
            <img className="home-activity-icon home-example-cover" src={changanCover} alt="" />
            <div className="home-activity-copy">
              <span className="home-activity-title">{uiText("长安夜行")}</span>
              <div className="home-project-meta">
                <span>{uiText("第 2 章 · 夜入长安")}</span>
                <span className="home-project-state" data-tone="gold">{uiText("待补原文")}</span>
              </div>
            </div>
          </div>
        </section>}
      </div>
      <div className="home-activity-footer">
        <Link className="home-text-action" to="/projects">{uiText("查看全部项目")}<ArrowRightOutlined aria-hidden="true" /></Link>
        {hasChapterFailure && <button type="button" className="home-text-action" onClick={() => setRetry(value => value + 1)}>{uiText("重试")}</button>}
      </div>
    </div>
  </section>
}
