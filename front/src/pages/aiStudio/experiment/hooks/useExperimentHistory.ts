import { useUiText } from '../../../../uiText'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExperimentMessageRead } from '../../../../services/generated'

/** 共享历史 Hook 的可选配置，用于按页面展示容量调整分页大小。 */
export interface UseExperimentHistoryOptions {
  /** 单页消息数量；服务端允许的范围为 1 到 100。 */
  pageSize?: number
  readPage: (options: {sessionId: string; page: number; pageSize: number}) =>
    Promise<{data?: ExperimentMessageRead[] | null; meta?: {cursor?: unknown; activeTurnIds?: string[] | null} | null}>
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
  /** 是否已经成功读取过本会话，包括成功返回空列表。 */
  hasLoadedHistory: boolean
  eventCursor?: number
  activeTurnIds?: string[]
  readLatest: (targetSessionId: string) => ReturnType<UseExperimentHistoryOptions['readPage']>
  /** 分页错误重试原页，避免重试时重置已经加载的历史。 */
  errorOnLoadMore: boolean
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
const emptyHistory: ExperimentMessageRead[] = []
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
  sessionId: string | undefined,
  { pageSize = 50, readPage }: UseExperimentHistoryOptions,
): ExperimentHistoryState {
  const uiText = useUiText()
  const [messages, setMessages] = useState<ExperimentMessageRead[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [hasMoreHistory, setHasMoreHistory] = useState(false)
  const [loading, setLoading] = useState(Boolean(sessionId))
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [eventCursor, setEventCursor] = useState<number>()
  const [activeTurnIds, setActiveTurnIds] = useState<string[]>()
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false)
  const [errorOnLoadMore, setErrorOnLoadMore] = useState(false)
  const requestVersionRef = useRef(0)
  const historySessionIdRef = useRef(sessionId)
  const historyPageRef = useRef(1)
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
    setEventCursor(undefined)
    setActiveTurnIds(undefined)
    setHasLoadedHistory(false)
    historyPageRef.current = 1
    setHistoryPage(1)
    setHasMoreHistory(false)
    setLoading(false)
    setLoadingMore(false)
    setErrorOnLoadMore(false)
    setError(null)
  }, [])

  /** 从第一页重新读取当前会话的完整可见历史。 */
  const refresh = useCallback(async () => {
    if (sessionId !== currentSessionIdRef.current) return
    if (!sessionId) {
      clearLocalHistory()
      return
    }

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    setLoading(true)
    setLoadingMore(false)
    setErrorOnLoadMore(false)
    setError(null)

    try {
      const response = await readPage({
        sessionId,
        page: 1,
        pageSize,
      })
      if (sessionId !== currentSessionIdRef.current || requestVersion !== requestVersionRef.current) return

      const items = response.data ?? []
      setEventCursor(typeof response.meta?.cursor === 'number' ? response.meta.cursor : 0)
      setActiveTurnIds(response.meta?.activeTurnIds ?? [])
      const adopted = adoptedMessagesBySession.get(sessionId) ?? []
      // 刷新第一页时保留已分页读取的更早消息，避免读者失去当前位置。
      const preserveEarlier = items.length === pageSize && historyPageRef.current > 1
      const earliest = preserveEarlier ? Math.min(...items.map((item) => item.sequence)) : undefined
      setMessages((current) => mergeExperimentMessages(
        earliest === undefined ? [] : current.filter((item) => item.sequence < earliest),
        adopted,
        items,
      ))
      releaseAdoptedMessages(sessionId, items)
      setHasLoadedHistory(true)
      if (!preserveEarlier) {
        historyPageRef.current = 1
        setHistoryPage(1)
        setHasMoreHistory(items.length === pageSize)
      }
    } catch (reason) {
      if (sessionId !== currentSessionIdRef.current || requestVersion !== requestVersionRef.current) return
      setError(reason instanceof Error ? reason : new Error(uiText("加载实验室历史失败")))
    } finally {
      if (sessionId === currentSessionIdRef.current && requestVersion === requestVersionRef.current) setLoading(false)
    }
  }, [uiText, clearLocalHistory, pageSize, readPage, sessionId])

  /** 读取当前会话更早的一页消息，并按服务端序号合并到本地历史。 */
  const loadMore = useCallback(async () => {
    if (!sessionId || !hasMoreHistory || loadingMore || loading) return

    const nextPage = historyPage + 1
    const requestVersion = requestVersionRef.current
    setLoadingMore(true)
    setErrorOnLoadMore(false)
    setError(null)

    try {
      const response = await readPage({
        sessionId,
        page: nextPage,
        pageSize,
      })
      if (sessionId !== currentSessionIdRef.current || requestVersion !== requestVersionRef.current) return

      const items = response.data ?? []
      setMessages((current) => mergeExperimentMessages(items, current))
      historyPageRef.current = nextPage
      setHistoryPage(nextPage)
      setHasMoreHistory(items.length === pageSize)
    } catch (reason) {
      if (sessionId !== currentSessionIdRef.current || requestVersion !== requestVersionRef.current) return
      setErrorOnLoadMore(true)
      setError(reason instanceof Error ? reason : new Error(uiText("加载更早实验室历史失败")))
    } finally {
      if (sessionId === currentSessionIdRef.current && requestVersion === requestVersionRef.current) setLoadingMore(false)
    }
  }, [uiText, hasMoreHistory, historyPage, loading, loadingMore, pageSize, readPage, sessionId])

  useEffect(() => {
    historySessionIdRef.current = sessionId
    historyPageRef.current = 1
    setMessages(sessionId ? adoptedMessagesBySession.get(sessionId) ?? [] : [])
    setEventCursor(undefined)
    setActiveTurnIds(undefined)
    setHasLoadedHistory(false)
    setHistoryPage(1)
    setHasMoreHistory(false)
    void refresh()
  }, [refresh, sessionId])

  const isCurrentHistory = historySessionIdRef.current === sessionId
  return {
    messages: isCurrentHistory ? messages : emptyHistory,
    historyPage,
    eventCursor: isCurrentHistory ? eventCursor : undefined,
    activeTurnIds: isCurrentHistory ? activeTurnIds : undefined,
    hasMoreHistory: isCurrentHistory && hasMoreHistory,
    loading: isCurrentHistory ? loading : Boolean(sessionId),
    loadingMore: isCurrentHistory && loadingMore,
    error: isCurrentHistory ? error : null,
    hasLoadedHistory: isCurrentHistory && hasLoadedHistory,
    errorOnLoadMore,
    refresh,
    readLatest: targetSessionId => readPage({sessionId: targetSessionId, page: 1, pageSize}),
    loadMore,
    adoptCanonicalMessages,
    clearLocalHistory,
  }
}
