import { useEffect, useState } from 'react'
import type { CancelablePromise } from '../../services/generated'

type RecentList<T> =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; items: T[] }

export const homeUpdatedAtFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
})

/** Each home section owns its request, retry and cancellation. */
export function useHomeRecentList<T>(load: () => CancelablePromise<{ data?: T[] | null }>) {
  const [result, setResult] = useState<RecentList<T>>({ status: 'loading' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setResult({ status: 'loading' })
    const request = load()
    void request.then(({ data }) => {
      if (active) setResult(Array.isArray(data) ? { status: 'ready', items: data } : { status: 'error' })
    }).catch(() => {
      if (active) setResult({ status: 'error' })
    })
    return () => {
      active = false
      request.cancel()
    }
  }, [load, revision])

  return { result, retry: () => setRevision(value => value + 1) }
}

export function HomeRecentFeedback({ status, label, onRetry }: {
  status: RecentList<never>['status']
  label: string
  onRetry: () => void
}) {
  if (status === 'error') return <div className="home-feedback home-feedback-error" role="alert">
    <span>读取{label}失败</span>
    <button type="button" className="home-text-action" onClick={onRetry}>重试</button>
  </div>
  return <p className="home-feedback" role="status">{status === 'loading' ? `正在读取${label}…` : `暂无${label}`}</p>
}
