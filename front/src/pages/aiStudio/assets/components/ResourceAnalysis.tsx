import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Tag } from 'antd'
import { FilmService, ScriptProcessingService, type AssetFieldSuggestion } from '../../../../services/generated'
import { useCancelableRelationTask } from '../../project/ProjectWorkbench/relationTasks'
import { handleTaskResultSafely } from '../../components/taskResultHelpers'
import { ASSET_FIELDS, previewAssetDescription, type AssetFacts, type AssetFieldName, type StructuredAssetType } from './AssetFactsFields'

/** 保留资产设定检测与逐项采用，结果不直接覆盖用户输入。 */
export function ResourceAnalysis({ kind, id, name, facts, supplement, disabled, onApply, onState }: {
  kind: StructuredAssetType; id: string; name: string; facts: AssetFacts; supplement: string; disabled: boolean
  onApply: (facts: AssetFacts, supplement: string) => void
  onState: (state: { busy: boolean; cancelling: boolean; cancel: () => Promise<boolean> }) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<AssetFieldSuggestion[]>([])
  const [issues, setIssues] = useState<string[]>([])
  const [baseline, setBaseline] = useState('')
  const current = JSON.stringify({ name, facts, supplement })
  const readResult = async (taskId: string) => {
    await handleTaskResultSafely(taskId, { readErrorMessage: '读取检测结果失败', failedFallbackMessage: '智能检测失败',
      onSucceeded: value => {
        const result = value as { suggestions?: AssetFieldSuggestion[]; issues?: string[] }
        setSuggestions(result.suggestions ?? []); setIssues(result.issues ?? [])
      }, onFailed: text => setError(text), onReadError: () => setError('读取检测结果失败，请重试'),
    })
  }
  const { task, trackTaskData, applyCancelData } = useCancelableRelationTask({ enabled: !!id,
    relationType: kind === 'actor' ? 'character_portrait_analysis' : `${kind}_info_analysis`,
    relationEntityId: `${kind}_image:${id}`, onTaskSettled: async taskId => { await readResult(taskId) },
  })
  const busy = submitting || !!task && ['queued', 'running'].includes(task.status)
  const cancel = useCallback(async () => {
    if (!task?.taskId) return false
    try {
      const response = await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: task.taskId, requestBody: { reason: '用户取消对象设定检测' } })
      applyCancelData(response.data)
      return true
    } catch { setError('取消检测失败，请重试'); return false }
  }, [task?.taskId, applyCancelData])
  useEffect(() => { onState({ busy, cancelling: !!task?.cancelRequested, cancel }) }, [busy, task?.cancelRequested, cancel, onState])
  const detect = async () => {
    if (busy || disabled) return
    const description = previewAssetDescription(kind, facts, supplement)
    if (!description) { setError('请先输入描述再进行智能检测'); return }
    setSubmitting(true); setError(''); setBaseline(current)
    try {
      const relation_entity_id = `${kind}_image:${id}`
      const response = kind === 'actor'
        ? await ScriptProcessingService.analyzeCharacterPortraitAsyncApiV1ScriptProcessingAnalyzeCharacterPortraitAsyncPost({ requestBody: { relation_entity_id, character_description: description, character_context: name } })
        : kind === 'scene' ? await ScriptProcessingService.analyzeSceneInfoAsyncApiV1ScriptProcessingAnalyzeSceneInfoAsyncPost({ requestBody: { relation_entity_id, scene_description: description, scene_context: name } })
          : kind === 'prop' ? await ScriptProcessingService.analyzePropInfoAsyncApiV1ScriptProcessingAnalyzePropInfoAsyncPost({ requestBody: { relation_entity_id, prop_description: description, prop_context: name } })
            : await ScriptProcessingService.analyzeCostumeInfoAsyncApiV1ScriptProcessingAnalyzeCostumeInfoAsyncPost({ requestBody: { relation_entity_id, costume_description: description, costume_context: name } })
      trackTaskData(response.data)
    } catch { setError('智能检测提交失败，输入已保留') }
    finally { setSubmitting(false) }
  }
  return <div className="resource-editor-fields"><Space wrap>
    <Button disabled={disabled || busy} loading={submitting} onClick={() => void detect()}>智能检测</Button>
    {busy && <><span role="status">{task?.cancelRequested ? '等待取消确认' : '智能检测进行中'}</span><Button disabled={task?.cancelRequested} onClick={() => void cancel()}>取消检测</Button></>}
  </Space>{error && <Alert type="error" message={error} action={task?.taskId && !busy && <Button onClick={() => void readResult(task.taskId)}>重试读取检测结果</Button>} />}{issues.map(issue => <Alert key={issue} type="warning" message={issue} />)}
    {suggestions.map(suggestion => {
      const field = ASSET_FIELDS[kind].find(field => field.key === suggestion.field)
      if (!field && suggestion.field !== 'supplementary_info') return null
      return <Card key={suggestion.field} size="small" title={field?.label ?? '补充信息'}>
        <Tag>{suggestion.source === 'explicit' ? '原文提取' : 'AI 推断，需确认'}</Tag><p>{suggestion.value}</p>
        {suggestion.evidence && <p>原文依据：{suggestion.evidence}</p>}
        <Button disabled={baseline !== current} onClick={() => {
          const nextFacts = suggestion.field === 'supplementary_info' ? facts : { ...facts, [suggestion.field as AssetFieldName]: suggestion.value }
          const nextSupplement = suggestion.field === 'supplementary_info' ? suggestion.value : supplement
          onApply(nextFacts, nextSupplement); setBaseline(JSON.stringify({ name, facts: nextFacts, supplement: nextSupplement }))
        }}>明确采用此项</Button>
      </Card>
    })}
  </div>
}
