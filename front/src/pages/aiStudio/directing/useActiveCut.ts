import { useEffect, useState } from 'react'
import { StudioDirectingService } from '../../../services/generated'
import type { WorkspaceRead } from '../../../services/generated'
import { resolveActiveCut } from './workspaceUsage'
import type { ActiveCutState } from './workspaceUsage'

/** 采用指针与本次工作区快照配对读取；旧请求、失败和缺失版本均不得产生“未采用”结论。 */
export function useActiveCut(projectId: string, sequenceId: string, workspace?: WorkspaceRead): ActiveCutState {
  const [result, setResult] = useState<{ workspace: WorkspaceRead; projectId: string; state: ActiveCutState }>()
  useEffect(() => {
    if (!workspace || workspace.sequence.id !== sequenceId) return
    let cancelled = false
    void StudioDirectingService.directingFeedback({ projectId, sequenceId }).then(response => {
      if (!cancelled) setResult({ workspace, projectId, state: { ...resolveActiveCut(workspace, response.data?.active_cut_revision_id), ...(response.data ? { feedback: response.data } : {}) } })
    }).catch(() => { if (!cancelled) setResult({ workspace, projectId, state: { status: 'error' } }) })
    return () => { cancelled = true }
  }, [projectId, sequenceId, workspace])
  return result?.workspace === workspace && result?.projectId === projectId && workspace?.sequence.id === sequenceId ? result.state : { status: 'loading' }
}
