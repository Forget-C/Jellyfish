import { queueStoryboardRiskNotice } from '../directing/storyboardRiskNotice'
import { createGraphRules } from './graphRules'
import { createCanvasOperations } from './canvasOperations'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, StudioDirectingService as Directing, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCatalog, CanvasDiagnostic, CanvasDocument, CanvasRead, CanvasSave, StoryboardApplication, StoryboardCandidate } from '../../../services/generated'
import { cleanObjectSources } from './objectSourceCleanup'
import { generationCanvasEditScope, useSceneEditOwnership } from '../directing/useSceneEditOwnership'

export const canvasRecoveryKey = (projectId: string, canvasId: string | null) =>
  `jellyfish:generation:${projectId}:${canvasId}:recovery`

export type StoryboardScope = { chapterId: string; sequenceId: string; taskId: string }
type SceneChange = StoryboardScope & ({ action: 'apply'; choices: StoryboardApplication } | { action: 'undo' | 'redo' })
type PendingSave = CanvasSave & { scene?: SceneChange }
type StoryboardApplicationReceipt = { taskId: string; before: CanvasDocument }
export type StoryboardReviewPreparation = { revision: number; appliedTaskId?: string }
export type CanvasArrangementChange = { undo: () => void; redo: () => void }
type HistoryEntry = { document: CanvasDocument; scene?: StoryboardScope; arrangement?: CanvasArrangementChange } | { apply: () => void; reverse: () => void }
type HistorySide = 'past' | 'future'
// 仅同标签页的工作台应用交接，刷新自然清空；修订不符时丢弃。
const storyboardHandoffs = new Map<string, { revision: number; entry: HistoryEntry; receipt?: StoryboardApplicationReceipt }>()

