import { useUiText } from '../../../../uiText'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Spin } from 'antd'
import { ArrowDownOutlined } from '@ant-design/icons'
import { WorkspaceScrollPanel } from '../../../../components/layout/PageLayout'
import { ExperimentEmptyState } from './ExperimentEmptyState'
import type { ExperimentHistoryState } from '../hooks/useExperimentHistory'

type ExperimentHistoryProps = {
  history: ExperimentHistoryState
  messageCount: number
  emptyDescription: string
  children: ReactNode
}

/** 管理历史读取状态及滚动。向前分页时保持首条可见消息的屏幕位置。 */
export function ExperimentHistory({ history, messageCount, emptyDescription, children }: ExperimentHistoryProps) {
  const uiText = useUiText()
  const { error, errorOnLoadMore, hasLoadedHistory, hasMoreHistory, loading, loadingMore, refresh, loadMore } = history
  const viewportRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const followingLatest = useRef(true)
  const anchor = useRef<{ element: HTMLElement; top: number; count: number }>()
  const [showLatest, setShowLatest] = useState(false)
  const firstRead = !messageCount && !hasLoadedHistory

  useEffect(() => {
    const viewport = viewportRef.current
    const list = listRef.current
    if (!viewport || !list) return
    const update = () => {
      if (followingLatest.current) viewport.scrollTop = viewport.scrollHeight
      setShowLatest(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 24)
    }
    const observer = new ResizeObserver(update)
    observer.observe(list)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const readEarlier = () => {
    const viewport = viewportRef.current
    if (viewport) {
      const top = viewport.getBoundingClientRect().top
      const visible = Array.from(viewport.querySelectorAll('article')).find((article) => article.getBoundingClientRect().bottom > top)
      if (visible) anchor.current = { element: visible, top: visible.getBoundingClientRect().top - top, count: messageCount }
      followingLatest.current = false
    }
    void loadMore()
  }

  useLayoutEffect(() => {
    const saved = anchor.current
    const viewport = viewportRef.current
    if (!saved || !viewport || loadingMore) return
    if (saved.count !== messageCount && saved.element.isConnected) {
      viewport.scrollTop += saved.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.top
      anchor.current = undefined
    } else if (errorOnLoadMore || !hasMoreHistory) {
      anchor.current = undefined
    }
  }, [errorOnLoadMore, hasMoreHistory, loadingMore, messageCount])

  const jumpToLatest = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    followingLatest.current = true
    viewport.scrollTop = viewport.scrollHeight
    viewport.focus({ preventScroll: true })
    setShowLatest(false)
  }

  return <div className="experiment-history-panel">
    <WorkspaceScrollPanel ref={viewportRef} className="app-lab-history" role="region" aria-label={uiText("会话消息")} tabIndex={0}
      onScroll={(event) => {
        const viewport = event.currentTarget
        const away = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 24
        followingLatest.current = !away
        setShowLatest(away)
      }}>
      <div ref={listRef} className="experiment-history-list">
        {loading && firstRead ? <div className="experiment-history-loading" role="status"><Spin size="small" /> {uiText("正在读取会话消息")}</div> : null}
        {error ? <Alert
          type="error"
          showIcon
          message={errorOnLoadMore ? uiText("更早消息读取失败") : firstRead ? uiText("会话消息读取失败") : uiText("会话消息刷新失败")}
          action={<Button size="small" onClick={errorOnLoadMore ? readEarlier : () => void refresh()}>
            {errorOnLoadMore ? uiText("重试加载更早消息") : uiText("重试读取消息")}
          </Button>}
        /> : null}
        {hasMoreHistory && !errorOnLoadMore ? <Button size="small" loading={loadingMore} disabled={loading} onClick={readEarlier}>{uiText("加载更早消息")}</Button> : null}
        {!messageCount && !loading && !error ? <ExperimentEmptyState description={emptyDescription} /> : null}
        {children}
      </div>
    </WorkspaceScrollPanel>
    {showLatest ? <Button className="experiment-history-jump" icon={<ArrowDownOutlined aria-hidden="true" />} onClick={jumpToLatest}>{uiText("回到最新")}</Button> : null}
  </div>
}
