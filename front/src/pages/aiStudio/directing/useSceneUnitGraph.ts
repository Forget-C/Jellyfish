import { useEffect, useState } from 'react'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneVersionContent_Output, UnitCanvasGraph } from '../../../services/generated'
import { directingError } from './common'

/** 当前编辑独立投影；请求绑定完整输入，迟到结果不能覆盖新编辑或保存基线。 */
export function useSceneUnitGraph(projectId: string, sequenceId: string, versionId: string | undefined, revision: number | undefined,
  content: SceneVersionContent_Output | undefined, saved: SceneVersionContent_Output | undefined, baseline: UnitCanvasGraph | undefined, active: boolean) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ key: string; graph: UnitCanvasGraph }>()
  const [failure, setFailure] = useState<{ key: string; message: string }>()
  const value = JSON.stringify(content)
  const key = JSON.stringify([projectId, sequenceId, versionId, revision, value, attempt])
  const baselineCurrent = value === JSON.stringify(saved) && attempt === 0
  useEffect(() => {
    if (!active || !versionId || !revision || !content || baselineCurrent || result?.key === key) return
    let current = true
    const request = StudioDirectingService.directingPreviewUnitCanvas({ projectId, sequenceId, versionId,
      requestBody: { expected_revision: revision, content } })
    void request.then(response => {
      if (!response.data || response.data.kind !== 'units' || response.data.version_id !== versionId || response.data.revision !== revision ||
        !Array.isArray(response.data.nodes) || !Array.isArray(response.data.views) || response.data.views.filter(view => view.parent_id === null).length !== 1) throw new Error('当前单元卡片尚未核实')
      if (current) { setResult({ key, graph: response.data }); setFailure(undefined) }
    }).catch(cause => { if (current) setFailure({ key, message: directingError(cause) }) })
    return () => { current = false; request.cancel() }
  }, [key, active, baselineCurrent, content, projectId, sequenceId, versionId, revision, result?.key])
  const current = baselineCurrent || result?.key === key
  return {
    graph: baselineCurrent ? baseline : result && result.graph.version_id === versionId && result.graph.revision === revision ? result.graph : baseline,
    current, pending: active && !current && failure?.key !== key,
    error: failure?.key === key ? failure.message : '',
    retry: () => setAttempt(value => value + 1),
  }
}
