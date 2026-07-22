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
  /** 当前会话中已按服务端序号正序合并的原始持久化消息。 */
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
  /** 读取并按服务端序号合并当前会话更早的一页历史。 */
  loadMore: () => Promise<void>
  /** 接管任务创建接口返回的持久化消息，并跨首次会话重挂载保留它们。 */
  adoptCanonicalMessages: (targetSessionId: string, items: ExperimentMessageRead[]) => void
  /** 清除浏览器中的历史状态，不会调用服务端删除消息。 */
  clearLocalHistory: () => void
}

/**
 * 保存任务创建接口已经确认、但历史列表请求尚未覆盖的消息。
 *
 * 首次提交会把草稿切换为持久化会话，Hook 可能随 sessionId 重建；这里仅缓存
 * 服务端已返回的正式消息，不保存前端伪造消息，因此消息 ID 与顺序始终可追溯。
 */
const adoptedMessagesBySession = new Map<string, ExperimentMessageRead[]>()

/** 按消息 ID 覆盖合并，并使用服务端 sequence 维持唯一稳定顺序。 */
function mergeExperimentMessages(...groups: ExperimentMessageRead[][]): ExperimentMessageRead[] {
  const byId = new Map<string, ExperimentMessageRead>()
  groups.flat().forEach((item) => byId.set(item.id, item))
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence)
}

/** 历史响应覆盖全部已接管消息后释放跨重挂载缓存。 */
function releaseAdoptedMessages(sessionId: string, persistedItems: ExperimentMessageRead[]): void {
  const adopted = adoptedMessagesBySession.get(sessionId)
  if (!adopted?.length) return
  const persistedIds = new Set(persistedItems.map((item) => item.id))
  if (adopted.every((item) => persistedIds.has(item.id))) adoptedMessagesBySession.delete(sessionId)
}

/**
 * 管理实验室会话的原始历史消息与分页读取。
 *
 * 服务端以 sequence 返回消息；本 Hook 仍统一去重和排序，抵御刷新与分页交错。
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
  const currentSessionIdRef = useRef(sessionId)
  currentSessionIdRef.current = sessionId

  /** 接管创建接口返回的正式消息，避免再次从 task_id 猜测用户消息归属。 */
  const adoptCanonicalMessages = useCallback((targetSessionId: string, items: ExperimentMessageRead[]) => {
    if (!items.length) return
    const adopted = mergeExperimentMessages(adoptedMessagesBySession.get(targetSessionId) ?? [], items)
    adoptedMessagesBySession.set(targetSessionId, adopted)
    if (!currentSessionIdRef.current || currentSessionIdRef.current === targetSessionId) {
      setMessages((current) => mergeExperimentMessages(current, adopted))
    }
  }, [])

  /** 清除本地缓存，并让尚未返回的请求失效，避免旧会话覆盖新会话。 */
  const clearLocalHistory = useCallback(() => {
    const currentSessionId = currentSessionIdRef.current
    if (currentSessionId) adoptedMessagesBySession.delete(currentSessionId)
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
      const adopted = adoptedMessagesBySession.get(sessionId) ?? []
      setMessages(mergeExperimentMessages(adopted, items))
      releaseAdoptedMessages(sessionId, items)
      setHistoryPage(1)
      setHasMoreHistory(items.length === pageSize)
    } catch (reason) {
      if (requestVersion !== requestVersionRef.current) return
      setMessages(adoptedMessagesBySession.get(sessionId) ?? [])
      setHistoryPage(1)
      setHasMoreHistory(false)
      setError(reason instanceof Error ? reason : new Error('加载实验室历史失败'))
    } finally {
      if (requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [clearLocalHistory, pageSize, sessionId])

  /** 读取当前会话更早的一页消息，并按服务端序号合并到本地历史。 */
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
      setMessages((current) => mergeExperimentMessages(items, current))
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
    setMessages(sessionId ? adoptedMessagesBySession.get(sessionId) ?? [] : [])
    void refresh()
  }, [refresh, sessionId])

  return {
    messages,
    historyPage,
    hasMoreHistory,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
    adoptCanonicalMessages,
    clearLocalHistory,
  }
}
