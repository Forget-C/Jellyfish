import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Empty, Input, List, Modal, Space, Spin, Tag, message } from 'antd'
import { flushSync } from 'react-dom'
import {
  CloseCircleOutlined,
  DiffOutlined,
  FileTextOutlined,
  HistoryOutlined,
  ReloadOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { ScriptProcessingService, StudioChaptersService } from '../../../../services/generated'
import type { ScriptConsistencyCheckResult } from '../../../../services/generated'
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
import { directingError } from '../../directing/common'
import { useWorkspaceDraft } from '../../directing/WorkspaceDrafts'

type EditorMode = 'raw' | 'condensed' | 'compare'

type HistoryItem = {
  id: string
  at: number
  rawText: string
  condensedText: string
}

export function ChapterRawTextEditorModal({
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
  const [editorText, setEditorText] = useState('')
  const [compareRaw, setCompareRaw] = useState('')
  const [compareCondensed, setCompareCondensed] = useState('')
  const [consistencyResult, setConsistencyResult] = useState<ScriptConsistencyCheckResult | null>(null)

  const applyConsistencyTaskResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取一致性检查结果失败',
      failedFallbackMessage: '一致性检查失败',
      onSucceeded: (resultValue) => {
        setConsistencyResult(resultValue as ScriptConsistencyCheckResult)
        const result = resultValue as Record<string, any>
        if (result?.has_issues) {
          message.warning(`发现 ${Array.isArray(result.issues) ? result.issues.length : 0} 个角色混淆问题`)
        } else {
          message.success('未发现角色混淆问题')
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
        if (mode === 'compare') {
          setCompareCondensed(simplified)
        } else {
          setMode('condensed')
          setEditorText(simplified)
        }
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
        const optimized = String(result?.optimized_script_text ?? '').trim()
        if (!optimized) {
          message.error('一键优化失败：未返回有效内容')
          return
        }
        setRawText(optimized)
        setEditorText(optimized)
        setMode('raw')
        setCompareRaw(optimized)
        message.success('一键优化完成')
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
        setSavedRawText(nextRaw)
        setSavedCondensedText(nextCondensed)
        setMode('raw')
        setEditorText(nextRaw)
        setCompareRaw(nextRaw)
        setCompareCondensed(nextCondensed)
        setConsistencyResult(null)
      })
      .catch(cause => {
        if (active) setLoadError(directingError(cause))
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
            requestBody: { script_text: scriptText, chapter_id: chapterId ?? null },
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
        reason: '用户在原文编辑弹窗取消一致性检查任务',
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
      message.info('请先进行角色混淆检查')
      return
    }
    if (notifyExistingTask(optimizeTask, {
      cancellingMessage: optimizeTaskCopy.cancellingMessage,
      runningMessage: optimizeTaskCopy.runningMessage,
    })) {
      return
    }
    setOptimizingScript(true)
    try {
      await executeAsyncTaskCreate({
        request: () =>
          ScriptProcessingService.optimizeScriptAsyncApiV1ScriptProcessingOptimizeScriptAsyncPost({
            requestBody: {
              chapter_id: chapterId ?? null,
              script_text: scriptText,
              consistency: consistencyResult as any,
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
        reason: '用户在原文编辑弹窗取消智能精简任务',
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
        reason: '用户在原文编辑弹窗取消一键优化任务',
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

  const handleBackToRaw = () => {
    setMode('raw')
    setEditorText(rawText)
  }

  const handleViewCondensed = () => {
    if (!condensedText.trim()) {
      message.info('暂无精简内容')
      return
    }
    setMode('condensed')
    setEditorText(condensedText)
  }

  const nextRaw = mode === 'compare' ? compareRaw : rawText
  const nextCondensed = mode === 'compare' ? compareCondensed : condensedText
  const rawChanged = nextRaw !== savedRawText
  const hasUnsavedChanges = chapterTitle.trim() !== savedTitle || rawChanged || nextCondensed !== savedCondensedText
  const impact = rawChanged && !!sequenceCount
    ? `修改章节原文不会自动更新已有场次的划分和原文范围。本章已有 ${sequenceCount} 个场次，保存后需要重新核对。已有设计和素材保留，继续试拍前还需核对相关设计与计划依据。`
    : undefined
  useEffect(() => { setConfirmRaw(undefined) }, [nextRaw])

  /** 所有视图共用变更判断；离开确认会展示同一影响说明，保存不会更新任何场次。 */
  const handleSave = async (confirmed = false): Promise<boolean> => {
    if (!chapterId || actionsLoading || sequenceCount === undefined) return false
    if (!hasUnsavedChanges) return true
    if (!chapterTitle.trim()) { setSaveError('请输入章节名称'); return false }
    if (impact && !confirmed) { setConfirmRaw(nextRaw); return false }
    setSaving(true); setSaveError('')
    try {
      await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({ chapterId, requestBody: {
        ...(chapterTitle.trim() !== savedTitle ? { title: chapterTitle.trim() } : {}),
        ...(rawChanged ? { raw_text: nextRaw } : {}),
        ...(nextCondensed !== savedCondensedText ? { condensed_text: nextCondensed } : {}),
      } })
      flushSync(() => {
        setChapterTitle(chapterTitle.trim()); setSavedTitle(chapterTitle.trim())
        setRawText(nextRaw); setSavedRawText(nextRaw)
        setCondensedText(nextCondensed); setSavedCondensedText(nextCondensed)
        setConfirmRaw(undefined); setSaving(false)
        if (rawChanged && sequenceCount > 0) setNeedsReview(true)
      })
      onSaved?.({ title: chapterTitle.trim(), rawText: nextRaw, condensedText: nextCondensed })
      message.success('章节已保存')
      return true
    } catch (cause) { setSaveError(directingError(cause)); return false }
    finally { setSaving(false) }
  }
  const guard = useWorkspaceDraft({ name: '章节编辑', dirty: open && !loadError && hasUnsavedChanges,
    busy: saving || extracting || checkingConsistency || optimizingScript || !!simplifyTask || !!optimizeTask || !!consistencyTask,
    saveWarning: impact, save: () => handleSave(true), discard: () => {
      flushSync(() => {
        setChapterTitle(savedTitle); setRawText(savedRawText); setCondensedText(savedCondensedText)
        setCompareRaw(savedRawText); setCompareCondensed(savedCondensedText)
        setEditorText(mode === 'condensed' ? savedCondensedText : savedRawText); setConfirmRaw(undefined)
      })
    } })
  const handleRequestClose = () => guard(onClose)

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
      <Modal
        className="chapter-editor-modal"
        title={
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FileTextOutlined aria-hidden />{' '}
              {savedTitle ? `编辑章节 · ${savedTitle}` : '编辑章节'}
              <Tag color="blue">{plainWordCount} 字</Tag>
              <Tag color="default">{paragraphCount} 段</Tag>
            </div>
            <Space size="small" wrap>
              <Button aria-label="保存" size="small" type="primary" icon={<SaveOutlined aria-hidden />} loading={actionsLoading || saving} disabled={actionsLoading || !hasUnsavedChanges} onClick={() => void handleSave()}>
                保存
              </Button>
              <Button
                size="small"
                icon={<ReloadOutlined aria-hidden />}
                loading={checkingConsistency || !!consistencyTask}
                disabled={actionsLoading || !!consistencyTask}
                onClick={() => void handleCheckConsistency()}
              >
                {consistencyTask ? '检查中' : '角色混淆检查'}
              </Button>
              {consistencyTask ? (
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined aria-hidden />}
                  disabled={consistencyTask.cancelRequested}
                  onClick={() => void handleCancelConsistencyTask()}
                >
                  {consistencyTask.cancelRequested ? '正在取消' : '取消检查'}
                </Button>
              ) : null}
              <Button
                size="small"
                icon={<ThunderboltOutlined aria-hidden />}
                loading={extracting || !!simplifyTask}
                disabled={actionsLoading || !!simplifyTask}
                onClick={() => void handleSmartSimplify()}
              >
                {simplifyTask ? '精简中' : '智能精简'}
              </Button>
              {simplifyTask ? (
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined aria-hidden />}
                  disabled={simplifyTask.cancelRequested}
                  onClick={() => void handleCancelSimplifyTask()}
                >
                  {simplifyTask.cancelRequested ? '正在取消' : '取消精简'}
                </Button>
              ) : null}
              {mode === 'condensed' ? (
                <Button size="small" icon={<ReloadOutlined aria-hidden />} loading={actionsLoading} disabled={actionsLoading} onClick={handleBackToRaw}>
                  回到原文
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<ReloadOutlined aria-hidden />}
                  loading={actionsLoading}
                  disabled={actionsLoading || !condensedText.trim()}
                  onClick={handleViewCondensed}
                >
                  查看精简
                </Button>
              )}
              <Button
                size="small"
                icon={<DiffOutlined aria-hidden />}
                loading={actionsLoading}
                disabled={actionsLoading}
                type={mode === 'compare' ? 'primary' : 'default'}
                onClick={() => {
                  if (mode === 'compare') {
                    setRawText(compareRaw); setCondensedText(compareCondensed)
                    setMode('raw')
                    setEditorText(compareRaw)
                    return
                  }
                  setCompareRaw(rawText)
                  setCompareCondensed(condensedText)
                  setMode('compare')
                }}
              >
                对比模式
              </Button>
              <Button size="small" icon={<HistoryOutlined aria-hidden />} loading={actionsLoading} disabled={actionsLoading} onClick={() => setHistoryOpen(true)}>
                版本历史
              </Button>
            </Space>
          </div>
        }
        open={open}
        onCancel={() => {
          handleRequestClose()
        }}
        width={900}
        footer={
          <Button type="primary" disabled={saving} onClick={handleRequestClose}>
            关闭
          </Button>
        }
        styles={{
          header: { paddingRight: 48 },
          body: { maxHeight: '70vh', overflow: 'auto', paddingTop: 12 },
        }}
      >
        <Alert type="info" showIcon message="改变章节内容后不会自动更新场次。" description="此处的章节内容指章节原文；仅修改名称或精简文本不会改变场次原文依据。" style={{ marginBottom: 12 }} />
        {loadError && <Alert type="error" showIcon message={loadError} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
        {saveError && <Alert type="error" showIcon message={saveError} />}
        {!loading && !loadError && <label>章节名称<Input autoFocus aria-label="章节名称" value={chapterTitle} disabled={actionsLoading} onChange={event => setChapterTitle(event.target.value)} style={{ marginBottom: 12 }} /></label>}
        {confirmRaw === nextRaw && impact && <Alert type="warning" showIcon message={impact} action={<Space wrap>
          <Button disabled={saving} onClick={() => setConfirmRaw(undefined)}>继续编辑</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave(true)}>确认保存原文</Button>
        </Space>} style={{ marginBottom: 12 }} />}
        {needsReview && <Alert type="warning" message="原文已保存，请逐场核对原文范围及设计与计划依据。" action={<Button onClick={() => guard(onReviewSequences)}>查看本章场次并核对</Button>} style={{ marginBottom: 12 }} />}
        {loading ? (
          <div className="flex justify-center items-center py-10">
            <Spin />
          </div>
        ) : loadError ? null : mode === 'compare' ? (
          <div className="chapter-compare grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">原文</div>
              <Input.TextArea
                aria-label="对比原文"
                value={compareRaw}
                onChange={(e) => { setCompareRaw(e.target.value); setRawText(e.target.value) }}
                rows={14}
                disabled={actionsLoading}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">精简内容</div>
              <Input.TextArea
                aria-label="对比精简内容"
                value={compareCondensed}
                onChange={(e) => { setCompareCondensed(e.target.value); setCondensedText(e.target.value) }}
                rows={14}
                disabled={actionsLoading}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
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
                setEditorText(v)
                if (mode === 'raw') setRawText(v)
                if (mode === 'condensed') setCondensedText(v)
              }}
            disabled={actionsLoading}
              placeholder={mode === 'raw' ? '编辑章节原文…' : '编辑精简内容…'}
              rows={16}
              style={{ resize: 'none', background: '#fdfdfd' }}
            />
            {consistencyResult ? (
              <Card
                size="small"
                title="角色混淆检查结果"
                extra={
                  <Space wrap>
                    <Tag color={consistencyResult.has_issues ? 'red' : 'green'}>
                      {consistencyResult.has_issues ? '发现问题' : '无问题'}
                    </Tag>
                    <Tag>issues：{consistencyIssues.length}</Tag>
                    <Button
                      size="small"
                      type="primary"
                      icon={<ThunderboltOutlined aria-hidden />}
                      loading={optimizingScript || !!optimizeTask}
                      disabled={actionsLoading || !!optimizeTask}
                      onClick={() => void handleOneClickOptimize()}
                    >
                      {optimizeTask ? '优化中' : '一键优化'}
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
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未发现角色混淆问题" />
                ) : (
                  <List
                    size="small"
                    dataSource={consistencyIssues}
                    renderItem={(it: any, idx) => (
                      <List.Item>
                        <div className="min-w-0">
                          <div className="font-medium">
                            {it?.issue_type ? `[${it.issue_type}] ` : ''}
                            Issue {idx + 1}
                          </div>
                          <div className="text-sm">{it?.description}</div>
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
      </Modal>

      <Modal
        title={
          <div className="flex items-center gap-2">
            <HistoryOutlined aria-hidden /> 历史版本
          </div>
        }
        open={historyOpen}
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
              <div className="text-sm font-medium mb-2">{new Date(h.at).toLocaleString()}</div>
              <Collapse
                items={[
                  {
                    key: 'content',
                    label: '展开查看内容',
                    children: (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="text-xs text-gray-500 mb-2">原文内容</div>
                          <Input.TextArea
                            value={h.rawText}
                            readOnly
                            rows={8}
                            style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
                          />
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-2">精简内容</div>
                          <Input.TextArea
                            value={h.condensedText}
                            readOnly
                            rows={8}
                            style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
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
