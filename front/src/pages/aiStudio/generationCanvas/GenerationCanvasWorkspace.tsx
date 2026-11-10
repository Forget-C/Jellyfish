import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Empty, Input, Space } from 'antd'
import { useBlocker, useNavigate } from 'react-router-dom'
import { StudioDirectingService as Directing, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCatalog, CanvasDocument, CanvasRead, TextContentCard, ImageContentCard, VideoContentCard, StoryboardTaskRead } from '../../../services/generated'
import { useGenerationCanvasEditor } from './useGenerationCanvasEditor'
import { GenerationCanvasGraph, type CanvasModelCardActionContext } from './GenerationCanvasGraph'
import type { GenerationCanvasLayoutPolicy } from './generationLayout'
import { useGenerationCanvasRuntime } from './useGenerationCanvasRuntime'
import { RunPreview } from './RunPreview'
import { RunHistory } from './RunHistory'
import { CheckArchive } from './CheckArchive'
import { SceneStoryboardReview, StoryboardReviewFindings } from '../directing/SceneStoryboardReview'
import { directingError } from '../directing/common'
import { WorkbenchTheme } from '../directing/ui/WorkbenchTheme'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { WorkbenchDetailsProvider } from '../directing/ui/WorkbenchDetails'
import { WorkbenchModal } from '../directing/ui/WorkbenchModal'
import { useGraphBrowse } from '../directing/useGraphBrowse'
import { CanvasToolbarMenu } from '../directing/CanvasToolbarMenu'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { ArrowLeftOutlined, ArrowRightOutlined, SaveOutlined, MoreOutlined, UndoOutlined, RedoOutlined } from '@ant-design/icons'
import '../directing/canvasWorkbench.css'
import { TaskCenter } from '../components/TaskCenter'
import './generationCanvas.css'
import type { CanvasInspectTarget } from './canvasDiagnosticNavigation'

/** 浏览仅限同一画布的真实位置，不使用业务内容撤销记录。 */
function CanvasHistoryControls({ storageKey, requestLeave }: { storageKey: string; requestLeave: () => Promise<boolean> }) {
  const { canBrowse } = useGraphBrowse(storageKey)
  const navigate = useNavigate()
  const browse = async (offset: -1 | 1) => { if (canBrowse(offset) && await requestLeave()) navigate(offset) }
  return <nav className="canvas-browse-history" aria-label="画布浏览历史">
    <WorkbenchIconButton label="后退" variant="quiet" icon={<ArrowLeftOutlined />} disabled={!canBrowse(-1)} onClick={() => void browse(-1)} />
    <WorkbenchIconButton label="前进" variant="quiet" icon={<ArrowRightOutlined />} disabled={!canBrowse(1)} onClick={() => void browse(1)} />
  </nav>
}

/** 宿主操作使用相同的离开保护和编辑门禁。 */
interface CanvasManagementContext {
  current: CanvasRead | undefined
  saving: boolean
  editable: boolean
  running: boolean
  canEdit: () => boolean
  requestLeave: () => Promise<boolean>
  nameEditor: ReactNode
}

type CanvasLayoutPolicy = (document: CanvasDocument, beforeApplication?: CanvasDocument) => GenerationCanvasLayoutPolicy | undefined

interface GenerationCanvasWorkspaceProps {
  layoutPolicy?: CanvasLayoutPolicy
  projectId: string
  canvasId: string | null
  back: { label: string; onClick: () => void }
  renderCanvasManagement?: (context: CanvasManagementContext) => ReactNode
  renderSceneActions?: (context: CanvasManagementContext & { document?: CanvasDocument }) => ReactNode
  renderModelCardAction?: (context: CanvasModelCardActionContext) => ReactNode
  storyboardTaskId?: string | null
  onCanvasRead?: (canvas: CanvasRead) => void
  hostError?: string
  hostErrorAction?: ReactNode
  targetRun?: string | null
  targetNode?: string | null
  targetCheck?: string | null
  targetReport?: string | null
  onCloseRunHistory?: () => void
}

