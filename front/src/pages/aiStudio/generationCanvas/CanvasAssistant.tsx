import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react'
import { ArrowUpOutlined, CommentOutlined, CloseOutlined, StopOutlined } from '@ant-design/icons'
import { Alert, Input, Select, Spin, Typography } from 'antd'
import { XMarkdown } from '@ant-design/x-markdown'
import { Sender, Suggestion, Think, ThoughtChain } from '@ant-design/x'
import { WorkbenchConversation } from '../../../components/workbench/WorkbenchConversation'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { ApiError, LlmService, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasDocument, CanvasAssistantDraftContext, CanvasAssistantExchange, CanvasAssistantFieldRevision, CanvasAssistantGroupReference, CanvasAssistantHistory, CanvasAssistantInstruction, CanvasAssistantLayout, CanvasAssistantMessage, CanvasAssistantProgress, CanvasAssistantQuestion, CanvasAssistantQueueItem, FileRead, ModelRead } from '../../../services/generated'
import { AssistantEditGroups, AssistantProposal } from './AssistantProposal'
import { AssistantMarkdownTable } from './AssistantMarkdownTable'
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
  if (/^写入画布[。！!]?$/.test(text)) return 'write'
  if (/^确认[，,]\s*(不过|但是|但)\s*.+/.test(text)) return 'revise'
  return undefined
}

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
const assistantPhaseLabels = {
  waiting_model: '等待模型响应',
  reasoning: '模型正在思考',
  generating_proposal: '正在生成画布提案',
  validating_proposal: '正在校验提案',
} as const

type AssistantSendError = 'text' | 'tools' | 'reply' | 'context-limit' | 'target' | 'proposal' | 'timeout' | 'model'

