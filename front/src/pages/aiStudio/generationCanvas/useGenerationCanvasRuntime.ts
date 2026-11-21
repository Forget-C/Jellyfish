import { useUiText } from '../../../uiText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasNodeRead, CanvasPrecheck, CanvasRunSubmit, CanvasRuntimeEvent, CanvasSnapshot } from '../../../services/generated'
import { connectEventStream } from '../../../services/eventStream'
import type { StreamConnection } from '../../../services/eventStream'

/** 画布各阅读入口使用同一可读运行状态，不向用户暴露传输枚举。 */
export const canvasNodeStatusLabels: Record<string, string> = { waiting: '等待上游', queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败 · 未完成', cancelled: '已取消 · 未完成', blocked: '已阻止 · 未完成' }

export const activeNode = (node?: CanvasNodeRead) => !!node && ['waiting', 'queued', 'running'].includes(node.status)
type RuntimeSnapshot = CanvasSnapshot & { outputScope?: string }
const empty = (): RuntimeSnapshot => ({ cursor: 0, runs: [], current_outputs: {} })
const describe = (reason: unknown) => reason instanceof ApiError && reason.body?.data?.code
  ? `${reason.body.data.code}: ${reason.body.data.message}` : '请求结果未知，请核实原请求；不会自动重复生成'
type Pending = { cardId: string; command: CanvasRunSubmit }

/** Runtime is an observation projection, never an editable CanvasDocument. Unknown
 * submission outcomes keep the exact durable command until its receipt is known. */
export function useGenerationCanvasRuntime(projectId: string, canvasId: string | null, save: () => Promise<boolean>, canEdit: () => boolean, savedRevision?: number) {
  const uiText = useUiText()
  const scope = `${projectId}:${canvasId}`, key = `jellyfish:generation-run:${scope}`
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(empty)
  const [connection, setConnection] = useState<StreamConnection>('connecting')
  const [preview, setPreview] = useState<CanvasPrecheck>()
  const [checking, setChecking] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState<Pending>()
  const [error, setError] = useState('')
  const [storageBlocked, setStorageBlocked] = useState(false)
  const [cancelling, setCancelling] = useState<Set<string>>(new Set())
  const cancelRequests = useRef(new Set<string>())
  const state = useRef({ scope, generation: 0, snapshotRequest: 0, previewGeneration: -1, checking: false, submitting: false, pending: undefined as Pending | undefined })
  // A task cursor does not identify a saved document revision. Both save and
  // stream snapshots reconcile through a fresh read, ordered by request epoch.
  const refreshSnapshot = useCallback(() => {
    const current = state.current
    if (!canvasId || current.scope !== scope) return
    const request = ++current.snapshotRequest, generation = current.generation
    void Canvases.canvasRuntime({ projectId, canvasId }).then(response => {
      if (state.current !== current || request !== current.snapshotRequest || generation !== current.generation || !response.data) return
      const next = response.data
      setSnapshot(previous => next.cursor >= previous.cursor ? { ...next, outputScope: scope } : previous)
    }).catch(() => {
      if (state.current === current && request === current.snapshotRequest && generation === current.generation) setError(uiText("输出状态读取失败，请重开后重试"))
    })
  }, [uiText, projectId, canvasId, scope])
  useEffect(() => {
    const s = { scope, generation: 0, snapshotRequest: 0, previewGeneration: -1, checking: false, submitting: false, pending: undefined as Pending | undefined }
    state.current = s
    cancelRequests.current = new Set(); setCancelling(new Set())
    setSnapshot(empty()); setPreview(undefined); setChecking(undefined); setSubmitting(false); setPending(undefined); setError(''); setStorageBlocked(false); setConnection('connecting')
    if (!canvasId) return
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const saved = JSON.parse(raw) as Pending
        if (typeof saved.cardId !== 'string' || typeof saved.command?.request_id !== 'string' || typeof saved.command?.preview_token !== 'string') throw new Error('invalid pending run')
        s.pending = saved; setPending(saved)
      }
    } catch { setStorageBlocked(true); setError(uiText("运行回执保护记录无法读取；请恢复浏览器存储并刷新后再执行")) }
    const stream = connectEventStream<CanvasRuntimeEvent>({
      url: async () => {
        const response = await Canvases.canvasStreamConnection({ projectId, canvasId })
        if (!response.data?.url) throw new Error('missing stream connection')
        return response.data.url
      },
      onConnection: next => { if (s === state.current) setConnection(next) },
      onEvent: event => {
        if (s !== state.current || event.canvas_id !== canvasId || event.version !== 1) return
        if (event.type === 'snapshot') { refreshSnapshot(); return }
        const node = event.type === 'run.finished' ? undefined : event.payload.node as CanvasNodeRead | undefined
        if (event.type !== 'run.finished' && !node) throw new Error('missing runtime node')
        setSnapshot(previous => {
          if (event.cursor <= previous.cursor) return previous
          const runs = [...previous.runs], outputs = { ...(event.payload.current_outputs as CanvasSnapshot['current_outputs'] | undefined || previous.current_outputs) }
          if (event.type === 'run.finished') {
            const index = runs.findIndex(run => run.id === event.payload.run_id)
            if (index >= 0) runs[index] = { ...runs[index], lifecycle: 'finished' }
          } else {
            // Each node envelope carries canonical cumulative text, including final
            // replacement text. Never append the same delta to a restored snapshot.
            if (!node) return previous
            let index = runs.findIndex(run => run.id === node.run_id)
            if (index < 0) { index = runs.length; runs.push({ id: node.run_id, canvas_id: canvasId, lifecycle: 'active', nodes: [] }) }
            const nodes = [...runs[index].nodes], position = nodes.findIndex(item => item.id === node.id)
            if (position < 0) nodes.push(node); else nodes[position] = node
            runs[index] = { ...runs[index], nodes }
            if (node.current_output_updated && !event.payload.current_outputs) outputs[node.card_id] = node.outputs
          }
          return { cursor: event.cursor, runs, current_outputs: outputs, outputScope: event.payload.current_outputs ? scope : previous.outputScope }
        })
      },
    })
    return () => { stream.close(); if (s === state.current) state.current = { ...s, scope: '' } }
  }, [uiText, scope, canvasId, key, projectId, refreshSnapshot])
  // Ordinary saves can invalidate outputs without producing task events.
  useEffect(() => { if (savedRevision !== undefined) refreshSnapshot() }, [savedRevision, refreshSnapshot])
  const invalidate = () => { state.current.generation++; setPreview(undefined) }
  const precheck = async (cardId: string) => {
    const s = state.current, generation = s.generation
    if (!canvasId || s.scope !== scope || s.checking || s.submitting || s.pending || storageBlocked || !canEdit()) return
    s.checking = true; setChecking(cardId); setPreview(undefined); setError('')
    try {
      if (!await save() || s !== state.current || generation !== s.generation) return
      const response = await Canvases.canvasPrecheck({ projectId, canvasId, requestBody: { card_id: cardId, kind: 'single' } })
      if (s === state.current && generation === s.generation) { s.previewGeneration = generation; setPreview(response.data || undefined) }
    } catch (reason) { if (s === state.current && generation === s.generation) setError(describe(reason)) }
    finally { if (s === state.current) { s.checking = false; setChecking(undefined) } }
  }
  const submit = async () => {
    const s = state.current
    if (!canvasId || s.scope !== scope || s.submitting || storageBlocked || !canEdit()) return
    if (!s.pending && (s.previewGeneration !== s.generation || !preview?.can_run || !preview.preview_token)) return
    const command = s.pending || { cardId: preview!.card_id, command: { request_id: crypto.randomUUID(), preview_token: preview!.preview_token! } }
    s.submitting = true; setSubmitting(true); setError('')
    try {
      // Persist before sending so refresh can verify the same request after a lost response.
      localStorage.setItem(key, JSON.stringify(command))
      s.pending = command; setPending(command)
      const response = await Canvases.canvasRunSubmit({ projectId, canvasId, requestBody: command.command })
      if (!response.data || response.data.request_id !== command.command.request_id || response.data.canvas_id !== canvasId) throw new Error('invalid run receipt')
      localStorage.removeItem(key)
      if (s === state.current) { s.pending = undefined; setPending(undefined); setPreview(undefined) }
    } catch (reason) {
      if (s !== state.current) return
      if (reason instanceof ApiError && [400, 403, 404, 409, 422].includes(reason.status)) {
        s.pending = undefined; setPending(undefined); setPreview(undefined)
        try { localStorage.removeItem(key) } catch { /* Original command remains safe to replay. */ }
      }
      setError(s.pending ? describe(reason) : reason instanceof ApiError ? describe(reason) : uiText("运行回执保护无法保存，未提交运行；请恢复浏览器存储后重试"))
    } finally { if (s === state.current) { s.submitting = false; setSubmitting(false) } }
  }
  const cancel = async (runId: string, nodeId?: string) => {
    const s = state.current, id = nodeId || runId, requests = cancelRequests.current
    if (!canvasId || s.scope !== scope || requests.has(id) || !canEdit()) return
    requests.add(id); setCancelling(new Set(requests)); setError('')
    try {
      if (nodeId) await Canvases.canvasCancelNode({ projectId, canvasId, runId, nodeId })
      else await Canvases.canvasCancelRun({ projectId, canvasId, runId })
      // The command acknowledges intent only. The persistent stream remains the
      // authority for status, retained text and releasing an occupied card.
    } catch (reason) {
      if (s === state.current) setError(reason instanceof ApiError ? describe(reason) : uiText("取消请求结果未知，继续观察真实任务状态；可核实后再次请求取消"))
    } finally {
      requests.delete(id)
      if (s === state.current) setCancelling(new Set(requests))
    }
  }
  const nodes = snapshot.runs.flatMap(run => run.nodes)
  const latestNodes = Object.fromEntries(nodes.map(node => [node.card_id, node])) as Record<string, CanvasNodeRead>
  const busyCards = new Set(nodes.filter(activeNode).map(node => node.card_id))
  return { snapshot, outputsVerified: snapshot.outputScope === scope, latestNodes, busyCards, connection, preview, checking, submitting, pending, error, storageBlocked, invalidate, precheck, submit, cancelling, cancel }
}
