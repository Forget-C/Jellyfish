import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUpOutlined, CommentOutlined, CloseOutlined } from '@ant-design/icons'
import { Alert, Select, Spin } from 'antd'
import { Sender, ThoughtChain } from '@ant-design/x'
import { WorkbenchConversation } from '../../../components/workbench/WorkbenchConversation'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { ApiError, LlmService, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasDocument, CanvasAssistantDraftContext, CanvasAssistantExchange, CanvasAssistantFieldRevision, CanvasAssistantInstruction, CanvasAssistantLayout, CanvasAssistantMessage, CanvasAssistantQuestion, CanvasAssistantQueueItem, FileRead, ModelRead } from '../../../services/generated'
import { AssistantEditGroups, AssistantProposal } from './AssistantProposal'
import { AssistantLayout } from './AssistantLayout'
import type { AssistantLayoutOutcome } from './assistantLayoutEditor'
import { AssistantGeneration } from './AssistantGeneration'
import { AssistantActionSummary } from './AssistantActionSummary'
import { useUiText } from '../../../uiText'
import { CanvasAssistantAttachments, CanvasAssistantEvidence } from './CanvasAssistantAttachments'
import { draftingAssistantReply, readDraftAssistant, writeDraftAssistant } from './draftAssistant'
import { proposalHighlight, type AssistantHighlight } from './assistantHighlight'
import { readCardReference } from './cardClipboard'
import './canvasAssistant.css'

function confirmationKind(text: string) {
  if (/^全部确认[。！!]?$/.test(text)) return 'all'
  if (/^确认[。！!]?$/.test(text)) return 'selected'
  if (/^确认[，,]\s*(不过|但是|但)\s*.+/.test(text)) return 'revise'
  return undefined
}

type AssistantScope = NonNullable<CanvasAssistantMessage['context']>['scope'] | 'text'

function appendExchange(turns: CanvasAssistantExchange[], incoming: CanvasAssistantExchange) {
  if (turns.some(turn => turn.request_id === incoming.request_id)) return turns
  const combined = [...turns, incoming]
  const revisions = new Map<string, (CanvasAssistantFieldRevision | null)[]>()
  for (const turn of combined) {
    if (!turn.proposal || !turn.revises) continue
    const changes = revisions.get(turn.revises) ?? []
    revisions.set(turn.revises, [...changes, turn.revises_field ?? null])
  }
  return combined.map(turn => {
    const revisionsForTurn = revisions.get(turn.request_id)
    if (!turn.proposal || !revisionsForTurn || turn.proposal.state === 'superseded') return turn
    const whole = revisionsForTurn.includes(null)
    const groups = turn.proposal.groups?.map(group => (group.state ?? 'pending') === 'pending' &&
      (whole || revisionsForTurn.some(revision => revision?.group_id === group.id))
      ? { ...group, state: 'superseded' as const } : group)
    return { ...turn, proposal: { ...turn.proposal,
      state: groups?.some(group => (group.state ?? 'pending') === 'pending') ? 'pending' as const : 'superseded' as const,
      groups } }
  }).sort((left, right) => left.sequence - right.sequence)
}

function updateQueue(queue: CanvasAssistantQueueItem[], item: CanvasAssistantQueueItem) {
  const current = queue.findIndex(entry => entry.request_id === item.request_id)
  if (item.state === 'removed' || item.state === 'completed') {
    return queue.filter(entry => entry.request_id !== item.request_id)
  }
  return current === -1 ? [...queue, item] : queue.map((entry, index) => index === current ? item : entry)
}