function assistantSendError(detail: unknown): AssistantSendError {
  switch (detail) {
    case 'ASSISTANT_TOOL_CALLING_REQUIRED': return 'tools'
    case 'ASSISTANT_TEXT_CAPABILITY_REQUIRED': return 'text'
    case 'ASSISTANT_CONTEXT_LIMIT_EXCEEDED': return 'context-limit'
    case 'CANVAS_TARGET_UNRESOLVED': return 'target'
    case 'ASSISTANT_PROPOSAL_INVALID': return 'proposal'
    case 'ASSISTANT_MODEL_TIMEOUT': return 'timeout'
    case 'ASSISTANT_MODEL_FAILED': return 'model'
    default: return 'reply'
  }
}

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
  const [turns, setTurnState] = useState<CanvasAssistantExchange[]>()
  const mutationEpoch = useRef(0)
  const setTurns = useCallback((update: SetStateAction<CanvasAssistantExchange[] | undefined>) => {
    mutationEpoch.current += 1
    setTurnState(update)
  }, [])
  const [historyError, setHistoryError] = useState(false)
  const [retryLoad, setRetryLoad] = useState(0)
  const [draft, setDraft] = useState('')
  const [repairSource, setRepairSource] = useState<string>()
  const [cardReferences, setCardReferences] = useState<string[]>([])
  const [externalReferences, setExternalReferences] = useState<Record<string, string[]>>({})
  const [externalGroups, setExternalGroups] = useState<Record<string, CanvasAssistantGroupReference[]>>({})
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
  const [sendError, setSendError] = useState<AssistantSendError>()
  const [failedReplyId, setFailedReplyId] = useState<string>()
  const [thinkingExpanded, setThinkingExpanded] = useState(false)
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
  const [liveRequest, setLiveRequest] = useState<{ request_id: string; text: string }>()
  const [draftStreamId, setDraftStreamId] = useState<string>()
  const [progress, setProgress] = useState<CanvasAssistantProgress>()
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
  const liveTurn: CanvasAssistantExchange | undefined = progress?.reply && liveRequest?.request_id === progress.request_id
    && !turns?.some(turn => turn.request_id === progress.request_id)
    ? { ...liveRequest, sequence: 0, model_id: progress.model_id, reply: progress.reply } : undefined
  const phaseSteps = Object.entries(progress?.phase_started_at ?? {})
    .sort(([, first], [, second]) => Date.parse(first) - Date.parse(second))
  const replyRecovered = !localDraft && !!failedReplyId && turns?.some(turn => turn.request_id === failedReplyId)
  const displayedTurns = liveTurn ? [...(turns ?? []), liveTurn] : turns
  const runningId = activeRequestId || steeringFor || draftStreamId ||
    (progress?.streaming && !pendingQuestion ? progress.request_id : undefined)
  const draftText = draft.trim()
  const approvalIntent = confirmationKind(draftText)
  const supplementing = !!runningId && !localDraft && !pendingQuestion && !steeringFor && stopping !== runningId && !approvalIntent
  const showStop = !!runningId && !draftText
  const sendLabel = uiText(supplementing ? '发送补充' : '发送消息')
  const canSend = !!draftText && !!turns && !draftPromoting && !draftStreamId &&
    !stopping && !savingModel && !savingApproval && !uploadingReference && !referenceIsMissing &&
    (!pendingQuestion || !!approvalIntent) &&
    (runningId ? supplementing || (!!approvalIntent && approvalIntent !== 'revise') : !sending)
  const panelId = 'canvas-assistant-' + canvasId
  const applySnapshot = useCallback((data: CanvasAssistantHistory, epoch: number) => {
    if (mutationEpoch.current !== epoch) return false
    const checkpoint = snapshotCursor.current
    if (checkpoint?.canvasId === canvasId && checkpoint.cursor > data.cursor) return false
    snapshotCursor.current = { canvasId, cursor: data.cursor }
    setTurns(data.turns)
    setPendingServerRequest(data.pending_request ?? undefined)
    setPendingQuestion(data.pending_question ?? undefined)
    setProgress(data.pending_progress ?? undefined)
    if (data.pending_progress?.error_code && !data.pending_progress.streaming) {
      setFailedReplyId(data.pending_progress.request_id)
      setSendError(assistantSendError(data.pending_progress.error_code))
    }
    setLiveRequest(data.pending_request ?? undefined)
    setQueue(data.queue ?? [])
    setPendingInstructions(data.pending_instructions ?? [])
    setModelId(data.model_id ?? null)
    setAutomaticApproval(data.approval_mode === 'automatic')
    return true
  }, [canvasId, setTurns])

  const updateDraft = (value: string) => {
    setConfirmationHint(undefined)
    setDraft(value)
    if (!value.trim()) setRepairSource(undefined)
    pending.current = undefined
    setSendError(undefined)
  }

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
          const epoch = mutationEpoch.current
          const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId }).catch(() => ({ data: undefined }))
          if (active && data) applySnapshot(data, epoch)
        }
        // Retry pending work and reuse the browser receipt when delivery fails.
      }
      finally { busy = false }
    }
    const timer = window.setInterval(() => void execute(), 500)
    return () => { active = false; window.clearInterval(timer) }
  }, [waitingLayout, approvalDisabled, canvasId, projectId, applySnapshot, setTurns])

  useEffect(() => {
    if (localDraft) {
      if (!open) return
      const saved = readDraftAssistant(canvasId)
      setDraftStreamId(saved.live?.id)
      setTurns(saved.turns)
      setModelId(saved.modelId)
      setReferenceFiles(saved.references)
      return
    }
    const epoch = mutationEpoch.current
    const request = Canvases.canvasAssistantHistory({ canvasId, projectId })
    let current = true
    void request.then(response => {
      if (!response.data) throw new Error('missing assistant history')
      if (current) applySnapshot(response.data, epoch)
    }).catch(() => { if (current) setHistoryError(true) })
    return () => { current = false; request.cancel() }
  }, [open, canvasId, projectId, retryLoad, localDraft, applySnapshot, setTurns])

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
          if ('message' in payload || event.type === 'question.asked' || event.type === 'turn.steered' || event.type === 'turn.progress' || event.type === 'turn.interrupted') return history
          if (event.type === 'turn.completed') return appendExchange(history, payload)
          const existing = history.find(turn => turn.request_id === event.turn_id)
          return existing ? history.map(turn => turn === existing ? {
            ...turn, ...payload, generation: payload.generation ?? turn.generation,
          } : turn) : appendExchange(history, payload)
        }, turns ?? []))
        for (const { type, turn_id, payload } of updates) {
          if (type === 'turn.progress' && 'progress' in payload && payload.progress) {
            setLiveRequest(payload)
            setProgress(payload.progress)
          }
          if (type === 'turn.interrupted') {
            const recovered = updates.some(event => event.turn_id === turn_id && event.type === 'turn.completed')
            if (turn_id && !recovered && 'error_code' in payload && payload.error_code) {
              setFailedReplyId(turn_id)
              setSendError(assistantSendError(payload.error_code))
            }
            if (!recovered && 'progress' in payload && payload.progress?.reply) {
              setLiveRequest(payload)
              setProgress(payload.progress)
            } else {
              setProgress(current => current?.request_id !== turn_id ? current : current.reply ? { ...current, streaming: false } : undefined)
            }
          }
          if (type === 'turn.steered' || type === 'question.asked' || type === 'turn.completed' || type === 'turn.stopped') {
            setProgress(current => current?.request_id === turn_id ? undefined : current)
          }
        }
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
    }, activeRequestId || pendingServerRequest ? 250 : 1500)
    return () => { active = false; window.clearInterval(timer); request?.cancel() }
  }, [open, canvasId, projectId, localDraft, pendingServerRequest, activeRequestId, setTurns])

  useEffect(() => {
    if (!open || !localDraft || !draftStreamId) return
    let active = true
    let loading = false
    let missingSince = 0
    const poll = async () => {
      if (loading) return
      loading = true
      try {
        const { data } = await Canvases.canvasDraftAssistantReply({ canvasId, sourceId: draftStreamId })
        const saved = readDraftAssistant(canvasId)
        if (!active || !data || saved.live?.id !== draftStreamId) return
        missingSince = 0
        if (data.state === 'running') {
          writeDraftAssistant(canvasId, { live: { ...saved.live, turn: data.turn } })
          setLiveRequest(data.turn)
          setProgress({
            ...data.turn.progress, request_id: data.turn.request_id, model_id: data.turn.model_id,
            reply: data.turn.reply, streaming: true,
          })
        } else {
          const updated = data.state === 'interrupted' ? saved.turns : appendExchange(saved.turns, data.turn)
          writeDraftAssistant(canvasId, { turns: updated, live: undefined })
          setTurns(updated)
          if (data.state === 'interrupted') setSendError(assistantSendError(data.turn.error_code))
          setProgress(undefined)
          setDraftStreamId(undefined)
          draftingAssistantReply.delete(canvasId)
        }
      } catch (error) {
        const live = readDraftAssistant(canvasId).live
        if (!(error instanceof ApiError) || error.status !== 404) missingSince = 0
        else if (!missingSince) missingSince = Date.now()
        if (active && live?.id === draftStreamId && missingSince && Date.now() - missingSince > 15000) {
          const saved = readDraftAssistant(canvasId)
          const updated = live.turn?.reply ? appendExchange(saved.turns, live.turn) : saved.turns
          writeDraftAssistant(canvasId, { live: undefined, turns: updated })
          setTurns(updated)
          setSendError('reply')
          setProgress(undefined)
          setDraftStreamId(undefined)
          draftingAssistantReply.delete(canvasId)
        }
      } finally {
        loading = false
      }
    }
    draftingAssistantReply.add(canvasId)
    void poll()
    const timer = window.setInterval(() => void poll(), 300)
    return () => { active = false; window.clearInterval(timer) }
  }, [open, localDraft, canvasId, draftStreamId, setTurns])

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
  }, [canvasId, localDraft, open, pendingQuestion, projectId, queueHead, sending, setTurns])

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
  }, [open, turns, sending, progress?.reply, referenceFiles.length])

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
      if (localDraft) {
        const { data } = await Canvases.canvasDraftAssistantStop({ canvasId, sourceId })
        if (!data) throw new Error('missing draft stop receipt')
        const updated = appendExchange(readDraftAssistant(canvasId).turns, data.turn)
        writeDraftAssistant(canvasId, { live: undefined, turns: updated })
        setTurns(updated)
        setDraftStreamId(undefined)
        draftingAssistantReply.delete(canvasId)
        stoppedRequest.current = sourceId
        activeRequest.current?.cancel()
        setProgress(undefined)
        return
      }
      const { data } = await Canvases.canvasAssistantStop({ canvasId, projectId, sourceId })
      if (!data) throw new Error('missing assistant stop receipt')
      setTurns(current => current?.some(turn => turn.request_id === sourceId)
        ? current.map(turn => turn.request_id === sourceId ? data : turn) : [...(current || []), data])
      setPendingServerRequest(request => request?.request_id === sourceId ? undefined : request)
      setProgress(current => current?.request_id === sourceId ? undefined : current)
      if (pendingServerRequest?.request_id === sourceId) setPendingQuestion(undefined)
      if (pendingServerRequest?.request_id === sourceId || activeRequestId === sourceId || steeringFor === sourceId) {
        setPendingInstructions([])
      }
      if (activeRequestId === sourceId || steeringFor === sourceId) {
        stoppedRequest.current = sourceId
        activeRequest.current?.cancel()
        pending.current = undefined
        setRevising(undefined)
        setRevisingField(undefined)
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
    const epoch = mutationEpoch.current
    const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
    if (data) applySnapshot(data, epoch)
  }

  const close = () => {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus())
  }

  const refreshDecision = async (sourceId: string, clearSelection = true) => {
    const epoch = mutationEpoch.current
    const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId }).catch(() => ({ data: undefined }))
    if (!data) {
      setRetryLoad(value => value + 1)
      return false
    }
    applySnapshot(data, epoch)
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

  const send = async (resume?: CanvasAssistantMessage, enqueue = false, replan = false) => {
    const text = (resume?.text ?? draft).trim()
    if (draftStreamId || draftPromoting || (enqueue && queueBusy) || savingModel || savingApproval || uploadingReference || !turns || !text) return
    const intent = resume || enqueue ? undefined : confirmationKind(text)
    const replyInProgress = sendingNow.current || !!runningId
    if (!enqueue && replyInProgress && !intent) {
      if (!localDraft && !resume && runningId && supplementing) await steer(runningId, text)
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
        if (intent !== 'write' || candidates.length || replyInProgress) {
          setConfirmationHint(candidates.length
            ? uiText('有多份待审批建议，请先勾选要确认的建议，或使用该建议的确认按钮。')
            : uiText('当前没有可以确认的修改建议，请核对最新对话。'))
          return
        }
      } else if (intent === 'revise') {
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
    if (!resume && ((!enqueue && pendingQuestion) || referenceIsMissing)) return
    const useCurrentSelection = /(?:当前选区|当前选择)/.test(text)
    const explicitReferences = useCurrentSelection ? [] : referenceIds
    const crossCanvas = useCurrentSelection ? [] : Object.entries(externalReferences).filter(([, ids]) => ids.length)
      .map(([canvas_id, card_ids]) => ({
        canvas_id, card_ids,
        groups: externalGroups[canvas_id]?.filter(group => group.card_ids.every(id => card_ids.includes(id))),
      }))
    const revisionTargets = revision?.proposal?.groups
      ? [...new Set(revision.proposal.groups.filter(group => group.state === 'pending' &&
        (!fieldRevision || group.id === fieldRevision.group_id))
        .flatMap(group => group.edits.filter(edit => edit.target.kind !== 'add_canvas_card').map(edit => edit.card_id)))]
      : revision?.proposal ? [revision.proposal.card_id] : []
    const requestBody: CanvasAssistantMessage = resume ?? (enqueue && queuedRequest.current?.text === text
      ? queuedRequest.current : !enqueue && pending.current?.text === text && pending.current.revises === revision?.request_id && pending.current.repairs === repairSource
      ? pending.current : {
          text,
          request_id: crypto.randomUUID(),
          stream_reply: true,
          repairs: repairSource,
          attachment_file_ids: referenceFiles.length ? referenceFiles.map(file => file.id) :
            revision?.attachments?.map(file => file.file_id) ?? [],
          revises: revision?.request_id,
          revises_field: fieldRevision,
          canvas_references: crossCanvas,
          context: revision?.proposal ? {
            ...readDraft(), scope: revisionTargets.length ? 'selection' : 'canvas', card_ids: revisionTargets,
          } : explicitReferences.length ? {
            ...readDraft(), scope: 'selection', card_ids: explicitReferences,
          } : crossCanvas.length ? undefined : {
            ...readDraft(), scope: 'auto', card_ids: selectedCards,
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
        setExternalGroups({})
      } catch {
        setQueueError(true)
      } finally {
        setQueueBusy(false)
      }
      return
    }
    const consumeDraft = !resume || (replan && pending.current === resume && draft.trim() === text)
    pending.current = requestBody
    if (consumeDraft) {
      setRepairSource(undefined)
      setDraft('')
      setReferenceFiles([])
      setCardReferences([])
      setReferenceGroups([])
      setExternalReferences({})
      setExternalGroups({})
    }
    historyPosition.current.follow = true
    sendingNow.current = true
    setSending(true)
    setSendError(undefined)
    setFailedReplyId(undefined)
    setLiveRequest(requestBody)
    if (localDraft) {
      draftingAssistantReply.add(canvasId)
      writeDraftAssistant(canvasId, { live: { id: requestBody.request_id }, references: [] })
      setDraftStreamId(requestBody.request_id)
    }
    try {
      const request = localDraft
        ? Canvases.canvasDraftAssistantSend({ canvasId, requestBody: {
          ...requestBody, turns: readDraftAssistant(canvasId).turns, model_id: modelId,
        } })
        : Canvases.canvasAssistantSend({ canvasId, projectId, requestBody })
      setActiveRequestId(requestBody.request_id)
      activeRequest.current = request
      const { data: turn } = await request
      if (!turn) throw new Error('missing assistant reply')
      if (turn.question) {
        setPendingQuestion(turn.question)
        setPendingServerRequest(requestBody)
      } else if (localDraft) {
        const updated = appendExchange(readDraftAssistant(canvasId).turns, turn)
        writeDraftAssistant(canvasId, { turns: updated, references: [], live: undefined })
        setDraftStreamId(undefined)
        setProgress(undefined)
        setTurns(updated)
      } else setTurns(current => appendExchange(current || [], turn))
      setRevising(undefined)
      setRevisingField(undefined)
      pending.current = undefined
      if (!turn.question) {
        setPendingQuestion(undefined)
        setPendingServerRequest(undefined)
      }
      if (turn.automatic_approval && !approvalDisabled && turn.proposal) {
        const groupIds = turn.proposal.groups?.map(group => group.id)
        try {
          if (!await approve(turn.request_id, groupIds, true)) setApprovalError(true)
          const epoch = mutationEpoch.current
          const { data } = await Canvases.canvasAssistantHistory({ canvasId, projectId })
          if (data) applySnapshot(data, epoch)
        } catch {
          setApprovalError(true)
        }
      }
    } catch (error) {
      if (stoppedRequest.current === requestBody.request_id) return
      if (!localDraft) {
        const epoch = mutationEpoch.current
        const history = await Canvases.canvasAssistantHistory({ canvasId, projectId }).catch(() => undefined)
        if (history?.data && applySnapshot(history.data, epoch) && history.data.pending_instructions?.length) return
      }
      if (consumeDraft && pending.current === requestBody) {
        setDraft(text)
        setRepairSource(requestBody.repairs ?? undefined)
        setReferenceFiles(referenceFiles)
        setCardReferences(cardReferences)
        setReferenceGroups(referenceGroups)
        setExternalReferences(externalReferences)
        setExternalGroups(externalGroups)
        if (localDraft) writeDraftAssistant(canvasId, { references: referenceFiles })
      }
      const detail = error instanceof ApiError ? error.body?.message ?? error.body?.detail : undefined
      setSendError(assistantSendError(detail))
    } finally {
      if (!readDraftAssistant(canvasId).live) draftingAssistantReply.delete(canvasId)
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
    } catch (error) {
      if (stoppedRequest.current !== sourceId) {
        const failure = assistantSendError(error instanceof ApiError ? error.body?.message ?? error.body?.detail : undefined)
        setSendError(failure)
        if (failure === 'proposal') setPendingQuestion(undefined)
      }
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
      mutationEpoch.current += 1
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
      mutationEpoch.current += 1
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
  const starters = storyboard
    ? selectedCards.length ? ['帮我看看这个镜头的推进节奏', '帮我检查选中卡片的连续性']
      : cards.length ? ['帮我梳理这场戏的镜头节奏', '看看哪些镜头还需要补充']
        : ['帮我构思第一个镜头', '帮我确定这场戏的视觉基调']
    : selectedCards.length ? ['帮我优化这张卡的提示词', '帮我看看选中的素材适合怎么用']
      : cards.length ? ['帮我梳理画布上的素材和生成方向', '帮我检查当前画布的提示词']
        : ['帮我构思一张起始画面', '帮我拟一版图片生成提示词']
  const openDrawer = () => {
    setHistoryError(false)
    setOpen(true)
    const cardId = selectedCards[0]
    if (!cardId || !window.matchMedia('(min-width: 801px)').matches) return
    requestAnimationFrame(() => {
      const graph = panel.current?.closest('.generation-stage')?.querySelector('.generation-graph')
      const card = graph?.querySelector('[data-card-id="' + CSS.escape(cardId) + '"]')
      if (graph && card && card.getBoundingClientRect().right > graph.getBoundingClientRect().right) onLocate(cardId)
    })
  }
  const fillSuggestion = (text: string) => {
    updateDraft(text)
    composer.current?.querySelector('textarea')?.focus()
  }
  const copyMessage = (text: string) => <Typography.Text className="canvas-assistant-copy"
    copyable={{ text, tooltips: [uiText('复制正文'), uiText('正文已复制')] }} />
  return <div className="canvas-assistant-dock" data-open={open}>
    <WorkbenchIconButton ref={trigger} label={uiText(open ? "收起画布助手" : "打开画布助手")} icon={<CommentOutlined />}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={open ? close : openDrawer} />
    {open && <aside ref={panel} id={panelId} className="canvas-assistant-panel" tabIndex={-1} aria-label={uiText("画布助手")}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing && !(event.target instanceof HTMLElement && event.target.getAttribute('aria-expanded') === 'true')) {
          event.stopPropagation()
          close()
        }
      }}>
      <header className="canvas-assistant-header">
        <strong>{uiText(storyboard ? '分镜画布助手' : '自由画布助手')}</strong>
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
            {starters.map(starter => <WorkbenchButton key={starter} onClick={() => fillSuggestion(uiText(starter))}>{uiText(starter)}</WorkbenchButton>)}
          </div>}
        {historyError && <Alert type="error" message={uiText("暂时无法读取助手对话")}
          action={<WorkbenchButton onClick={() => { setHistoryError(false); setRetryLoad(value => value + 1) }}>{uiText("重试")}</WorkbenchButton>} />}
        {stopError && <Alert type="error" message={uiText("暂时无法停止助手")} />}
        {!turns && !historyError && <Spin aria-label={uiText("正在读取助手对话")} />}
        {displayedTurns?.map(turn => <article className="canvas-assistant-turn" data-assistant-turn={turn.request_id} key={turn.request_id}>
          <WorkbenchConversation items={[
            {
              key: 'user', role: 'user', placement: 'end', variant: 'borderless',
              classNames: { content: 'canvas-assistant-question' },
              styles: { root: { paddingBlock: 4 }, content: { padding: '8px 12px', background: 'var(--wb-raised)', color: 'var(--wb-text)' } },
              footer: copyMessage([turn.text, ...(turn.instructions ?? []).map(item => item.text)].join('\n\n')),
              footerPlacement: 'outer-end',
              content: <>{turn.text}{!!turn.instructions?.length && <section aria-label={uiText('本轮补充指令')}>
                <ul>{turn.instructions.map(instruction => <li key={instruction.request_id}>{instruction.text}</li>)}</ul>
              </section>}{!!turn.attachments?.length && <div className="canvas-assistant-files">
                {turn.attachments.map(file => <span key={file.file_id}>{file.name ?? uiText("素材不可用")}</span>)}
              </div>}</>,
            },
            {
              key: 'assistant', role: 'ai', variant: 'borderless', streaming: turn === liveTurn && !!progress?.streaming && !pendingQuestion,
              footer: turn.reply && copyMessage(turn.reply),
              styles: { root: { paddingInlineEnd: 0, paddingBlock: 4 }, body: { width: '100%' }, content: { padding: 0, color: 'var(--wb-text)' } },
              content: <XMarkdown escapeRawHtml disableDefaultStyles={['table', 'th', 'td']}
                components={{ table: AssistantMarkdownTable }} className="canvas-assistant-markdown" content={turn.reply}
                streaming={{ hasNextChunk: turn === liveTurn && !!progress?.streaming && !pendingQuestion }} />,
            },
          ]} />
            {!!turn.attachments?.length && <CanvasAssistantEvidence attachments={turn.attachments} />}
            {!!turn.proposal_issues?.length && <details open className="canvas-assistant-evidence">
              <summary>{uiText('待修正的画布操作')}</summary>
              <ul>{turn.proposal_issues.map((issue, index) => <li key={index}>
                {issue.group != null && <>{uiText('第 {{group}} 组', { group: issue.group })} · </>}
                {issue.operation != null && <>{uiText('第 {{operation}} 项', { operation: issue.operation })} · </>}
                {issue.field && <code>{issue.field} · </code>}
                {issue.message}
                {issue.candidate_ids?.map(id => <span key={id}>
                  {(['使用已有卡', '另建副本'] as const).map(action => <WorkbenchButton key={action} variant="quiet"
                    disabled={!!runningId || sending || !!draftText} onClick={() => {
                      updateDraft(`${turn.text}\n${action} ${id}`)
                      composer.current?.querySelector('textarea')?.focus()
                    }}>{uiText(action)} · {id.slice(0, 8)}</WorkbenchButton>)}
                </span>)}
                {issue.source_card && issue.target_card && <span> · {issue.source_card} → {issue.target_card}</span>}
              </li>)}</ul>
              <WorkbenchButton variant="quiet" disabled={!!runningId || sending || !!draftText || !!revising ||
                !!referenceFiles.length || !!cardReferences.length || !!Object.keys(externalReferences).length} onClick={() => {
                updateDraft(uiText('请修正未完成的画布操作。'))
                setRepairSource(turn.request_id)
                composer.current?.querySelector('textarea')?.focus()
              }}>{uiText('修正未完成项')}</WorkbenchButton>
            </details>}
          {!!turn.canvas_references?.length && <details className="canvas-assistant-evidence">
            <summary>{uiText('其他画布的只读引用')}</summary>
            <ul>{turn.canvas_references.map(ref => <li key={ref.canvas_id}>{ref.canvas_id} · {ref.groups?.map(group => group.name).join('、') || ref.card_ids.join('、')}</li>)}</ul>
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
        {!pendingQuestion && (sending || steeringFor || progress?.streaming) && <div role="status">
          {(!liveTurn || progress?.phase === 'generating_proposal' || progress?.phase === 'validating_proposal') && <Think className="canvas-assistant-wait"
            loading blink expanded={thinkingExpanded} onExpand={setThinkingExpanded}
            title={<button type="button" className="canvas-assistant-think-toggle" aria-expanded={thinkingExpanded}
              onClick={event => { event.stopPropagation(); setThinkingExpanded(value => !value) }}>
              {uiText(assistantPhaseLabels[progress?.phase ?? 'waiting_model'])}
            </button>}>
            {!!phaseSteps.length && <ol>
              {phaseSteps.map(([phase, at], index) => {
                const next = phaseSteps[index + 1]?.[1]
                const elapsed = next && (Date.parse(next) - Date.parse(at)) / 1000
                return <li key={phase}>
                  {uiText(assistantPhaseLabels[phase as keyof typeof assistantPhaseLabels])}
                  {typeof elapsed === 'number' && <span> · {elapsed.toFixed(1)} s</span>}
                </li>
              })}
            </ol>}
          </Think>}
          {progress && <ThoughtChain items={[
          { key: progress.request_id,
            title: uiText('已接收本轮上下文'),
            status: progress.active_tasks && Object.keys(progress.active_tasks).length ? 'loading' : 'success',
            collapsible: true,
            content: <div className="canvas-assistant-live-evidence">
              <p>{uiText('助手模型')} · {models.find(model => model.id === progress.model_id)?.name ?? progress.model_id}</p>
              {typeof progress.revision === 'number' && <p>{uiText('画布修订')} {progress.revision}</p>}
              {!!progress.observed_card_ids?.length && <p>{uiText('已读取卡片')} · {progress.observed_card_ids.join('、')}</p>}
              {!!progress.skills?.length && <p>{uiText('本轮使用的技能')} · {progress.skills.map(skill => skill.name).join('、')}</p>}
              {!!progress.attachments?.length && <CanvasAssistantEvidence attachments={progress.attachments} prepared />}
              {Object.entries(progress.active_tasks ?? {}).map(([id, task]) => <p key={id}>{uiText('正在处理')} · {task}</p>)}
              {progress.subtasks?.map(task => <section key={task.id}>
                <strong>{task.task}</strong><p>{task.result}</p>
                {!!task.evidence.length && <CanvasAssistantEvidence attachments={task.evidence} />}
              </section>)}
            </div> },
        ]} />}</div>}
        {runningId && !showStop && <WorkbenchButton variant="quiet" loading={stopping === runningId}
          onClick={() => { void stopTurn(runningId) }}>{uiText("停止助手")}</WorkbenchButton>}
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
            <Input aria-label={uiText('自定义回答')} value={questionAnswer} maxLength={2000}
              onChange={event => setQuestionAnswer(event.target.value)} disabled={sending} />
            <WorkbenchButton htmlType="submit" disabled={sending || !questionAnswer.trim()}>{uiText('提交回答')}</WorkbenchButton>
          </form> : !progress?.streaming && <WorkbenchButton variant="quiet" onClick={() => { void send(pendingServerRequest) }}>{uiText("继续回复")}</WorkbenchButton>}
          {!runningId && <WorkbenchButton variant="quiet" loading={stopping === pendingServerRequest.request_id}
            onClick={() => { void stopTurn(pendingServerRequest.request_id) }}>{uiText("停止助手")}</WorkbenchButton>}
        </div>}
      </div>
        {readingEarlier && <WorkbenchButton className="canvas-assistant-jump" variant="quiet" onClick={() => {
          const log = history.current
          historyPosition.current.follow = true
          if (log) log.scrollTop = log.scrollHeight
          setReadingEarlier(false)
        }}>{uiText('返回最新进展')}</WorkbenchButton>}
      <form className="canvas-assistant-composer" ref={composer} onSubmit={event => { event.preventDefault(); if (canSend) void send() }}>
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
              <Input aria-label={uiText('修改排队消息')} value={queueEditing.text} maxLength={16000}
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
        {sendError && !replyRecovered && <Alert type="error" message={sendError === 'tools'
          ? uiText("当前模型无法调用画布工具。切换支持提出画布修改的模型后，发送同一消息即可接续。")
          : sendError === 'text' ? uiText("当前模型无法进行文字对话，请切换助手模型。")
          : sendError === 'target' ? uiText('没有找到指令中点名的镜头，请核对镜头或引用对应卡片。')
          : sendError === 'context-limit' ? uiText("内容超出当前模型的上下文上限，请缩小分析范围或切换助手模型。")
          : sendError === 'proposal' ? uiText('画布提案未通过校验，本轮未修改画布。')
          : sendError === 'timeout' ? uiText('助手处理超时，请继续或缩小本轮任务。')
          : sendError === 'model' ? uiText('模型处理失败，可以继续本轮或切换模型。')
            : uiText("未收到助手回复，请检查助手模型后重试")}
          action={sendError === 'proposal' && (pendingServerRequest || pending.current) && <WorkbenchButton
            variant="quiet" disabled={!!runningId} onClick={() => { void send(pendingServerRequest ?? pending.current, false, true) }}>
            {uiText('重新规划提案')}
          </WorkbenchButton>} />}
        <CanvasAssistantAttachments projectId={projectId} files={referenceFiles} uploading={uploadingReference}
          onReference={() => setBrowseReferences(value => !value)} setUploading={setUploadingReference} disabled={draftPromoting || sending || !turns}
          onChange={files => {
            if (localDraft) writeDraftAssistant(canvasId, { references: files })
            setReferenceFiles(files)
            pending.current = undefined
            setSendError(undefined)
          }}>
          {(add, attachments) => <>
            {attachments}
            {(!!referenceIds.length || Object.values(externalReferences).some(ids => ids.length)) && <div className="canvas-assistant-files" aria-label={uiText('引用卡片')}>
              {cardReferences.map(id => {
                const card = cards.find(item => item.id === id)
                return <WorkbenchButton key={id} variant="quiet" onClick={() => {
                  setCardReferences(current => current.filter(value => value !== id)); pending.current = undefined
                }}>{card ? ('name' in card && card.name) || uiText(cardTitles[card.type ?? ''] ?? card.type ?? '卡片') : uiText('引用已失效')} · {id.slice(0, 8)} ×</WorkbenchButton>
              })}
              {Object.entries(externalGroups).flatMap(([source, groups]) => groups.map(group =>
                <details key={source + ':' + group.id}><summary>{group.name} · {group.card_ids.length}</summary>
                  <ul>{group.card_ids.map(id => <li key={id}>{id}</li>)}</ul>
                  <WorkbenchButton variant="quiet" onClick={() => {
                    const survivors = groups.filter(item => item.id !== group.id)
                    const retained = new Set(survivors.flatMap(item => item.card_ids))
                    setExternalGroups(previous => ({ ...previous, [source]: survivors }))
                    setExternalReferences(previous => ({ ...previous, [source]: previous[source].filter(id =>
                      !group.card_ids.includes(id) || retained.has(id)) }))
                    pending.current = undefined
                  }}>{uiText('移除引用')}</WorkbenchButton>
                </details>))}
              {Object.entries(externalReferences).flatMap(([source, ids]) => ids.filter(id =>
                !externalGroups[source]?.some(group => group.card_ids.includes(id))).map(id =>
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
            <Suggestion block items={() => starters.map(value => ({ label: uiText(value), value: uiText(value) }))}
              onSelect={fillSuggestion}>
              {({ onTrigger, onKeyDown, open: suggestionsOpen }) => (
                <Sender aria-label={uiText("给画布助手发消息")} value={draft}
                  placeholder={uiText("输入问题，或输入 / 查看提问建议")}
                  className="canvas-assistant-sender" suffix={false}
                  autoSize={{ minRows: 2, maxRows: 4 }} disabled={draftPromoting}
                  onChange={value => {
                    updateDraft(value.slice(0, 16000))
                    if (value === '/' || suggestionsOpen) onTrigger(value === '/' ? undefined : false)
                    if (value.endsWith('@')) setBrowseReferences(true)
                  }}
                  onPaste={event => {
                    const reference = readCardReference(event.clipboardData.getData('text/plain'))
                    if (!reference) return
                    event.preventDefault()
                    if (reference.canvasId === canvasId) {
                      if (reference.group) {
                        const { id, name } = reference.group
                        setReferenceGroups(previous => [...previous.filter(group => group.id !== id),
                          { id, name, members: reference.cardIds }])
                        pending.current = undefined
                      } else addCardReferences(reference.cardIds)
                    } else {
                      if (!(reference.canvasId in externalReferences) && Object.keys(externalReferences).filter(key => externalReferences[key].length).length >= 3) {
                        setConfirmationHint(uiText('每轮最多引用三个其他画布'))
                        return
                      }
                      const ids = [...new Set([...(externalReferences[reference.canvasId] ?? []), ...reference.cardIds])]
                      if (reference.group && ids.length > 20) {
                        setConfirmationHint(uiText('其他画布的编组超过单轮可引用范围，请减少引用卡片。'))
                        return
                      }
                      if (reference.group) {
                        const group = { ...reference.group, card_ids: reference.cardIds }
                        setExternalGroups(previous => ({ ...previous, [reference.canvasId]: [
                          ...(previous[reference.canvasId] ?? []).filter(item => item.id !== group.id), group,
                        ] }))
                      }
                      setExternalReferences(previous => ({ ...previous, [reference.canvasId]: ids.slice(0, 20) }))
                      pending.current = undefined
                    }
                  }}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) {
                      event.stopPropagation()
                      return false
                    }
                    const submitKey = event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
                    if (suggestionsOpen && (submitKey || ['ArrowDown', 'ArrowUp', 'Escape'].includes(event.key))) {
                      onKeyDown(event)
                      // Cascader tracks the active option. Escape closes only its popup.
                      if (event.key === 'Escape') event.stopPropagation()
                      return false
                    }
                    // Keep the Cascader trigger from consuming spaces or native newlines in the textarea.
                    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
                    if (submitKey) {
                      event.preventDefault()
                      if (canSend) void send()
                    }
                    return false
                  }} />
              )}
            </Suggestion>
            {modelError && <span role="alert">{uiText("无法读取或切换助手模型")}</span>}
            {!localDraft && (runningId || pendingServerRequest || queue.length > 0) && !!draftText &&
              <WorkbenchButton className="canvas-assistant-queue-action" variant="quiet"
                disabled={queueBusy || draftPromoting || !turns || referenceIsMissing}
                onClick={() => { void send(undefined, true) }}>{uiText('排到下一轮')}</WorkbenchButton>}
            <div className="canvas-assistant-footer">
              {add}
              {!localDraft && <Select className="canvas-assistant-approval" variant="borderless"
                aria-label={uiText('审批模式')} value={automaticApproval ? 'automatic' : 'manual'}
                disabled={!!runningId || sending || savingApproval || !turns} popupMatchSelectWidth={false}
                onChange={value => { void chooseApproval(value === 'automatic') }}
                labelRender={({ value }) => uiText(value === 'automatic' ? '自动审批' : '手动审批')}
                options={[
                  { value: 'manual', label: uiText('手动审批') },
                  { value: 'automatic', label: uiText('自动审批明确请求') },
                ]} />}
              <div className="canvas-assistant-send-actions">
                <Select className="canvas-assistant-model" variant="borderless" value={modelId ?? ''} aria-label={uiText("助手模型")} popupMatchSelectWidth={false} optionLabelProp="short"
                  disabled={draftPromoting || sending || savingModel || !turns || !!pendingQuestion} onChange={selected => { void chooseModel(selected) }}
                  options={[
                    { label: defaultModel ? uiText("默认模型") + ' · ' + modelLabel(defaultModel) : uiText("默认模型"),
                      short: defaultModel?.name ?? uiText("默认模型"), value: '' },
                    ...models.map(model => ({
                      label: modelLabel(model), short: model.name, value: model.id,
                      disabled: !model.effective_capabilities?.text_inputs || !model.effective_capabilities?.text_outputs,
                    })),
                  ]} />
                {showStop && runningId ? <WorkbenchIconButton className="canvas-assistant-primary"
                  label={uiText('停止回复')} title={uiText('停止回复')} tooltipOpen={false} icon={<StopOutlined />} variant="primary" loading={stopping === runningId}
                  onClick={() => { void stopTurn(runningId) }} />
                  : <WorkbenchIconButton className="canvas-assistant-primary"
                    label={sendLabel} title={sendLabel} tooltipOpen={false} icon={<ArrowUpOutlined />}
                    htmlType="submit" variant="primary"
                    disabled={!canSend} />}
              </div>
            </div>
          </>}
        </CanvasAssistantAttachments>
      </form>
    </aside>}
  </div>
}
