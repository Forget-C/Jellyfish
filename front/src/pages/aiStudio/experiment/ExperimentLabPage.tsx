/** 统一实验室页面：负责会话与路由，模态组件仅负责各自的生成能力。 */
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ExperimentLabLayout } from './components/ExperimentLabLayout'
import { ExperimentSessionSidebar } from './components/ExperimentSessionSidebar'
import { useExperimentSessions, type ExperimentLabType } from './hooks/useExperimentSessions'
import { TextExperimentMode } from './modes/TextExperimentMode'
import { ImageExperimentMode } from './modes/ImageExperimentMode'
import { VideoExperimentMode } from './modes/VideoExperimentMode'

function parseMode(mode: string | null): ExperimentLabType | undefined {
  if (mode === 'text' || mode === 'image' || mode === 'video') return mode
  return undefined
}

type LabSlots = { history: ReactNode; composer: ReactNode; clearContent?: () => Promise<void>; overlays?: ReactNode; disabled?: boolean }

/** 将会话选择写入唯一实验室路由，同时使草稿态保持显式模态。 */
export default function ExperimentLabPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialSessionId = useRef(searchParams.get('session') ?? undefined).current
  const lastRouteKeyRef = useRef(searchParams.toString())
  const skipSessionWriteRef = useRef(false)
  const requestedMode = parseMode(searchParams.get('mode'))
  const initialLabType = useRef(initialSessionId ? undefined : requestedMode).current
  const sidebarTrigger = useRef<HTMLButtonElement>(null)
  const [draftRevision, setDraftRevision] = useState(0)
  const {
    sessions, selectedSessionId, selectedLabType, loading, failedTypes, reloadSessions,
    selectDraft, selectSession, ensureSession, renameSession, deleteSession, clearSessionMessages,
  } = useExperimentSessions({ initialSessionId, initialLabType })

  /** 响应浏览器前进/后退及同路由导航，避免内部 URL 回写覆盖外部选择。 */
  useEffect(() => {
    const routeKey = searchParams.toString()
    if (routeKey === lastRouteKeyRef.current) return
    lastRouteKeyRef.current = routeKey
    const routeSessionId = searchParams.get('session')
    if (routeSessionId) {
      void reloadSessions({ sessionId: routeSessionId })
      return
    }
    skipSessionWriteRef.current = true
    if (requestedMode) {
      setDraftRevision(revision => revision + 1)
      selectDraft(requestedMode)
    } else void reloadSessions({})
  }, [reloadSessions, requestedMode, searchParams, selectDraft])

  /** 草稿首提创建会话后补写 URL；已有会话切换均由显式操作写入。 */
  useEffect(() => {
    if (skipSessionWriteRef.current) {
      skipSessionWriteRef.current = false
      return
    }
    if (loading || searchParams.get('session') || !selectedSessionId) return
    const next = new URLSearchParams(searchParams)
    next.delete('mode')
    next.set('session', selectedSessionId)
    lastRouteKeyRef.current = next.toString()
    setSearchParams(next, { replace: true })
  }, [loading, searchParams, selectedSessionId, setSearchParams])

  /** 切换历史会话；模态由服务端会话的 lab_type 决定。 */
  const handleSelectSession = (session: typeof sessions[number]) => {
    selectSession(session)
    const next = new URLSearchParams(searchParams)
    next.delete('mode')
    next.set('session', session.id)
    lastRouteKeyRef.current = next.toString()
    setSearchParams(next)
  }

  /** 进入草稿态时同步 URL，确保刷新后仍保留所选模态。 */
  const handleStartDraft = (labType: ExperimentLabType) => {
    // 显式新建草稿使上一份未落库草稿的异步回执失效；首提回写会话 ID 沿用原上下文。
    setDraftRevision(revision => revision + 1)
    selectDraft(labType)
    const next = new URLSearchParams(searchParams)
    next.delete('session')
    next.set('mode', labType)
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
      sessionTitle={sessions.find(session => session.id === selectedSessionId)?.title}
      clearContent={slots.clearContent}
      sidebarTrigger={sidebarTrigger}
      sidebar={(close) => <ExperimentSessionSidebar
        value={selectedSessionId}
        labType={selectedLabType}
        sessions={sessions}
        loading={loading}
        failedTypes={failedTypes}
        onRetry={() => void reloadSessions({
          sessionId: searchParams.get('session') ?? undefined,
          labType: requestedMode,
        })}
        // 运行中的任务只锁定当前模态输入，不阻断会话恢复或切换。
        onChange={session => { handleSelectSession(session); close() }}
        onStartDraft={labType => { handleStartDraft(labType); close() }}
        onRename={async (sessionId, title) => { await renameSession(sessionId, title) }}
        onDelete={handleDeleteSession}
      />}
      history={slots.history}
      composer={slots.composer}
      overlays={slots.overlays}
    />
  )

  if (selectedLabType === 'image') return <ImageExperimentMode key={draftRevision} sessionId={selectedSessionId} ensureSession={ensureSession} clearSessionMessages={clearSessionMessages} render={renderLayout('图片实验室')} />
  if (selectedLabType === 'video') return <VideoExperimentMode key={draftRevision} sessionId={selectedSessionId} ensureSession={ensureSession} clearSessionMessages={clearSessionMessages} render={renderLayout('视频实验室')} />
  return <TextExperimentMode key={draftRevision} sessionId={selectedSessionId} ensureSession={ensureSession} onClearSession={clearSessionMessages} render={renderLayout('文本实验室')} />
}
