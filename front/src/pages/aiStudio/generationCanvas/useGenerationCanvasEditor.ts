import { createGraphRules } from './graphRules'
import { createCanvasOperations } from './canvasOperations'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { ApiError, StudioDirectingService as Directing, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCatalog, CanvasDiagnostic, CanvasDocument, CanvasRead, CanvasSave, StoryboardApplication, StoryboardCandidate } from '../../../services/generated'
import { cleanObjectSources } from './objectSourceCleanup'
import { useSceneEditOwnership } from '../directing/useSceneEditOwnership'

export type StoryboardScope = { chapterId: string; sequenceId: string; taskId: string }
type SceneChange = StoryboardScope & ({ action: 'apply'; choices: StoryboardApplication } | { action: 'undo' | 'redo' })
type PendingSave = CanvasSave & { scene?: SceneChange }
type HistoryEntry = { document: CanvasDocument; scene?: StoryboardScope } | { apply: () => void; reverse: () => void }
type HistorySide = 'past' | 'future'

type Recovery = { schema: 1; baseline: CanvasRead; document: CanvasDocument; pending?: PendingSave }
const validDocument = (value: CanvasDocument, projectId: string, canvasId: string) => value && value.id === canvasId && value.project_id === projectId && typeof value.name === 'string' && Array.isArray(value.cards) && value.cards.every(card => card && typeof card.id === 'string' && typeof card.type === 'string')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const preservesFixedSource = (server: CanvasDocument, draft: CanvasDocument) => {
  if (!same(server.fixed_source ?? null, draft.fixed_source ?? null) ||
      !same(server.archived_sources ?? [], draft.archived_sources ?? [])) return false
  return [server.fixed_source, ...(server.archived_sources ?? [])].every(source => !source ||
    same(server.cards?.find(card => card.id === source.card_id), draft.cards?.find(card => card.id === source.card_id)))
}
const initialStoryboardSave = (requestId: string) => requestId.startsWith('storyboard:')
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
export function useGenerationCanvasEditor(projectId: string, canvasId: string | null) {
  const key = `jellyfish:generation:${projectId}:${canvasId}:recovery`
  const ownership = useSceneEditOwnership(`jellyfish:generation-editor:${projectId}:${canvasId}`)
  const [current, setCurrent] = useState<CanvasRead>()
  const [document, setDocument] = useState<CanvasDocument>()
  const [saving, setSaving] = useState(false)
  const [initialApplying, setInitialApplying] = useState(false)
  const [error, setError] = useState('')
  const [failedDiagnostic, setFailedDiagnostic] = useState<{ scope: string; document: unknown; issue: CanvasDiagnostic }>()
  const [storageError, setStorageError] = useState('')
  const [recovery, setRecovery] = useState<Recovery>()
  const [conflict, setConflict] = useState(false)
  const state = useRef<{ scope: string; current?: CanvasRead; document?: CanvasDocument; pending?: PendingSave; blocked?: CanvasDocument; recovery?: Recovery; initialBefore?: CanvasDocument; historySide?: HistorySide; conflict: boolean }>({ scope: key, conflict: false })
  const cleaner = useRef<(value: CanvasDocument) => CanvasDocument>()
  const configureCatalog = useCallback((catalog: CanvasCatalog) => { cleaner.current = createCanvasOperations(createGraphRules(catalog)).clean }, [])
  const inFlight = useRef<Promise<boolean>>()
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
    setCurrent(undefined); setDocument(undefined); setError(''); setConflict(false); setRecovery(undefined); setSaving(false); setInitialApplying(false)
    if (canvasId) void Canvases.canvasGet({ projectId, canvasId }).then(response => {
      if (!active || !response.data) return
      const server = response.data
      state.current = { scope: key, current: server, document: server.document, conflict: false }
      setCurrent(server); setDocument(server.document)
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const saved = JSON.parse(raw) as Recovery
          if (saved.schema !== 1 || !saved.baseline || !Number.isInteger(saved.baseline.revision) || !validDocument(saved.baseline.document, projectId, canvasId) || !validDocument(saved.document, projectId, canvasId) || (saved.pending && (typeof saved.pending.request_id !== 'string' || !Number.isInteger(saved.pending.expected_revision) || !validDocument(saved.pending.document as CanvasDocument, projectId, canvasId)))) throw new Error('invalid recovery')
          state.current.recovery = saved; setRecovery(saved)
        }
      } catch { setStorageError('本地恢复记录无法读取；未覆盖服务器内容') }
    }).catch(reason => { if (active) setError(describe(reason)) })
    return () => { active = false }
  }, [key, projectId, canvasId])
  const edit = (next: CanvasDocument | ((previous: CanvasDocument) => CanvasDocument)) => {
    const s = state.current
    if (!ownership.canEdit() || !s.document || s.recovery || s.initialBefore || s.scope !== key) return
    const proposed = cleanObjectSources(typeof next === 'function' ? next(s.document) : next)
    const value = markStoryboardEdits(s.document, proposed)
    if (same(value, s.document)) return
    history.current = { scope: key, past: [...history.current.past.slice(-49), { document: s.document }], future: [] }
    s.document = value
    setDocument(s.document); persist()
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
    h[direction === 'past' ? 'future' : 'past'].push({ document: s.document })
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
      return response.data
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
      const staged = !!saved.pending && (initialStoryboardSave(saved.pending.request_id) || !!saved.pending.scene)
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
      const entry = { document: saved.baseline.document, scene: saved.pending?.scene }
      history.current = { scope: key, past: staged && !changed && saved.pending?.scene?.action !== 'undo' ? [entry] : [],
        future: staged && !changed && saved.pending?.scene?.action === 'undo' ? [entry] : [] }
      setCurrent(s.current); setDocument(s.document); setRecovery(undefined); persist()
    } catch (reason) {
      if (s === state.current) {
        if (reason instanceof ApiError && [400, 409, 422].includes(reason.status)) {
          saved.pending = undefined
          try { localStorage.setItem(key, JSON.stringify(saved)) } catch { setStorageError('本地恢复保护失败') }
        }
        setError(`恢复失败：${describe(reason)}`)
      }
    }
    finally { if (s === state.current) setSaving(false) }
  }
  const reload = async (keepLocal = false) => {
    const s = state.current
    if (s.pending || s.recovery?.pending) { setError('请先核实未明保存请求，再处理冲突或放弃内容'); return false }
    try {
      const response = await Canvases.canvasGet({ projectId, canvasId: canvasId! })
      if (!response.data || s !== state.current) return false
      if (keepLocal && s.document && !preservesFixedSource(response.data.document, s.document)) {
        setError('本地内容的固定原文与服务器不同，请先核对后使用服务器内容')
        return false
      }
      s.current = response.data; if (!keepLocal) { s.document = response.data.document; history.current = { scope: key, past: [], future: [] } }
      s.conflict = false; s.recovery = undefined
      setCurrent(s.current); setDocument(s.document); setRecovery(undefined); setConflict(false); setError(''); persist(); return true
    } catch (reason) { setError(describe(reason)); return false }
  }
  const latestActions = useRef({ reload, persist }); latestActions.current = { reload, persist }
  useEffect(() => {
    if (!ownership.editable) return
    const s = state.current
    if (s.current && !s.recovery && !s.pending && same(s.document, s.current.document)) void latestActions.current.reload()
  }, [ownership.editable])
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
  const prepareReview = async () => {
    const s = state.current
    if (!await save() || s !== state.current || !s.current || s.initialBefore) return undefined
    return s.current.revision
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
  const latest = useRef({ save, dirty, recovery, requestLeave }); latest.current = { save, dirty, recovery, requestLeave }
  useEffect(() => { const timer = window.setInterval(() => { if (latest.current.dirty && !latest.current.recovery && !same(state.current.blocked, state.current.document)) void latest.current.save() }, 1000); return () => clearInterval(timer) }, [key])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (latest.current.dirty || state.current.pending || state.current.recovery) { latestActions.current.persist(); event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave)
  }, [key])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.key !== nextLocation.key && (!!state.current.pending || !!state.current.recovery || (!!state.current.current && !same(state.current.document, state.current.current.document))))
  useEffect(() => { if (blocker.state === 'blocked') void latest.current.requestLeave().then(ok => { if (ok) blocker.proceed(); else blocker.reset() }) }, [blocker])
  const saveDiagnostic = failedDiagnostic?.scope === key && same(document, failedDiagnostic.document) ? failedDiagnostic.issue : undefined
  return { saveDiagnostic, configureCatalog, current, document, edit, recordAction, save, saving, initialApplying, applyInitialCandidate, applyReviewedCandidate, prepareReview, dirty, error, storageError, recovery, conflict, restore, reload, ownership, requestLeave,
    undo: () => travel('past'), redo: () => travel('future'), canUndo: history.current.scope === key && !!history.current.past.length, canRedo: history.current.scope === key && !!history.current.future.length }
}