type Recovery = { schema: 1; baseline: CanvasRead; document: CanvasDocument; pending?: PendingSave }
const validDocument = (value: CanvasDocument, projectId: string, canvasId: string) => value && value.id === canvasId && value.project_id === projectId && typeof value.name === 'string' && Array.isArray(value.cards) && value.cards.every(card => card && typeof card.id === 'string' && typeof card.type === 'string')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const preservesFixedSource = (server: CanvasDocument, draft: CanvasDocument) => {
  if (!same(server.fixed_source ?? null, draft.fixed_source ?? null) ||
      !same(server.archived_sources ?? [], draft.archived_sources ?? [])) return false
  return [server.fixed_source, ...(server.archived_sources ?? [])].every(source => !source ||
    same(server.cards?.find(card => card.id === source.card_id), draft.cards?.find(card => card.id === source.card_id)))
}
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
export function useGenerationCanvasEditor(projectId: string, canvasId: string | null, refreshOnOwnership = true) {
  const key = canvasRecoveryKey(projectId, canvasId)
  const ownership = useSceneEditOwnership(generationCanvasEditScope(projectId, canvasId))
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
  const state = useRef<{ scope: string; current?: CanvasRead; document?: CanvasDocument; pending?: PendingSave; blocked?: CanvasDocument; recovery?: Recovery; initialBefore?: CanvasDocument; historySide?: HistorySide; conflict: boolean }>({ scope: key, conflict: false })
  const cleaner = useRef<(value: CanvasDocument) => CanvasDocument>()
  const configureCatalog = useCallback((catalog: CanvasCatalog) => { cleaner.current = createCanvasOperations(createGraphRules(catalog)).clean }, [])
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
    } catch { setStorageError('浏览器存储不可用，本地恢复保护失败；请保存后再离开') }
  }
  useEffect(() => {
    let active = true
    state.current = { scope: key, conflict: false }; inFlight.current = undefined; cleaner.current = undefined
    history.current = { scope: key, past: [], future: [] }
    setStoryboardApplication(undefined)
    setCurrent(undefined); setDocument(undefined); setError(''); setConflict(false); setRecovery(undefined); setSaving(false); setInitialApplying(false)
    if (canvasId) void Canvases.canvasGet({ projectId, canvasId }).then(response => {
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
  }, [key, projectId, canvasId])
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
  const recordAction = (undo: () => void, redo: () => void) => {
    if (!ownership.canEdit() || state.current.scope !== key || state.current.recovery || state.current.initialBefore) return
    history.current = { scope: key, past: [...history.current.past.slice(-49), { apply: undo, reverse: redo }], future: [] }
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
        s.historySide = direction
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
    h[direction === 'past' ? 'future' : 'past'].push({ document: s.document, arrangement: next.arrangement })
    next.arrangement?.[direction === 'past' ? 'undo' : 'redo']()
    s.document = cleaner.current!(next.document); setDocument(s.document); persist(); return 'document' as const
  }
  const send = async (canvas: CanvasRead, command: PendingSave): Promise<CanvasRead> => {
    const scene = command.scene
    if (scene) {
      const scope = { projectId, chapterId: scene.chapterId, sequenceId: scene.sequenceId, taskId: scene.taskId }
      const response = scene.action === 'apply' ? await Directing.directingStoryboardApply({ ...scope, requestBody: scene.choices })
        : await Directing.directingStoryboardRestore({ ...scope, requestBody: { request_id: command.request_id,
          expected_revision: command.expected_revision, direction: scene.action, document: command.document as CanvasDocument } })
      if (response.data?.id !== canvas.id || response.data.revision !== command.expected_revision + 1) throw new Error('invalid scene receipt')
      if (scene.action === 'apply' && scene.choices?.accepted_conflict_ids?.length) {
        queueStoryboardRiskNotice(projectId, canvas.id, scene.taskId)
      }
      return { ...response.data, scene: response.data.scene ?? canvas.scene }
    }
    const result = await Canvases.canvasSave({ projectId, canvasId: canvas.id, requestBody: command })
    if (!result.data || result.data.request_id !== command.request_id || result.data.canvas_id !== canvas.id) throw new Error('invalid receipt')
    return { ...canvas, revision: result.data.revision, document: cleanObjectSources(command.document as CanvasDocument) }
  }
  const save = (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.recovery || s.conflict) return Promise.resolve(false)
    const run = async () => {
      setSaving(true); setError(''); setFailedDiagnostic(undefined)
      try {
        while (s === state.current && (s.pending || !same(s.document, s.current!.document))) {
          const command = s.pending || { request_id: crypto.randomUUID(), expected_revision: s.current!.revision, document: structuredClone(s.document!) }
          s.pending = command; persist()
          const committed = await send(s.current!, command)
          if (s !== state.current) return false
          if (s.initialBefore) {
            const applied = storyboardApplicationReceipt(command, s.initialBefore, committed.document)
            if (applied) setStoryboardApplication(applied)
            const entry = { document: s.initialBefore, scene: command.scene }
            if (s.historySide) {
              history.current[s.historySide].pop()
              history.current[s.historySide === 'past' ? 'future' : 'past'].push(entry)
            } else {
              history.current = { scope: key, past: [...history.current.past.slice(-49), entry], future: [] }
            }
            s.document = committed.document
            s.initialBefore = undefined; s.historySide = undefined
            setDocument(s.document); setInitialApplying(false)
          }
          s.current = committed; s.pending = undefined; s.blocked = undefined
          setCurrent(s.current); persist()
        }
        return true
      } catch (reason) {
        if (s !== state.current) return false
        const failedDocument = s.pending?.document
        if (reason instanceof ApiError && [400, 409, 422].includes(reason.status)) {
          s.pending = undefined
          if (s.initialBefore) {
            s.initialBefore = undefined; s.historySide = undefined; setInitialApplying(false)
          } else if (reason.status === 409) { s.conflict = true; setConflict(true) }
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
      let recovered = saved.document
      const staged = !!saved.pending && (renameSave(saved.pending.request_id) || initialStoryboardSave(saved.pending.request_id) || visualContinuitySave(saved.pending.request_id) || !!saved.pending.scene)
      if (saved.pending) {
        baseline = await send(baseline, saved.pending)
        if (staged) recovered = baseline.document
      }
      const response = await Canvases.canvasGet({ projectId, canvasId: baseline.id })
      if (!response.data || s !== state.current) return
      if (!staged && !preservesFixedSource(response.data.document, recovered)) {
        setError('本地内容的固定原文与服务器不同，请先核对后使用服务器内容')
        return
      }
      if (!cleaner.current) {
        const catalog = await Canvases.canvasCatalog({ projectId, canvasId: baseline.id })
        if (s !== state.current) return
        if (!catalog.data) throw new Error('empty catalog')
        configureCatalog(catalog.data)
      }
      const changed = response.data.revision !== baseline.revision || !same(cleaner.current!(response.data.document), cleaner.current!(baseline.document))
      if (changed && staged) recovered = response.data.document
      if (changed && !staged) {
        s.conflict = true; setConflict(true); setError('REVISION_CONFLICT: 服务器已有更新，本地恢复内容保留，请核对后选择')
      }
      s.current = response.data; s.document = cleaner.current!(recovered); s.pending = undefined; s.recovery = undefined
      if (!changed && saved.pending) {
        const applied = storyboardApplicationReceipt(saved.pending, saved.baseline.document, s.document)
        if (applied) setStoryboardApplication(applied)
      }
      const entry = { document: saved.baseline.document, scene: saved.pending?.scene }
      history.current = { scope: key, past: staged && !changed && saved.pending?.scene?.action !== 'undo' ? [entry] : [],
        future: staged && !changed && saved.pending?.scene?.action === 'undo' ? [entry] : [] }
      setCurrent(s.current); setDocument(s.document); setRecovery(undefined); persist()
      return true
    } catch (reason) {
      if (s === state.current) {
        if (reason instanceof ApiError && [400, 409, 422].includes(reason.status)) {
          if (renameSave(saved.pending?.request_id)) {
            s.recovery = undefined; setRecovery(undefined); persist()
          } else {
            saved.pending = undefined
            try { localStorage.setItem(key, JSON.stringify(saved)) } catch { setStorageError('本地恢复保护失败') }
          }
        }
        setError(`恢复失败：${describe(reason)}`)
      }
    }
    finally { if (s === state.current) setSaving(false) }
  }
  const reload = async (keepLocal = false, preserveHandoff = false) => {
    const s = state.current
    if (s.pending || s.recovery?.pending) { setError('请先核实未明保存请求，再处理冲突或放弃内容'); return false }
    try {
      const response = await Canvases.canvasGet({ projectId, canvasId: canvasId! })
      if (!response.data || s !== state.current) return false
      if (keepLocal && s.document && !preservesFixedSource(response.data.document, s.document)) {
        setError('本地内容的固定原文与服务器不同，请先核对后使用服务器内容')
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
      if (localStorage.getItem(key)) { setError('请在画布中处理未保存的内容，再更名。'); return undefined }
    } catch { setError('无法核对本地恢复内容，请检查浏览器存储后重试。'); return undefined }
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
  const commitVisualContinuity = (expectedRevision: number, requestId: string, transform: (before: CanvasDocument) => CanvasDocument) => {
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.scope !== key || s.recovery || s.conflict) return Promise.resolve(false)
    const id = `visual-continuity:${requestId}`
    if (s.pending?.request_id === id) return save()
    if (inFlight.current || s.pending || !same(s.document, s.current.document) || s.current.revision !== expectedRevision) return Promise.resolve(false)
    const next = markStoryboardEdits(s.document, cleanObjectSources(transform(s.document)))
    if (same(next, s.document)) return Promise.resolve(true)
    s.initialBefore = s.document
    s.pending = { request_id: id, expected_revision: expectedRevision, document: next }
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
  return { handoffStoryboardApplication, canUndoArrangement: !!lastChange && 'document' in lastChange && !!lastChange.arrangement, saveDiagnostic, configureCatalog, current, document, edit, recordAction, save, saving, initialApplying, storyboardApplication, applyInitialCandidate, applyReviewedCandidate, prepareReview, prepareCommittedEdit, commitVisualContinuity, dirty, error, storageError, recovery, conflict, restore, reload, ownership, requestLeave, needsLeaveProtection, renameSceneCanvas, pendingRename,
    undo: () => travel('past'), redo: () => travel('future'), canUndo: history.current.scope === key && !!history.current.past.length, canRedo: history.current.scope === key && !!history.current.future.length }
}
