import { useEffect, useRef, useState } from 'react'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneVideoSubmitRequest, SceneVideoRetryRequest } from '../../../services/generated'
import type { VideoActivityTarget } from './SceneVideoActivity'
import { directingError } from './common'

type Intent = Omit<VideoActivityTarget, 'taskId'> & { request: SceneVideoSubmitRequest | SceneVideoRetryRequest; executionId?: string }
type Pending = Intent & { submitting?: boolean; error?: string }

/** 已保存内容的生成授权按原单元持久化，不占用版本保存槽位。 */
export function useSceneVideoRequests({ projectId, sequenceId, enabled, canSubmit, onAccepted, onRejected }: {
  projectId: string; sequenceId: string; enabled: boolean; canSubmit: boolean
  onAccepted: (target: VideoActivityTarget) => void; onRejected: (target: Intent, error: string) => void
}) {
  const key = `jellyfish:scene-video-requests:${projectId}:${sequenceId}`
  const [pending, setPending] = useState<Pending[]>([])
  const [storageError, setStorageError] = useState('')
  const values = useRef<Pending[]>([])
  const initialized = useRef(false)
  const mounted = useRef(true)
  const running = useRef(new Set<string>())
  const live = useRef({ enabled, canSubmit, onAccepted, onRejected })
  live.current = { enabled, canSubmit, onAccepted, onRejected }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const persist = (rows: Pending[]) => {
    localStorage.setItem(key, JSON.stringify(rows.map(({ submitting: _submitting, error: _error, ...intent }) => intent)))
    values.current = rows
    if (mounted.current) { setPending(rows); setStorageError('') }
  }
  const remove = (id: string) => {
    // 页面离开后旧响应仍可能到达，只删除自己的请求，保留新页面追加的授权。
    const stored = JSON.parse(localStorage.getItem(key) || '[]') as Intent[]
    persist(stored.filter(row => row.request.request_id !== id).map(row =>
      values.current.find(current => current.request.request_id === row.request.request_id) || row))
  }
  const run = async (intent: Intent) => {
    const id = intent.request.request_id
    if (!live.current.enabled || running.current.has(id)) return
    running.current.add(id)
    values.current = values.current.map(row => row.request.request_id === id ? { ...row, submitting: true, error: undefined } : row)
    if (mounted.current) setPending(values.current)
    try {
      const target = { projectId: intent.projectId, sequenceId: intent.sequenceId, versionId: intent.versionId, unitId: intent.unitId }
      const response = intent.executionId ? await StudioDirectingService.directingSceneVideoRetry({ ...target,
        executionId: intent.executionId, requestBody: { request_id: intent.request.request_id } }) :
        'expected_revision' in intent.request ? await StudioDirectingService.directingSceneVideoSubmit({ ...target, requestBody: intent.request }) :
          undefined
      if (!response?.data) throw new Error('视频提交结果尚未核实')
      remove(id)
      if (mounted.current) live.current.onAccepted({ ...intent, taskId: response.data.task_id })
    } catch (cause) {
      if (cause instanceof ApiError && [400, 409, 422].includes(cause.status)) {
        try {
          remove(id)
          if (mounted.current) live.current.onRejected(intent, directingError(cause))
          return
        } catch { /* 清理未落盘时保留原请求，下次仍核实同一身份。 */ }
      }
      values.current = values.current.map(row => row.request.request_id === id ? { ...row, submitting: false, error: directingError(cause) } : row)
      if (mounted.current) setPending(values.current)
    } finally { running.current.delete(id) }
  }
  useEffect(() => {
    if (!enabled || initialized.current) return
    initialized.current = true
    try {
      const rows = JSON.parse(localStorage.getItem(key) || '[]') as Intent[]
      if (!Array.isArray(rows) || rows.some(row => row.projectId !== projectId || row.sequenceId !== sequenceId ||
        !row.versionId || !row.unitId || !row.request?.request_id || (row.executionId !== undefined ? typeof row.executionId !== 'string' || !row.executionId :
          !('expected_revision' in row.request) || !Number.isInteger(row.request.expected_revision) || row.request.expected_revision < 1))) {
        throw new Error('视频请求恢复记录无法读取，请保留记录并修复后重新加载')
      }
      values.current = rows; setPending(rows)
      rows.forEach(row => { void run(row) })
    } catch (cause) { initialized.current = false; setStorageError(directingError(cause)) }
  }, [enabled, key])
  const submit = (intent: Intent) => {
    if (!live.current.enabled || !live.current.canSubmit || !initialized.current || values.current.some(row => row.versionId === intent.versionId && row.unitId === intent.unitId)) return false
    try { persist([...values.current, intent]) }
    catch (cause) { setStorageError(`视频授权恢复记录未保存，尚未提交。${directingError(cause)}`); return false }
    void run(intent)
    return true
  }
  return { pending, storageError, submit, retry: run }
}
