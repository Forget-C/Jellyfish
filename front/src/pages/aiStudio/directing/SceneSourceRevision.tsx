import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { SourceRead, WorkspaceRead } from '../../../services/generated'
import { DesignFields } from './DesignFields'
import { PlanEditor } from './PlanEditor'
import { PromptReader } from './PromptReader'
import { CutItems } from './WorkspaceHistory'
import { directingError } from './common'

/** 来源中的旧修订按身份与修订号核对；加载和查看不改变当前场次版本。 */
export function SceneSourceRevision({ projectId, sequenceId, source }: { projectId: string; sequenceId: string; source: SourceRead }) {
  const [workspace, setWorkspace] = useState<WorkspaceRead>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setWorkspace(undefined); setError('')
    void StudioDirectingService.directingWorkspace({ projectId, sequenceId }).then(result => {
      if (!result.data) throw new Error('历史工作区尚未核实')
      if (active) setWorkspace(result.data)
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, sequenceId, source.revision_id, source.source.version, attempt])
  if (error) return <Alert type="warning" message="历史来源读取失败" description={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试历史来源</Button>} />
  if (!workspace) return <p>正在核实历史来源</p>
  const matches = (row: { id: string; version: number }) => row.id === source.revision_id && String(row.version) === source.source.version
  const design = workspace.designs.find(matches)
  if (design) return <DesignFields value={design.content} path={[]} onChange={() => {}} disabled />
  const plan = workspace.plans.find(matches)
  if (plan) {
    const fixed = workspace.designs.find(row => row.id === plan.content.design_revision_id)
    return fixed ? <PlanEditor projectId={projectId} workspace={workspace} design={fixed.content} value={plan.content} onChange={() => {}} disabled /> : <Alert type="warning" message="此计划的固定设计已不可用" />
  }
  const prompt = workspace.prompts.find(matches)
  if (prompt) return <PromptReader prompt={prompt.content} workspace={workspace} />
  const cut = workspace.cuts.find(matches)
  if (cut) return <CutItems workspace={workspace} cut={cut.content} />
  return <Alert type="warning" message="原历史修订已不可用；请重新选择来源" />
}
