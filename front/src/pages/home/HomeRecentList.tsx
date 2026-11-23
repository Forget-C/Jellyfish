import { currentLanguage } from '../../i18n'
import { useUiText } from '../../uiText'
import { useEffect, useState } from 'react'
import type { CancelablePromise } from '../../services/generated'

type RecentList<T> =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; items: T[] }

export const homeUpdatedAtFormat = () => new Intl.DateTimeFormat(currentLanguage(), {
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

export function HomeRecentFeedback({ status, label, emptyText, onRetry }: {
  status: RecentList<never>['status']
  label: string
  emptyText?: string
  onRetry: () => void
}) {
  const uiText = useUiText()
  if (status === 'error') return <div className="home-feedback home-feedback-error" role="alert">
    <span>{uiText("读取{{label}}失败", { label })}</span>
    <button type="button" className="home-text-action" onClick={onRetry}>{uiText("重试")}</button>
  </div>
  return <p className={status === 'loading' ? 'home-feedback home-feedback-loading' : 'home-feedback'} role="status">{status === 'loading' ? uiText("正在读取{{label}}…", { label }) : emptyText ?? uiText("暂无{{label}}", { label })}</p>
}
