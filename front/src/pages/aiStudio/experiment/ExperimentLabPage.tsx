/** 统一实验室页面：负责会话与路由，模态组件仅负责各自的生成能力。 */
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ExperimentLabLayout } from './components/ExperimentLabLayout'
import { ExperimentSessionSidebar } from './components/ExperimentSessionSidebar'
import { useExperimentSessions, type ExperimentLabType } from './hooks/useExperimentSessions'
import { TextExperimentMode } from './modes/TextExperimentMode'
import { ImageExperimentMode } from './modes/ImageExperimentMode'
import { VideoExperimentMode } from './modes/VideoExperimentMode'

type LabSlots = { history: ReactNode; composer: ReactNode; extra: ReactNode; overlays?: ReactNode; disabled?: boolean }

/** 将会话选择写入唯一实验室路由，同时使草稿态保持显式模态。 */
export default function ExperimentLabPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSessionId = useRef(searchParams.get('session') ?? undefined).current
  const lastRouteKeyRef = useRef(searchParams.toString())
  const initialModeAppliedRef = useRef(false)
  const requestedMode = searchParams.get('mode') as ExperimentLabType | null
  const sessionState = useExperimentSessions({ initialSessionId })
  const { sessions, selectedSessionId, selectedLabType, loading, selectDraft, selectSession, ensureSession, renameSession, deleteSession, clearSessionMessages } = sessionState

  /** 响应浏览器前进/后退及同路由导航，避免内部 URL 回写覆盖外部选择。 */
  useEffect(() => {
    const routeKey = searchParams.toString()
    if (routeKey === lastRouteKeyRef.current) return
    lastRouteKeyRef.current = routeKey
    const routeSessionId = searchParams.get('session')
    if (routeSessionId) {
      void sessionState.reloadSessions(routeSessionId)
      return
    }
    if (requestedMode && ['text', 'image', 'video'].includes(requestedMode)) selectDraft(requestedMode)
  }, [requestedMode, searchParams, selectDraft, sessionState])

  /** 初次以 mode 参数进入时，mode 明确优先于默认的最近会话恢复。 */
  useEffect(() => {
    if (!loading && !initialSessionId && requestedMode && ['text', 'image', 'video'].includes(requestedMode)) {
      initialModeAppliedRef.current = true
      selectDraft(requestedMode)
    }
  }, [initialSessionId, loading, requestedMode, selectDraft])

  /** 草稿首提创建会话后补写 URL；已有会话切换均由显式操作写入。 */
  useEffect(() => {
    if (!initialSessionId && requestedMode && !initialModeAppliedRef.current) return
    if (loading || searchParams.get('session') || !selectedSessionId) return
    const next = new URLSearchParams({ session: selectedSessionId })
    lastRouteKeyRef.current = next.toString()
    setSearchParams(next, { replace: true })
  }, [initialSessionId, loading, requestedMode, searchParams, selectedSessionId, setSearchParams])

  /** 切换历史会话；模态由服务端会话的 lab_type 决定。 */
  const handleSelectSession = (session: typeof sessions[number]) => {
    selectSession(session)
    const next = new URLSearchParams({ session: session.id })
    lastRouteKeyRef.current = next.toString()
    setSearchParams(next)
  }

  /** 进入草稿态时同步 URL，确保刷新后仍保留所选模态。 */
  const handleStartDraft = (labType: ExperimentLabType) => {
    selectDraft(labType)
    const next = new URLSearchParams({ mode: labType })
    lastRouteKeyRef.current = next.toString()
    setSearchParams(next)
  }

  /** 删除后恢复全局最新会话；没有历史时回到文本草稿。 */
  const handleDeleteSession = async (sessionId: string) => {
    const deletingCurrent = sessionId === selectedSessionId
    const next = await deleteSession(sessionId)
    if (!deletingCurrent) return
    if (next) handleSelectSession(next)
    else handleStartDraft('text')
  }

  /** 统一装配布局与侧栏，确保不同模态不再拥有独立页面框架。 */
  // render-prop 工厂返回布局节点，不是匿名 React 组件。
  // eslint-disable-next-line react/display-name
  const renderLayout = (title: string) => (slots: LabSlots) => (
    <ExperimentLabLayout
      title={title}
      extra={slots.extra}
      sidebar={<ExperimentSessionSidebar
        value={selectedSessionId}
        sessions={sessions}
        disabled={Boolean(slots.disabled)}
        onChange={handleSelectSession}
        onStartDraft={handleStartDraft}
        onRename={async (sessionId, title) => { await renameSession(sessionId, title) }}
        onDelete={handleDeleteSession}
      />}
      history={slots.history}
      composer={slots.composer}
      overlays={slots.overlays}
    />
  )

  if (selectedLabType === 'image') return <ImageExperimentMode key={`image-${selectedSessionId ?? 'draft'}`} sessionId={selectedSessionId} ensureSession={ensureSession} clearSessionMessages={clearSessionMessages} render={renderLayout('图片实验室')} />
  if (selectedLabType === 'video') return <VideoExperimentMode key={`video-${selectedSessionId ?? 'draft'}`} sessionId={selectedSessionId} ensureSession={ensureSession} clearSessionMessages={clearSessionMessages} render={renderLayout('视频实验室')} />
  return <TextExperimentMode key={`text-${selectedSessionId ?? 'draft'}`} sessionId={selectedSessionId} ensureSession={ensureSession} onClearSession={clearSessionMessages} render={renderLayout('文本实验室')} />
}
