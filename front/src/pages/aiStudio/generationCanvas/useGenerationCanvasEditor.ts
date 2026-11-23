import { useUiText } from '../../../uiText'
import { createGraphRules } from './graphRules'
import { createCanvasOperations } from './canvasOperations'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCatalog, CanvasDiagnostic, CanvasDocument, CanvasDraftSave, CanvasRead, CanvasSave, StoryboardApplication, StoryboardCandidate } from '../../../services/generated'
import { clearDraftAssistant, draftAssistantSnapshot, draftingAssistantReply } from './draftAssistant'
import { cleanObjectSources } from './objectSourceCleanup'
import { generationCanvasEditScope, useCanvasEditOwnership } from './useCanvasEditOwnership'

export const canvasRecoveryKey = (projectId: string, canvasId: string | null) =>
  `jellyfish:generation:${projectId}:${canvasId}:recovery`

export type StoryboardScope = { chapterId: string; sequenceId: string; taskId: string }
type SceneChange = StoryboardScope & ({ action: 'apply'; choices: StoryboardApplication } | { action: 'undo' | 'redo' })
export type PendingSave = CanvasSave & { scene?: SceneChange; assistantProposalId?: string; assistantDecisionId?: string; assistantGroupIds?: string[]; assistantAutomatic?: boolean; assistantApproveLayout?: boolean; draftAssistant?: CanvasDraftSave['assistant']; draftAssistantApproval?: CanvasDraftSave['assistant_approval'] }
type StoryboardApplicationReceipt = { taskId: string; before: CanvasDocument }
export type StoryboardReviewPreparation = { revision: number; appliedTaskId?: string }
export type CanvasSettingsChanges = Partial<Pick<CanvasDocument, 'name' | 'cover_file_id'>>
export type CanvasArrangementChange = { undo: () => void; redo: () => void }
type HistoryEntry = { document: CanvasDocument; scene?: StoryboardScope; arrangement?: CanvasArrangementChange; assistantKeys?: string[] } | { apply: () => void; reverse: () => void }
type HistorySide = 'past' | 'future'
// 仅同标签页的工作台应用交接，刷新自然清空；修订不符时丢弃。
const storyboardHandoffs = new Map<string, { revision: number; entry: HistoryEntry; receipt?: StoryboardApplicationReceipt }>()

type Recovery = { schema: 1; baseline: CanvasRead; document: CanvasDocument; pending?: PendingSave }
const validDocument = (value: CanvasDocument, projectId: string, canvasId: string) => value && value.id === canvasId && (value.project_id || '') === projectId && typeof value.name === 'string' && Array.isArray(value.cards) && value.cards.every(card => card && typeof card.id === 'string' && typeof card.type === 'string')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const preservesFixedSource = (server: CanvasDocument, draft: CanvasDocument) => {
  if (!same(server.fixed_source ?? null, draft.fixed_source ?? null) ||
      !same(server.archived_sources ?? [], draft.archived_sources ?? [])) return false
  return [server.fixed_source, ...(server.archived_sources ?? [])].every(source => !source ||
    same(server.cards?.find(card => card.id === source.card_id), draft.cards?.find(card => card.id === source.card_id)))
}
const settingsSave = (requestId?: string) => requestId?.startsWith('settings:') === true
const rejectedSave = (reason: unknown, settings = false): reason is ApiError => reason instanceof ApiError &&
  ([400, 409, 422].includes(reason.status) || (settings && reason.status === 404))
const renameSave = (requestId?: string) => requestId?.startsWith('rename:') === true
const visualContinuitySave = (requestId?: string) => requestId?.startsWith('visual-continuity:') === true
const initialStoryboardSave = (requestId: string) => requestId.startsWith('storyboard:')
/** 仅已核实的分镜应用回执可为布局提供应用前文档。 */
const storyboardApplicationReceipt = (command: PendingSave, before: CanvasDocument, after: CanvasDocument): StoryboardApplicationReceipt | undefined => {
  const taskId = after.storyboard?.task_id
  if (!taskId || before.storyboard?.task_id === taskId) return
  if (command.scene ? command.scene.action === 'apply' && command.scene.taskId === taskId : command.request_id === `storyboard:${taskId}`) {
    return { taskId, before }
  }
}
const markStoryboardEdits = (before: CanvasDocument, next: CanvasDocument): CanvasDocument => {
  if (!next.storyboard || before.storyboard?.task_id !== next.storyboard.task_id) return next
  const old = new Map(before.cards?.map(card => [card.id, card]))
  const origins = { ...next.storyboard.origins }
  for (const card of next.cards || []) {
    if (origins[card.id] && old.has(card.id) && !same(card, old.get(card.id))) {
      origins[card.id] = { ...origins[card.id], manually_edited: true }
    }
  }
  return { ...next, storyboard: { ...next.storyboard, origins } }
}
const describe = (reason: unknown) => reason instanceof ApiError
  ? `${reason.body?.data?.code || reason.status}: ${reason.body?.data?.message || reason.body?.message || '保存失败，请重试'}` : '请求结果未知，请重试核实原请求'

