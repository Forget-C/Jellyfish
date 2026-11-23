import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpOutlined, CommentOutlined, CloseOutlined } from '@ant-design/icons'
import { Alert, Input, Select, Spin } from 'antd'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { ApiError, LlmService, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasDocument, CanvasAssistantDraftContext, CanvasAssistantExchange, CanvasAssistantLayout, CanvasAssistantMessage, FileRead, ModelRead } from '../../../services/generated'
import { AssistantEditGroups, AssistantProposal } from './AssistantProposal'
import { AssistantLayout } from './AssistantLayout'
import type { AssistantLayoutOutcome } from './assistantLayoutEditor'
import { AssistantGeneration } from './AssistantGeneration'
import { useUiText } from '../../../uiText'
import { CanvasAssistantAttachments, CanvasAssistantEvidence } from './CanvasAssistantAttachments'
import { draftingAssistantReply, readDraftAssistant, writeDraftAssistant } from './draftAssistant'
import './canvasAssistant.css'

type AssistantScope = NonNullable<CanvasAssistantMessage['context']>['scope'] | 'text'

/** Nonmodal conversation for one saved canvas. Closing it keeps the draft and in-flight reply. */
export function CanvasAssistant({ canvasId, projectId, storyboard, cards, cardTitles, localDraft, draftPromoting, selectedCards, readDraft, approve, approvalDisabled, applyLayout, openRun }: {
  canvasId: string
  projectId: string
  storyboard: boolean
  cardTitles: Readonly<Record<string, string>>
  cards: NonNullable<CanvasDocument['cards']>
  localDraft?: boolean
  draftPromoting?: boolean
  selectedCards: string[]
  approve: (sourceId: string, groupIds?: string[], automatic?: boolean) => Promise<boolean>
  approvalDisabled: boolean
  applyLayout: (sourceId: string, proposal: CanvasAssistantLayout, claim: () => Promise<void>) => Promise<AssistantLayoutOutcome>
  openRun: (runId: string) => void
  readDraft: () => Pick<CanvasAssistantDraftContext, 'draft' | 'revision' | 'layout_positions'>
}) {
  const uiText = useUiText()
  const trigger = useRef<HTMLElement>(null)
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<CanvasAssistantExchange[]>()
  const [historyError, setHistoryError] = useState(false)
  const [retryLoad, setRetryLoad] = useState(0)
  const [draft, setDraft] = useState('')
  const [referenceFiles, setReferenceFiles] = useState<FileRead[]>([])
  const [uploadingReference, setUploadingReference] = useState(false)
  const [revising, setRevising] = useState<CanvasAssistantExchange>()
  const composer = useRef<HTMLFormElement>(null)
  const [sendError, setSendError] = useState<'text' | 'tools' | 'reply' | 'context-limit'>()
  const [sending, setSending] = useState(false)
  const [stopping, setStopping] = useState<string>()
  const [stopError, setStopError] = useState(false)
  const [modelId, setModelId] = useState<string | null>(null)
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const [models, setModels] = useState<ModelRead[]>([])
  const [savingModel, setSavingModel] = useState(false)
  const [modelError, setModelError] = useState(false)
  const [automaticApproval, setAutomaticApproval] = useState(false)
  const [savingApproval, setSavingApproval] = useState(false)
  const [approvalError, setApprovalError] = useState(false)
  const [scope, setScope] = useState<AssistantScope>()
  const [starterScope, setStarterScope] = useState<AssistantScope>()
  const [draftUsesSelection, setDraftUsesSelection] = useState(false)
  const pending = useRef<CanvasAssistantMessage>()
  const pendingRejections = useRef(new Map<string, { decision_id: string; expected_revision: number }>())
  const rejectProposal = async (sourceId: string, groupIds?: string[]) => {
    const key = JSON.stringify([canvasId, sourceId, groupIds ? [...groupIds].sort() : []])
    const decision = pendingRejections.current.get(key) ?? {
      decision_id: crypto.randomUUID(), expected_revision: readDraft().revision,
    }
    pendingRejections.current.set(key, decision)
    const { data } = await Canvases.canvasAssistantDecideProposal({
      canvasId, projectId, sourceId, requestBody: { ...decision, action: 'reject', group_ids: groupIds },
    })
    if (data) pendingRejections.current.delete(key)
    return !!data
  }
  const sendingNow = useRef(false)
  const [activeRequestId, setActiveRequestId] = useState<string>()
  const [pendingServerRequest, setPendingServerRequest] = useState<CanvasAssistantMessage>()
  const activeRequest = useRef<ReturnType<typeof Canvases.canvasAssistantSend>>()
  const stoppedRequest = useRef<string>()
  const panel = useRef<HTMLElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const historyPosition = useRef({ top: 0, follow: true })
  const panelId = 'canvas-assistant-' + canvasId
  const inputId = panelId + '-input'
  const canUseDraftTools = localDraft && models.some(model =>
    model.id === (modelId ?? defaultModelId) && model.effective_capabilities?.tool_calling)
  const selectionInDraft = selectedCards.length > 0 || (Boolean(draft.trim()) && draftUsesSelection)
  const effectiveScope = scope ?? (selectionInDraft ? 'selection' : starterScope ?? (canUseDraftTools ? 'canvas' : 'text'))
  const awaitingSelection = !revising && !pending.current && effectiveScope === 'selection' && !selectedCards.length
  useLayoutEffect(() => {
    if (!draft.trim()) setStarterScope(undefined)
    if (!draft.trim() || selectedCards.length) {
      setDraftUsesSelection(Boolean(draft.trim() && selectedCards.length))
    }
  }, [draft, selectedCards.length])

  const updateDraft = (value: string) => {
    setDraft(value)
    pending.current = undefined
    setSendError(undefined)
  }
  const activeGeneration = turns?.some(({ generation }) => generation && (
    ['queued', 'running'].includes(generation.state)
    || ['waiting', 'reviewing'].includes(generation.review?.state ?? '')
    || generation.versions?.some(version => ['queued', 'running'].includes(version.state))
  ))
  const waitingLayout = turns?.find(turn => turn.layout?.state === 'executing' || !turn.stopped && turn.layout?.state === 'waiting')
  const layoutEditor = useRef(applyLayout)
  layoutEditor.current = applyLayout

  useEffect(() => {
    if (!waitingLayout?.layout || approvalDisabled) return
    const { layout, request_id: sourceId } = waitingLayout
    let active = true
    let busy = false
    const execute = async () => {
      if (!active || busy) return
      busy = true
      try {
        const outcome = await layoutEditor.current(sourceId, layout, async () => {
          await Canvases.canvasAssistantDecideLayout({ projectId, canvasId, sourceId, requestBody: { action: 'claim' } })
        })
        if (!active || outcome === 'deferred') return
        const { data } = await Canvases.canvasAssistantDecideLayout({
          projectId, canvasId, sourceId, requestBody: { action: outcome },
        })
        if (active && data) setTurns(previous => previous?.map(turn =>
          turn.request_id === sourceId ? { ...turn, layout: data } : turn))
      } catch (error) {
        if (active && error instanceof ApiError && error.status === 409) {
          const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId }).catch(() => ({ data: undefined }))
          if (active && data) setTurns(data.turns ?? [])
        }
        // Retry pending work and reuse the browser receipt when delivery fails.
      }
      finally { busy = false }
    }
    const timer = window.setInterval(() => void execute(), 500)
    return () => { active = false; window.clearInterval(timer) }
  }, [waitingLayout, approvalDisabled, canvasId, projectId])

  useEffect(() => {
    if (!open || !activeGeneration) return
    let request: ReturnType<typeof Canvases.canvasAssistantHistory> | undefined
    let active = true
    const timer = window.setInterval(() => {
      if (request) return
      request = Canvases.canvasAssistantHistory({ canvasId, projectId })
      void request.then(response => {
        if (!active || !response.data) return
        const updates = new Map(response.data?.turns.map(turn => [turn.request_id, turn.generation]))
        setTurns(previous => previous?.map(turn => {
          const generation = updates.get(turn.request_id)
          return generation ? { ...turn, generation } : turn
        }))
      }).catch(() => { /* The next observation resumes after a transient read failure. */ })
        .finally(() => { request = undefined })
    }, 1500)
    return () => { active = false; window.clearInterval(timer); request?.cancel() }
  }, [open, activeGeneration, canvasId, projectId])

  useEffect(() => {
    if (localDraft) {
      if (!open) return
      const saved = readDraftAssistant(canvasId)
      setTurns(saved.turns)
      setModelId(saved.modelId)
      setReferenceFiles(saved.references)
      return
    }
    const request = Canvases.canvasAssistantHistory({ canvasId, projectId })
    let current = true
    void request.then(response => {
      if (!response.data) throw new Error('missing assistant history')
      const saved = response.data.turns
      if (current) {
        setTurns(previous => (previous?.[previous.length - 1]?.sequence ?? 0) > (saved[saved.length - 1]?.sequence ?? 0)
          ? previous : saved)
        setModelId(response.data.model_id ?? null)
        setPendingServerRequest(response.data.pending_request ?? undefined)
        setAutomaticApproval(response.data.approval_mode === 'automatic')
      }
    }).catch(() => { if (current) setHistoryError(true) })
    return () => { current = false; request.cancel() }
  }, [open, canvasId, projectId, retryLoad, localDraft])

  useEffect(() => {
    if (!open) return
    let current = true
    const settings = LlmService.getModelSettingsApiV1LlmModelSettingsGet()
    const firstPage = LlmService.listModelsApiV1LlmModelsGet({ category: 'text', pageSize: 100 })
    setModelError(false)
    void Promise.all([settings, firstPage]).then(async ([defaults, first]) => {
      const data = first.data
      if (!data) throw new Error('missing assistant models')
      const listed = [...data.items]
      for (let page = 2; current && listed.length < data.pagination.total; page++) {
        const next = await LlmService.listModelsApiV1LlmModelsGet({ category: 'text', pageSize: 100, page })
        if (!next.data?.items.length) break
        listed.push(...next.data.items)
      }
      if (current) {
        setDefaultModelId(defaults.data?.default_text_model_id ?? null)
        setModels(listed)
      }
    }).catch(() => { if (current) setModelError(true) })
    return () => { current = false; settings.cancel(); firstPage.cancel() }
  }, [open, retryLoad])

  useLayoutEffect(() => {
    if (open) panel.current?.focus({ preventScroll: true })
  }, [open])

  useLayoutEffect(() => {
    if (!history.current) return
    const { follow, top } = historyPosition.current
    history.current.scrollTop = follow ? history.current.scrollHeight : top
  }, [open, turns, sending, referenceFiles.length])

  useEffect(() => {
    const element = panel.current
    const viewport = window.visualViewport
    if (!open || !element || !viewport) return
    const resize = () => {
      element.dataset.keyboard = String(window.innerHeight - viewport.height > 120 && viewport.scale === 1)
      element.style.setProperty('--assistant-visual-top', `${viewport.offsetTop}px`)
      element.style.setProperty('--assistant-visual-bottom', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`)
    }
    resize()
    viewport.addEventListener('resize', resize)
    viewport.addEventListener('scroll', resize)
    return () => {
      viewport.removeEventListener('resize', resize)
      viewport.removeEventListener('scroll', resize)
    }
  }, [open])

  const stopTurn = async (sourceId: string) => {
    setStopping(sourceId)
    setStopError(false)
    try {
      const { data } = await Canvases.canvasAssistantStop({ canvasId, projectId, sourceId })
      if (!data) throw new Error('missing assistant stop receipt')
      setTurns(current => current?.some(turn => turn.request_id === sourceId)
        ? current.map(turn => turn.request_id === sourceId ? data : turn) : [...(current || []), data])
      setPendingServerRequest(request => request?.request_id === sourceId ? undefined : request)
      if (activeRequestId === sourceId) {
        stoppedRequest.current = sourceId
        activeRequest.current?.cancel()
        pending.current = undefined
        setDraft('')
        setReferenceFiles([])
        setRevising(undefined)
      }
      if (revising?.request_id === sourceId) {
        setRevising(undefined)
        pending.current = undefined
      }
    } catch { setStopError(true) }
    finally { setStopping(undefined) }
  }

  const cancelRun = async (runId: string) => {
    await Canvases.canvasCancelRun({ canvasId, projectId, runId })
    const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
    if (data) setTurns(data.turns)
  }

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  const send = async (resume?: CanvasAssistantMessage) => {
    const text = (resume?.text ?? draft).trim()
    if (draftPromoting || sendingNow.current || savingModel || savingApproval || uploadingReference || !turns || !text) return
    if (!resume && awaitingSelection) return
    const revisionTargets = revising?.proposal?.groups
      ? [...new Set(revising.proposal.groups.filter(group => group.state === 'pending')
        .flatMap(group => group.edits.filter(edit => edit.target.kind !== 'add_canvas_card').map(edit => edit.card_id)))]
      : revising?.proposal ? [revising.proposal.card_id] : []
    const requestBody: CanvasAssistantMessage = resume ?? (pending.current?.text === text
      ? pending.current : {
          text,
          request_id: crypto.randomUUID(),
          attachment_file_ids: referenceFiles.length ? referenceFiles.map(file => file.id) :
            revising?.attachments?.map(file => file.file_id) ?? [],
          revises: revising?.request_id,
          context: revising?.proposal ? {
            ...readDraft(), scope: revisionTargets.length ? 'selection' : 'canvas', card_ids: revisionTargets,
          } : effectiveScope === 'text' ? undefined : {
            ...readDraft(), scope: effectiveScope, card_ids: effectiveScope === 'selection' ? selectedCards : [],
          },
        })
    pending.current = requestBody
    historyPosition.current.follow = true
    sendingNow.current = true
    setSending(true)
    setSendError(undefined)
    if (localDraft) draftingAssistantReply.add(canvasId)
    try {
      const request = localDraft
        ? Canvases.canvasDraftAssistantSend({ canvasId, requestBody: {
          ...requestBody, turns: readDraftAssistant(canvasId).turns, model_id: modelId,
        } })
        : Canvases.canvasAssistantSend({ canvasId, projectId, requestBody })
      if (!localDraft) {
        setActiveRequestId(requestBody.request_id)
        activeRequest.current = request
      }
      const { data: turn } = await request
      if (!turn) throw new Error('missing assistant reply')
      const appendTurn = (current: CanvasAssistantExchange[]) => current.some(existing => existing.request_id === turn.request_id)
        ? current : [...current.map(existing => turn.proposal && turn.revises === existing.request_id && existing.proposal
          ? { ...existing, proposal: { ...existing.proposal, state: 'superseded' as const,
            groups: existing.proposal.groups?.map(group => (group.state ?? 'pending') === 'pending'
              ? { ...group, state: 'superseded' as const } : group) } } : existing), turn]
      if (localDraft) {
        const updated = appendTurn(readDraftAssistant(canvasId).turns)
        writeDraftAssistant(canvasId, { turns: updated, references: [] })
        setTurns(updated)
      } else setTurns(current => appendTurn(current || []))
      setRevising(undefined)
      setDraft('')
      setReferenceFiles([])
      pending.current = undefined
      setPendingServerRequest(undefined)
      if (turn.automatic_approval && !approvalDisabled && turn.proposal) {
        const groupIds = turn.proposal.groups?.map(group => group.id)
        try {
          if (!await approve(turn.request_id, groupIds, true)) setApprovalError(true)
          const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
          if (data) setTurns(data.turns)
        } catch {
          setApprovalError(true)
        }
      }
    } catch (error) {
      if (stoppedRequest.current === requestBody.request_id) return
      if (!localDraft) {
        const history = await Canvases.canvasAssistantHistory({ canvasId, projectId }).catch(() => undefined)
        setPendingServerRequest(history?.data?.pending_request ?? undefined)
      }
      const detail = error instanceof ApiError ? error.body?.message ?? error.body?.detail : undefined
      setSendError(detail === 'ASSISTANT_TOOL_CALLING_REQUIRED' ? 'tools'
        : detail === 'ASSISTANT_TEXT_CAPABILITY_REQUIRED' ? 'text'
        : detail === 'ASSISTANT_CONTEXT_LIMIT_EXCEEDED' ? 'context-limit' : 'reply')
    } finally {
      draftingAssistantReply.delete(canvasId)
      sendingNow.current = false
      activeRequest.current = undefined
      setActiveRequestId(undefined)
      setSending(false)
    }
  }

  const chooseModel = async (selected: string) => {
    if (localDraft) {
      writeDraftAssistant(canvasId, { modelId: selected || null })
      setModelId(selected || null)
      return
    }
    setSavingModel(true)
    setModelError(false)
    try {
      const { data } = await Canvases.canvasAssistantSetModel({
        canvasId, projectId, requestBody: { model_id: selected || null },
      })
      if (!data) throw new Error('missing assistant model preference')
      setModelId(data.model_id)
    } catch {
      setModelError(true)
    } finally {
      setSavingModel(false)
    }
  }

  const chooseApproval = async (enabled: boolean) => {
    setSavingApproval(true)
    setApprovalError(false)
    try {
      const { data } = await Canvases.canvasAssistantSetApproval({
        canvasId, projectId, requestBody: { approval_mode: enabled ? 'automatic' : 'manual' },
      })
      if (!data) throw new Error('missing assistant approval preference')
      setAutomaticApproval(data.approval_mode === 'automatic')
    } catch {
      setApprovalError(true)
    } finally {
      setSavingApproval(false)
    }
  }

  const modelLabel = (model: ModelRead) => {
    const capability = model.effective_capabilities
    const modes = [
      ...(capability?.tool_calling ? [uiText("可读画布")] : []),
      ...(capability?.image_inputs ? [uiText("可读图片与视频静帧")] : []),
      ...(capability?.video_inputs
        ? [capability.audio_inputs ? uiText("可读连续画面及音轨") : uiText("可读连续画面")]
        : []),
    ]
    return [model.name, ...(modes.length ? modes : [uiText("仅文字对话")])].join(' · ')
  }
  const defaultModel = models.find(model => model.id === defaultModelId)
  const selectedNames = selectedCards.map(id => {
    const card = cards.find(entry => entry.id === id)
    const name = (card && 'name' in card && card.name) || cardTitles[card?.type ?? ''] || uiText("卡片")
    return uiText(name) + ' · ' + id.slice(0, 8)
  })
  const starters = storyboard
    ? selectedCards.length ? ['帮我看看这个镜头的推进节奏', '帮我检查选中卡片的连续性']
      : cards.length ? ['帮我梳理这场戏的镜头节奏', '看看哪些镜头还需要补充']
        : ['帮我构思第一个镜头', '帮我确定这场戏的视觉基调']
    : selectedCards.length ? ['帮我优化这张卡的提示词', '帮我看看选中的素材适合怎么用']
      : cards.length ? ['帮我梳理画布上的素材和生成方向', '帮我检查当前画布的提示词']
        : ['帮我构思一张起始画面', '帮我拟一版图片生成提示词']
  const selectionLabel = selectedCards.length
    ? uiText("选中 {{count}} 张卡", { count: selectedCards.length }) : uiText("请选择卡片")
  const scopeOptions = [
    { label: uiText("仅对话"), short: uiText("仅对话"), value: 'text' },
    { label: <>{selectionLabel}{selectedNames.length > 0 &&
        <small className="canvas-assistant-scope-cards">{selectedNames.join('、')}</small>}</>,
      short: selectionLabel, value: 'selection', disabled: !selectedCards.length },
    { label: uiText("审看整张画布"), short: uiText("审看整张画布"), value: 'canvas' },
  ]

  return <div className="canvas-assistant-dock" data-open={open}>
    <WorkbenchIconButton ref={trigger} label={uiText(open ? "收起画布助手" : "打开画布助手")} icon={<CommentOutlined />}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { if (open) close(); else { setHistoryError(false); setOpen(true) } }} />
    {open && <aside ref={panel} id={panelId} className="canvas-assistant-panel" tabIndex={-1} aria-label={uiText("画布助手")}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLElement && event.target.getAttribute('aria-expanded') === 'true')) {
          event.stopPropagation()
          close()
        }
      }}>
      <header className="canvas-assistant-header">
        <div><strong>{uiText("画布助手")}</strong><small>{uiText(storyboard ? "分镜画布" : "自由画布")}</small></div>
        {!localDraft && <Select aria-label={uiText("审批模式")} value={automaticApproval ? 'automatic' : 'manual'}
          disabled={sending || savingApproval || !turns} popupMatchSelectWidth={false}
          onChange={value => { void chooseApproval(value === 'automatic') }}
          options={[
            { value: 'manual', label: uiText("手动审批") },
            { value: 'automatic', label: uiText("自动审批明确请求") },
          ]} />}
        <WorkbenchIconButton label={uiText("关闭画布助手")} icon={<CloseOutlined />} variant="quiet" onClick={close} />
      </header>
      <div ref={history} className="canvas-assistant-history" role="log" aria-live="polite" onScroll={event => {
        const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
        historyPosition.current = { top: scrollTop, follow: scrollHeight - scrollTop - clientHeight < 40 }
      }}>
        {approvalError && <p role="alert">{uiText("无法完成自动审批，请核对当前设置和修改建议")}</p>}
        {turns?.length === 0 && !pendingServerRequest && !sending && !draft.trim() &&
          <div className="canvas-assistant-starters">
            {starters.map(starter => <WorkbenchButton key={starter} onClick={() => {
              setScope(undefined)
              setStarterScope(cards.length ? 'canvas' : 'text')
              updateDraft(uiText(starter))
              composer.current?.querySelector('textarea')?.focus()
            }}>{uiText(starter)}</WorkbenchButton>)}
          </div>}
        {historyError && <Alert type="error" message={uiText("暂时无法读取助手对话")}
          action={<WorkbenchButton onClick={() => { setHistoryError(false); setRetryLoad(value => value + 1) }}>{uiText("重试")}</WorkbenchButton>} />}
        {stopError && <Alert type="error" message={uiText("暂时无法停止助手")} />}
        {!turns && !historyError && <Spin aria-label={uiText("正在读取助手对话")} />}
        {turns?.map(turn => <article className="canvas-assistant-turn" key={turn.request_id}>
          <div className="canvas-assistant-question">
            {turn.text}
            {!!turn.attachments?.length && <div className="canvas-assistant-files">
              {turn.attachments.map(file => <span key={file.file_id}>{file.name ?? uiText("素材不可用")}</span>)}
            </div>}
          </div>
          <div>{turn.reply}</div>
            {!!turn.attachments?.length && <CanvasAssistantEvidence attachments={turn.attachments} />}
          {turn.generation && <AssistantGeneration generation={turn.generation}
            openRun={runId => { close(); openRun(runId) }} cancelRun={cancelRun} />}
          {turn.stopped && <small>{uiText("助手已停止")}</small>}
          {!turn.stopped && (
            turn.proposal?.state === 'pending'
            || ['proposed', 'waiting'].includes(turn.layout?.state ?? '')
            || (turn.generation && ['queued', 'waiting_approval'].includes(turn.generation.state))
            || (turn.generation && (turn.generation.versions?.length ?? 0) < turn.generation.requested_count
              && turn.generation.state === 'running')
            || ['waiting', 'reviewing'].includes(turn.generation?.review?.state ?? '')
          ) && <WorkbenchButton variant="quiet" disabled={Boolean(stopping)}
            loading={stopping === turn.request_id}
            onClick={() => { void stopTurn(turn.request_id) }}>{uiText("停止助手")}</WorkbenchButton>}
          {turn.layout && <AssistantLayout layout={turn.layout} disabled={approvalDisabled || sending}
            decide={async action => {
              const { data } = await Canvases.canvasAssistantDecideLayout({
                projectId, canvasId, sourceId: turn.request_id, requestBody: { action },
              })
              if (!data) throw new Error('missing assistant layout decision')
              setTurns(previous => previous?.map(entry => entry.request_id === turn.request_id ? { ...entry, layout: data } : entry))
            }} />}
          {turn.proposal?.groups?.length ? <AssistantEditGroups groups={turn.proposal.groups}
            current={() => readDraft().draft}
            editDisabled={approvalDisabled || sending}
            revise={() => {
              setRevising(turn); pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            }}
            decide={async (action, groupIds) => {
              if (action === 'approve' && !await approve(turn.request_id, groupIds)) return false
              if (action === 'reject' && localDraft) {
                const changed = readDraftAssistant(canvasId).turns.map(item => item.request_id === turn.request_id && item.proposal
                  ? { ...item, proposal: { ...item.proposal, state: 'rejected' as const,
                    groups: item.proposal.groups?.map(group => groupIds.includes(group.id) ? { ...group, state: 'rejected' as const } : group) } } : item)
                writeDraftAssistant(canvasId, { turns: changed })
                setTurns(changed)
                return true
              }
              if (action === 'reject' && !await rejectProposal(turn.request_id, groupIds)) return false
              const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
              if (!data) return false
              setTurns(data.turns)
              if (revising?.request_id === turn.request_id) {
                pending.current = undefined
                setRevising(undefined)
              }
              return true
            }} /> : turn.proposal && <AssistantProposal proposal={turn.proposal} current={() => readDraft().draft} editDisabled={approvalDisabled || sending}
            revise={() => {
              setRevising(turn); pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            }} decide={async action => {
              if (action === 'approve') {
                if (!await approve(turn.request_id)) return false
              } else if (!await rejectProposal(turn.request_id)) return false
              const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
              if (!data) return false
              setTurns(data.turns)
              if (revising?.request_id === turn.request_id) {
                pending.current = undefined
                setRevising(undefined)
              }
              return true
            }} />}
          {turn.approval_audit?.map((entry, index) => <small key={index}>
            {uiText(entry.mode === 'automatic' ? '自动审批明确请求' : '人工审批')} · {
              uiText(entry.outcome === 'rejected' ? '建议已拒绝' : entry.outcome === 'conflict'
                ? '与当前画布冲突' : entry.outcome === 'partial' ? '部分建议已写入' : '已写入画布')
            }
          </small>)}
          {!!turn.skills?.length && <details className="canvas-assistant-evidence">
            <summary>{uiText("本轮使用的技能")}</summary>
            <span>{turn.skills.map(skill => skill.name).join('、')}</span>
          </details>}
        </article>)}
        {sending && <p role="status">{uiText("助手正在回复")}</p>}
        {activeRequestId && <WorkbenchButton variant="quiet" loading={stopping === activeRequestId}
          onClick={() => { void stopTurn(activeRequestId) }}>{uiText("停止助手")}</WorkbenchButton>}
        {!activeRequestId && pendingServerRequest && <div>
          <WorkbenchButton variant="quiet" onClick={() => { void send(pendingServerRequest) }}>{uiText("继续回复")}</WorkbenchButton>
          <WorkbenchButton variant="quiet" loading={stopping === pendingServerRequest.request_id}
            onClick={() => { void stopTurn(pendingServerRequest.request_id) }}>{uiText("停止助手")}</WorkbenchButton>
        </div>}
      </div>
      <form className="canvas-assistant-composer" ref={composer} onSubmit={event => { event.preventDefault(); void send() }}>
        {revising?.proposal && <div className="canvas-assistant-edit-actions">
          <span>{uiText("正在修订修改建议")} · {uiText(revising.proposal.card_name)}</span>
          <WorkbenchButton variant="quiet" disabled={sending} onClick={() => {
            setRevising(undefined); pending.current = undefined
          }}>{uiText("取消修订")}</WorkbenchButton>
        </div>}
        {sendError && <Alert type="error" message={sendError === 'tools'
          ? uiText("当前模型无法调用画布工具。切换可读画布的模型后，发送同一消息即可接续。")
          : sendError === 'text' ? uiText("当前模型无法进行文字对话，请切换助手模型。")
          : sendError === 'context-limit' ? uiText("内容超出当前模型的上下文上限，请缩小分析范围或切换助手模型。")
            : uiText("未收到助手回复，请检查助手模型后重试")} />}
        <CanvasAssistantAttachments projectId={projectId} files={referenceFiles} uploading={uploadingReference}
          setUploading={setUploadingReference} disabled={draftPromoting || sending || !turns}
          onChange={files => {
            if (localDraft) writeDraftAssistant(canvasId, { references: files })
            setReferenceFiles(files)
            pending.current = undefined
            setSendError(undefined)
          }}>
          {(add, attachments) => <>
            {!revising && <div className="canvas-assistant-context">
              <Select<AssistantScope> value={effectiveScope} aria-label={uiText("提问范围")}
                optionLabelProp="short" popupMatchSelectWidth={false} disabled={sending} options={scopeOptions}
                onChange={value => { setScope(value); pending.current = undefined; setSendError(undefined) }} />
            </div>}
            {attachments}
            <Input.TextArea id={inputId} aria-label={uiText("给画布助手发消息")} value={draft} maxLength={16000}
              placeholder={uiText("输入想讨论的镜头、画面或提示词…")}
              autoSize={{ minRows: 2, maxRows: 4 }} disabled={sending}
              onChange={event => updateDraft(event.target.value)} />
            {modelError && <span role="alert">{uiText("无法读取或切换助手模型")}</span>}
            <div className="canvas-assistant-footer">
              {add}
              <div className="canvas-assistant-send-actions">
                <Select value={modelId ?? ''} aria-label={uiText("助手模型")} popupMatchSelectWidth={false} optionLabelProp="short"
                  disabled={draftPromoting || sending || savingModel || !turns} onChange={selected => { void chooseModel(selected) }}
                  options={[
                    { label: defaultModel ? uiText("默认模型") + ' · ' + modelLabel(defaultModel) : uiText("默认模型"),
                      short: defaultModel?.name ?? uiText("默认模型"), value: '' },
                    ...models.map(model => ({
                      label: modelLabel(model), short: model.name, value: model.id,
                      disabled: !model.effective_capabilities?.text_inputs || !model.effective_capabilities?.text_outputs,
                    })),
                  ]} />
                <WorkbenchIconButton label={uiText("发送消息")} icon={<ArrowUpOutlined />}
                  htmlType="submit" variant="primary" loading={sending}
                  disabled={draftPromoting || !turns || !draft.trim() || savingModel || savingApproval || uploadingReference || awaitingSelection} />
              </div>
            </div>
          </>}
        </CanvasAssistantAttachments>
      </form>
    </aside>}
  </div>
}
