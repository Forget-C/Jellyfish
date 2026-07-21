import { useCallback, useEffect, useRef, useState } from 'react'
import {
  StudioExperimentSessionsService,
  type ExperimentMessageRead,
} from '../../../../services/generated'

/** 共享历史 Hook 的可选配置，用于按页面展示容量调整分页大小。 */
export interface UseExperimentHistoryOptions {
  /** 单页消息数量；服务端允许的范围为 1 到 100。 */
  pageSize?: number
}

/** 共享历史 Hook 暴露给实验室模态组件的状态和操作。 */
export interface ExperimentHistoryState {
  /** 当前会话中已按时间正序合并的原始持久化消息。 */
  messages: ExperimentMessageRead[]
  /** 当前已读取到的历史页码。 */
  historyPage: number
  /** 是否仍可继续读取更早的消息。 */
  hasMoreHistory: boolean
  /** 首次读取或切换会话时的加载状态。 */
  loading: boolean
  /** 正在追加更早一页历史时的加载状态。 */
  loadingMore: boolean
  /** 最近一次读取历史失败时的错误，成功读取后会清空。 */
  error: Error | null
  /** 从第一页重新读取当前会话历史。 */
  refresh: () => Promise<void>
  /** 读取并追加当前会话更早的一页历史。 */
  loadMore: () => Promise<void>
  /** 清除浏览器中的历史状态，不会调用服务端删除消息。 */
  clearLocalHistory: () => void
}

/**
 * 管理实验室会话的原始历史消息与分页读取。
 *
 * 服务端每页已按时间正序返回消息，因此加载更早历史时将结果前置即可。
 * 当 sessionId 为空时代表未持久化草稿，本 Hook 只维护一个空的本地历史。
 */
export function useExperimentHistory(
  sessionId?: string,
  { pageSize = 50 }: UseExperimentHistoryOptions = {},
): ExperimentHistoryState {
  const [messages, setMessages] = useState<ExperimentMessageRead[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const requestVersionRef = useRef(0)

  /** 清除本地缓存，并让尚未返回的请求失效，避免旧会话覆盖新会话。 */
  const clearLocalHistory = useCallback(() => {
    requestVersionRef.current += 1
    setMessages([])
    setHistoryPage(1)
    setHasMoreHistory(false)
    setLoading(false)
    setLoadingMore(false)
    setError(null)
  }, [])

  /** 从第一页重新读取当前会话的完整可见历史。 */
  const refresh = useCallback(async () => {
    if (!sessionId) {
      clearLocalHistory()
      return
    }

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setLoading(true)
    setLoadingMore(false)
    setError(null)

    try {
      const response = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({
        sessionId,
        page: 1,
        pageSize,
      })
      if (requestVersion !== requestVersionRef.current) return

      const items = response.data ?? []
      setMessages(items)
      setHistoryPage(1)
      setHasMoreHistory(items.length === pageSize)
    } catch (reason) {
      if (requestVersion !== requestVersionRef.current) return
      setMessages([])
      setHistoryPage(1)
      setHasMoreHistory(false)
      setError(reason instanceof Error ? reason : new Error('加载实验室历史失败'))
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [clearLocalHistory, pageSize, sessionId])

  /** 读取当前会话更早的一页消息，并前置到时间正序的本地历史。 */
  const loadMore = useCallback(async () => {
    if (!sessionId || !hasMoreHistory || loadingMore || loading) return

    const nextPage = historyPage + 1
    const requestVersion = requestVersionRef.current
    setLoadingMore(true)
    setError(null)

    try {
      const response = await StudioExperimentSessionsService.listExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesGet({
        sessionId,
        page: nextPage,
        pageSize,
      })
      if (requestVersion !== requestVersionRef.current) return

      const items = response.data ?? []
      setMessages((current) => [...items, ...current])
      setHistoryPage(nextPage)
      setHasMoreHistory(items.length === pageSize)
    } catch (reason) {
      if (requestVersion !== requestVersionRef.current) return
      setError(reason instanceof Error ? reason : new Error('加载更早实验室历史失败'))
    } finally {
      if (requestVersion === requestVersionRef.current) setLoadingMore(false)
    }
  }, [hasMoreHistory, historyPage, loading, loadingMore, pageSize, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    messages,
    historyPage,
    hasMoreHistory,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
    clearLocalHistory,
  }
}
