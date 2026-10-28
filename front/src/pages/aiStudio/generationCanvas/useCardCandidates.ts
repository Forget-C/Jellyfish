import { useEffect, useRef, useState } from 'react'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasResolvedOutput } from '../../../services/generated'

/** 候选只取已保存修订的直接出口，旧响应不能覆盖新的查询范围。 */
export function useCardCandidates(projectId: string, canvasId: string, cardId: string, revision?: number, published?: Record<string, CanvasResolvedOutput[]>) {
  const [value, setValue] = useState<{ scope: string; candidates: CanvasResolvedOutput[]; error: string }>()
  const publishedKey = Object.entries(published || {}).filter(([, outputs]) => outputs.length > 0).sort(([a], [b]) => a.localeCompare(b))
  const scope = JSON.stringify([projectId, canvasId, cardId, revision, publishedKey])
  const latest = useRef(scope); latest.current = scope
  useEffect(() => {
    let active = true
    void Canvases.canvasCardOutputs({ projectId, canvasId, cardId }).then(response => {
      if (!active || latest.current !== scope || !response.data) return
      if (revision !== undefined && response.data.revision !== revision) return
      setValue({ scope, candidates: response.data.candidates, error: '' })
    }).catch(() => { if (active && latest.current === scope) setValue({ scope, candidates: [], error: '已保存输入读取失败，请保存或重开后重试' }) })
    return () => { active = false }
  }, [projectId, canvasId, cardId, revision, scope])
  return value?.scope === scope ? { ...value, loading: false } : { candidates: [], error: '', loading: true }
}
