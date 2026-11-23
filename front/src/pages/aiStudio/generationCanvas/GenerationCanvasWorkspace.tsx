import type { AssistantLayoutEditor, AssistantLayoutOutcome } from './assistantLayoutEditor'
import { useUiText } from '../../../uiText'
import { PromptDraftContext, PromptEditingContext, PromptEditingActiveContext } from './PromptEditingContext'
import { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Empty, Space } from 'antd'
import { useBlocker, useNavigate } from 'react-router-dom'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCatalog, CanvasDocument, CanvasRead, CanvasAssistantLayout, TextContentCard, ImageContentCard, VideoContentCard, StoryboardApplication } from '../../../services/generated'
import { useGenerationCanvasEditor, type CanvasSettingsChanges, type StoryboardReviewPreparation, type StoryboardScope, type PendingSave } from './useGenerationCanvasEditor'
import { GenerationCanvasGraph, type CanvasModelCardActionContext, type CanvasModelCardMenuContext } from './GenerationCanvasGraph'
import type { GenerationCanvasLayoutPolicy } from './generationLayout'
import { useGenerationCanvasRuntime } from './useGenerationCanvasRuntime'
import { RunPreview } from './RunPreview'
import { RunHistory } from './RunHistory'
import { readAssistantHighlight, storeAssistantHighlight, type AssistantHighlight } from './assistantHighlight'
import { CanvasAssistant } from './CanvasAssistant'
import { SaveVideoFrameDialog, type VideoFrameSource } from './SaveVideoFrameDialog'
import { CanvasAppearancePicker } from '../../../components/workbench/CanvasAppearancePicker'
import { WorkbenchTheme } from '../../../components/workbench/WorkbenchTheme'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDetailsProvider } from '../../../components/workbench/WorkbenchDetails'
import { WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { useGraphBrowse } from './useGraphBrowse'
import { CanvasToolbarMenu } from './CanvasToolbarMenu'
import { WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { ArrowLeftOutlined, ArrowRightOutlined, SaveOutlined, MoreOutlined, UndoOutlined, RedoOutlined } from '@ant-design/icons'
import '../directing/canvasWorkbench.css'
import { TaskCenter } from '../components/TaskCenter'
import './generationCanvas.css'
import type { CanvasSourceItem } from './CanvasSourcePopover'
import type { GenerationCard } from './graphRules'
import type { CanvasInspectTarget } from './canvasDiagnosticNavigation'

/** 浏览仅限同一画布的真实位置，不使用业务内容撤销记录。 */
function CanvasHistoryControls({ storageKey, requestLeave }: { storageKey: string; requestLeave: () => Promise<boolean> }) {
  const uiText = useUiText()
  const { canBrowse } = useGraphBrowse(storageKey)
  const navigate = useNavigate()
  const browse = async (offset: -1 | 1) => { if (canBrowse(offset) && await requestLeave()) navigate(offset) }
  return <nav className="canvas-browse-history" aria-label={uiText("画布浏览历史")}>
    <WorkbenchIconButton label={uiText("后退")} variant="quiet" icon={<ArrowLeftOutlined />} disabled={!canBrowse(-1)} onClick={() => void browse(-1)} />
    <WorkbenchIconButton label={uiText("前进")} variant="quiet" icon={<ArrowRightOutlined />} disabled={!canBrowse(1)} onClick={() => void browse(1)} />
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
  document?: CanvasDocument
  settingsBlocked: boolean
  settingsPending: boolean
  settingsDraft?: CanvasSettingsChanges
  clearSettingsDraft: () => void
  settingsError: string
  saveSettings: (changes: CanvasSettingsChanges) => Promise<boolean>
}

type CanvasLayoutPolicy = (document: CanvasDocument, beforeApplication?: CanvasDocument) => GenerationCanvasLayoutPolicy | undefined

export type WorkbenchModelMenuContext = CanvasModelCardMenuContext & {
  prepare: () => Promise<CanvasRead | undefined>
  commit: (revision: number, requestId: string, transform: (before: CanvasDocument, catalog: CanvasCatalog) => CanvasDocument) => Promise<boolean>
}

interface GenerationCanvasWorkspaceProps {
  freeDraft?: boolean
  sceneSave?: (projectId: string, canvas: CanvasRead, command: PendingSave) => Promise<CanvasRead>
  renderFeedback?: (current?: CanvasRead) => ReactNode
  layoutPolicy?: CanvasLayoutPolicy
  projectId: string
  canvasId: string | null
  back: { label: string; onClick: () => void }
  renderCanvasManagement?: (context: CanvasManagementContext, focusMenu: () => void) => ReactNode
  renderSceneActions?: (context: CanvasManagementContext & { document?: CanvasDocument;
    prepareReview: () => Promise<StoryboardReviewPreparation | undefined>;
    applyReview: (scope: StoryboardScope, choice: StoryboardApplication) => Promise<boolean>;
    reloadReview: () => Promise<boolean>;
  }) => ReactNode
  renderModelCardAction?: (context: CanvasModelCardActionContext) => ReactNode
  renderModelCardMenu?: (context: WorkbenchModelMenuContext) => ReactNode
  modelCardSources?: (card: GenerationCard, document: CanvasDocument) => CanvasSourceItem[]
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
  freeDraft, sceneSave, renderFeedback, projectId, canvasId, back, renderCanvasManagement, renderSceneActions, renderModelCardAction, renderModelCardMenu, modelCardSources, onCanvasRead, hostError, hostErrorAction,
  targetRun, targetNode, targetCheck: checkCardId, targetReport: checkReportId, onCloseRunHistory, layoutPolicy,
}: GenerationCanvasWorkspaceProps) {
  const uiText = useUiText()
  const [assistantHistoryTarget, setAssistantHistoryTarget] = useState<{ canvasId: string, runId: string }>()
  const assistantRun = assistantHistoryTarget?.canvasId === canvasId ? assistantHistoryTarget?.runId : undefined
  const toolbar = useRef<HTMLElement>(null)
  useEffect(() => {
    const element = toolbar.current
    if (!element) return
    const measure = () => element.parentElement?.style.setProperty('--workbench-toolbar-bottom', `${element.offsetTop + element.offsetHeight}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [])
  const [primaryHost, setPrimaryHost] = useState<HTMLDivElement | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [inspectTarget, setInspectTarget] = useState<CanvasInspectTarget>()
  const pendingInspect = useRef<CanvasInspectTarget>()
  const editor = useGenerationCanvasEditor(projectId, canvasId, true, sceneSave, freeDraft)
  const [promptEditors, setPromptEditors] = useState<Set<string>>(() => new Set())
  const assistantLayout = useRef<AssistantLayoutEditor>()
  const assistantGroupingBefore = useRef<{ sourceId: string, document: CanvasDocument }>()
  const [assistantMarks, setAssistantMarks] = useState<{ scope: string, value: AssistantHighlight }>()
  const [assistantTarget, setAssistantTarget] = useState<{ scope: string, cardId: string, serial: number }>()
  const [selectedCards, setSelectedCards] = useState<string[]>([])
  const activePromptDrafts = useRef(new Map<string, () => GenerationCard>())
  const reportPromptDraft = useCallback((sessionId: string, readDraft?: () => GenerationCard) => {
    if (readDraft) activePromptDrafts.current.set(sessionId, readDraft)
    else activePromptDrafts.current.delete(sessionId)
  }, [])
  const reportPromptEditing = useCallback((cardId: string, editing: boolean) => setPromptEditors(previous => {
    if (previous.has(cardId) === editing) return previous
    const next = new Set(previous)
    if (editing) next.add(cardId); else next.delete(cardId)
    return next
  }), [])
  const requestLeave = async () => {
    if (promptEditors.size) return false
    return editor.requestLeave()
  }
  useEffect(() => {
    if (!promptEditors.size) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [promptEditors])
  const leaveEditor = useRef(requestLeave); leaveEditor.current = requestLeave
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.key !== nextLocation.key && (!!promptEditors.size || editor.needsLeaveProtection()))
  useEffect(() => { if (blocker.state === 'blocked') void leaveEditor.current().then(ok => { if (ok) blocker.proceed(); else blocker.reset() }) }, [blocker])
  const { current, document, edit, save, saving, dirty, ownership, configureCatalog: configureEditorCatalog } = editor
  const layoutApplication = editor.storyboardApplication
  const beforeApplication = layoutApplication?.taskId === document?.storyboard?.task_id &&
    layoutApplication?.before.id === document?.id && layoutApplication?.before.project_id === projectId
    ? layoutApplication.before : undefined
  const catalog = useRef<CanvasCatalog>()
  const configureCatalog = useCallback((value: CanvasCatalog) => {
    catalog.current = value
    configureEditorCatalog(value)
  }, [configureEditorCatalog])
  const canPublishRead = !freeDraft || (!dirty && !saving && !editor.needsLeaveProtection() && !promptEditors.size && blocker.state === 'unblocked')
  useEffect(() => { if (current && canPublishRead) onCanvasRead?.(current) }, [current, onCanvasRead, canPublishRead])
  const liveCheck = !!checkCardId && !!current?.document.cards?.some(card => card.id === checkCardId && card.type === 'review.check')
  useEffect(() => {
    if (current?.id === canvasId && checkCardId && checkReportId && liveCheck) {
      setInspectTarget({ cardId: checkCardId, reportId: checkReportId, serial: Date.now() })
    }
  }, [canvasId, current?.id, checkCardId, checkReportId, liveCheck])
  const uncreated = current?.revision === -1
  const runtime = useGenerationCanvasRuntime(projectId, (!current || uncreated) ? null : canvasId, save, ownership.canEdit, current?.revision)
  useEffect(() => { if (runtime.preview) setPreviewOpen(true) }, [runtime.preview])
  const change: typeof edit = (next, arrangement) => { runtime.invalidate(); edit(next, arrangement) }
  const scope = `${projectId}:${canvasId}`, latestScope = useRef(scope); latestScope.current = scope
  const persistedHighlight = useMemo(() => readAssistantHighlight(scope), [scope])
  const assistantHighlight = assistantMarks?.scope === scope ? assistantMarks.value : persistedHighlight

  const [frameSelection, setFrameSelection] = useState<{ scope: string; source: VideoFrameSource }>()
  const frameDisabled = !ownership.editable || !!editor.recovery || editor.conflict || editor.initialApplying
  const selectVideoFrame = (source: VideoFrameSource) => setFrameSelection({ scope, source })
  const saveSelectedFrame = async (card: ImageContentCard) => {
    if (latestScope.current !== scope || !ownership.canEdit()) return false
    change(previous => ({ ...previous, cards: previous.cards?.some(item => item.id === card.id)
      ? previous.cards : [...(previous.cards || []), card] }))
    return save()
  }

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
    running: !!runtime.busyCards.size, canEdit: ownership.canEdit, requestLeave,
    document: current?.id === canvasId ? document : undefined,
    settingsBlocked: !!promptEditors.size || !!editor.recovery || editor.conflict || (editor.initialApplying && !editor.pendingSettings),
    settingsPending: editor.pendingSettings,
    settingsDraft: editor.settingsDraft,
    clearSettingsDraft: editor.clearSettingsDraft,
    settingsError: editor.error,
    saveSettings: changes => promptEditors.size ? Promise.resolve(false) : editor.commitSettings(changes),
  }
  const applyAssistantLayout = async (sourceId: string, proposal: CanvasAssistantLayout, claim: () => Promise<void>): Promise<AssistantLayoutOutcome> => {
    if (!document || promptEditors.size || !ownership.canEdit()) return 'deferred'
    const prepared = await editor.prepareCommittedEdit()
    if (!prepared || scope !== latestScope.current || !ownership.canEdit() || !assistantLayout.current) return 'deferred'
    if (assistantLayout.current.plan(sourceId, proposal).outcome === 'deferred') return 'deferred'
    await claim()
    if (scope !== latestScope.current || !ownership.canEdit() || !assistantLayout.current) return 'deferred'
    const { document: current } = prepared
    const group = proposal.group
    const existing = group && current.groups?.find(item => item.id === group.id)
    if (existing && (existing.name !== group.name || JSON.stringify(existing.card_ids) !== JSON.stringify(group.card_ids))) return 'stale'
    const memberships = new Map(current.groups?.flatMap(item => (item.card_ids || []).map(id => [id, item.id] as const)))
    if (Object.entries(proposal.group_membership).some(([id, expected]) =>
      !current.cards?.some(card => card.id === id) || (memberships.get(id) ?? null) !== (existing?.id ?? expected))) return 'stale'
    const plan = assistantLayout.current.plan(sourceId, proposal)
    if (plan.outcome !== 'ready') {
      // A saved local receipt cannot recreate a group the user subsequently removed or undid.
      return plan.outcome === 'applied' && group && !existing ? 'stale' : plan.outcome
    }
    if (group && !existing) {
      assistantGroupingBefore.current = { sourceId, document: current }
      if (!await editor.commitAssistantLayoutGroup(prepared.revision, group)) return 'deferred'
      runtime.invalidate()
    }
    if (scope !== latestScope.current || !ownership.canEdit() || !plan.apply()) return 'deferred'
    const undoGroup = assistantGroupingBefore.current
    editor.recordAction(plan.arrangement.undo, plan.arrangement.redo, undoGroup?.sourceId === sourceId ? undoGroup.document : undefined)
    assistantGroupingBefore.current = undefined
    return 'applied'
  }
  return <WorkbenchTheme adaptive><WorkbenchDetailsProvider><section className="canvas-workbench generation-workbench" aria-label={uiText("生成画布工作台")} onContextMenu={event => event.preventDefault()}>
    <header ref={toolbar} className="canvas-workbench-toolbar generation-workbench-header">
      <div className="canvas-toolbar-identity">
        <WorkbenchIconButton label={back.label} variant="quiet" icon={<ArrowLeftOutlined />} onClick={async () => { if (await requestLeave()) back.onClick() }} />
        <strong className="canvas-sequence-name">{document?.name || uiText("画布生成")}</strong>
        <span role="status" aria-label={uiText("画布保存状态")}>{saving ? uiText("保存中") : editor.conflict ? uiText("修订冲突") : !ownership.editable && canvasId ? uiText("只读") : dirty ? uiText("待保存") : uncreated ? uiText("尚未创建") : current ? uiText("已保存") : uiText("尚无画布")}</span>
        {current && <WorkbenchIconButton label={uiText("保存画布")} variant={dirty ? 'primary' : 'quiet'} icon={<SaveOutlined />} onClick={() => void save(true)} loading={saving} disabled={!ownership.editable || !!editor.recovery || editor.conflict} />}
        <div className="generation-browse-history-host">{canvasId && <CanvasHistoryControls key={scope} storageKey={`generation-canvas:${scope}`} requestLeave={requestLeave} />}</div>
      </div>
      <div className="generation-toolbar-center" />
      <div className="canvas-toolbar-actions">
        <div ref={setPrimaryHost} className="generation-primary-host" />
        {renderSceneActions?.({ ...management, document, prepareReview: editor.prepareReview,
          applyReview: editor.applyReviewedCandidate, reloadReview: editor.reload,
          editable: management.editable && !editor.recovery && !editor.conflict && !editor.initialApplying })}
        {document && <RunHistory onClose={() => { setAssistantHistoryTarget(undefined); onCloseRunHistory?.() }}
          key={document.id} runs={runtime.snapshot.runs} targetRun={assistantRun ?? targetRun} targetNode={assistantRun ? undefined : targetNode}
          disabled={!ownership.editable || !!editor.recovery || editor.conflict} onSave={saveOutput} onSelectVideoFrame={selectVideoFrame} onCancel={runtime.cancel} cancelling={runtime.cancelling} />}
        <CanvasAppearancePicker compact />
        <TaskCenter workbench />
        <CanvasToolbarMenu label={uiText("更多操作")} icon={<MoreOutlined />} compact={!!renderCanvasManagement}>
          {focusMenu => <>
            {renderCanvasManagement?.(management, focusMenu)}
            {!uncreated && <span role="status" aria-label={uiText("运行连接")}>{runtime.connection === 'connected' ? uiText("运行事件已连接") : runtime.connection === 'connecting' ? uiText("正在连接运行事件") : uiText("运行连接恢复中，保留已接收内容")}</span>}
          </>}
        </CanvasToolbarMenu>
      </div>
    </header>
    <div className="generation-feedback">
    {(hostError || editor.error) && <Alert type="error" showIcon message={hostError || editor.error} action={hostErrorAction} />}
    {renderFeedback?.(current)}
    {editor.storageError && <Alert type="warning" message={editor.storageError} />}
    {canvasId && !ownership.editable && <Alert type="warning" message={ownership.message || (ownership.state === 'unsupported' ? uiText("浏览器不支持编辑所有权保护，当前只读") : uiText("此画布当前只读"))} action={<Space><Button onClick={ownership.takeEditing}>{uiText("取得编辑权")}</Button>{ownership.state === 'choice' && <><Button onClick={() => ownership.chooseHandoff('save')}>{uiText("保存后交接")}</Button><Button onClick={() => ownership.chooseHandoff('discard')}>{uiText("放弃后交接")}</Button></>}</Space>} />}

      {runtime.error && <Alert type="error" message={runtime.error} />}
      {runtime.pending && <Alert type="warning" message={uiText("运行请求结果待核实；将使用原请求身份取得回执")} action={<Button loading={runtime.submitting} disabled={!ownership.editable} onClick={() => void runtime.submit()}>{uiText("核实运行请求")}</Button>} />}
    </div>
      <WorkbenchModal title={uiText("核对画布内容")} open={!!editor.recovery || editor.conflict} closable={false} footer={null}>
    {editor.recovery && <Alert type="warning" message={uiText("发现本地未保存内容；恢复前将核实服务器及未明请求")} action={<Space><Button onClick={editor.restore} disabled={!ownership.editable || saving}>{uiText("恢复本地内容")}</Button><Button onClick={() => editor.reload()} disabled={!ownership.editable || saving}>{uiText("使用服务器内容")}</Button></Space>} />}
    {editor.conflict && <Alert type="warning" message={uiText("修订冲突，本地内容已保留。核对后选择处理方式")} action={<Space><Button onClick={() => editor.reload(true)}>{uiText("保留本地并以最新修订保存")}</Button><Button onClick={() => editor.reload()}>{uiText("使用服务器内容")}</Button></Space>} />}
      </WorkbenchModal>
      <WorkbenchModal title={uiText("运行预检")} afterClose={() => {
        // 预检操作容器解除底层 inert 后，再由详情定位真实编辑片段。
        if (pendingInspect.current) { setInspectTarget(pendingInspect.current); pendingInspect.current = undefined }
      }} open={previewOpen && !!runtime.preview && !editor.recovery && !editor.conflict} onCancel={() => setPreviewOpen(false)} footer={null}>
        {runtime.preview && <RunPreview canvas={document || undefined} catalog={catalog.current} preview={runtime.preview} submitting={runtime.submitting} disabled={!ownership.editable || !!runtime.pending || runtime.busyCards.has(runtime.preview.card_id)} onSubmit={() => void runtime.submit()} onLocate={target => { pendingInspect.current = { cardId: String(target.card_id || runtime.preview!.card_id), diagnostic: target, serial: Date.now() }; setPreviewOpen(false) }} />}
      </WorkbenchModal>
    {canvasId && frameSelection?.scope === scope && <SaveVideoFrameDialog key={scope} projectId={projectId} canvasId={canvasId}
      source={frameSelection.source} disabled={frameDisabled} onSave={saveSelectedFrame} onClose={() => setFrameSelection(undefined)} />}
    {!!promptEditors.size && <Alert type="info" message={uiText("提示词正在编辑，请保存修改或取消编辑后再离开、预检或生成。")} />}
    {!document || !current ? <Empty className="generation-empty" description={uiText("创建或选择一张画布")} /> : <div className="generation-stage">
      <PromptEditingContext.Provider value={reportPromptEditing}><PromptDraftContext.Provider value={reportPromptDraft}><PromptEditingActiveContext.Provider value={!!promptEditors.size}><GenerationCanvasGraph assistantLayout={assistantLayout}
        assistantHighlight={assistantHighlight?.hidden ? undefined : assistantHighlight}
        assistantLocate={assistantTarget?.scope === scope ? assistantTarget : undefined} onAssistantSelection={setSelectedCards} layoutPolicy={layoutPolicy?.(document, beforeApplication)} onCatalogReady={configureCatalog} history={{ canUndo: editor.canUndo, canUndoArrangement: editor.canUndoArrangement, record: editor.recordAction, undo: () => { if (!promptEditors.size && editor.undo() === 'document') runtime.invalidate() }, redo: () => { if (!promptEditors.size && editor.redo() === 'document') runtime.invalidate() } }} contentHistory={<div className="canvas-history-controls" aria-label={uiText("画布操作历史")}>
        <WorkbenchIconButton label={uiText("撤销操作")} variant="quiet" icon={<UndoOutlined />} disabled={!!promptEditors.size || !ownership.editable || !!editor.recovery || !editor.canUndo} onClick={() => { if (!promptEditors.size && editor.undo() === 'document') runtime.invalidate() }} />
        <WorkbenchIconButton label={uiText("重做操作")} variant="quiet" icon={<RedoOutlined />} disabled={!!promptEditors.size || !ownership.editable || !!editor.recovery || !editor.canRedo} onClick={() => { if (!promptEditors.size && editor.redo() === 'document') runtime.invalidate() }} />
      </div>} primaryHost={primaryHost} savedDocument={current.document} savedRevision={current.revision} key={document.id} document={document} onChange={change} inspectTarget={inspectTarget} diagnostics={[...(runtime.preview?.diagnostics || []), ...(editor.saveDiagnostic ? [editor.saveDiagnostic] : [])]} editingStatus={editor.error || (editor.conflict ? '修订冲突，请关闭详情处理' : saving ? '正在保存修改' : dirty ? '修改尚未保存' : undefined)} readonly={!ownership.editable || !!editor.recovery || editor.initialApplying}
        renderModelCardAction={renderModelCardAction} modelCardSources={modelCardSources} onSelectVideoFrame={frameDisabled ? undefined : selectVideoFrame}
        renderModelCardMenu={renderModelCardMenu && (context => renderModelCardMenu({ ...context, disabled: context.disabled || frameDisabled,
          prepare: editor.prepareCommittedEdit,
          commit: async (revision, requestId, transform) => {
            const policy = catalog.current
            if (!policy) return false
            const saved = await editor.commitVisualContinuity(revision, requestId, before => transform(before, policy))
            if (saved) runtime.invalidate()
            return saved
          },
        }))}
        runtime={{ outputs: runtime.snapshot.current_outputs, outputsVerified: runtime.outputsVerified, runs: runtime.snapshot.runs, nodes: runtime.latestNodes, busyCards: runtime.busyCards, checking: runtime.checking,
          disabled: uncreated || runtime.storageBlocked || !!runtime.pending || !!runtime.checking || runtime.submitting || editor.conflict, precheck: cardId => { if (!promptEditors.size) void runtime.precheck(cardId) } }} /></PromptEditingActiveContext.Provider></PromptDraftContext.Provider></PromptEditingContext.Provider>
      {canvasId && current.id === canvasId &&
        <CanvasAssistant key={scope} document={document} highlight={assistantHighlight}
          onHighlight={value => { storeAssistantHighlight(scope, value); setAssistantMarks({ scope, value }) }}
          onLocate={cardId => setAssistantTarget({ scope, cardId, serial: Date.now() })}
          canvasId={canvasId} projectId={projectId} storyboard={Boolean(projectId)} cards={document.cards ?? []} localDraft={uncreated} draftPromoting={uncreated && saving}
          cardTitles={Object.fromEntries((catalog.current?.cards ?? []).map(card => [card.type, card.title]))}
          applyLayout={applyAssistantLayout}
          openRun={runId => setAssistantHistoryTarget({ canvasId, runId })}
          approvalDisabled={!!promptEditors.size || !ownership.editable || !!editor.recovery || editor.conflict}
          approve={async (sourceId, groupIds, automatic) => {
            if (promptEditors.size || !ownership.canEdit()) return false
            const saved = await editor.commitAssistantProposal(sourceId, groupIds, automatic)
            if (saved) runtime.invalidate()
            return saved
          }}
          selectedCards={selectedCards.filter(id => document.cards?.some(card => card.id === id))}
          readDraft={() => {
            const active = new Map([...activePromptDrafts.current.values()].map(read => {
              const card = read()
              return [card.id, card]
            }))
            return { revision: Math.max(0, current.revision), layout_positions: assistantLayout.current?.positions(), draft: { ...document, cards: document.cards?.map(card => active.get(card.id) || card) } }
          }} />}
    </div>}
  </section></WorkbenchDetailsProvider></WorkbenchTheme>
}
