/**
 * 实验室共享会话状态。
 *
 * 该 Hook 只管理会话数据和当前选择，不耦合 URL 或页面跳转，
 * 让统一实验室页面能够自行决定如何映射会话选择到路由。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  StudioExperimentSessionsService,
  type ExperimentSessionRead,
} from '../../../../services/generated'

/** 实验室支持的生成模态。 */
export type ExperimentLabType = ExperimentSessionRead['lab_type']

/** Hook 初始化时可选地恢复一个已知会话。 */
export type UseExperimentSessionsOptions = {
  initialSessionId?: string
}

/** 新会话的默认标题，只有首次有效提交时才会真正写入服务端。 */
const defaultSessionTitles: Record<ExperimentLabType, string> = {
  text: '新文本会话',
  image: '新图片会话',
  video: '新视频会话',
}

/** 对会话按最近更新时间倒序排序，保证侧栏与默认恢复使用相同顺序。 */
function sortSessions(sessions: ExperimentSessionRead[]): ExperimentSessionRead[] {
  return [...sessions].sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))
}

/**
 * 管理实验室跨模态会话的加载、草稿选择和服务端 CRUD。
 *
 * @param options.initialSessionId - 页面从 URL 解析出的待恢复会话 ID；不存在时保持文本草稿。
 * @returns 会话列表、当前选择，以及供页面壳和模态组件调用的操作。
 */
export function useExperimentSessions(options: UseExperimentSessionsOptions = {}) {
  const { initialSessionId } = options
  const [sessions, setSessions] = useState<ExperimentSessionRead[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(initialSessionId)
  const [selectedLabType, setSelectedLabType] = useState<ExperimentLabType>('text')
  const [loading, setLoading] = useState(true)
  const creatingSessionsRef = useRef<Partial<Record<ExperimentLabType, Promise<ExperimentSessionRead>>>>({})

  const selectedSession = sessions.find((session) => session.id === selectedSessionId)

  /** 拉取三种模态的会话，并按全局最近更新时间合并排序。 */
  const reloadSessions = useCallback(async (targetSessionId = initialSessionId) => {
    setLoading(true)
    try {
      const responses = await Promise.all(
        (['text', 'image', 'video'] as ExperimentLabType[]).map((labType) =>
          StudioExperimentSessionsService.listExperimentSessionsApiV1StudioExperimentSessionsGet({ labType }),
        ),
      )
      const nextSessions = sortSessions(responses.flatMap((response) => response.data ?? []))
      setSessions(nextSessions)

      const restored = targetSessionId
        ? nextSessions.find((session) => session.id === targetSessionId)
        : undefined
      if (restored) {
        setSelectedSessionId(restored.id)
        setSelectedLabType(restored.lab_type)
      } else if (nextSessions[0]) {
        setSelectedSessionId(nextSessions[0].id)
        setSelectedLabType(nextSessions[0].lab_type)
      } else {
        setSelectedSessionId(undefined)
        setSelectedLabType('text')
      }
      return nextSessions
    } finally {
      setLoading(false)
    }
  }, [initialSessionId])

  useEffect(() => {
    void reloadSessions()
  }, [reloadSessions])

  /** 进入指定模态的未持久化草稿；不会触发创建接口。 */
  const selectDraft = useCallback((labType: ExperimentLabType) => {
    setSelectedSessionId(undefined)
    setSelectedLabType(labType)
  }, [])

  /** 选择已有会话，并使当前模态与会话实际类型保持一致。 */
  const selectSession = useCallback((session: ExperimentSessionRead) => {
    setSelectedSessionId(session.id)
    setSelectedLabType(session.lab_type)
  }, [])

  /**
   * 确保指定模态已有持久化会话，供首条有效提交前调用。
   * 同一模态并发提交会复用进行中的创建请求，避免产生重复空会话。
   */
  const ensureSession = useCallback(async (labType: ExperimentLabType): Promise<ExperimentSessionRead> => {
    if (selectedSession && selectedSession.lab_type === labType) return selectedSession

    const pending = creatingSessionsRef.current[labType]
    if (pending) return pending

    const creation = StudioExperimentSessionsService
      .createExperimentSessionApiV1StudioExperimentSessionsPost({
        requestBody: { lab_type: labType, title: defaultSessionTitles[labType] },
      })
      .then((response) => {
        const session = response.data
        if (!session) throw new Error('创建实验室会话失败')
        setSessions((current) => sortSessions([session, ...current.filter((item) => item.id !== session.id)]))
        setSelectedSessionId(session.id)
        setSelectedLabType(session.lab_type)
        return session
      })
      .finally(() => {
        delete creatingSessionsRef.current[labType]
      })

    creatingSessionsRef.current[labType] = creation
    return creation
  }, [selectedSession])

  /** 更新会话标题，并使用服务端返回的更新时间重新排序。 */
  const renameSession = useCallback(async (sessionId: string, title: string): Promise<ExperimentSessionRead | undefined> => {
    const response = await StudioExperimentSessionsService
      .updateExperimentSessionApiV1StudioExperimentSessionsSessionIdPatch({
        sessionId,
        requestBody: { title },
      })
    const updated = response.data ?? undefined
    if (updated) {
      setSessions((current) => sortSessions(current.map((session) => (session.id === updated.id ? updated : session))))
    }
    return updated
  }, [])

  /**
   * 删除会话，并在删除当前会话时退回默认文本草稿。
   *
   * @returns 删除后全局最近的剩余会话，供页面壳决定是否跳转。
   */
  const deleteSession = useCallback(async (sessionId: string): Promise<ExperimentSessionRead | undefined> => {
    await StudioExperimentSessionsService
      .deleteExperimentSessionApiV1StudioExperimentSessionsSessionIdDelete({ sessionId })
    let nextSession: ExperimentSessionRead | undefined
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== sessionId)
      nextSession = remaining[0]
      return remaining
    })
    if (selectedSessionId === sessionId) {
      setSelectedSessionId(undefined)
      setSelectedLabType('text')
    }
    return nextSession
  }, [selectedSessionId])

  /** 清空指定会话的服务端消息；消息展示状态由各模态组件自行重置。 */
  const clearSessionMessages = useCallback(async (sessionId: string) => {
    await StudioExperimentSessionsService
      .clearExperimentMessagesApiV1StudioExperimentSessionsSessionIdMessagesDelete({ sessionId })
  }, [])

  return {
    sessions,
    selectedSession,
    selectedSessionId,
    selectedLabType,
    loading,
    reloadSessions,
    selectDraft,
    selectSession,
    ensureSession,
    renameSession,
    deleteSession,
    clearSessionMessages,
  }
}
