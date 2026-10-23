import { useEffect, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasDocument, CanvasRead, CanvasSave } from '../../../services/generated'
import { useSceneEditOwnership } from '../directing/useSceneEditOwnership'

type Recovery = { schema: 1; baseline: CanvasRead; document: CanvasDocument; pending?: CanvasSave }
const validDocument = (value: CanvasDocument, projectId: string, canvasId: string) => value && value.id === canvasId && value.project_id === projectId && typeof value.name === 'string' && Array.isArray(value.cards) && value.cards.every(card => card && typeof card.id === 'string' && typeof card.type === 'string')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const describe = (reason: unknown) => reason instanceof ApiError
  ? `${reason.body?.detail?.code || reason.status}: ${reason.body?.detail?.message || '保存失败，请重试'}` : '请求结果未知，请重试核实原请求'

/** 文档快照串行保存；原回执只推进基线，绝不替换仍在编辑的正文。 */
export function useGenerationCanvasEditor(projectId: string, canvasId: string | null) {
  const key = `jellyfish:generation:${projectId}:${canvasId}:recovery`
  const ownership = useSceneEditOwnership(`jellyfish:generation-editor:${projectId}:${canvasId}`)
  const [current, setCurrent] = useState<CanvasRead>()
  const [document, setDocument] = useState<CanvasDocument>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [recovery, setRecovery] = useState<Recovery>()
  const [conflict, setConflict] = useState(false)
  const state = useRef<{ scope: string; current?: CanvasRead; document?: CanvasDocument; pending?: CanvasSave; recovery?: Recovery; conflict: boolean }>({ scope: key, conflict: false })
  const inFlight = useRef<Promise<boolean>>()
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
    state.current = { scope: key, conflict: false }; inFlight.current = undefined
    setCurrent(undefined); setDocument(undefined); setError(''); setConflict(false); setRecovery(undefined); setSaving(false)
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
    if (!ownership.canEdit() || !s.document || s.recovery || s.scope !== key) return
    s.document = typeof next === 'function' ? next(s.document) : next
    setDocument(s.document); persist()
  }
  const save = (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    const s = state.current
    if (!ownership.canEdit() || !s.current || !s.document || s.recovery || s.conflict) return Promise.resolve(false)
    const run = async () => {
      setSaving(true); setError('')
      try {
        while (s === state.current && (s.pending || !same(s.document, s.current!.document))) {
          const command = s.pending || { request_id: crypto.randomUUID(), expected_revision: s.current!.revision, document: structuredClone(s.document!) }
          s.pending = command; persist()
          const result = await Canvases.canvasSave({ projectId, canvasId: s.current!.id, requestBody: command })
          if (!result.data || result.data.request_id !== command.request_id || result.data.canvas_id !== s.current!.id) throw new Error('invalid receipt')
          if (s !== state.current) return false
          s.current = { ...s.current!, revision: result.data.revision, document: command.document as CanvasDocument }; s.pending = undefined
          setCurrent(s.current); persist()
        }
        return true
      } catch (reason) {
        if (s !== state.current) return false
        if (reason instanceof ApiError && [400, 409, 422].includes(reason.status)) {
          s.pending = undefined
          if (reason.status === 409) { s.conflict = true; setConflict(true) }
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
      if (saved.pending) {
        const receipt = await Canvases.canvasSave({ projectId, canvasId: baseline.id, requestBody: saved.pending })
        if (!receipt.data || receipt.data.request_id !== saved.pending.request_id) throw new Error('invalid receipt')
        baseline = { ...baseline, revision: receipt.data.revision, document: saved.pending.document as CanvasDocument }
      }
      const response = await Canvases.canvasGet({ projectId, canvasId: baseline.id })
      if (!response.data || s !== state.current) return
      if (response.data.revision !== baseline.revision || !same(response.data.document, baseline.document)) {
        s.conflict = true; setConflict(true); setError('REVISION_CONFLICT: 服务器已有更新，本地恢复内容保留，请核对后选择')
      }
      s.current = response.data; s.document = saved.document; s.pending = undefined; s.recovery = undefined
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
      s.current = response.data; if (!keepLocal) s.document = response.data.document
      s.conflict = false; s.recovery = undefined
      setCurrent(s.current); setDocument(s.document); setRecovery(undefined); setConflict(false); setError(''); persist(); return true
    } catch (reason) { setError(describe(reason)); return false }
  }
  useEffect(() => {
    if (!ownership.editable) return
    const s = state.current
    if (s.current && !s.recovery && !s.pending && same(s.document, s.current.document)) void reload()
  }, [ownership.editable])
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
  useEffect(() => { const timer = window.setInterval(() => { if (latest.current.dirty && !latest.current.recovery) void latest.current.save() }, 5000); return () => clearInterval(timer) }, [key])
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (latest.current.dirty || state.current.pending || state.current.recovery) { persist(); event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave)
  }, [key])
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.key !== nextLocation.key && (!!state.current.pending || !!state.current.recovery || (!!state.current.current && !same(state.current.document, state.current.current.document))))
  useEffect(() => { if (blocker.state === 'blocked') void latest.current.requestLeave().then(ok => { if (ok) blocker.proceed(); else blocker.reset() }) }, [blocker])
  return { current, document, edit, save, saving, dirty, error, storageError, recovery, conflict, restore, reload, ownership, requestLeave }
}
