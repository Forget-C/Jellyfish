import { currentLanguage } from '../../i18n'
import { useUiText } from '../../uiText'
import { useEffect, useState } from 'react'
import { ArrowRightOutlined, MessageOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { HomeRecentFeedback } from './HomeRecentList'
import { Link } from 'react-router-dom'
import { StudioExperimentSessionsService, type ExperimentSessionRead } from '../../services/generated'
import { HomePlaceholders } from './HomePlaceholders'

const sessionTypes = {
  chat: { label: '多模态聊天', icon: <MessageOutlined /> },
  text: { label: '文本', icon: <MessageOutlined /> },
  image: { label: '图片', icon: <PictureOutlined /> },
  video: { label: '视频', icon: <VideoCameraOutlined /> },
}

const dateFormat = () => new Intl.DateTimeFormat(currentLanguage(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type SessionActivity = { sessions: ExperimentSessionRead[]; failedTypes: number }

/** 合并既有会话列表中的近期记录。单一类型读取失败时，其他类型仍可继续。 */
async function readRecentSessions(): Promise<SessionActivity> {
  const types: ExperimentSessionRead['lab_type'][] = ['chat', 'text', 'image', 'video']
  const results = await Promise.allSettled(types.map(labType =>
    StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType }),
  ))
  const available = results.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value.data) ? [result.value.data] : [])
  const sessions = available.flat()
    .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))
    .slice(0, 3)
  return { sessions, failedTypes: types.length - available.length }
}

export function HomeRecentSessions() {
  const uiText = useUiText()
  const [activity, setActivity] = useState<SessionActivity>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setActivity(undefined)
    void readRecentSessions().then(result => { if (active) setActivity(result) })
    return () => { active = false }
  }, [retry])

  const sessions = activity?.sessions ?? []
  return <section aria-labelledby="home-recent-sessions">
    <header className="home-section-heading">
      <h2 id="home-recent-sessions">{uiText("最近实验室会话")}</h2>
    </header>
    <div className="home-activity-surface">
      <div className="home-activity-scroll">
        <div className="home-slot-frame">
          {activity && activity.failedTypes > 0 && <div className="home-feedback home-feedback-error" role="alert" data-partial={sessions.length > 0 || undefined}>
            <span>{activity.failedTypes === Object.keys(sessionTypes).length ? uiText("读取实验室会话失败") : uiText("部分实验室会话读取失败")}</span>
            <button type="button" className="home-text-action" onClick={() => setRetry(value => value + 1)}>{uiText("重试")}</button>
          </div>}
          <ul className="home-activity-list">
            {sessions.map(session => {
              const type = sessionTypes[session.lab_type]
              const date = Date.parse(session.updated_at)
              const preview = session.last_message_preview?.trim() || uiText('暂无摘要')
              return <li key={session.id}>
                <Link className="home-session-row" to={`/lab?session=${encodeURIComponent(session.id)}`}>
                  <span className="home-activity-icon" aria-hidden="true">{type.icon}</span>
                  <div className="home-activity-copy">
                    <span className="home-activity-title" title={session.title}>{session.title}</span>
                    <p className="home-session-preview" title={preview}>{uiText(type.label)} · {preview}</p>
                  </div>
                  {Number.isFinite(date) ? <time className="home-session-time" dateTime={session.updated_at}>{dateFormat().format(date)}</time>
                    : <span className="home-session-time">{uiText("更新时间未知")}</span>}
                </Link>
              </li>
            })}
            {!activity && <HomePlaceholders kind="activity" />}
          </ul>
          {!sessions.length && !activity?.failedTypes && <HomeRecentFeedback status={activity ? 'ready' : 'loading'}
            label={uiText("实验室会话")} onRetry={() => setRetry(value => value + 1)} />}
        </div>
      </div>
      <div className="home-activity-footer home-session-footer">
        <div className="home-quick-links" role="group" aria-label={uiText("新建实验")}>
          <span>{uiText("新建：")}</span>
          {Object.entries(sessionTypes).map(([mode, type]) => (
            <Link key={mode} className="home-text-action" aria-label={uiText("新建{{label}}实验", { label: uiText(type.label) })} to={`/lab?mode=${mode}`}>
              <span aria-hidden="true">{type.icon}</span>{uiText(type.label)}
            </Link>
          ))}
        </div>
        <Link className="home-text-action" to="/lab">{uiText("打开实验室")}<ArrowRightOutlined aria-hidden /></Link>
      </div>
    </div>
  </section>
}
