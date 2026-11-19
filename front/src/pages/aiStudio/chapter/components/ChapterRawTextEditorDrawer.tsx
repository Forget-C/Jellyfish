import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Collapse, Empty, Input, List, Modal, Space, Spin, Tag, Select, message } from 'antd'
import { flushSync } from 'react-dom'
import {
  CloseCircleOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { ScriptProcessingService, StudioChaptersService } from '../../../../services/generated'
import type { SourceExplanation } from '../../../../services/generated'
import { SourceExplanationsEditor, sourceVersion, SOURCE_POLICY_VERSION } from './SourceExplanationsEditor'
import type { ScriptConsistencyCheckResult } from './scriptConsistencyResult'
import {
  CONSISTENCY_CHECK_RELATION_TYPE,
  SCRIPT_OPTIMIZATION_RELATION_TYPE,
  SCRIPT_SIMPLIFICATION_RELATION_TYPE,
  useCancelableRelationTask,
} from '../../project/ProjectWorkbench/relationTasks'
import { executeAsyncTaskCreate, executeTaskCancel, notifyExistingTask } from '../../components/taskActionHelpers'
import { handleTaskResultSafely } from '../../components/taskResultHelpers'
import { useRelationTaskNotification } from '../../components/taskNotificationHelpers'
import { useTaskPageContext } from '../../components/taskPageContext'
import { TASK_COPY } from '../../components/taskCopy'
import { apiErrorMessage } from '../../../../services/apiErrorMessage'
import { useWorkspaceDraft } from '../../directing/WorkspaceDrafts'

import { ResourceEditorFrame } from '../../assets/components/ResourceEditorFrame'
import '../../assets/components/resourceEditor.css'
import './chapter-editor.css'

type EditorMode = 'raw' | 'condensed' | 'compare'

type HistoryItem = {
  id: string
  at: number
  rawText: string
  condensedText: string
}

export function ChapterRawTextEditorDrawer({
  open,
  onClose,
  chapterId,
  projectId,
  onSaved,
  onReviewSequences,
}: {
  open: boolean
  onClose: () => void
  chapterId: string | undefined
  projectId: string
  onSaved?: (next: { title?: string; rawText?: string; condensedText?: string }) => void
  onReviewSequences: () => void
}) {
  const consistencyTaskCopy = TASK_COPY.consistencyCheck
  const simplifyTaskCopy = TASK_COPY.scriptSimplify
  const optimizeTaskCopy = TASK_COPY.scriptOptimize
  const drawerId = useId()
  const saveFeedback = useRef<HTMLDivElement>(null)
  const historyTrigger = useRef<HTMLButtonElement>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [checkingConsistency, setCheckingConsistency] = useState(false)
  const [optimizingScript, setOptimizingScript] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chapterTitle, setChapterTitle] = useState('')
  const [savedTitle, setSavedTitle] = useState('')
  const [sequenceCount, setSequenceCount] = useState<number>()
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [retry, setRetry] = useState(0)
  const [confirmRaw, setConfirmRaw] = useState<string>()
  const [needsReview, setNeedsReview] = useState(false)

  const [mode, setMode] = useState<EditorMode>('raw')
  const [rawText, setRawText] = useState('')
  const [condensedText, setCondensedText] = useState('')
  const [savedRawText, setSavedRawText] = useState('')
  const [savedCondensedText, setSavedCondensedText] = useState('')
  const [explanations, setExplanations] = useState<SourceExplanation[]>([])
  const [basisVersion, setBasisVersion] = useState<string>()
  const [savedExplanations, setSavedExplanations] = useState<SourceExplanation[]>([])
  const [rawVersion, setRawVersion] = useState('')
  const [reviewVersion, setReviewVersion] = useState('')
  const [explanationVersion, setExplanationVersion] = useState('')
  const [decisions, setDecisions] = useState<Record<number, string>>({})
  const [intent, setIntent] = useState<Record<number, string>>({})
  const [repairPreview, setRepairPreview] = useState<{ text: string; source: string; explanationVersion?: string; policyVersion?: number; reviewVersion?: string }>()
  useEffect(() => {
    let active = true
    setRawVersion(''); setExplanationVersion('')
    void sourceVersion(rawText).then(async version => {
      const valid = explanations.filter(item => item.source_version === version && item.policy_version === SOURCE_POLICY_VERSION)
      const canonical = (items: SourceExplanation[]) => JSON.stringify(items.map(item => ({ ...(item.end == null ? {} : { end: item.end }), excerpt: item.excerpt ?? '', id: item.id, kind: item.kind ?? 'explanation', ...(item.policy_version == null ? {} : { policy_version: item.policy_version }), source_version: item.source_version, ...(item.start == null ? {} : { start: item.start }), text: item.text })))
      const stable = canonical(valid)
      const reviewHash = await sourceVersion(canonical(explanations))
      const explanationHash = await sourceVersion(stable)
      if (active) { setRawVersion(version); setExplanationVersion(explanationHash); setReviewVersion(reviewHash) }
    })
    return () => { active = false }
  }, [rawText, explanations])
  const [consistencyResult, setConsistencyResult] = useState<ScriptConsistencyCheckResult | null>(null)

  const applyConsistencyTaskResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取一致性检查结果失败',
      failedFallbackMessage: '一致性检查失败',
      onSucceeded: (resultValue) => {
        setConsistencyResult(resultValue as ScriptConsistencyCheckResult)
        setDecisions({}); setIntent({})
        const result = resultValue as Record<string, any>
        if (result?.has_issues) {
          message.warning(`发现 ${Array.isArray(result.issues) ? result.issues.length : 0} 个原文一致性问题`)
        } else {
          message.success('未发现原文一致性问题')
        }
      },
      onFailed: (errorMessage) => {
        message.error(errorMessage)
      },
      onReadError: () => {
        message.error('读取一致性检查结果失败')
      },
    })
  }, [])

  const applySimplifyResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取智能精简结果失败',
      failedFallbackMessage: '智能精简失败',
      onSucceeded: (resultValue) => {
        const result = resultValue as Record<string, any>
        const simplified = String(result?.simplified_script_text ?? '').trim()
        if (!simplified) {
          message.error('智能精简失败：未返回有效内容')
          return
        }
        setCondensedText(simplified)
        if (mode !== 'compare') setMode('condensed')
        message.success('智能精简完成')
      },
      onFailed: (errorMessage) => {
        message.error(errorMessage)
      },
      onReadError: () => {
        message.error('读取智能精简结果失败')
      },
    })
  }, [mode])

  const applyOptimizeResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取一键优化结果失败',
      failedFallbackMessage: '一键优化失败',
      onSucceeded: (resultValue) => {
        const result = resultValue as Record<string, any>
        const optimized = String(result?.optimized_script_text ?? '')
        if (!optimized.trim()) {
          message.error('一键优化失败：未返回有效内容')
          return
        }
        setRepairPreview({ text: optimized, source: String(result?.source_text ?? ''), explanationVersion: result?.explanation_version, policyVersion: result?.policy_version, reviewVersion: result?.review_version })
      },
      onFailed: (errorMessage) => {
        message.error(errorMessage)
      },
      onReadError: () => {
        message.error('读取一键优化结果失败')
      },
    })
  }, [])

  const { task: consistencyTask, settledTask: consistencySettledTask, trackTaskData: trackConsistencyTaskData, applyCancelData: applyConsistencyCancelData } = useCancelableRelationTask({
    enabled: open && !!chapterId,
    relationType: CONSISTENCY_CHECK_RELATION_TYPE,
    relationEntityId: chapterId,
    onTaskSettled: applyConsistencyTaskResult,
  })

  const { task: simplifyTask, settledTask: simplifySettledTask, trackTaskData: trackSimplifyTaskData, applyCancelData: applySimplifyCancelData } = useCancelableRelationTask({
    enabled: open && !!chapterId,
    relationType: SCRIPT_SIMPLIFICATION_RELATION_TYPE,
    relationEntityId: chapterId,
    onTaskSettled: applySimplifyResult,
  })

  const { task: optimizeTask, settledTask: optimizeSettledTask, trackTaskData: trackOptimizeTaskData, applyCancelData: applyOptimizeCancelData } = useCancelableRelationTask({
    enabled: open && !!chapterId,
    relationType: SCRIPT_OPTIMIZATION_RELATION_TYPE,
    relationEntityId: chapterId,
    onTaskSettled: applyOptimizeResult,
  })
  useTaskPageContext(
    open && chapterId
      ? [
          {
            relationType: CONSISTENCY_CHECK_RELATION_TYPE,
            relationEntityId: chapterId,
          },
          {
            relationType: SCRIPT_SIMPLIFICATION_RELATION_TYPE,
            relationEntityId: chapterId,
          },
          {
            relationType: SCRIPT_OPTIMIZATION_RELATION_TYPE,
            relationEntityId: chapterId,
          },
        ]
      : [],
  )

  const editorText = mode === 'condensed' ? condensedText : rawText
  const plainWordCount = useMemo(() => editorText.trim().length, [editorText])
  const paragraphCount = useMemo(() => editorText.split(/\n\s*\n/).filter((p) => p.trim()).length, [editorText])
  const actionsLoading =
    loading || !!loadError || saving || extracting || checkingConsistency || optimizingScript || !!simplifyTask || !!optimizeTask || !!consistencyTask
  const consistencyIssues = useMemo(() => {
    const list = (consistencyResult?.issues as any[] | undefined) ?? []
    return Array.isArray(list) ? list : []
  }, [consistencyResult])

  useEffect(() => {
    let active = true
    if (!open) return
    if (!chapterId) return
    setLoading(true); setLoadError(''); setSequenceCount(undefined)
    StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId })
      .then((res) => {
        const data = res.data
        if (!data || data.project_id !== projectId) throw new Error('章节不存在或不属于当前项目')
        if (!active) return
        if (!Number.isInteger(data.sequence_count) || data.sequence_count! < 0) throw new Error('场次数量读取失败，请重试')
        setSequenceCount(data.sequence_count)
        setChapterTitle(data.title); setSavedTitle(data.title)
        const nextRaw = data?.raw_text ?? ''
        const nextCondensed = data?.condensed_text ?? ''
        setRawText(nextRaw)
        setCondensedText(nextCondensed)
        setBasisVersion(data.basis_version)
        setExplanations(data.source_explanations ?? []); setSavedExplanations(data.source_explanations ?? [])
        setRepairPreview(undefined)
        setSavedRawText(nextRaw)
        setSavedCondensedText(nextCondensed)
        setMode('raw')
        setConsistencyResult(null)
      })
      .catch(cause => {
        if (active) setLoadError(apiErrorMessage(cause))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [open, chapterId, projectId, retry])

  const handleSmartSimplify = async () => {
    if (!rawText.trim()) {
      message.warning('请先输入原文')
      return
    }
    if (notifyExistingTask(simplifyTask, {
      cancellingMessage: simplifyTaskCopy.cancellingMessage,
      runningMessage: simplifyTaskCopy.runningMessage,
    })) {
      return
    }
    setExtracting(true)
    try {
      await executeAsyncTaskCreate({
        request: () =>
          ScriptProcessingService.simplifyScriptAsyncApiV1ScriptProcessingSimplifyScriptAsyncPost({
            requestBody: {
              chapter_id: chapterId ?? null,
              script_text: rawText,
            },
          }),
        trackTaskData: trackSimplifyTaskData,
        startedMessage: simplifyTaskCopy.startedMessage,
        reusedMessage: simplifyTaskCopy.reusedMessage,
        fallbackErrorMessage: '智能精简失败',
      })
    } catch {
      // executeAsyncTaskCreate 已统一处理错误提示
    } finally {
      setExtracting(false)
    }
  }

  const handleCheckConsistency = async () => {
    const scriptText = rawText.trim()
    if (!scriptText) {
      message.warning('请先输入原文')
      return
    }
    if (notifyExistingTask(consistencyTask, {
      cancellingMessage: consistencyTaskCopy.cancellingMessage,
      runningMessage: consistencyTaskCopy.runningMessage,
    })) {
      return
    }
    setCheckingConsistency(true)
    try {
      await executeAsyncTaskCreate({
        request: () =>
          ScriptProcessingService.checkConsistencyAsyncApiV1ScriptProcessingCheckConsistencyAsyncPost({
            requestBody: { script_text: rawText, chapter_id: chapterId ?? null, source_explanations: explanations },
          }),
        trackTaskData: trackConsistencyTaskData,
        startedMessage: consistencyTaskCopy.startedMessage,
        reusedMessage: consistencyTaskCopy.reusedMessage,
        fallbackErrorMessage: '一致性检查失败',
      })
    } catch {
      // executeAsyncTaskCreate 已统一处理错误提示
    } finally {
      setCheckingConsistency(false)
    }
  }

  const handleCancelConsistencyTask = async () => {
    if (!consistencyTask?.taskId) return
    try {
      await executeTaskCancel({
        taskId: consistencyTask.taskId,
        reason: '用户在原文编辑抽屉取消一致性检查任务',
        applyCancelData: applyConsistencyCancelData,
        cancelledImmediatelyMessage: consistencyTaskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: consistencyTaskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消一致性检查任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    }
  }

  const handleOneClickOptimize = async () => {
    const scriptText = rawText.trim()
    if (!scriptText) {
      message.warning('请先输入原文')
      return
    }
    if (!consistencyResult) {
      message.info('请先进行原文一致性检查')
      return
    }
    if (notifyExistingTask(optimizeTask, {
      cancellingMessage: optimizeTaskCopy.cancellingMessage,
      runningMessage: optimizeTaskCopy.runningMessage,
    })) {
      return
    }
    if (consistencyResult.check_scope !== 'source_consistency' || consistencyResult.review_version !== reviewVersion || consistencyResult.policy_version !== SOURCE_POLICY_VERSION || consistencyResult.source_version !== rawVersion || consistencyResult.explanation_version !== explanationVersion) {
      message.warning('检查依据已变化或为旧版检查，请重新检查'); return
    }
    if ((consistencyResult.issues ?? []).some((item, index) => decisions[index] === 'repair' && item.classification === 'ambiguity' && !intent[index]?.trim())) {
      message.info('请先明确所选歧义的处理意见，或将其设为暂不确定'); return
    }
    const selected = (consistencyResult.issues ?? []).flatMap((item, index) => decisions[index] === 'repair' && item.target !== 'explanation' ? [{ ...item, resolution: 'repair', instruction: intent[index] ?? '' }] : [])
    if (!selected.length) { message.info('请先选择已确认的原文异常'); return }
    setOptimizingScript(true)
    try {
      await executeAsyncTaskCreate({
        request: () =>
          ScriptProcessingService.optimizeScriptAsyncApiV1ScriptProcessingOptimizeScriptAsyncPost({
            requestBody: {
              chapter_id: chapterId ?? null,
              script_text: rawText,
              consistency: { ...consistencyResult, issues: selected },
              source_explanations: explanations,
            },
          }),
        trackTaskData: trackOptimizeTaskData,
        startedMessage: optimizeTaskCopy.startedMessage,
        reusedMessage: optimizeTaskCopy.reusedMessage,
        fallbackErrorMessage: '一键优化失败',
      })
    } catch {
      // executeAsyncTaskCreate 已统一处理错误提示
    } finally {
      setOptimizingScript(false)
    }
  }

  const handleCancelSimplifyTask = async () => {
    if (!simplifyTask?.taskId) return
    try {
      await executeTaskCancel({
        taskId: simplifyTask.taskId,
        reason: '用户在原文编辑抽屉取消智能精简任务',
        applyCancelData: applySimplifyCancelData,
        cancelledImmediatelyMessage: simplifyTaskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: simplifyTaskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消智能精简任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    }
  }

  const handleCancelOptimizeTask = async () => {
    if (!optimizeTask?.taskId) return
    try {
      await executeTaskCancel({
        taskId: optimizeTask.taskId,
        reason: '用户在原文编辑抽屉取消一键优化任务',
        applyCancelData: applyOptimizeCancelData,
        cancelledImmediatelyMessage: optimizeTaskCopy.cancelledImmediatelyMessage,
        cancelRequestedMessage: optimizeTaskCopy.cancelRequestedMessage,
        fallbackErrorMessage: '取消一键优化任务失败',
      })
    } catch {
      // executeTaskCancel 已统一处理错误提示
    }
  }

  useRelationTaskNotification({
    task: consistencyTask,
    settledTask: consistencySettledTask,
    title: consistencyTaskCopy.title,
    sourceLabel: '章节原文编辑',
    runningDescription: consistencyTaskCopy.runningDescription,
    cancellingDescription: consistencyTaskCopy.cancellingDescription,
    successDescription: consistencyTaskCopy.successDescription,
    cancelledDescription: consistencyTaskCopy.cancelledDescription,
    failedDescription: consistencyTaskCopy.failedDescription,
    onCancel: consistencyTask ? () => void handleCancelConsistencyTask() : null,
  })

  useRelationTaskNotification({
    task: simplifyTask,
    settledTask: simplifySettledTask,
    title: simplifyTaskCopy.title,
    sourceLabel: '章节原文编辑',
    runningDescription: simplifyTaskCopy.runningDescription,
    cancellingDescription: simplifyTaskCopy.cancellingDescription,
    successDescription: simplifyTaskCopy.successDescription,
    cancelledDescription: simplifyTaskCopy.cancelledDescription,
    failedDescription: simplifyTaskCopy.failedDescription,
    onCancel: simplifyTask ? () => void handleCancelSimplifyTask() : null,
  })

  useRelationTaskNotification({
    task: optimizeTask,
    settledTask: optimizeSettledTask,
    title: optimizeTaskCopy.title,
    sourceLabel: '章节原文编辑',
    runningDescription: optimizeTaskCopy.runningDescription,
    cancellingDescription: optimizeTaskCopy.cancellingDescription,
    successDescription: optimizeTaskCopy.successDescription,
    cancelledDescription: optimizeTaskCopy.cancelledDescription,
    failedDescription: optimizeTaskCopy.failedDescription,
    onCancel: optimizeTask ? () => void handleCancelOptimizeTask() : null,
  })

  const rawChanged = rawText !== savedRawText
  const hasUnsavedChanges = JSON.stringify(explanations) !== JSON.stringify(savedExplanations) || chapterTitle.trim() !== savedTitle || rawChanged || condensedText !== savedCondensedText
  const impact = rawChanged && !!sequenceCount
    ? `修改章节原文不会自动更新已有场次的划分和原文范围。本章已有 ${sequenceCount} 个场次，保存后需要重新核对。已有设计和素材保留，继续试拍前还需核对相关设计与计划依据。`
    : undefined
  useEffect(() => { setConfirmRaw(undefined) }, [rawText])

  /** 所有视图共用变更判断；离开确认会展示同一影响说明，保存不会更新任何场次。 */
  const handleSave = async (confirmed = false): Promise<boolean> => {
    if (!chapterId || actionsLoading || sequenceCount === undefined) return false
    if (!hasUnsavedChanges) return true
    if (!chapterTitle.trim()) { setSaveError('请输入章节名称'); return false }
    if (impact && !confirmed) { setConfirmRaw(rawText); return false }
    setSaving(true); setSaveError('')
    try {
      const saved = await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({ chapterId, requestBody: {
        expected_basis_version: basisVersion,
        ...(chapterTitle.trim() !== savedTitle ? { title: chapterTitle.trim() } : {}),
        ...(rawChanged ? { raw_text: rawText } : {}),
        ...(JSON.stringify(explanations) !== JSON.stringify(savedExplanations) ? { source_explanations: explanations } : {}),
        ...(condensedText !== savedCondensedText ? { condensed_text: condensedText } : {}),
      } })
      flushSync(() => {
        setChapterTitle(chapterTitle.trim()); setSavedTitle(chapterTitle.trim())
        setRawText(rawText); setSavedRawText(rawText)
        setCondensedText(condensedText); setSavedCondensedText(condensedText)
        setBasisVersion(saved.data?.basis_version)
        setSavedExplanations(explanations)
        setConfirmRaw(undefined); setSaving(false)
        if (rawChanged && sequenceCount > 0) setNeedsReview(true)
      })
      onSaved?.({ title: chapterTitle.trim(), rawText: rawText, condensedText: condensedText })
      message.success('章节已保存')
      return true
    } catch (cause) { setSaveError(apiErrorMessage(cause)); return false }
    finally { setSaving(false) }
  }
  const guard = useWorkspaceDraft({ name: '章节编辑', dirty: open && !loadError && hasUnsavedChanges,
    busy: saving || extracting || checkingConsistency || optimizingScript || !!simplifyTask || !!optimizeTask || !!consistencyTask,
    saveWarning: impact, save: () => handleSave(true), discard: () => {
      flushSync(() => {
        setExplanations(savedExplanations); setChapterTitle(savedTitle); setRawText(savedRawText); setCondensedText(savedCondensedText); setConfirmRaw(undefined)
      })
    } })
  const handleRequestClose = () => guard(onClose)
  useEffect(() => {
    if (saveError || (confirmRaw !== undefined && confirmRaw === rawText && impact)) {
      saveFeedback.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [saveError, confirmRaw, rawText, impact])

  const mockHistory: HistoryItem[] = useMemo(
    () => [
      {
        id: 'h-1',
        at: Date.now() - 1000 * 60 * 60 * 2,
        rawText: '【原文】示例版本 1（预置数据）',
        condensedText: '【精简】示例版本 1（预置数据）',
      },
      {
        id: 'h-2',
        at: Date.now() - 1000 * 60 * 22,
        rawText: '【原文】示例版本 2（预置数据）',
        condensedText: '【精简】示例版本 2（预置数据）',
      },
    ],
    [],
  )

  return (
    <>
      <ResourceEditorFrame id={drawerId} open={open} drawer className="chapter-editor-drawer"
        title={savedTitle ? `编辑章节 · ${savedTitle}` : '编辑章节'}
        backLabel="返回" onClose={historyOpen ? () => setHistoryOpen(false) : handleRequestClose}
        actions={<Space wrap>
          <Button ref={historyTrigger} icon={<HistoryOutlined aria-hidden />} disabled={actionsLoading}
            onClick={() => setHistoryOpen(true)}>版本历史</Button>
          <Button aria-label="保存" type="primary" icon={<SaveOutlined aria-hidden />} loading={saving}
            disabled={actionsLoading || !hasUnsavedChanges} onClick={() => void handleSave()}>保存</Button>
        </Space>}
      >
        <Alert type="info" showIcon message="改变章节内容后不会自动更新场次。" description="此处的章节内容指章节原文；仅修改名称或精简文本不会改变场次原文依据。" style={{ marginBottom: 12 }} />
        {loadError && <Alert type="error" showIcon message={loadError} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
        {!loading && !loadError && <label className="chapter-editor-field">章节名称<Input aria-label="章节名称" value={chapterTitle} disabled={actionsLoading} onChange={event => setChapterTitle(event.target.value)} /></label>}
        <div ref={saveFeedback}>
          {saveError && <Alert type="error" showIcon message={saveError} />}
          {confirmRaw === rawText && impact && <Alert type="warning" showIcon message={impact} action={<Space wrap>
            <Button disabled={saving} onClick={() => setConfirmRaw(undefined)}>继续编辑</Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave(true)}>确认保存原文</Button>
          </Space>} style={{ marginBottom: 12 }} />}
        </div>
        {needsReview && <Alert type="warning" message="原文已保存，请逐场核对原文范围及设计与计划依据。" action={<Button onClick={() => guard(onReviewSequences)}>查看本章场次并核对</Button>} style={{ marginBottom: 12 }} />}
        {!loading && !loadError && <div className="chapter-editor-tools">
          <Space wrap role="group" aria-label="正文视图">
            <Button aria-label="原文" aria-pressed={mode === 'raw'} disabled={actionsLoading} onClick={() => setMode('raw')}>原文</Button>
            <Button aria-pressed={mode === 'condensed'} disabled={actionsLoading || !condensedText.trim()} onClick={() => setMode('condensed')}>精简内容</Button>
            <Button aria-label="对比" aria-pressed={mode === 'compare'} disabled={actionsLoading} onClick={() => setMode('compare')}>对比</Button>
          </Space>
          <Space wrap aria-label="原文工具" role="group">
            <Button
              icon={<ReloadOutlined aria-hidden />}
              loading={checkingConsistency || !!consistencyTask}
              disabled={actionsLoading || !!consistencyTask}
              onClick={() => void handleCheckConsistency()}
            >
              {consistencyTask ? '检查中' : '原文一致性检查'}
            </Button>
            {consistencyTask ? (
              <Button
                danger
                icon={<CloseCircleOutlined aria-hidden />}
                disabled={consistencyTask.cancelRequested}
                onClick={() => void handleCancelConsistencyTask()}
              >
                {consistencyTask.cancelRequested ? '正在取消' : '取消检查'}
              </Button>
            ) : null}
            <Button
              icon={<ThunderboltOutlined aria-hidden />}
              loading={extracting || !!simplifyTask}
              disabled={actionsLoading || !!simplifyTask}
              onClick={() => void handleSmartSimplify()}
            >
              {simplifyTask ? '精简中' : '智能精简'}
            </Button>
            {simplifyTask ? (
              <Button
                danger
                icon={<CloseCircleOutlined aria-hidden />}
                disabled={simplifyTask.cancelRequested}
                onClick={() => void handleCancelSimplifyTask()}
              >
                {simplifyTask.cancelRequested ? '正在取消' : '取消精简'}
              </Button>
            ) : null}
          </Space>
          <div className="chapter-editor-meta"><Tag>{plainWordCount} 字</Tag><Tag>{paragraphCount} 段</Tag></div>
        </div>}
        {loading ? (
          <div className="flex justify-center items-center py-10">
            <Spin />
          </div>
        ) : loadError ? null : mode === 'compare' ? (
          <div className="chapter-compare grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <div className="chapter-editor-label">原文</div>
              <Input.TextArea
                aria-label="对比原文"
                value={rawText}
                onChange={event => setRawText(event.target.value)}
                rows={14}
                disabled={actionsLoading}
                className="chapter-editor-text"
              />
            </div>
            <div className="flex flex-col">
              <div className="chapter-editor-label">精简内容</div>
              <Input.TextArea
                aria-label="对比精简内容"
                value={condensedText}
                onChange={event => setCondensedText(event.target.value)}
                rows={14}
                disabled={actionsLoading}
                className="chapter-editor-text"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input.TextArea
              aria-label={mode === 'raw' ? '章节原文' : '精简内容'}
              value={editorText}
              onChange={(e) => {
                const v = e.target.value
                if (mode === 'raw') setRawText(v)
                if (mode === 'condensed') setCondensedText(v)
              }}
            disabled={actionsLoading}
              placeholder={mode === 'raw' ? '编辑章节原文…' : '编辑精简内容…'}
              rows={16}
              className="chapter-editor-text"
            />
            <SourceExplanationsEditor items={explanations} version={rawVersion} rawText={rawText} disabled={actionsLoading} onChange={setExplanations} />
            {consistencyResult && (consistencyResult.review_version !== reviewVersion || consistencyResult.policy_version !== SOURCE_POLICY_VERSION || consistencyResult.source_version !== rawVersion || consistencyResult.explanation_version !== explanationVersion) && <Alert type="warning" message="检查结果已过期或为旧版检查，请重新检查后修复" />}
            {repairPreview && <Card title="原文异常修复预览">
              <p>修改前</p><pre className="chapter-editor-text" style={{ whiteSpace: 'pre-wrap' }}>{repairPreview.source}</pre>
              <p>修改后</p><pre className="chapter-editor-text" style={{ whiteSpace: 'pre-wrap' }}>{repairPreview.text}</pre>
              <Space><Button disabled={repairPreview.reviewVersion !== reviewVersion || repairPreview.policyVersion !== SOURCE_POLICY_VERSION || repairPreview.source !== rawText || repairPreview.explanationVersion !== explanationVersion} onClick={() => { setRawText(repairPreview.text); setRepairPreview(undefined) }}>应用修复稿</Button>
              <Button type="text" onClick={() => setRepairPreview(undefined)}>放弃建议</Button></Space>
            </Card>}
            {consistencyResult ? (
              <Card
                size="small"
                title={consistencyResult.check_scope === 'source_consistency' ? '原文一致性检查结果' : '角色混淆检查结果（旧版）'}
                extra={
                  <Space wrap>
                    <Tag color={consistencyResult.has_issues ? 'red' : 'green'}>
                      {consistencyResult.has_issues ? '发现问题' : '无问题'}
                    </Tag>
                    <Tag>问题：{consistencyIssues.length}</Tag>
                    <Button
                      size="small"
                      type="primary"
                      icon={<ThunderboltOutlined aria-hidden />}
                      loading={optimizingScript || !!optimizeTask}
                      disabled={actionsLoading || !!optimizeTask}
                      onClick={() => void handleOneClickOptimize()}
                    >
                      {optimizeTask ? '生成中' : '生成修复建议'}
                    </Button>
                    {optimizeTask ? (
                      <Button
                        size="small"
                        danger
                        icon={<CloseCircleOutlined aria-hidden />}
                        disabled={optimizeTask.cancelRequested}
                        onClick={() => void handleCancelOptimizeTask()}
                      >
                        {optimizeTask.cancelRequested ? '正在取消' : '取消优化'}
                      </Button>
                    ) : null}
                  </Space>
                }
              >
                {consistencyIssues.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现原文一致性问题" />
                ) : (
                  <List
                    size="small"
                    dataSource={consistencyIssues}
                    renderItem={(it: any, idx) => it.target === 'explanation' ? (
                      <List.Item><Space direction="vertical">
                        <Tag>补充解释问题</Tag>
                        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{explanations.find(item => item.id === it.explanation_id)?.text ?? '条目已移除'}</div>
                        <div>{it.description}</div><div>建议：{it.suggestion}</div>
                        <Button disabled={actionsLoading || consistencyResult.review_version !== reviewVersion || consistencyResult.policy_version !== SOURCE_POLICY_VERSION || consistencyResult.source_version !== rawVersion} onClick={() => {
                          setExplanations(previous => previous.map(item => item.id === it.explanation_id ? { ...item, source_version: '', policy_version: undefined } : item))
                          message.info('已退出采用，解释内容保留待调整')
                        }}>确认越界，退出采用</Button>
                        <div>若判断不成立，可保留解释；AI 疑点不会自动作废解释。需要修改时请在上方解释条目中编辑。</div>
                      </Space></List.Item>
                    ) : (
                      <List.Item>
                        <div className="min-w-0">
                          <div className="font-medium">
                            {({ language: '语言表达', semantics: '语义表达', character_confusion: '身份指代', spatial: '文字空间关系', action_time: '文字时序', prop_state: '道具描述', fact: '文本事实' } as Record<string, string>)[it.issue_type] ?? '文字问题'} · 问题 {idx + 1}
                          </div>
                          <div className="text-sm">{it?.description}</div>
                          <Tag>{({ contradiction: '明确矛盾', ambiguity: '待确认歧义', optional: '可选补充' } as Record<string, string>)[it.classification] ?? '待确认'}</Tag>
                          {it.excerpt && <blockquote>{it.excerpt}</blockquote>}
                          <Select aria-label={`问题${idx + 1}性质`} placeholder="确认问题性质" value={decisions[idx]} style={{ width: 210 }} onChange={value => {
                              setDecisions(previous => ({ ...previous, [idx]: value }))
                              setExplanations(previous => previous.filter(item => !(item.kind === 'normal' && item.excerpt === it.excerpt && item.source_version === rawVersion)))
                              if (value === 'normal' && it.excerpt && rawVersion) setExplanations(previous => [...previous, { id: crypto.randomUUID(), policy_version: SOURCE_POLICY_VERSION, kind: 'normal', excerpt: it.excerpt, text: '用户确认此处表述正常，无需处理。', source_version: rawText.split(it.excerpt).length === 2 ? rawVersion : '' }])
                            }}
                            options={[{ value: 'repair', label: '原文异常，需要修复' }, { value: 'explain', label: '正常表述，需要解释' }, { value: 'normal', label: '正常，无需处理' }, { value: 'unknown', label: '暂不确定' }]} />
                          {(decisions[idx] === 'repair' || decisions[idx] === 'explain') && <>
                            {!!it.candidates?.length && <Select aria-label={`问题${idx + 1}候选解释`} placeholder="选择解释或填写处理意见" style={{ width: '100%' }} options={it.candidates.map((text: string) => ({ value: text, label: text }))} onChange={value => setIntent(previous => ({ ...previous, [idx]: value }))} />}
                            <Input.TextArea aria-label={`问题${idx + 1}处理意见`} placeholder="处理意见或原意解释；有多种解释时请明确意图" value={intent[idx] ?? ''} onChange={event => setIntent(previous => ({ ...previous, [idx]: event.target.value }))} />
                          </>}
                          {decisions[idx] === 'explain' && <Button disabled={!intent[idx]?.trim() || consistencyResult.source_version !== rawVersion} onClick={() => {
                            setExplanations(previous => [...previous, { id: crypto.randomUUID(), policy_version: SOURCE_POLICY_VERSION, excerpt: it.excerpt ?? '', text: intent[idx], source_version: !it.excerpt || rawText.split(it.excerpt).length === 2 ? rawVersion : '' }])
                            setDecisions(previous => ({ ...previous, [idx]: 'normal' }))
                          }}>确认并添加解释</Button>}

                          {it?.character_candidates?.length ? (
                            <div className="text-xs text-gray-500 mt-1">候选角色：{it.character_candidates.join('、')}</div>
                          ) : null}
                          {it?.suggestion ? (
                            <div className="text-xs text-gray-500 mt-1">建议：{it.suggestion}</div>
                          ) : null}
                          {it?.affected_lines ? (
                            <div className="text-xs text-gray-400 mt-1">
                              影响范围：{it.affected_lines.start_line ?? '-'}–{it.affected_lines.end_line ?? '-'}
                            </div>
                          ) : null}
                        </div>
                      </List.Item>
                    )}
                  />
                )}
                {consistencyResult.summary ? (
                  <div className="text-xs text-gray-500 mt-2">{String(consistencyResult.summary)}</div>
                ) : null}
              </Card>
            ) : null}
          </div>
        )}
      </ResourceEditorFrame>

      <Modal className="chapter-editor-history"
        title={
          <div className="flex items-center gap-2">
            <HistoryOutlined aria-hidden /> 历史版本
          </div>
        }
        open={historyOpen}
        focusTriggerAfterClose={false}
        afterClose={() => historyTrigger.current?.focus({ preventScroll: true })}
        onCancel={() => setHistoryOpen(false)}
        width={920}
        footer={
          <Button type="primary" onClick={() => setHistoryOpen(false)}>
            关闭
          </Button>
        }
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        {/* TODO: 历史版本接口未接入，当前为预置数据；后续接入后按时间线渲染即可 */}
        <div className="text-xs text-gray-500 mb-3">内容默认折叠，仅展示时间线节点。</div>
        <div className="space-y-3">
          {mockHistory.map((h) => (
            <div key={h.id} className="border border-gray-200 rounded-lg p-3 bg-white">
              <div className="chapter-editor-meta mb-2">{new Date(h.at).toLocaleString()}</div>
              <Collapse
                items={[
                  {
                    key: 'content',
                    label: '展开查看内容',
                    children: (
                      <div className="chapter-compare grid grid-cols-2 gap-4">
                        <div>
                          <div className="chapter-editor-label">原文内容</div>
                          <Input.TextArea
                            value={h.rawText}
                            readOnly
                            rows={8}
                            className="chapter-editor-text"
                          />
                        </div>
                        <div>
                          <div className="chapter-editor-label">精简内容</div>
                          <Input.TextArea
                            value={h.condensedText}
                            readOnly
                            rows={8}
                            className="chapter-editor-text"
                          />
                        </div>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
