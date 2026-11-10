import { useEffect, useState } from 'react'
import { ArrowRightOutlined, MessageOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { StudioExperimentSessionsService, type ExperimentSessionRead } from '../../services/generated'

const sessionTypes = {
  text: { label: '文本', icon: <MessageOutlined /> },
  image: { label: '图片', icon: <PictureOutlined /> },
  video: { label: '视频', icon: <VideoCameraOutlined /> },
}

const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type SessionActivity = { sessions: ExperimentSessionRead[]; failedTypes: number }

/** 合并既有会话列表中的近期记录。单一类型读取失败时，其他类型仍可继续。 */
async function readRecentSessions(): Promise<SessionActivity> {
  const types: ExperimentSessionRead['lab_type'][] = ['text', 'image', 'video']
  const results = await Promise.allSettled(types.map(labType =>
    StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType }),
  ))
  const available = results.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value.data) ? [result.value.data] : [])
  const sessions = available.flat()
    .sort((a, b) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0))
    .slice(0, 5)
  return { sessions, failedTypes: types.length - available.length }
}

export function HomeRecentSessions() {
  const [activity, setActivity] = useState<SessionActivity>()
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    setActivity(undefined)
    void readRecentSessions().then(result => { if (active) setActivity(result) })
    return () => { active = false }
  }, [retry])

  return <section aria-labelledby="home-recent-sessions">
    <header className="home-section-heading">
      <h2 id="home-recent-sessions">最近实验室会话</h2>
    </header>
    <div className="home-activity-surface">
      {!activity && <p className="home-feedback" role="status">正在读取实验室会话…</p>}
      {activity && activity.failedTypes > 0 && <div className="home-feedback home-feedback-error" role="alert">
        <span>{activity.failedTypes === 3 ? '读取实验室会话失败' : '部分实验室会话读取失败'}</span>
        <button type="button" className="home-text-action" onClick={() => setRetry(value => value + 1)}>重试</button>
      </div>}
      {activity && (activity.sessions.length ? <ul className="home-activity-list">
        {activity.sessions.map(session => {
          const type = sessionTypes[session.lab_type]
          const date = Date.parse(session.updated_at)
          const preview = session.last_message_preview?.trim() || '暂无摘要'
          return <li key={session.id}>
            <Link className="home-session-row" to={`/lab?session=${encodeURIComponent(session.id)}`}>
              <span className="home-activity-icon" aria-hidden="true">{type.icon}</span>
              <div className="home-activity-copy">
                <span className="home-activity-title" title={session.title}>{session.title}</span>
                <p className="home-session-preview" title={preview}>{type.label} · {preview}</p>
              </div>
              {Number.isFinite(date) ? <time className="home-session-time" dateTime={session.updated_at}>{dateFormat.format(date)}</time>
                : <span className="home-session-time">更新时间未知</span>}
            </Link>
          </li>
        })}
      </ul> : !activity.failedTypes && <p className="home-feedback" role="status">暂无实验室会话</p>)}
      <div className="home-activity-footer">
        <Link className="home-text-action" to="/lab">打开实验室<ArrowRightOutlined aria-hidden /></Link>
      </div>
    </div>
  </section>
}

export function HomeLabQuickStart() {
  return <section className="home-quick-start" aria-labelledby="home-quick-start">
    <header className="home-section-heading">
      <h2 id="home-quick-start">快捷开始</h2>
    </header>
    <div className="home-activity-surface home-quick-links">
      {Object.entries(sessionTypes).map(([mode, type]) => (
        <Link key={mode} className="home-quick-link" to={`/lab?mode=${mode}`}>
          <span className="home-activity-icon" aria-hidden="true">{type.icon}</span>
          {type.label}实验
          <ArrowRightOutlined aria-hidden />
        </Link>
      ))}
    </div>
  </section>
}