/** Nonmodal conversation for one saved canvas. Closing it keeps the draft and in-flight reply. */
export function CanvasAssistant({ canvasId, projectId, storyboard, cards, cardTitles, localDraft, draftPromoting, selectedCards, readDraft, approve, approvalDisabled, applyLayout, openRun, highlight, onHighlight, onLocate, document, assistantUndone }: {
  canvasId: string
  assistantUndone: string[]
  document: CanvasDocument
  highlight?: AssistantHighlight
  onHighlight: (highlight: AssistantHighlight) => void
  onLocate: (cardId: string) => void
  projectId: string
  storyboard: boolean
  cardTitles: Readonly<Record<string, string>>
  cards: NonNullable<CanvasDocument['cards']>
  localDraft?: boolean
  draftPromoting?: boolean
  selectedCards: string[]
  approve: (sourceId: string, groupIds?: string[], automatic?: boolean, approveLayout?: boolean) => Promise<boolean>
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
  const [cardReferences, setCardReferences] = useState<string[]>([])
  const [externalReferences, setExternalReferences] = useState<Record<string, string[]>>({})
  const [referenceGroups, setReferenceGroups] = useState<{ id: string; name: string; members: string[] }[]>([])
  const [browseReferences, setBrowseReferences] = useState(false)
  const referenceIds = [...new Set([...cardReferences, ...referenceGroups.flatMap(group => group.members)])]
  const referenceIsMissing = referenceIds.some(id => !cards.some(card => card.id === id))
  const addCardReferences = (ids: string[]) => {
    setCardReferences(previous => [...new Set([...previous, ...ids])])
    pending.current = undefined
  }
  const [referenceFiles, setReferenceFiles] = useState<FileRead[]>([])
  const [uploadingReference, setUploadingReference] = useState(false)
  const [revising, setRevising] = useState<CanvasAssistantExchange>()
  const [revisingField, setRevisingField] = useState<CanvasAssistantFieldRevision>()
  const [selectedGroups, setSelectedGroups] = useState<Record<string, string[]>>({})
  const [confirmationHint, setConfirmationHint] = useState<string>()
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
  const [pendingQuestion, setPendingQuestion] = useState<CanvasAssistantQuestion>()
  const [questionAnswer, setQuestionAnswer] = useState('')
  const [queue, setQueue] = useState<CanvasAssistantQueueItem[]>([])
  const [queueEditing, setQueueEditing] = useState<{ id: string; text: string }>()
  const [queueBusy, setQueueBusy] = useState(false)
  const [queueError, setQueueError] = useState(false)
  const pumpingQueue = useRef(false)
  const queuedRequest = useRef<CanvasAssistantMessage>()
  const [steeringFor, setSteeringFor] = useState<string>()
  const [pendingInstructions, setPendingInstructions] = useState<CanvasAssistantInstruction[]>([])
  const retryInstruction = useRef<{ sourceId: string; body: CanvasAssistantInstruction }>()
  const activeRequest = useRef<ReturnType<typeof Canvases.canvasAssistantSend>>()
  const stoppedRequest = useRef<string>()
  const panel = useRef<HTMLElement>(null)
  const snapshotCursor = useRef<{ canvasId: string; cursor: number }>()
  const history = useRef<HTMLDivElement>(null)
  const historyPosition = useRef({ top: 0, follow: true })
  const [readingEarlier, setReadingEarlier] = useState(false)
  const panelId = 'canvas-assistant-' + canvasId
  const canUseDraftTools = localDraft && models.some(model =>
    model.id === (modelId ?? defaultModelId) && model.effective_capabilities?.tool_calling)
  const selectionInDraft = selectedCards.length > 0 || (Boolean(draft.trim()) && draftUsesSelection)
  const planning = /(?:^|\s)\/plan(?![\w-])|先给方案/.test(draft)
  const effectiveScope = scope ?? (
    selectionInDraft ? 'selection' : starterScope ?? (canUseDraftTools || planning ? 'canvas' : 'text')
  )
  const awaitingSelection = !revising && !pending.current && effectiveScope === 'selection' && !selectedCards.length && !referenceIds.length && !Object.values(externalReferences).some(ids => ids.length)
  useLayoutEffect(() => {
    if (!draft.trim()) setStarterScope(undefined)
    if (!draft.trim() || selectedCards.length) {
      setDraftUsesSelection(Boolean(draft.trim() && selectedCards.length))
    }
  }, [draft, selectedCards.length])

  const updateDraft = (value: string) => {
    setConfirmationHint(undefined)
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
        const checkpoint = snapshotCursor.current
        const cursor = response.data.cursor
        if (checkpoint?.canvasId === canvasId && checkpoint.cursor > cursor) return
        snapshotCursor.current = { canvasId, cursor }
        setTurns(previous => (previous?.[previous.length - 1]?.sequence ?? 0) > cursor
          ? previous : saved)
        setModelId(response.data.model_id ?? null)
        setPendingServerRequest(response.data.pending_request ?? undefined)
        setPendingQuestion(response.data.pending_question ?? undefined)
        setQueue(response.data.queue ?? [])
        setPendingInstructions(response.data.pending_instructions ?? [])
        setAutomaticApproval(response.data.approval_mode === 'automatic')
      }
    }).catch(() => { if (current) setHistoryError(true) })
    return () => { current = false; request.cancel() }
  }, [open, canvasId, projectId, retryLoad, localDraft])

  useEffect(() => {
    if (!open || localDraft) return
    let active = true
    let request: ReturnType<typeof Canvases.canvasAssistantEvents> | undefined
    const timer = window.setInterval(async () => {
      const checkpoint = snapshotCursor.current
      if (request || checkpoint?.canvasId !== canvasId) return
      request = Canvases.canvasAssistantEvents({ canvasId, projectId, after: checkpoint.cursor })
      try {
        const { data } = await request
        if (!active || !data?.length) return
        const cursor = snapshotCursor.current?.cursor ?? 0
        const updates = data.filter(event => event.session_id === canvasId && event.cursor > cursor)
        if (!updates.length) return
        snapshotCursor.current = { canvasId, cursor: updates[updates.length - 1].cursor }
        const queueUpdates = updates.flatMap(event => 'message' in event.payload ? [event.payload] : [])
        if (queueUpdates.length) setQueue(current => queueUpdates.reduce(updateQueue, current))
        setTurns(turns => updates.reduce<CanvasAssistantExchange[]>((history, event) => {
          const payload = event.payload
          if ('message' in payload || event.type === 'question.asked' || event.type === 'turn.steered') return history
          if (event.type === 'turn.completed') return appendExchange(history, payload)
          const existing = history.find(turn => turn.request_id === event.turn_id)
          return existing ? history.map(turn => turn === existing ? {
            ...turn, ...payload, generation: payload.generation ?? turn.generation,
          } : turn) : appendExchange(history, payload)
        }, turns ?? []))
        const steerUpdate = [...updates].reverse().find(event => event.type === 'turn.steered')
        if (steerUpdate && !('message' in steerUpdate.payload)) {
          const stillRunning = !updates.some(event => event.turn_id === steerUpdate.turn_id && event.type === 'turn.completed')
          setPendingInstructions(stillRunning ? steerUpdate.payload.instructions ?? [] : [])
        }
        const lastQuestion = [...updates].reverse().map(event => event.payload).find(payload =>
          'question' in payload && !!payload.question)
        const completed = (id?: string) => updates.some(event => event.turn_id === id &&
          (event.type === 'turn.completed' || event.type === 'turn.stopped'))
        if (lastQuestion && 'question' in lastQuestion && !completed(lastQuestion.request_id)) {
          setPendingServerRequest({ request_id: lastQuestion.request_id, text: lastQuestion.text })
          setPendingQuestion(lastQuestion.question ?? undefined)
        } else if (pendingServerRequest && completed(pendingServerRequest.request_id)) {
          setPendingServerRequest(undefined)
          setPendingQuestion(undefined)
        }
      } catch {
        // Retry with the same cursor after loss of the connection.
      } finally {
        request = undefined
      }
    }, 1500)
    return () => { active = false; window.clearInterval(timer); request?.cancel() }
  }, [open, canvasId, projectId, localDraft, pendingServerRequest])

  const queueHead = queue[0]
  useEffect(() => {
    if (!open || !queueHead || localDraft || sending || pendingQuestion) return
    let active = true
    const pump = async () => {
      if (!active || sendingNow.current || pumpingQueue.current) return
      pumpingQueue.current = true
      try {
        const { data } = await Canvases.canvasAssistantRunQueue({
          canvasId, projectId, requestId: queueHead.request_id,
        })
        if (!active || !data) return
        if (data.question) {
          setPendingQuestion(data.question)
          setPendingServerRequest({ request_id: data.request_id, text: data.text })
        } else {
          setQueue(current => current.filter(entry => entry.request_id !== queueHead.request_id))
          setTurns(current => appendExchange(current || [], data))
        }
      } catch {
        if (active) setQueueError(true)
      } finally {
        pumpingQueue.current = false
      }
    }
    const timer = window.setInterval(() => void pump(), 1200)
    return () => { active = false; window.clearInterval(timer) }
  }, [canvasId, localDraft, open, pendingQuestion, projectId, queueHead, sending])

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
      if (pendingServerRequest?.request_id === sourceId) setPendingQuestion(undefined)
      if (pendingServerRequest?.request_id === sourceId || activeRequestId === sourceId || steeringFor === sourceId) {
        setPendingInstructions([])
      }
      if (activeRequestId === sourceId || steeringFor === sourceId) {
        stoppedRequest.current = sourceId
        activeRequest.current?.cancel()
        pending.current = undefined
        setDraft('')
        setReferenceFiles([])
        setRevising(undefined)
        setRevisingField(undefined)
        setCardReferences([])
        setReferenceGroups([])
        setExternalReferences({})
      }
      if (revising?.request_id === sourceId) {
        setRevising(undefined)
        setRevisingField(undefined)
        pending.current = undefined
      }
    } catch { setStopError(true) }
    finally { setStopping(undefined) }
  }

  const decideLayout = async (sourceId: string, action: 'approve' | 'reject') => {
    const { data } = await Canvases.canvasAssistantDecideLayout({
      projectId, canvasId, sourceId, requestBody: { action },
    })
    if (!data) throw new Error('missing assistant layout decision')
    setTurns(previous => previous?.map(entry => entry.request_id === sourceId ? { ...entry, layout: data } : entry))
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

  const refreshDecision = async (sourceId: string, clearSelection = true) => {
    const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId }).catch(() => ({ data: undefined }))
    if (!data) {
      setRetryLoad(value => value + 1)
      return false
    }
    if (data.cursor >= (snapshotCursor.current?.cursor ?? 0)) {
      snapshotCursor.current = { canvasId, cursor: data.cursor }
      setTurns(data.turns)
      setPendingServerRequest(data.pending_request ?? undefined)
      setPendingQuestion(data.pending_question ?? undefined)
      setQueue(data.queue ?? [])
      setPendingInstructions(data.pending_instructions ?? [])
    }
    if (clearSelection) setSelectedGroups(current => ({ ...current, [sourceId]: [] }))
    if (revising?.request_id === sourceId) {
      pending.current = undefined
      setRevising(undefined)
    }
    return true
  }

  const approveProposal = async (sourceId: string, groups?: string[], includeLayout?: boolean) => {
    const accepted = await approve(sourceId, groups, false, includeLayout)
    const refreshed = await refreshDecision(sourceId, accepted)
    if (accepted && !refreshed) setConfirmationHint(uiText('已收到审批结果，正在重新读取对话。'))
    return accepted
  }

  const steer = async (sourceId: string, text: string) => {
    const previous = retryInstruction.current
    const body = previous?.sourceId === sourceId && previous.body.text === text ? previous.body :
      { request_id: crypto.randomUUID(), text }
    retryInstruction.current = { sourceId, body }
    setSteeringFor(sourceId)
    setSendError(undefined)
    setConfirmationHint(undefined)
    try {
      const { data } = await Canvases.canvasAssistantSteer({ canvasId, projectId, sourceId, requestBody: body })
      if (!data) throw new Error('missing supplemental instruction receipt')
      retryInstruction.current = undefined
      setPendingInstructions([])
      setSendError(undefined)
      setDraft(current => current.trim() === text ? '' : current)
      if (data.question) {
        setPendingQuestion(data.question)
        setPendingServerRequest({ request_id: data.request_id, text: data.text })
      } else {
        setTurns(current => appendExchange(current || [], data))
      }
    } catch (error) {
      if (stoppedRequest.current !== sourceId) {
        setConfirmationHint(error instanceof ApiError && error.status === 409
          ? uiText('本轮已结束或正在等待回答，补充指令未接收。') : uiText('暂未核实补充指令，请重试。'))
      }
    } finally {
      setSteeringFor(undefined)
    }
  }

  const send = async (resume?: CanvasAssistantMessage, enqueue = false) => {
    const text = (resume?.text ?? draft).trim()
    if (draftPromoting || (enqueue && queueBusy) || savingModel || savingApproval || uploadingReference || !turns || !text) return
    const intent = resume || enqueue ? undefined : confirmationKind(text)
    const replyInProgress = sendingNow.current || !!steeringFor
    if (!enqueue && replyInProgress && !intent) {
      if (!resume && activeRequestId && !pendingQuestion && !steeringFor) await steer(activeRequestId, text)
      return
    }
    if (replyInProgress && intent === 'revise') return
    let revision = enqueue ? undefined : revising
    let fieldRevision = enqueue ? undefined : revisingField
    if (intent) {
      const candidates = turns.filter(turn => !turn.stopped && turn.proposal &&
        (turn.proposal.state ?? 'pending') === 'pending')
      const checked = (turn: CanvasAssistantExchange) => turn.proposal?.groups
        ?.filter(group => (group.state ?? 'pending') === 'pending' && selectedGroups[turn.request_id]?.includes(group.id))
        .map(group => group.id) ?? []
      const highlighted = candidates.filter(turn => checked(turn).length)
      const target = candidates.length === 1 ? candidates[0] : highlighted.length === 1 ? highlighted[0] : undefined
      if (!target?.proposal) {
        setConfirmationHint(candidates.length
          ? uiText('有多份待审批建议，请先勾选要确认的建议，或使用该建议的确认按钮。')
          : uiText('当前没有可以确认的修改建议，请核对最新对话。'))
        return
      }
      if (intent === 'revise') {
        revision = target
        if (target.request_id !== revising?.request_id) fieldRevision = undefined
      }
      else {
        const available = target.proposal.groups?.filter(group => (group.state ?? 'pending') === 'pending')
          .map(group => group.id)
        const groups = intent === 'all' || available?.length === 1 ? available : checked(target)
        if (available && !groups?.length) {
          setConfirmationHint(uiText('请先勾选要批准的改动组，或回复「全部确认」。'))
          return
        }
        if (approvalDisabled) {
          setConfirmationHint(uiText('请完成当前编辑并取得画布编辑权后再确认。'))
          return
        }
        if (!replyInProgress) {
          sendingNow.current = true
          setSending(true)
        }
        setConfirmationHint(undefined)
        try {
          if (!await approveProposal(target.request_id, available ? groups : undefined)) throw new Error('approval failed')
          setDraft('')
          pending.current = undefined
        } catch {
          setConfirmationHint(uiText('未能完成审批，请核对画布状态后重试。'))
        } finally {
          if (!replyInProgress) {
            sendingNow.current = false
            setSending(false)
          }
        }
        return
      }
    }
    if (!resume && ((!enqueue && pendingQuestion) || referenceIsMissing || awaitingSelection && !revision)) return
    const useCurrentSelection = /(?:当前选区|当前选择)/.test(text)
    const explicitReferences = useCurrentSelection ? [] : referenceIds
    const crossCanvas = useCurrentSelection ? [] : Object.entries(externalReferences).filter(([, ids]) => ids.length)
      .map(([canvas_id, card_ids]) => ({ canvas_id, card_ids }))
    const revisionTargets = revision?.proposal?.groups
      ? [...new Set(revision.proposal.groups.filter(group => group.state === 'pending' &&
        (!fieldRevision || group.id === fieldRevision.group_id))
        .flatMap(group => group.edits.filter(edit => edit.target.kind !== 'add_canvas_card').map(edit => edit.card_id)))]
      : revision?.proposal ? [revision.proposal.card_id] : []
    const requestBody: CanvasAssistantMessage = resume ?? (enqueue && queuedRequest.current?.text === text
      ? queuedRequest.current : !enqueue && pending.current?.text === text && pending.current.revises === revision?.request_id
      ? pending.current : {
          text,
          request_id: crypto.randomUUID(),
          attachment_file_ids: referenceFiles.length ? referenceFiles.map(file => file.id) :
            revision?.attachments?.map(file => file.file_id) ?? [],
          revises: revision?.request_id,
          revises_field: fieldRevision,
          canvas_references: crossCanvas,
          context: revision?.proposal ? {
            ...readDraft(), scope: revisionTargets.length ? 'selection' : 'canvas', card_ids: revisionTargets,
          } : explicitReferences.length ? {
            ...readDraft(), scope: 'selection', card_ids: explicitReferences,
          } : crossCanvas.length || effectiveScope === 'text' ? undefined : {
            ...readDraft(), scope: effectiveScope, card_ids: effectiveScope === 'selection' ? selectedCards : [],
          },
        })
    if (enqueue) {
      queuedRequest.current = requestBody
      setQueueBusy(true)
      setQueueError(false)
      try {
        const { data } = await Canvases.canvasAssistantEnqueue({ canvasId, projectId, requestBody })
        if (!data) throw new Error('missing assistant queue receipt')
        queuedRequest.current = undefined
        setQueue(current => updateQueue(current, data))
        setDraft(current => current.trim() === text ? '' : current)
        setReferenceFiles([])
        setCardReferences([])
        setReferenceGroups([])
        setExternalReferences({})
      } catch {
        setQueueError(true)
      } finally {
        setQueueBusy(false)
      }
      return
    }
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
      if (turn.question) {
        setPendingQuestion(turn.question)
        setPendingServerRequest(requestBody)
      } else if (localDraft) {
        const updated = appendExchange(readDraftAssistant(canvasId).turns, turn)
        writeDraftAssistant(canvasId, { turns: updated, references: [] })
        setTurns(updated)
      } else setTurns(current => appendExchange(current || [], turn))
      setRevising(undefined)
      setRevisingField(undefined)
      setDraft(current => current.trim() === text ? '' : current)
      setReferenceFiles([])
      setCardReferences([])
      setReferenceGroups([])
      setExternalReferences({})
      pending.current = undefined
      if (!turn.question) {
        setPendingQuestion(undefined)
        setPendingServerRequest(undefined)
      }
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
        setPendingQuestion(history?.data?.pending_question ?? undefined)
        setPendingInstructions(history?.data?.pending_instructions ?? [])
        if (history?.data?.pending_instructions?.length) return
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

  const answerQuestion = async (answer: string) => {
    const sourceId = pendingServerRequest?.request_id
    if (!sourceId || !pendingQuestion || !answer.trim() || sendingNow.current) return
    sendingNow.current = true
    setSending(true)
    setSendError(undefined)
    setActiveRequestId(sourceId)
    try {
      const request = Canvases.canvasAssistantAnswer({
        canvasId, projectId, sourceId, requestBody: { question_id: pendingQuestion.id, answer },
      })
      activeRequest.current = request
      const { data } = await request
      if (!data) throw new Error('missing assistant answer receipt')
      setPendingQuestion(data.question ?? undefined)
      setQuestionAnswer('')
      if (!data.question) {
        setTurns(current => appendExchange(current || [], data))
        setPendingServerRequest(undefined)
      }
    } catch {
      if (stoppedRequest.current !== sourceId) setSendError('reply')
    } finally {
      activeRequest.current = undefined
      setActiveRequestId(undefined)
      sendingNow.current = false
      setSending(false)
    }
  }

  const changeQueue = async (id: string, text?: string) => {
    setQueueBusy(true)
    setQueueError(false)
    try {
      const result = text === undefined
        ? await Canvases.canvasAssistantRemoveQueue({ canvasId, projectId, requestId: id })
        : await Canvases.canvasAssistantEditQueue({ canvasId, projectId, requestId: id, requestBody: { text } })
      const item = result.data
      if (!item) throw new Error('missing assistant queue receipt')
      setQueue(current => updateQueue(current, item))
      setQueueEditing(undefined)
    } catch {
      setQueueError(true)
    } finally {
      setQueueBusy(false)
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
      ...(capability?.tool_calling ? [uiText("可读画布与提出修改")]
        : capability?.text_inputs && capability.text_outputs ? [uiText("可读画布文字")] : []),
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
        const follow = scrollHeight - scrollTop - clientHeight < 40
        historyPosition.current = { top: scrollTop, follow }
        setReadingEarlier(!follow)
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
        {turns?.map(turn => <article className="canvas-assistant-turn" data-assistant-turn={turn.request_id} key={turn.request_id}>
          <WorkbenchConversation items={[
            {
              key: 'user', role: 'user', placement: 'end', variant: 'borderless',
              classNames: { content: 'canvas-assistant-question' },
              styles: { content: { background: 'var(--wb-raised)', color: 'var(--wb-text)' } },
              content: <>{turn.text}{!!turn.instructions?.length && <section aria-label={uiText('本轮补充指令')}>
                <ul>{turn.instructions.map(instruction => <li key={instruction.request_id}>{instruction.text}</li>)}</ul>
              </section>}{!!turn.attachments?.length && <div className="canvas-assistant-files">
                {turn.attachments.map(file => <span key={file.file_id}>{file.name ?? uiText("素材不可用")}</span>)}
              </div>}</>,
            },
            {
              key: 'assistant', role: 'ai', variant: 'borderless', content: turn.reply,
              styles: { content: { padding: 0, color: 'var(--wb-text)' } },
            },
          ]} />
            {!!turn.attachments?.length && <CanvasAssistantEvidence attachments={turn.attachments} />}
          {!!turn.canvas_references?.length && <details className="canvas-assistant-evidence">
            <summary>{uiText('其他画布的只读引用')}</summary>
            <ul>{turn.canvas_references.map(ref => <li key={ref.canvas_id}>{ref.canvas_id} · {ref.card_ids.join('、')}</li>)}</ul>
          </details>}
          {turn.context?.observed_card_ids && <details className="canvas-assistant-evidence">
            <summary>{uiText('本轮读取 {{count}}/{{total}} 张卡片', {
              count: turn.context.observed_card_ids.length, total: turn.context.cards.length,
            })}</summary>
            <ul>{turn.context.cards.filter(card => turn.context?.observed_card_ids?.includes(card.id))
              .map(card => <li key={card.id}>{String(card.name || card.title || card.id)}</li>)}</ul>
          </details>}
          {turn.generation && <AssistantGeneration generation={turn.generation}
            openRun={runId => { close(); openRun(runId) }} cancelRun={cancelRun} approvalDisabled={approvalDisabled}
            reapprove={async requestBody => {
              const { data } = await Canvases.canvasAssistantReapproveGeneration({
                projectId, canvasId, sourceId: turn.request_id, requestBody,
              })
              if (!data) throw new Error('missing generation approval receipt')
              setTurns(current => current?.map(entry => entry.request_id === turn.request_id ? { ...entry, generation: data } : entry))
            }} />}
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
          {turn.layout && <AssistantLayout layout={turn.layout} disabled={approvalDisabled || sending && !activeRequestId}
            decide={action => decideLayout(turn.request_id, action)} />}
          {turn.proposal && <div className="canvas-assistant-edit-actions">
            <WorkbenchButton variant="quiet" aria-pressed={highlight?.sourceId === turn.request_id && !highlight.hidden}
              onClick={() => {
                if (highlight?.sourceId === turn.request_id) onHighlight({ ...highlight, hidden: !highlight.hidden })
                else if (turn.proposal) onHighlight(proposalHighlight(turn.request_id, turn.proposal, document))
              }}>{uiText(highlight?.sourceId === turn.request_id && !highlight.hidden ? '隐藏影响范围' : '查看影响范围')}</WorkbenchButton>
            {highlight?.sourceId === turn.request_id && highlight.cards.map(cardId => {
              const card = cards.find(item => item.id === cardId)
              if (!card) return null
              const name = ('name' in card && card.name) || uiText(cardTitles[card.type ?? ''] ?? card.type ?? '卡片')
              return <WorkbenchButton key={cardId} variant="quiet"
                onClick={() => onLocate(cardId)}>{uiText('定位 {{value1}}', { value1: name })}</WorkbenchButton>
            })}
          </div>}
          {turn.proposal?.groups?.length ? <AssistantEditGroups groups={turn.proposal.groups}
            undone={turn.proposal.groups.filter(group => assistantUndone.includes(turn.request_id + ':' + group.id)).map(group => group.id)}
            selected={selectedGroups[turn.request_id] ?? []}
            onSelectionChange={ids => setSelectedGroups(current => ({ ...current, [turn.request_id]: ids }))}
            current={() => readDraft().draft}
            reviseField={!localDraft ? (groupId, index) => {
              setRevising(turn); setRevisingField({ group_id: groupId, change_index: index })
              pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            } : undefined}
            editDisabled={approvalDisabled || sending && !activeRequestId}
            revise={() => {
              setRevising(turn); setRevisingField(undefined); pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            }}
            decide={async (action, groupIds) => {
              if (action === 'approve') return approveProposal(turn.request_id, groupIds)
              if (action === 'reject' && localDraft) {
                const changed = readDraftAssistant(canvasId).turns.map(item => item.request_id === turn.request_id && item.proposal
                  ? { ...item, proposal: { ...item.proposal, state: 'rejected' as const,
                    groups: item.proposal.groups?.map(group => groupIds.includes(group.id) ? { ...group, state: 'rejected' as const } : group) } } : item)
                writeDraftAssistant(canvasId, { turns: changed })
                setTurns(changed)
                return true
              }
              return await rejectProposal(turn.request_id, groupIds) && await refreshDecision(turn.request_id)
            }} /> : turn.proposal && <AssistantProposal proposal={turn.proposal} undone={assistantUndone.includes(turn.request_id + ':')} current={() => readDraft().draft} editDisabled={approvalDisabled || sending && !activeRequestId}
            revise={() => {
              setRevising(turn); setRevisingField(undefined); pending.current = undefined; setSendError(undefined)
              composer.current?.querySelector('textarea')?.focus()
            }} decide={async action => {
              if (action === 'approve') return approveProposal(turn.request_id)
              return await rejectProposal(turn.request_id) && await refreshDecision(turn.request_id)
            }} />}
          {turn.approval_audit?.map((entry, index) => <div key={index}>
            <small>{uiText(entry.mode === 'automatic' ? '自动审批明确请求' : '人工审批')} · {
              uiText(entry.outcome === 'manual_required' ? '等待人工审批' :
                entry.outcome === 'rejected' ? '建议已拒绝' : entry.outcome === 'conflict'
                  ? '与当前画布冲突' : entry.outcome === 'partial' ? '部分建议已写入' : '已写入画布')
            }</small>
            {entry.review && <details><summary>{uiText('独立审批复核')}</summary>
              <p>{entry.review.reason}</p>
              <small>{[entry.review.policy, entry.review.reviewer_model_id, entry.group_ids?.join('、')].filter(Boolean).join(' · ')}</small>
            </details>}
          </div>)}
          {!!turn.skills?.length && <ThoughtChain items={[{
            key: 'skills', title: uiText("本轮使用的技能"), status: 'success',
            collapsible: true, content: <ul>{turn.skills.map(skill => <li key={skill.id}>
              <span>{skill.name}</span> <small>{skill.version}</small>
            </li>)}</ul>,
          }]} />}
          {!!turn.subtasks?.length && <details className="canvas-assistant-evidence">
            <summary>{uiText('专项任务结果')}</summary>
            {turn.subtasks.map(task => <section key={task.id}>
              <strong>{uiText(task.role === 'storyboard-design' ? '分镜设计' : '素材与连续性审看')}</strong>
              <p>{task.task}</p>
              <small>{task.model_id} · {task.skills.map(skill => skill.name + ' ' + skill.version).join('、')}</small>
              {!!task.card_ids.length && <p>{task.card_ids.join('、')}</p>}
              <p>{task.result}</p>
              {!!task.evidence.length && <CanvasAssistantEvidence attachments={task.evidence} />}
            </section>)}
          </details>}
          {!turn.stopped && <AssistantActionSummary turn={turn}
            canApprove={!approvalDisabled && !sending && (!turn.proposal?.groups ||
              turn.proposal.groups.some(group => group.state === 'pending' && selectedGroups[turn.request_id]?.includes(group.id)))}
            approve={async includeLayout => {
              const groups = turn.proposal?.groups?.filter(group => group.state === 'pending' && selectedGroups[turn.request_id]?.includes(group.id))
                .map(group => group.id)
              const approved = await approveProposal(turn.request_id, groups, includeLayout)
              if (!approved) throw new Error('proposal remains pending')
            }}
            locate={label => {
              const item = history.current?.querySelector('article[data-assistant-turn="' + CSS.escape(turn.request_id) + '"]')
              item?.querySelector('[aria-label="' + CSS.escape(label) + '"]')?.scrollIntoView({ block: 'nearest' })
            }} />}
        </article>)}
        {!!pendingInstructions.length && <div role="status">
          <strong>{uiText('本轮已接收补充指令')}</strong>
          <ul>{pendingInstructions.map(instruction => <li key={instruction.request_id}>{instruction.text}</li>)}</ul>
        </div>}
        {(sending || steeringFor) && <div role="status"><ThoughtChain items={[
          { key: 'reply', title: uiText("助手正在回复"), status: 'loading' },
        ]} /></div>}
        {(activeRequestId || steeringFor) && <WorkbenchButton variant="quiet" loading={stopping === (activeRequestId || steeringFor)}
          onClick={() => { const runningId = activeRequestId || steeringFor; if (runningId) void stopTurn(runningId) }}>{uiText("停止助手")}</WorkbenchButton>}
        {!activeRequestId && !steeringFor && pendingServerRequest && <div>
          {pendingQuestion ? <form aria-label={uiText('创作问题')} onSubmit={event => {
            event.preventDefault(); void answerQuestion(questionAnswer)
          }}>
            <strong>{pendingServerRequest.text}</strong>
            <p>{pendingQuestion.text}</p>
            <div className="canvas-assistant-edit-actions">
              {pendingQuestion.options.map(option => <WorkbenchButton key={option} variant="quiet" disabled={sending}
                onClick={() => { void answerQuestion(option) }}>{option}</WorkbenchButton>)}
            </div>
            <input aria-label={uiText('自定义回答')} value={questionAnswer} maxLength={2000}
              onChange={event => setQuestionAnswer(event.target.value)} disabled={sending} />
            <WorkbenchButton htmlType="submit" disabled={sending || !questionAnswer.trim()}>{uiText('提交回答')}</WorkbenchButton>
          </form> : <WorkbenchButton variant="quiet" onClick={() => { void send(pendingServerRequest) }}>{uiText("继续回复")}</WorkbenchButton>}
          <WorkbenchButton variant="quiet" loading={stopping === pendingServerRequest.request_id}
            onClick={() => { void stopTurn(pendingServerRequest.request_id) }}>{uiText("停止助手")}</WorkbenchButton>
        </div>}
      </div>
      <form className="canvas-assistant-composer" ref={composer} onSubmit={event => { event.preventDefault(); void send() }}>
        {readingEarlier && <WorkbenchButton variant="quiet" onClick={() => {
          const log = history.current
          historyPosition.current.follow = true
          if (log) log.scrollTop = log.scrollHeight
          setReadingEarlier(false)
        }}>{uiText('返回最新进展')}</WorkbenchButton>}
        {revising?.proposal && <div className="canvas-assistant-edit-actions">
          <span>{uiText(revisingField ? '正在修订所选字段' : '正在修订修改建议')} · {uiText(revising.proposal.card_name)}</span>
          <WorkbenchButton variant="quiet" disabled={sending} onClick={() => {
            setRevising(undefined); setRevisingField(undefined); pending.current = undefined
          }}>{uiText("取消修订")}</WorkbenchButton>
        </div>}
        {!!queue.length && <section aria-label={uiText('下一轮队列')}>
          <strong>{uiText('下一轮队列')}</strong>
          <ul>{queue.map(item => <li key={item.request_id}>
            {queueEditing?.id === item.request_id ? <>
              <input aria-label={uiText('修改排队消息')} value={queueEditing.text} maxLength={16000}
                onChange={event => setQueueEditing({ id: item.request_id, text: event.target.value })} />
              <WorkbenchButton variant="quiet" disabled={!queueEditing.text.trim() || queueBusy || item.state !== 'queued'}
                onClick={() => { void changeQueue(item.request_id, queueEditing.text) }}>{uiText('保存')}</WorkbenchButton>
              <WorkbenchButton variant="quiet" onClick={() => setQueueEditing(undefined)}>{uiText('取消')}</WorkbenchButton>
            </> : <>
              <span>{item.message.text}</span>
              {item.state === 'queued' ? <>
                <WorkbenchButton variant="quiet" disabled={queueBusy}
                  onClick={() => setQueueEditing({ id: item.request_id, text: item.message.text })}>{uiText('编辑')}</WorkbenchButton>
                <WorkbenchButton variant="quiet" disabled={queueBusy}
                  onClick={() => { void changeQueue(item.request_id) }}>{uiText('移除')}</WorkbenchButton>
              </> : <>
                <small>{uiText('已开始处理')}</small>
                {item.turn_id && <WorkbenchButton variant="quiet" loading={stopping === item.turn_id}
                  onClick={() => { if (item.turn_id) void stopTurn(item.turn_id) }}>{uiText('停止排队任务')}</WorkbenchButton>}
              </>}
            </>}
          </li>)}</ul>
        </section>}
        {queueError && <Alert type="warning" message={uiText('暂时无法更新助手队列')} />}
        {confirmationHint && <Alert type="warning" message={confirmationHint} />}
        {sendError && <Alert type="error" message={sendError === 'tools'
          ? uiText("当前模型无法调用画布工具。切换支持提出画布修改的模型后，发送同一消息即可接续。")
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
            {(!!referenceIds.length || Object.values(externalReferences).some(ids => ids.length)) && <div className="canvas-assistant-files" aria-label={uiText('引用卡片')}>
              {cardReferences.map(id => {
                const card = cards.find(item => item.id === id)
                return <WorkbenchButton key={id} variant="quiet" onClick={() => {
                  setCardReferences(current => current.filter(value => value !== id)); pending.current = undefined
                }}>{card ? ('name' in card && card.name) || uiText(cardTitles[card.type ?? ''] ?? card.type ?? '卡片') : uiText('引用已失效')} · {id.slice(0, 8)} ×</WorkbenchButton>
              })}
              {Object.entries(externalReferences).flatMap(([source, ids]) => ids.map(id =>
                <WorkbenchButton key={source + ':' + id} variant="quiet" onClick={() => {
                  setExternalReferences(previous => ({ ...previous, [source]: previous[source].filter(item => item !== id) }))
                  pending.current = undefined
                }}>{uiText('其他画布的只读引用')} · {source.slice(0, 8)} / {id.slice(0, 8)} ×</WorkbenchButton>
              ))}
              {referenceGroups.map(group => {
                const current = document.groups?.find(item => item.id === group.id)
                const members = current?.card_ids ?? []
                const changed = members.length !== group.members.length || members.some((id, index) => id !== group.members[index])
                return <details key={group.id}><summary>{group.name} · {group.members.length}</summary>
                  <ul>{group.members.map(id => <li key={id}>{id} {cards.some(card => card.id === id) ? '' : uiText('引用已失效')}</li>)}</ul>
                  {changed && members.length > 0 && <WorkbenchButton variant="quiet" onClick={() => {
                    setReferenceGroups(previous => previous.map(item => item.id === group.id ? { ...item, members } : item))
                    pending.current = undefined
                  }}>{uiText('更新编组引用')}</WorkbenchButton>}
                  <WorkbenchButton variant="quiet" onClick={() => {
                    setReferenceGroups(previous => previous.filter(item => item.id !== group.id)); pending.current = undefined
                  }}>{uiText('移除引用')}</WorkbenchButton>
                </details>
              })}
            </div>}
            {referenceIsMissing && <Alert type="warning" message={uiText('请移除失效引用或更新编组后继续。')} />}
            {browseReferences && <Select aria-label={uiText('选择引用')} placeholder={uiText('选择引用')} value={null}
              showSearch optionFilterProp="label" onChange={value => {
                const [kind, ...parts] = String(value).split(':')
                const id = parts.join(':')
                const group = document.groups?.find(item => item.id === id)
                if (kind === 'group' && group?.card_ids?.length && !referenceGroups.some(item => item.id === id)) {
                  setReferenceGroups(previous => [...previous, { id, name: group.name, members: group.card_ids ?? [] }])
                  pending.current = undefined
                } else if (kind === 'card') addCardReferences([id])
                setBrowseReferences(false)
              }} options={[
                ...(document.groups ?? []).filter(group => group.kind !== 'stack' && group.card_ids?.length)
                  .map(group => ({ value: 'group:' + group.id, label: group.name })),
                ...cards.map(card => ({ value: 'card:' + card.id,
                  label: ('name' in card && card.name) || uiText(cardTitles[card.type ?? ''] ?? card.type ?? '卡片') + ' · ' + card.id.slice(0, 8) })),
              ]} />}
            <Sender aria-label={uiText("给画布助手发消息")} value={draft}
              placeholder={uiText("输入想讨论的镜头、画面或提示词…")}
              className="canvas-assistant-sender" suffix={false}
              autoSize={{ minRows: 2, maxRows: 4 }} disabled={draftPromoting}
              onChange={value => {
                updateDraft(value.slice(0, 16000))
                if (value.endsWith('@')) setBrowseReferences(true)
              }}
              onPaste={event => {
                const reference = readCardReference(event.clipboardData.getData('text/plain'))
                if (!reference) return
                event.preventDefault()
                if (reference.canvasId === canvasId) addCardReferences(reference.cardIds)
                else {
                  if (!(reference.canvasId in externalReferences) && Object.keys(externalReferences).filter(key => externalReferences[key].length).length >= 3) {
                    setConfirmationHint(uiText('每轮最多引用三个其他画布'))
                    return
                  }
                  setExternalReferences(previous => ({ ...previous,
                    [reference.canvasId]: [...new Set([...(previous[reference.canvasId] ?? []), ...reference.cardIds])].slice(0, 20),
                  }))
                  pending.current = undefined
                }
              }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return false
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
                  event.preventDefault()
                  void send()
                }
                return false
              }} />
            {modelError && <span role="alert">{uiText("无法读取或切换助手模型")}</span>}
            <div className="canvas-assistant-footer">
              {add}
              <WorkbenchButton variant="quiet" aria-label={uiText('引用卡片')} aria-expanded={browseReferences}
                disabled={sending} onClick={() => setBrowseReferences(value => !value)}>@</WorkbenchButton>
              <div className="canvas-assistant-send-actions">
                {!localDraft && (sending || !!steeringFor || !!pendingServerRequest || !!queue.length) && <WorkbenchButton variant="quiet"
                  disabled={!draft.trim() || queueBusy || draftPromoting || !turns || referenceIsMissing}
                  onClick={() => { void send(undefined, true) }}>{uiText('排到下一轮')}</WorkbenchButton>}
                <Select value={modelId ?? ''} aria-label={uiText("助手模型")} popupMatchSelectWidth={false} optionLabelProp="short"
                  disabled={draftPromoting || sending || savingModel || !turns || !!pendingQuestion} onChange={selected => { void chooseModel(selected) }}
                  options={[
                    { label: defaultModel ? uiText("默认模型") + ' · ' + modelLabel(defaultModel) : uiText("默认模型"),
                      short: defaultModel?.name ?? uiText("默认模型"), value: '' },
                    ...models.map(model => ({
                      label: modelLabel(model), short: model.name, value: model.id,
                      disabled: !model.effective_capabilities?.text_inputs || !model.effective_capabilities?.text_outputs,
                    })),
                  ]} />
                <WorkbenchIconButton label={uiText("发送消息")} icon={<ArrowUpOutlined />}
                  htmlType="submit" variant="primary" loading={(sending || !!steeringFor) && !draft.trim()}
                  disabled={draftPromoting || (!confirmationKind(draft.trim()) && !!steeringFor) || !turns || !!pendingQuestion && !confirmationKind(draft.trim()) || !draft.trim() || savingModel || savingApproval || uploadingReference || referenceIsMissing || awaitingSelection && !confirmationKind(draft.trim())} />
              </div>
            </div>
          </>}
        </CanvasAssistantAttachments>
      </form>
    </aside>}
  </div>
}