/** 按项目与画布身份承载编辑、保存和执行。宿主提供导航和画布管理。 */
export function GenerationCanvasWorkspace({
  projectId, canvasId, back, renderCanvasManagement, renderSceneActions, renderModelCardAction, storyboardTaskId, onCanvasRead, hostError, hostErrorAction,
  targetRun, targetNode, targetCheck: checkCardId, targetReport: checkReportId, onCloseRunHistory, layoutPolicy,
}: GenerationCanvasWorkspaceProps) {
  const [primaryHost, setPrimaryHost] = useState<HTMLDivElement | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [inspectTarget, setInspectTarget] = useState<CanvasInspectTarget>()
  const pendingInspect = useRef<CanvasInspectTarget>()
  const editor = useGenerationCanvasEditor(projectId, canvasId)
  const leaveEditor = useRef(editor.requestLeave); leaveEditor.current = editor.requestLeave
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.key !== nextLocation.key && editor.needsLeaveProtection())
  useEffect(() => { if (blocker.state === 'blocked') void leaveEditor.current().then(ok => { if (ok) blocker.proceed(); else blocker.reset() }) }, [blocker])
  const { current, document, edit, save, saving, dirty, ownership, applyInitialCandidate, configureCatalog: configureEditorCatalog } = editor
  const layoutApplication = editor.storyboardApplication
  const beforeApplication = layoutApplication?.taskId === document?.storyboard?.task_id &&
    layoutApplication?.before.id === document?.id && layoutApplication?.before.project_id === projectId
    ? layoutApplication.before : undefined
  const scene = current?.id === canvasId ? current.scene : undefined
  const chapterId = scene?.chapter_id, sequenceId = scene?.sequence_id
  const candidateKey = JSON.stringify([projectId, canvasId, chapterId, sequenceId, storyboardTaskId])
  const [discovery, setDiscovery] = useState<{ key: string; result?: StoryboardTaskRead; error?: string }>()
  const [candidateRefresh, setCandidateRefresh] = useState(0)
  const handledCandidate = useRef<string>()
  const [reviewTask, setReviewTask] = useState<string>()
  const discovered = discovery?.key === candidateKey ? discovery : undefined
  const candidate = discovered?.result?.candidate
  const candidateTask = discovered?.result?.task_id
  const requiresReview = discovered?.result?.pending_application
  useEffect(() => {
    if (!canvasId || !chapterId || !sequenceId) return
    let active = true
    const request = Directing.directingStoryboardCandidate({ projectId, chapterId, sequenceId, canvasId,
      taskId: storyboardTaskId ?? undefined })
    void request.then(({ data }) => {
      if (!active) return
      if (data && (data.canvas_id !== canvasId || data.candidate?.document.id !== canvasId ||
          data.candidate.document.storyboard?.task_id !== data.task_id)) throw new Error('此分镜候选不属于当前画布')
      setDiscovery({ key: candidateKey, result: data ?? undefined })
    }).catch(cause => {
      if (active) setDiscovery({ key: candidateKey, error: directingError(cause) })
    })
    return () => { active = false; request.cancel() }
  }, [candidateKey, projectId, canvasId, chapterId, sequenceId, storyboardTaskId, candidateRefresh])
  useEffect(() => {
    if (!current || !candidate || !candidateTask || handledCandidate.current === candidateTask) return
    if (current.document.storyboard?.task_id === candidateTask) {
      handledCandidate.current = candidateTask
      return
    }
    if (!ownership.editable && ownership.state === 'checking') return
    handledCandidate.current = candidateTask
    if (requiresReview) setReviewTask(candidateTask)
    else void applyInitialCandidate(candidate).then(result => {
      if (result === 'pending' && handledCandidate.current === candidateTask) setReviewTask(candidateTask)
    })
  }, [candidateTask, current, candidate, applyInitialCandidate, ownership.editable, ownership.state, requiresReview])
  const catalog = useRef<CanvasCatalog>()
  const configureCatalog = useCallback((value: CanvasCatalog) => {
    catalog.current = value
    configureEditorCatalog(value)
  }, [configureEditorCatalog])
  useEffect(() => { if (current) onCanvasRead?.(current) }, [current, onCanvasRead])
  const liveCheck = !!checkCardId && !!current?.document.cards?.some(card => card.id === checkCardId && card.type === 'review.check')
  useEffect(() => {
    if (current?.id === canvasId && checkCardId && checkReportId && liveCheck) {
      setInspectTarget({ cardId: checkCardId, reportId: checkReportId, serial: Date.now() })
    }
  }, [canvasId, current?.id, checkCardId, checkReportId, liveCheck])
  const runtime = useGenerationCanvasRuntime(projectId, canvasId, save, ownership.canEdit, current?.revision)
  useEffect(() => { if (runtime.preview) setPreviewOpen(true) }, [runtime.preview])
  const change: typeof edit = (next, arrangement) => { runtime.invalidate(); edit(next, arrangement) }
  const scope = `${projectId}:${canvasId}`, latestScope = useRef(scope); latestScope.current = scope
  const retainedCopies = useRef(new Map<string, TextContentCard | ImageContentCard | VideoContentCard>())

  const saveOutput = async (node: { id: string; run_id: string }, position: number) => {
    if (!canvasId || !ownership.canEdit() || editor.recovery || editor.conflict) return false
    const targetScope = scope, key = `${scope}:${node.id}:${position}`
    let card = retainedCopies.current.get(key)
    if (!card) {
      const response = await Canvases.canvasOutputContent({ projectId, canvasId, runId: node.run_id, nodeId: node.id, position })
      if (!response.data) throw new Error('missing content receipt')
      card = response.data; retainedCopies.current.set(key, card)
    }
    if (latestScope.current !== targetScope || !ownership.canEdit()) return false
    const copy = card
    // Functional insertion preserves edits made while the historical DTO loads.
    // Failed saves keep this same card identity for an explicit retry.
    change(previous => ({ ...previous, cards: previous.cards?.some(item => item.id === copy.id) ? previous.cards : [...(previous.cards || []), copy] }))
    const saved = await save()
    if (saved) retainedCopies.current.delete(key)
    return saved
  }

  const management: CanvasManagementContext = {
    current, saving, editable: ownership.editable,
    running: !!runtime.busyCards.size, canEdit: ownership.canEdit, requestLeave: editor.requestLeave,
    nameEditor: current?.id === canvasId && !current.scene && document && <Input aria-label="画布名称" value={document.name} maxLength={255}
      disabled={!ownership.editable || !!editor.recovery || editor.initialApplying}
      onChange={event => change({ ...document, name: event.target.value })} />,
  }
  return <WorkbenchTheme><WorkbenchDetailsProvider><section className="canvas-workbench generation-workbench" aria-label="生成画布工作台" onContextMenu={event => event.preventDefault()}>
    <header className="canvas-workbench-toolbar generation-workbench-header">
      <div className="canvas-toolbar-identity">
        <WorkbenchIconButton label={back.label} variant="quiet" icon={<ArrowLeftOutlined />} onClick={async () => { if (await editor.requestLeave()) back.onClick() }} />
        <strong className="canvas-sequence-name">{document?.name || '画布生成'}</strong>
        {renderCanvasManagement?.(management)}
        <span role="status" aria-label="画布保存状态">{saving ? '保存中' : editor.conflict ? '修订冲突' : !ownership.editable && canvasId ? '只读' : dirty ? '待保存' : current ? '已保存' : '尚无画布'}</span>
        {current && <WorkbenchIconButton label="保存画布" variant={dirty ? 'primary' : 'quiet'} icon={<SaveOutlined />} onClick={() => void save()} loading={saving} disabled={!ownership.editable || !!editor.recovery || editor.conflict} />}
        <div className="generation-browse-history-host">{canvasId && <CanvasHistoryControls key={scope} storageKey={`generation-canvas:${scope}`} requestLeave={editor.requestLeave} />}</div>
      </div>
      <div className="generation-toolbar-center" />
      <div className="canvas-toolbar-actions">
        <div ref={setPrimaryHost} className="generation-primary-host" />
        {renderSceneActions?.({ ...management, document, editable: management.editable && !editor.recovery && !editor.conflict && !editor.initialApplying })}
        {document && <RunHistory onClose={() => onCloseRunHistory?.()} key={document.id} runs={runtime.snapshot.runs} targetRun={targetRun} targetNode={targetNode}
          disabled={!ownership.editable || !!editor.recovery || editor.conflict} onSave={saveOutput} onCancel={runtime.cancel} cancelling={runtime.cancelling} />}
        {current && <CheckArchive key={scope} projectId={projectId} canvasId={current.id} revision={current.revision} targetReportId={liveCheck ? undefined : checkReportId ?? undefined} />}
        <TaskCenter workbench />
        <CanvasToolbarMenu label="更多操作" icon={<MoreOutlined />}>
          <span role="status" aria-label="运行连接">{runtime.connection === 'connected' ? '运行事件已连接' : runtime.connection === 'connecting' ? '正在连接运行事件' : '运行连接恢复中，保留已接收内容'}</span>
        </CanvasToolbarMenu>
      </div>
    </header>
    <div className="generation-feedback">
    {(hostError || editor.error) && <Alert type="error" showIcon message={hostError || editor.error} action={hostErrorAction} />}
    {discovered?.error && <Alert type="error" showIcon message={discovered.error}
      action={<Button onClick={() => setCandidateRefresh(value => value + 1)}>重试读取分镜</Button>} />}
    {candidateTask && candidateTask === reviewTask && chapterId && sequenceId && current?.document.storyboard?.task_id !== candidateTask &&
      <SceneStoryboardReview key={candidateTask} scope={{ projectId, chapterId, sequenceId, taskId: candidateTask }} editable={ownership.editable && !editor.recovery && !editor.conflict}
        report={discovered?.result?.review} candidate={candidate}
        prepare={editor.prepareReview} reload={editor.reload} applying={saving} saveError={editor.error}
        apply={async choice => {
          const applied = await editor.applyReviewedCandidate({ chapterId, sequenceId, taskId: candidateTask }, choice)
          if (applied) { runtime.invalidate(); setReviewTask(undefined) }
          return applied
        }} />}
    {!requiresReview && discovered?.result?.review_state === 'warning' && discovered.result.review &&
      <Alert type="warning" showIcon message="部分连续性依据不足"
        description={<StoryboardReviewFindings report={discovered.result.review} candidate={candidate} />} />}
    {current?.source_changed && <Alert type="warning" showIcon message="章节原文已变化，画布仍保留当前固定原文。" />}
    {editor.storageError && <Alert type="warning" message={editor.storageError} />}
    {canvasId && !ownership.editable && <Alert type="warning" message={ownership.message || (ownership.state === 'unsupported' ? '浏览器不支持编辑所有权保护，当前只读' : '此画布当前只读')} action={<Space><Button onClick={ownership.takeEditing}>取得编辑权</Button>{ownership.state === 'choice' && <><Button onClick={() => ownership.chooseHandoff('save')}>保存后交接</Button><Button onClick={() => ownership.chooseHandoff('discard')}>放弃后交接</Button></>}</Space>} />}

      {runtime.error && <Alert type="error" message={runtime.error} />}
      {runtime.pending && <Alert type="warning" message="运行请求结果待核实；将使用原请求身份取得回执" action={<Button loading={runtime.submitting} disabled={!ownership.editable} onClick={() => void runtime.submit()}>核实运行请求</Button>} />}
    </div>
      <WorkbenchModal title="核对画布内容" open={!!editor.recovery || editor.conflict} closable={false} footer={null}>
    {editor.recovery && <Alert type="warning" message="发现本地未保存内容；恢复前将核实服务器及未明请求" action={<Space><Button onClick={editor.restore} disabled={!ownership.editable || saving}>恢复本地内容</Button><Button onClick={() => editor.reload()} disabled={!ownership.editable || saving}>使用服务器内容</Button></Space>} />}
    {editor.conflict && <Alert type="warning" message="修订冲突，本地内容已保留。核对后选择处理方式" action={<Space><Button onClick={() => editor.reload(true)}>保留本地并以最新修订保存</Button><Button onClick={() => editor.reload()}>使用服务器内容</Button></Space>} />}
      </WorkbenchModal>
      <WorkbenchModal title="运行预检" afterClose={() => {
        // 预检操作容器解除底层 inert 后，再由详情定位真实编辑片段。
        if (pendingInspect.current) { setInspectTarget(pendingInspect.current); pendingInspect.current = undefined }
      }} open={previewOpen && !!runtime.preview && !editor.recovery && !editor.conflict} onCancel={() => setPreviewOpen(false)} footer={null}>
        {runtime.preview && <RunPreview canvas={document || undefined} catalog={catalog.current} preview={runtime.preview} submitting={runtime.submitting} disabled={!ownership.editable || !!runtime.pending || runtime.busyCards.has(runtime.preview.card_id)} onSubmit={() => void runtime.submit()} onLocate={target => { pendingInspect.current = { cardId: String(target.card_id || runtime.preview!.card_id), diagnostic: target, serial: Date.now() }; setPreviewOpen(false) }} />}
      </WorkbenchModal>
    {!document || !current ? <Empty className="generation-empty" description="创建或选择一张画布" /> : <div className="generation-stage">
      <GenerationCanvasGraph layoutPolicy={layoutPolicy?.(document, beforeApplication)} onCatalogReady={configureCatalog} history={{ canUndo: editor.canUndo, canUndoArrangement: editor.canUndoArrangement, record: editor.recordAction, undo: () => { if (editor.undo() === 'document') runtime.invalidate() }, redo: () => { if (editor.redo() === 'document') runtime.invalidate() } }} contentHistory={<div className="canvas-history-controls" aria-label="画布操作历史">
        <WorkbenchIconButton label="撤销操作" variant="quiet" icon={<UndoOutlined />} disabled={!ownership.editable || !!editor.recovery || !editor.canUndo} onClick={() => { if (editor.undo() === 'document') runtime.invalidate() }} />
        <WorkbenchIconButton label="重做操作" variant="quiet" icon={<RedoOutlined />} disabled={!ownership.editable || !!editor.recovery || !editor.canRedo} onClick={() => { if (editor.redo() === 'document') runtime.invalidate() }} />
      </div>} primaryHost={primaryHost} savedDocument={current.document} savedRevision={current.revision} key={document.id} document={document} onChange={change} inspectTarget={inspectTarget} diagnostics={[...(runtime.preview?.diagnostics || []), ...(editor.saveDiagnostic ? [editor.saveDiagnostic] : [])]} editingStatus={editor.error || (editor.conflict ? '修订冲突，请关闭详情处理' : saving ? '正在保存修改' : dirty ? '修改尚未保存' : undefined)} readonly={!ownership.editable || !!editor.recovery || editor.initialApplying}
        renderModelCardAction={renderModelCardAction}
        runtime={{ outputs: runtime.snapshot.current_outputs, outputsVerified: runtime.outputsVerified, runs: runtime.snapshot.runs, nodes: runtime.latestNodes, busyCards: runtime.busyCards, checking: runtime.checking,
          disabled: runtime.storageBlocked || !!runtime.pending || !!runtime.checking || runtime.submitting || editor.conflict, precheck: cardId => void runtime.precheck(cardId) }} />
    </div>}
  </section></WorkbenchDetailsProvider></WorkbenchTheme>
}
