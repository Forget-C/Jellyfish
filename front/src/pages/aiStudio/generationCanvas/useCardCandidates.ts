import { useEffect, useRef, useState } from 'react'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCompiledInput, CanvasResolvedOutput } from '../../../services/generated'

/** 候选只取已保存修订的直接出口，旧响应不能覆盖新的查询范围。 */
export function useCardCandidates(projectId: string, canvasId: string, cardId: string, revision?: number, published?: Record<string, CanvasResolvedOutput[]>, compile = true) {
  const [value, setValue] = useState<{ entity: string; scope: string; candidates: CanvasResolvedOutput[]; outputs: CanvasResolvedOutput[]; revision: number; compiled?: CanvasCompiledInput; error: string }>()
  const publishedKey = Object.entries(published || {}).filter(([, outputs]) => outputs.length > 0).sort(([a], [b]) => a.localeCompare(b))
  const entity = JSON.stringify([projectId, canvasId, cardId, compile])
  const scope = JSON.stringify([projectId, canvasId, cardId, revision, publishedKey, compile])
  const latest = useRef(scope); latest.current = scope
  useEffect(() => {
    let active = true
    void Promise.allSettled([
      Canvases.canvasCardOutputs({ projectId, canvasId, cardId }),
      compile ? Canvases.canvasCompile({ projectId, canvasId, cardId }) : Promise.resolve(undefined),
    ]).then(([outputs, compiled]) => {
      if (!active || latest.current !== scope) return
      const data = outputs.status === 'fulfilled' ? outputs.value.data : undefined
      const input = compiled.status === 'fulfilled' ? compiled.value?.data : undefined
      if (!data) throw new Error('missing outputs')
      if (revision !== undefined && (data.revision !== revision || input && input.revision !== revision)) return
      setValue({ entity, scope, candidates: data.candidates, outputs: data.outputs, revision: data.revision, compiled: input || undefined,
        error: input || !compile ? '' : '已保存输入诊断读取失败，请保存或重开后重试' })
    }).catch(() => { if (active && latest.current === scope) setValue(previous => ({ ...(previous?.entity === entity ? previous : {entity, candidates: [], outputs: [], revision: revision || 0}), scope, error: '已保存输入读取失败，请保存或重开后重试' })) })
    return () => { active = false }
  }, [projectId, canvasId, cardId, revision, scope, compile, entity])
  if (value?.entity === entity) return { ...value, loading: value.scope !== scope }
  return { candidates: [], outputs: [], revision, compiled: undefined, error: '', loading: true }
}