/** 文档快照串行保存；原回执只推进基线，绝不替换仍在编辑的正文。 */
export function useGenerationCanvasEditor(projectId: string, canvasId: string | null, refreshOnOwnership = true, sceneSave?: (projectId: string, canvas: CanvasRead, command: PendingSave) => Promise<CanvasRead>, freeDraft = false) {
  const uiText = useUiText()
  const key = canvasRecoveryKey(projectId, canvasId)
  const ownership = useCanvasEditOwnership(generationCanvasEditScope(projectId, canvasId))
  const [current, setCurrent] = useState<CanvasRead>()
  const [document, setDocument] = useState<CanvasDocument>()
  const [saving, setSaving] = useState(false)
  const [initialApplying, setInitialApplying] = useState(false)
  const [storyboardApplication, setStoryboardApplication] = useState<StoryboardApplicationReceipt>()
  const [error, setError] = useState('')
  const [failedDiagnostic, setFailedDiagnostic] = useState<{ scope: string; document: unknown; issue: CanvasDiagnostic }>()
  const [storageError, setStorageError] = useState('')
  const [recovery, setRecovery] = useState<Recovery>()
  const [conflict, setConflict] = useState(false)
  const [settingsDraft, setSettingsDraft] = useState<CanvasSettingsChanges>()
  const state = useRef<{ scope: string; current?: CanvasRead; document?: CanvasDocument; pending?: PendingSave; blocked?: CanvasDocument; recovery?: Recovery; initialBefore?: CanvasDocument; conflict: boolean }>({ scope: key, conflict: false })
  const cleaner = useRef<(value: CanvasDocument) => CanvasDocument>()
  const configureCatalog = useCallback((catalog: CanvasCatalog) => {
    const clean = createCanvasOperations(createGraphRules(catalog)).clean
    const allowed = new Set(catalog.cards.map(card => card.type))
    cleaner.current = value => {
      if (value.cards?.some(card => !allowed.has(card.type || ''))) throw new Error(uiText("本地文档包含当前画布不支持的卡片"))
      return clean(value)
    }
  }, [uiText])
  const inFlight = useRef<Promise<boolean>>()
  const handoffHistory = useRef(false)
  const history = useRef<{ scope: string; past: HistoryEntry[]; future: HistoryEntry[] }>({ scope: key, past: [], future: [] })
  const dirty = !!document && !!current && !same(document, current.document)
  const persist = () => {
    const s = state.current
    if (s.scope !== key || !s.current || !s.document || !ownership.canEdit()) return
    try {
      if (same(s.document, s.current.document) && !s.pending) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify({ schema: 1, baseline: s.current, document: s.document, pending: s.pending }))
      setStorageError('')
    } catch { setStorageError(uiText("浏览器存储不可用，本地恢复保护失败；请保存后再离开")) }
  }
  const readCanvas = useCallback((id: string, allowDraft: boolean) => freeDraft && allowDraft
    ? Canvases.canvasDraftRead({ canvasId: id })
    : Canvases.canvasGet({ projectId, canvasId: id }), [freeDraft, projectId])
  useEffect(() => {
    let active = true
    state.current = { scope: key, conflict: false }; inFlight.current = undefined; cleaner.current = undefined
    history.current = { scope: key, past: [], future: [] }
    setStoryboardApplication(undefined)
    setSettingsDraft(undefined)
    setCurrent(undefined); setDocument(undefined); setError(''); setConflict(false); setRecovery(undefined); setSaving(false); setInitialApplying(false)
    if (canvasId) void readCanvas(canvasId, true).then(response => {
      if (!active || !response.data) return
      const server = response.data
      state.current = { scope: key, current: server, document: server.document, conflict: false }
      const handoff = storyboardHandoffs.get(key)
      storyboardHandoffs.delete(key)
      if (handoff?.revision === server.revision) {
        history.current.past = [handoff.entry]
        handoffHistory.current = true
        setStoryboardApplication(handoff.receipt)
      }
      setCurrent(server); setDocument(server.document)
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const saved = JSON.parse(raw) as Recovery
          if (saved.schema !== 1 || !saved.baseline || !Number.isInteger(saved.baseline.revision) || !validDocument(saved.baseline.document, projectId, canvasId) || !validDocument(saved.document, projectId, canvasId) || (saved.pending && (typeof saved.pending.request_id !== 'string' || !Number.isInteger(saved.pending.expected_revision) || !validDocument(saved.pending.document as CanvasDocument, projectId, canvasId)))) throw new Error('invalid recovery')
          state.current.recovery = saved; setRecovery(saved)
        }
      } catch { setStorageError('本地恢复记录无法读取；未覆盖服务器内容') }
    }).catch(reason => { if (active) setError(reason instanceof ApiError && reason.status === 404 ? '此画布已不可用' : describe(reason)) })
    return () => { active = false }
  }, [uiText, key, projectId, canvasId, readCanvas])
  const edit = (next: CanvasDocument | ((previous: CanvasDocument) => CanvasDocument), arrangement?: CanvasArrangementChange) => {
    const s = state.current
    if (!ownership.canEdit() || !s.document || s.recovery || s.initialBefore || s.scope !== key) return
    const proposed = cleanObjectSources(typeof next === 'function' ? next(s.document) : next)
    const value = markStoryboardEdits(s.document, proposed)
    if (same(value, s.document)) return
    history.current = { scope: key, past: [...history.current.past.slice(-49), { document: s.document, arrangement }], future: [] }
    s.document = value
    arrangement?.redo(); setDocument(s.document); persist()
  }
  const [, refreshHistory] = useState(0)
  const [undoLabels, setUndoLabels] = useState<{ key: string; ids: string[] }>()
  // 普通保存保留会话历史，刷新恢复先清空历史，再按同一条命令重建一步。
  const recordConfirmedSave = (command: PendingSave, before: CanvasDocument, after: CanvasDocument, appliedGroups?: string[]) => {
    const applied = storyboardApplicationReceipt(command, before, after)
    if (applied) setStoryboardApplication(applied)
    const source = command.assistantProposalId ?? command.draftAssistantApproval?.source_id
    const ids = appliedGroups ?? command.draftAssistantApproval?.group_ids ?? ['']
    const assistantKeys = source ? ids.map(id => source + ':' + id) : undefined
    const entry = { document: before, scene: command.scene, assistantKeys }
    const action = command.scene?.action
    if (action === 'undo' || action === 'redo') {
      const from = action === 'undo' ? 'past' : 'future'
      const to = action === 'undo' ? 'future' : 'past'
      history.current[from].pop()
      history.current[to].push(entry)
    } else {
      history.current = { scope: key, past: [...history.current.past.slice(-49), entry], future: [] }
    }
  }
  const recordAction = (undo: () => void, redo: () => void, documentBefore?: CanvasDocument) => {
    if (!ownership.canEdit() || state.current.scope !== key || state.current.recovery || state.current.initialBefore) return
    const past = history.current.past
    const last = past[past.length - 1]
    if (documentBefore && last && 'document' in last && same(last.document, documentBefore)) {
      last.arrangement = { undo, redo }
    } else {
      history.current = { scope: key, past: [...history.current.past.slice(-49), { apply: undo, reverse: redo }], future: [] }
    }
    refreshHistory(value => value + 1)
  }
  // 文档和布局按操作顺序撤销；场次整批切换在收到服务端回执后入栈。
  const travel = (direction: HistorySide) => {
    const s = state.current, h = history.current
    if (!ownership.canEdit() || !s.document || s.recovery || s.initialBefore || s.scope !== key || h.scope !== key || !cleaner.current) return
    const next = h[direction][h[direction].length - 1]
    if (!next) return
    if ('document' in next && next.scene) {
      const scene = next.scene
      const restoreScene = async () => {
        if (!await save() || s !== state.current || h[direction][h[direction].length - 1] !== next || !s.current || !s.document ||
            !same(s.document, s.current.document) || s.pending || !ownership.canEdit()) return
        s.initialBefore = s.document
        s.pending = { request_id: crypto.randomUUID(), expected_revision: s.current.revision, document: next.document,
          scene: { ...scene, action: direction === 'past' ? 'undo' : 'redo' } }
        setInitialApplying(true); persist()
        await save()
      }
      void restoreScene()
      return 'document' as const
    }
    h[direction].pop()
    if ('apply' in next) {
      h[direction === 'past' ? 'future' : 'past'].push({ apply: next.reverse, reverse: next.apply })
      next.apply(); refreshHistory(value => value + 1); return 'layout' as const
    }
    h[direction === 'past' ? 'future' : 'past'].push({
      document: s.document, arrangement: next.arrangement, assistantKeys: next.assistantKeys,
    })
    const assistantKeys = next.assistantKeys
    if (assistantKeys?.length) setUndoLabels(previous => {
      const ids = previous?.key === key ? previous.ids : []
      return { key, ids: direction === 'past' ? [...new Set([...ids, ...assistantKeys])] :
        ids.filter(id => !assistantKeys.includes(id)) }
    })
    next.arrangement?.[direction === 'past' ? 'undo' : 'redo']()
    s.document = cleaner.current!(next.document); setDocument(s.document); persist(); return 'document' as const
  }
  const send = async (canvas: CanvasRead, command: PendingSave): Promise<CanvasRead & { assistantReceiptRevision?: number; assistantAppliedGroups?: string[] }> => {
    if (command.assistantProposalId) {
      const { data } = await Canvases.canvasAssistantDecideProposal({
        projectId, canvasId: canvas.id, sourceId: command.assistantProposalId,
        requestBody: { action: 'approve', decision_id: command.assistantDecisionId, expected_revision: command.expected_revision, group_ids: command.assistantGroupIds,
          approval_mode: command.assistantAutomatic ? 'automatic' : 'manual', approve_layout: command.assistantApproveLayout },
      })
      const manualReview = data?.automatic_review?.status === 'manual_required' ||
        data?.automatic_review?.status === 'unavailable'
      if (!data?.canvas || (data.receipt ? data.receipt.canvas_id !== canvas.id : !data.conflicts?.length && !manualReview)) {
        throw new Error('invalid assistant edit receipt')
      }
      return { ...data.canvas, assistantReceiptRevision: data.receipt?.revision,
        assistantAppliedGroups: data.proposal.groups?.filter(group => group.state === 'applied' &&
          command.assistantGroupIds?.includes(group.id)).map(group => group.id) }
    }
    const scene = command.scene
    if (scene) {
      if (!sceneSave) throw new Error(uiText("当前画布不支持场次操作"))
      return sceneSave(projectId, canvas, command)
    }
    if (canvas.revision === -1) {
      const { data } = await Canvases.canvasDraftSave({ canvasId: canvas.id, requestBody: {
        request_id: command.request_id, expected_revision: 0, document: command.document,
        assistant: command.draftAssistant, assistant_approval: command.draftAssistantApproval,
      } })
      if (!data || data.request_id !== command.request_id || data.canvas_id !== canvas.id) throw new Error('invalid draft receipt')
      clearDraftAssistant(canvas.id)
      return { ...canvas, revision: data.revision, document: cleanObjectSources(data.document ?? command.document as CanvasDocument) }
    }
    const { data } = await Canvases.canvasSave({ projectId, canvasId: canvas.id, requestBody: command })
    if (!data || data.request_id !== command.request_id || data.canvas_id !== canvas.id) throw new Error('invalid receipt')
    return { ...canvas, revision: data.revision, document: cleanObjectSources(command.document as CanvasDocument) }
  }
  const save = (explicit = false): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.recovery || s.conflict) return Promise.resolve(false)
    if (s.current.revision === -1) {
      if (draftingAssistantReply.has(s.current.id)) {
        if (explicit) setError(uiText("请等待助手回复后再保存画布"))
        return Promise.resolve(false)
      }
      const conversation = draftAssistantSnapshot(s.current.id)
      if (explicit && !s.pending && conversation?.turns?.length) {
        s.pending = { request_id: crypto.randomUUID(), expected_revision: -1, document: structuredClone(s.document) }
      }
      if (s.pending && !('draftAssistant' in s.pending)) s.pending.draftAssistant = conversation ?? null
    }
    const run = async () => {
      setSaving(true); setError(''); setFailedDiagnostic(undefined)
      try {
        while (s === state.current && (s.pending || !same(s.document, s.current!.document))) {
          const command = s.pending || { request_id: crypto.randomUUID(), expected_revision: s.current!.revision, document: structuredClone(s.document!) }
          if (s.current!.revision === -1 && !s.pending) command.draftAssistant = draftAssistantSnapshot(s.current!.id) ?? null
          s.pending = command; persist()
          const committed = await send(s.current!, command)
          if (s !== state.current) return false
          if (s.initialBefore) {
            if (!command.assistantProposalId || committed.revision === committed.assistantReceiptRevision && committed.revision === command.expected_revision + 1) {
              recordConfirmedSave(command, s.initialBefore, committed.document, committed.assistantAppliedGroups)
            } else if (committed.revision !== s.current?.revision) {
              // An approval replay can return a newer canvas after other edits.
              history.current = { scope: key, past: [], future: [] }
            }
            s.document = committed.document
            s.initialBefore = undefined
            setDocument(s.document); setInitialApplying(false)
          }
          s.current = committed; s.pending = undefined; s.blocked = undefined
          setCurrent(s.current); persist()
        }
        return true
      } catch (reason) {
        if (s !== state.current) return false
        const failedDocument = s.pending?.document
        const settings = settingsSave(s.pending?.request_id)
        if (rejectedSave(reason, settings)) {
          const staged = !!s.initialBefore
          s.pending = undefined
          if (staged) {
            s.initialBefore = undefined; setInitialApplying(false)
          }
          if (reason.status === 409 && (!staged || settings)) { s.conflict = true; setConflict(true) }
        }
        // 暂停相同失败正文；未知结果保留原请求，手动保存可随时核实。
        s.blocked = structuredClone(s.pending ? s.document : failedDocument as CanvasDocument)
        const issue = reason instanceof ApiError && reason.status === 422 ? reason.body?.data : undefined
        if (failedDocument && issue && typeof issue.target?.card_id === 'string' && typeof issue.code === 'string' && typeof issue.message === 'string' && Array.isArray(issue.blocks)) {
          setFailedDiagnostic({ scope: key, document: failedDocument, issue })
        }
        setError(describe(reason)); persist(); return false
      } finally { if (s === state.current) { setSaving(false); inFlight.current = undefined } }
    }
    inFlight.current = Promise.resolve().then(run); return inFlight.current
  }
  const restore = async () => {
    const s = state.current, saved = s.recovery
    if (!saved || !ownership.canEdit()) return
    setSaving(true)
    try {
      // 先重放未明请求取得原回执，再读取最新服务端；恢复不产生新的保存意图。
      let baseline = saved.baseline
      let assistantReceiptRevision: number | undefined
      let recovered = saved.document
      const command = saved.pending
      let staged = !!command && (!!command.draftAssistantApproval || renameSave(command.request_id) || settingsSave(command.request_id) || initialStoryboardSave(command.request_id) || visualContinuitySave(command.request_id) || !!command.scene || !!command.assistantProposalId)
      let recoveredSettings: CanvasSettingsChanges | undefined
      if (command) {
        try {
          const committed = await send(baseline, command)
          assistantReceiptRevision = committed.assistantReceiptRevision
          baseline = committed
          if (staged) recovered = baseline.document
        } catch (reason) {
          if (!settingsSave(command.request_id) || !rejectedSave(reason, true)) throw reason
          const draft = command.document as CanvasDocument
          recoveredSettings = {}
          if (draft.name !== saved.document.name) recoveredSettings.name = draft.name
          if ((draft.cover_file_id ?? null) !== (saved.document.cover_file_id ?? null)) {
            recoveredSettings.cover_file_id = draft.cover_file_id ?? null
          }
          staged = false
        }
      }
      const response = await readCanvas(baseline.id, baseline.revision === -1)
      if (!response.data || s !== state.current) return
      if (!staged && !preservesFixedSource(response.data.document, recovered)) {
        setError(uiText("本地内容的固定原文与服务器不同，请先核对后使用服务器内容"))
        return
      }
      if (!cleaner.current) {
        const catalog = await (baseline.revision === -1 ? Canvases.freeCanvasCatalog() : Canvases.canvasCatalog({ projectId, canvasId: baseline.id }))
        if (s !== state.current) return
        if (!catalog.data) throw new Error('empty catalog')
        configureCatalog(catalog.data)
      }
      // 首次写入回执确认该修订属于原请求，以服务端补全默认字段后的文档为基线。
      if (saved.baseline.revision === -1 && command && baseline.revision === response.data.revision && baseline.revision >= 0) {
        if (staged || same(recovered, command.document)) recovered = response.data.document
        baseline = response.data
      }
      const changed = response.data.revision !== baseline.revision || !same(cleaner.current!(response.data.document), cleaner.current!(baseline.document))
      const settingsOnly = recoveredSettings && same(cleaner.current!(saved.document), cleaner.current!(saved.baseline.document))
      if (changed && (staged || settingsOnly)) recovered = response.data.document
      if (changed && !staged && !settingsOnly) {
        s.conflict = true; setConflict(true); setError(uiText("REVISION_CONFLICT: 服务器已有更新，本地恢复内容保留，请核对后选择"))
      }
      s.current = response.data; s.document = cleaner.current!(recovered); s.pending = undefined; s.recovery = undefined
      history.current = { scope: key, past: [], future: [] }
      if (!changed && staged && saved.pending && (!saved.pending.assistantProposalId ||
        assistantReceiptRevision === saved.baseline.revision + 1 && response.data.revision === assistantReceiptRevision)) {
        recordConfirmedSave(saved.pending, saved.baseline.document, s.document)
      }
      setSettingsDraft(recoveredSettings)
      setCurrent(s.current); setDocument(s.document); setRecovery(undefined); persist()
      return true
    } catch (reason) {
      if (s === state.current) {
        if (settingsSave(saved.pending?.request_id) && reason instanceof ApiError && reason.status === 404) {
          s.recovery = undefined; setRecovery(undefined); persist()
          s.current = undefined; s.document = undefined
          setCurrent(undefined); setDocument(undefined); setError(uiText("此画布已不可用"))
          return false
        }
        if (reason instanceof ApiError && [400, 409, 422].includes(reason.status)) {
          if (renameSave(saved.pending?.request_id)) {
            s.recovery = undefined; setRecovery(undefined); persist()
          } else {
            saved.pending = undefined
            try { localStorage.setItem(key, JSON.stringify(saved)) } catch { setStorageError(uiText("本地恢复保护失败")) }
          }
        }
        setError(uiText("恢复失败：{{value1}}", { value1: describe(reason) }))
      }
    }
    finally { if (s === state.current) setSaving(false) }
  }
  const reload = async (keepLocal = false, preserveHandoff = false) => {
    const s = state.current
    if (s.pending || s.recovery?.pending) { setError(uiText("请先核实未明保存请求，再处理冲突或放弃内容")); return false }
    try {
      const snapshot = s.document
      const response = await readCanvas(canvasId!, s.current?.revision === -1)
      if (!response.data || s !== state.current) return false
      // 取得编辑权后的读取可能晚于首次输入或保存回执。
      if (s.document !== snapshot || s.pending) return false
      keepLocal = keepLocal && !same(s.document, s.current?.document)
      if (keepLocal && s.document && !preservesFixedSource(response.data.document, s.document)) {
        setError(uiText("本地内容的固定原文与服务器不同，请先核对后使用服务器内容"))
        return false
      }
      const unchanged = s.current?.revision === response.data.revision
      s.current = response.data; if (!keepLocal) { s.document = response.data.document; if (!preserveHandoff || !unchanged) history.current = { scope: key, past: [], future: [] } }
      s.conflict = false; s.recovery = undefined
      setCurrent(s.current); setDocument(s.document); setRecovery(undefined); setConflict(false); setError(''); persist(); return true
    } catch (reason) { setError(describe(reason)); return false }
  }
  const latestActions = useRef({ reload, persist }); latestActions.current = { reload, persist }
  useEffect(() => {
    if (!ownership.editable || !refreshOnOwnership) return
    const s = state.current
    if (s.current && !s.recovery && !s.pending && same(s.document, s.current.document)) void latestActions.current.reload(false, handoffHistory.current).finally(() => { handoffHistory.current = false })
  }, [ownership.editable, refreshOnOwnership])
  const applyInitialCandidate = async (candidate: StoryboardCandidate): Promise<'applied' | 'pending'> => {
    const s = state.current
    const next = candidate.document, taskId = next.storyboard?.task_id
    if (!taskId || !ownership.canEdit() || !s.current || !s.document || s.scope !== key || s.pending || s.recovery ||
      s.conflict || inFlight.current || s.current.id !== next.id || s.current.revision !== candidate.base_revision ||
      !same(s.document, s.current.document) || !preservesFixedSource(s.current.document, next)) return 'pending'
    // Stage only the command: the previous document remains visible until CAS is confirmed.
    s.initialBefore = s.document
    s.pending = { request_id: `storyboard:${taskId}`, expected_revision: candidate.base_revision, document: next }
    setInitialApplying(true); persist()
    const applied = await save()
    if (!applied && s === state.current && !s.pending) await reload()
    return applied ? 'applied' : 'pending'
  }
  // 名称只作为同一保存链上的已确认命令暂存，失败时不把旧文档当作新草稿。
  const renameSceneCanvas = async (name: string, scene: { chapterId: string; sequenceId: string }) => {
    const s = state.current
    const belongsToScene = () => s.current?.scene?.chapter_id === scene.chapterId && s.current.scene.sequence_id === scene.sequenceId
    if (!ownership.canEdit() || !belongsToScene() || s.scope !== key || inFlight.current) return undefined
    if (s.recovery || s.pending) {
      const original = s.pending ?? s.recovery?.pending
      if (!renameSave(original?.request_id)) return undefined
      const saved = s.recovery ? await restore() : await save()
      return saved ? s.current?.document.name : undefined
    }
    try {
      // 另一页可能在本弹窗打开后才留下恢复内容，取得锁后再核对一次。
      if (localStorage.getItem(key)) { setError(uiText("请在画布中处理未保存的内容，再更名。")); return undefined }
    } catch { setError(uiText("无法核对本地恢复内容，请检查浏览器存储后重试。")); return undefined }
    if (!await reload() || s !== state.current || !s.current || !s.document || !belongsToScene() || !ownership.canEdit()) return undefined
    if (s.current.document.name === name) return name
    s.initialBefore = s.document
    s.pending = { request_id: `rename:${crypto.randomUUID()}`, expected_revision: s.current.revision,
      document: { ...s.current.document, name } }
    setInitialApplying(true); persist()
    return await save() ? s.current.document.name : undefined
  }
  const pendingCommand = state.current.pending ?? recovery?.pending
  const pendingRename = renameSave(pendingCommand?.request_id) ? (pendingCommand?.document as CanvasDocument).name : undefined
  // 设置随最新本地文档保存，只有收到回执才更新可见名称和封面。
  const commitSettings = async (changes: CanvasSettingsChanges) => {
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.current.scene || s.scope !== key || s.recovery || s.conflict) return false
    if (settingsSave(s.pending?.request_id)) return save()
    if ((inFlight.current || s.pending) && !await save()) return false
    if (s !== state.current || !s.current || !s.document || !ownership.canEdit() || s.initialBefore || s.recovery || s.conflict) return false
    const next = { ...s.document, ...changes }
    if (same(next, s.document)) return true
    s.initialBefore = s.document
    s.pending = { request_id: `settings:${crypto.randomUUID()}`, expected_revision: s.current.revision, document: next }
    setInitialApplying(true); persist()
    return save()
  }
  const pendingSettings = settingsSave(pendingCommand?.request_id)
  const prepareReview = async (): Promise<StoryboardReviewPreparation | undefined> => {
    const s = state.current
    if (!await save() || s !== state.current || !s.current || s.initialBefore) return undefined
    return { revision: s.current.revision, appliedTaskId: s.current.document.storyboard?.continuity_check_task_id
      ?? s.current.document.storyboard?.task_id }
  }
  const applyReviewedCandidate = (scene: StoryboardScope, choices: StoryboardApplication) => {
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.scope !== key || s.recovery ||
        s.conflict || s.current.revision !== choices.expected_revision) return Promise.resolve(false)
    if (s.pending?.scene?.action === 'apply' && s.pending.scene.taskId === scene.taskId) return save()
    if (inFlight.current || s.pending || !same(s.document, s.current.document)) return Promise.resolve(false)
    s.initialBefore = s.document
    s.pending = { request_id: `storyboard:${scene.taskId}`, expected_revision: choices.expected_revision, document: s.document,
      scene: { ...scene, action: 'apply', choices } }
    setInitialApplying(true); persist()
    return save()
  }
  const prepareCommittedEdit = async () => {
    const s = state.current
    if (!await save() || s !== state.current || !s.current || s.initialBefore) return undefined
    return s.current
  }
  // 和场次应用使用同一回执及撤销链，已确认前保持原文档可见。
  const commitTransformedDocument = (expectedRevision: number, id: string, transform: (before: CanvasDocument) => CanvasDocument) => {
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.scope !== key || s.recovery || s.conflict) return Promise.resolve(false)
    if (s.pending?.request_id === id) return save()
    if (inFlight.current || s.pending || !same(s.document, s.current.document) || s.current.revision !== expectedRevision) return Promise.resolve(false)
    const next = markStoryboardEdits(s.document, cleanObjectSources(transform(s.document)))
    if (same(next, s.document)) return Promise.resolve(true)
    s.initialBefore = s.document
    s.pending = { request_id: id, expected_revision: expectedRevision, document: next }
    setInitialApplying(true); persist()
    return save()
  }
  const commitVisualContinuity = (revision: number, requestId: string, transform: (before: CanvasDocument) => CanvasDocument) =>
    commitTransformedDocument(revision, `visual-continuity:${requestId}`, transform)
  const commitAssistantLayoutGroup = (revision: number, group: NonNullable<CanvasDocument['groups']>[number]) =>
    commitTransformedDocument(revision, `assistant-layout:${group.id}`, before => ({ ...before, groups: [...(before.groups || []), group] }))
  const commitAssistantProposal = async (sourceId: string, groupIds?: string[], automatic?: boolean, approveLayout?: boolean) => {
    const s = state.current
    if (s.pending?.assistantProposalId === sourceId) {
      return same(s.pending.assistantGroupIds, groupIds) && !!s.pending.assistantApproveLayout === !!approveLayout ? save() : false
    }
    if (s.pending?.draftAssistantApproval?.source_id === sourceId) {
      return same(s.pending.draftAssistantApproval?.group_ids, groupIds) ? save() : false
    }
    const before = await prepareCommittedEdit()
    if (!before || s !== state.current || !s.document || !ownership.canEdit() || s.pending || s.recovery ||
      s.conflict || s.scope !== key || inFlight.current || !same(s.document, before.document)) return false
    s.initialBefore = s.document
    if (before.revision === -1) {
      if (!groupIds?.length || automatic || approveLayout) { s.initialBefore = undefined; return false }
      s.pending = { request_id: crypto.randomUUID(), expected_revision: -1, document: s.document,
        draftAssistant: draftAssistantSnapshot(before.id), draftAssistantApproval: { source_id: sourceId, group_ids: groupIds } }
    } else s.pending = { request_id: crypto.randomUUID(), expected_revision: before.revision, document: s.document,
      assistantProposalId: sourceId, assistantDecisionId: crypto.randomUUID(), assistantGroupIds: groupIds, assistantAutomatic: automatic, assistantApproveLayout: approveLayout }
    setInitialApplying(true); persist()
    return save()
  }
  const requestLeave = async () => {
    const s = state.current
    if (s.recovery) return false
    if (s.pending || (s.document && s.current && !same(s.document, s.current.document))) return save()
    return !s.recovery
  }
  ownership.handoff.current = async action => {
    if (action === 'cancel') return 'failed'
    if (action === 'save') return await save() ? 'ready' : 'failed'
    if (action === 'discard') return await reload() ? 'ready' : 'failed'
    const s = state.current
    return s.pending || s.recovery || (s.current && !same(s.document, s.current.document)) ? 'choice' : 'ready'
  }
  const latest = useRef({ save, dirty }); latest.current = { save, dirty }
  useEffect(() => { const timer = window.setInterval(() => { if (latest.current.dirty && !state.current.recovery && !same(state.current.blocked, state.current.document)) void latest.current.save() }, 1000); return () => clearInterval(timer) }, [key])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (latest.current.dirty || state.current.pending || state.current.recovery) { latestActions.current.persist(); event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave)
  }, [key])
  const needsLeaveProtection = () => {
    const s = state.current
    return !!(s.pending || s.recovery || s.current && !same(s.document, s.current.document))
  }
  const saveDiagnostic = failedDiagnostic?.scope === key && same(document, failedDiagnostic.document) ? failedDiagnostic.issue : undefined
  const handoffStoryboardApplication = () => {
    const s = state.current
    const entry = history.current.past[history.current.past.length - 1]
    if (s.current && entry && 'document' in entry && entry.scene && !s.pending && !s.recovery) {
      storyboardHandoffs.set(key, { revision: s.current.revision, entry,
        receipt: { taskId: entry.scene.taskId, before: entry.document } })
    }
  }
  const past = history.current.past
  const lastChange = history.current.scope === key ? past[past.length - 1] : undefined
  return { assistantUndone: undoLabels?.key === key ? undoLabels.ids : [], handoffStoryboardApplication, canUndoArrangement: !!lastChange && 'document' in lastChange && !!lastChange.arrangement, saveDiagnostic, configureCatalog, current, document, edit, recordAction, save, saving, initialApplying, storyboardApplication, applyInitialCandidate, applyReviewedCandidate, prepareReview, prepareCommittedEdit, commitVisualContinuity, commitAssistantLayoutGroup, commitAssistantProposal, dirty, error: error === '此画布已不可用' ? uiText(error) : error, storageError: storageError === '本地恢复记录无法读取；未覆盖服务器内容' ? uiText(storageError) : storageError, recovery, conflict, restore, reload, ownership, requestLeave, needsLeaveProtection, renameSceneCanvas, pendingRename, commitSettings, pendingSettings, settingsDraft, clearSettingsDraft: () => setSettingsDraft(undefined),
    undo: () => travel('past'), redo: () => travel('future'), canUndo: history.current.scope === key && !!history.current.past.length, canRedo: history.current.scope === key && !!history.current.future.length }
}
