import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Collapse, Empty, Input, List, Modal, Space, Spin, Tag, Tooltip, message } from 'antd'
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
} from '../../project/ProjectWorkbench/chapterDivisionTasks'
import { executeTaskCancel, notifyExistingTask } from '../../components/taskActionHelpers'
import { handleTaskResultSafely } from '../../components/taskResultHelpers'
import { useRelationTaskNotification } from '../../components/taskNotificationHelpers'
import { useTaskPageContext } from '../../components/taskPageContext'
import { TASK_COPY } from '../../components/taskCopy'
// 阶段 B ③（审计 §4.3 模式 6）：任务失败原文（`data.error`）与信封错误原文都要过管道
import { showUserError } from '../../components/userFacingMessage'
// 阶段 B ③（审计 §4.3 模式 2）：问题类型枚举原值不许直渲
import { SCRIPT_ISSUE_TYPE, labelFor } from '../../components/enumLabels'

type EditorMode = 'raw' | 'condensed' | 'compare'

type HistoryItem = {
  id: string
  at: number
  rawText: string
  condensedText: string
}

/**
 * 这三个 AI 动作改为同步调用：本环境没有配置后台任务 worker（Celery broker
 * 不可达、也没有 worker 进程），异步接口只写任务记录、无人执行。同步接口
 * `/api/v1/script-processing/*` 会在本次 HTTP 请求内跑完 LLM 并直接返回结果，
 * 代价是请求阻塞数十秒，因此按钮全程 loading 并禁止重复点击。
 */
const SYNC_AI_HINT =
  '本环境未配置后台任务 worker，AI 会在本次请求内同步执行，通常需要数十秒，请不要重复点击或关闭弹窗'
const SYNC_CONSISTENCY_LOADING = 'AI 正在同步检查角色混淆，通常需要数十秒，请不要重复点击…'
const SYNC_SIMPLIFY_LOADING = 'AI 正在同步精简剧本，通常需要数十秒，请不要重复点击…'
const SYNC_OPTIMIZE_LOADING = 'AI 正在同步优化剧本，通常需要数十秒，请不要重复点击…'
const SYNC_CONSISTENCY_MESSAGE_KEY = 'chapter-raw-sync-consistency'
const SYNC_SIMPLIFY_MESSAGE_KEY = 'chapter-raw-sync-simplify'
const SYNC_OPTIMIZE_MESSAGE_KEY = 'chapter-raw-sync-optimize'

/**
 * 把后端统一错误信封 `{code, message, data, meta}` 解析成可读提示：
 * 结构化细节优先取 `meta.error.message`，其次信封 `message` / `detail`，
 * 最后回退到客户端 ApiError 自带的 message（与 PromptFlowPage 的约定一致）。
 */
function describeEnvelopeError(error: unknown, fallback: string): string {
  if (!error) return fallback
  if (typeof error === 'string') return error.trim() || fallback
  const err = error as { body?: unknown; message?: unknown }
  const body = err.body
  if (body && typeof body === 'object') {
    const envelope = body as Record<string, unknown>
    const meta = (envelope.meta ?? {}) as Record<string, unknown>
    const metaError = (meta.error ?? {}) as Record<string, unknown>
    const metaMessage = metaError.message
    if (typeof metaMessage === 'string' && metaMessage.trim()) return metaMessage
    const envelopeMessage = envelope.message
    if (typeof envelopeMessage === 'string' && envelopeMessage.trim()) return envelopeMessage
    const detail = envelope.detail
    if (typeof detail === 'string' && detail.trim()) return detail
  }
  if (typeof err.message === 'string' && err.message.trim()) return err.message
  return fallback
}

export function ChapterRawTextEditorModal({
  open,
  onClose,
  chapterId,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  chapterId: string | undefined
  onSaved?: (next: { rawText?: string; condensedText?: string }) => void
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

  const [mode, setMode] = useState<EditorMode>('raw')
  const [rawText, setRawText] = useState('')
  const [condensedText, setCondensedText] = useState('')
  const [savedRawText, setSavedRawText] = useState('')
  const [savedCondensedText, setSavedCondensedText] = useState('')
  const [editorText, setEditorText] = useState('')
  const [compareRaw, setCompareRaw] = useState('')
  const [compareCondensed, setCompareCondensed] = useState('')
  const [consistencyResult, setConsistencyResult] = useState<ScriptConsistencyCheckResult | null>(null)

  // 同步接口直接返回结果，这里把「结果对象 → 界面状态」的落地逻辑单独抽出来，
  // 既给同步调用复用，也继续给任务轮询的 onTaskSettled 复用（逻辑完全一致）。
  const applyConsistencyResultValue = useCallback((resultValue: unknown) => {
    setConsistencyResult(resultValue as ScriptConsistencyCheckResult)
    const result = resultValue as Record<string, any>
    if (result?.has_issues) {
      message.warning(`发现 ${Array.isArray(result.issues) ? result.issues.length : 0} 个角色混淆问题`)
    } else {
      message.success('未发现角色混淆问题')
    }
  }, [])

  const applyConsistencyTaskResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取一致性检查结果失败',
      failedFallbackMessage: '一致性检查失败',
      onSucceeded: (resultValue) => applyConsistencyResultValue(resultValue),
      onFailed: (errorMessage) => {
        // 审计 §4.3 模式 6：`errorMessage` 来自 taskResultHelpers 的 `data.error`（后端原文）
        void showUserError(errorMessage, '一致性检查失败')
      },
      onReadError: () => {
        message.error('读取一致性检查结果失败')
      },
    })
  }, [applyConsistencyResultValue])

  const applySimplifyResultValue = useCallback((resultValue: unknown) => {
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
  }, [mode])

  const applySimplifyResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取智能精简结果失败',
      failedFallbackMessage: '智能精简失败',
      onSucceeded: (resultValue) => applySimplifyResultValue(resultValue),
      onFailed: (errorMessage) => {
        void showUserError(errorMessage, '智能精简失败')
      },
      onReadError: () => {
        message.error('读取智能精简结果失败')
      },
    })
  }, [applySimplifyResultValue])

  const applyOptimizeResultValue = useCallback((resultValue: unknown) => {
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
  }, [])

  const applyOptimizeResult = useCallback(async (taskId: string) => {
    await handleTaskResultSafely(taskId, {
      readErrorMessage: '读取一键优化结果失败',
      failedFallbackMessage: '一键优化失败',
      onSucceeded: (resultValue) => applyOptimizeResultValue(resultValue),
      onFailed: (errorMessage) => {
        void showUserError(errorMessage, '一键优化失败')
      },
      onReadError: () => {
        message.error('读取一键优化结果失败')
      },
    })
  }, [applyOptimizeResultValue])

  const { task: consistencyTask, settledTask: consistencySettledTask, applyCancelData: applyConsistencyCancelData } = useCancelableRelationTask({
    enabled: open && !!chapterId,
    relationType: CONSISTENCY_CHECK_RELATION_TYPE,
    relationEntityId: chapterId,
    onTaskSettled: applyConsistencyTaskResult,
  })

  const { task: simplifyTask, settledTask: simplifySettledTask, applyCancelData: applySimplifyCancelData } = useCancelableRelationTask({
    enabled: open && !!chapterId,
    relationType: SCRIPT_SIMPLIFICATION_RELATION_TYPE,
    relationEntityId: chapterId,
    onTaskSettled: applySimplifyResult,
  })

  const { task: optimizeTask, settledTask: optimizeSettledTask, applyCancelData: applyOptimizeCancelData } = useCancelableRelationTask({
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
    extracting || checkingConsistency || optimizingScript || !!simplifyTask || !!optimizeTask || !!consistencyTask
  const consistencyIssues = useMemo(() => {
    const list = (consistencyResult?.issues as any[] | undefined) ?? []
    return Array.isArray(list) ? list : []
  }, [consistencyResult])

  useEffect(() => {
    if (!open) return
    if (!chapterId) return
    setLoading(true)
    StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId })
      .then((res) => {
        const data = res.data
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
      .catch(() => {
        message.error('加载章节失败')
      })
      .finally(() => setLoading(false))
  }, [open, chapterId])

  const handleSmartSimplify = async () => {
    if (!rawText.trim()) {
      message.warning('请先输入原文')
      return
    }
    if (extracting) return
    if (notifyExistingTask(simplifyTask, {
      cancellingMessage: simplifyTaskCopy.cancellingMessage,
      runningMessage: simplifyTaskCopy.runningMessage,
    })) {
      return
    }
    setExtracting(true)
    message.loading({ content: SYNC_SIMPLIFY_LOADING, key: SYNC_SIMPLIFY_MESSAGE_KEY, duration: 0 })
    try {
      const res = await ScriptProcessingService.simplifyScriptApiV1ScriptProcessingSimplifyScriptPost({
        requestBody: {
          chapter_id: chapterId ?? null,
          script_text: rawText,
        },
      })
      message.destroy(SYNC_SIMPLIFY_MESSAGE_KEY)
      if (!res.data) {
        message.error('智能精简失败：未返回有效内容')
        return
      }
      applySimplifyResultValue(res.data)
    } catch (error) {
      message.destroy(SYNC_SIMPLIFY_MESSAGE_KEY)
      // 审计 §4.3 模式 6：`describeEnvelopeError` 会原样返回 `meta.error.message` / `detail`
      void showUserError(describeEnvelopeError(error, '智能精简失败'), '智能精简失败')
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
    if (checkingConsistency) return
    if (notifyExistingTask(consistencyTask, {
      cancellingMessage: consistencyTaskCopy.cancellingMessage,
      runningMessage: consistencyTaskCopy.runningMessage,
    })) {
      return
    }
    setCheckingConsistency(true)
    message.loading({ content: SYNC_CONSISTENCY_LOADING, key: SYNC_CONSISTENCY_MESSAGE_KEY, duration: 0 })
    try {
      const res = await ScriptProcessingService.checkConsistencyApiV1ScriptProcessingCheckConsistencyPost({
        requestBody: { script_text: scriptText, chapter_id: chapterId ?? null },
      })
      message.destroy(SYNC_CONSISTENCY_MESSAGE_KEY)
      if (!res.data) {
        message.error('一致性检查失败：未返回有效结果')
        return
      }
      applyConsistencyResultValue(res.data)
    } catch (error) {
      message.destroy(SYNC_CONSISTENCY_MESSAGE_KEY)
      void showUserError(describeEnvelopeError(error, '一致性检查失败'), '一致性检查失败')
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
    if (optimizingScript) return
    if (notifyExistingTask(optimizeTask, {
      cancellingMessage: optimizeTaskCopy.cancellingMessage,
      runningMessage: optimizeTaskCopy.runningMessage,
    })) {
      return
    }
    setOptimizingScript(true)
    message.loading({ content: SYNC_OPTIMIZE_LOADING, key: SYNC_OPTIMIZE_MESSAGE_KEY, duration: 0 })
    try {
      const res = await ScriptProcessingService.optimizeScriptApiV1ScriptProcessingOptimizeScriptPost({
        requestBody: {
          chapter_id: chapterId ?? null,
          script_text: scriptText,
          consistency: consistencyResult as any,
        },
      })
      message.destroy(SYNC_OPTIMIZE_MESSAGE_KEY)
      if (!res.data) {
        message.error('一键优化失败：未返回有效内容')
        return
      }
      applyOptimizeResultValue(res.data)
    } catch (error) {
      message.destroy(SYNC_OPTIMIZE_MESSAGE_KEY)
      void showUserError(describeEnvelopeError(error, '一键优化失败'), '一键优化失败')
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

  const handleSave = async (): Promise<boolean> => {
    if (!chapterId) return false
    setSaving(true)
    try {
      if (mode === 'raw') {
        await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
          chapterId,
          requestBody: { raw_text: editorText },
        })
        setRawText(editorText)
        setSavedRawText(editorText)
        onSaved?.({ rawText: editorText })
        message.success('原文已保存')
        return true
      }

      if (mode === 'condensed') {
        await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
          chapterId,
          requestBody: { condensed_text: editorText },
        })
        setCondensedText(editorText)
        setSavedCondensedText(editorText)
        onSaved?.({ condensedText: editorText })
        message.success('精简内容已保存')
        return true
      }

      await StudioChaptersService.updateChapterApiV1StudioChaptersChapterIdPatch({
        chapterId,
        requestBody: { raw_text: compareRaw, condensed_text: compareCondensed },
      })
      setRawText(compareRaw)
      setCondensedText(compareCondensed)
      setSavedRawText(compareRaw)
      setSavedCondensedText(compareCondensed)
      onSaved?.({ rawText: compareRaw, condensedText: compareCondensed })
      message.success('已保存')
      return true
    } catch {
      message.error('保存失败')
      return false
    } finally {
      setSaving(false)
    }
  }

  const hasUnsavedChanges = useMemo(() => {
    if (mode === 'compare') return compareRaw !== savedRawText || compareCondensed !== savedCondensedText
    if (mode === 'raw') return editorText !== savedRawText
    return editorText !== savedCondensedText
  }, [compareCondensed, compareRaw, editorText, mode, savedCondensedText, savedRawText])

  const handleRequestClose = () => {
    if (actionsLoading) return
    if (!hasUnsavedChanges) {
      onClose()
      return
    }
    Modal.confirm({
      title: '检测到未保存变更',
      content: '文本输入区有未保存修改，关闭前请选择操作。',
      okText: '保存',
      cancelText: '忽略',
      onOk: async () => {
        const ok = await handleSave()
        if (ok) onClose()
      },
      onCancel: () => {
        onClose()
      },
    })
  }

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
        title={
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FileTextOutlined />{' '}
              {mode === 'raw' ? '原文编辑区' : mode === 'condensed' ? '精简内容编辑区' : '对比模式'}
              <Tag color="blue">{plainWordCount} 字</Tag>
              <Tag color="default">{paragraphCount} 段</Tag>
            </div>
            <Space size="small">
              <Button size="small" type="primary" icon={<SaveOutlined />} loading={actionsLoading || saving} disabled={actionsLoading} onClick={() => void handleSave()}>
                保存
              </Button>
              <Tooltip title={SYNC_AI_HINT}>
                <span>
                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    loading={checkingConsistency || !!consistencyTask}
                    disabled={actionsLoading || !!consistencyTask}
                    onClick={() => void handleCheckConsistency()}
                  >
                    {consistencyTask ? '正在检查…' : '角色混淆检查'}
                  </Button>
                </span>
              </Tooltip>
              {consistencyTask ? (
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  disabled={consistencyTask.cancelRequested}
                  onClick={() => void handleCancelConsistencyTask()}
                >
                  {consistencyTask.cancelRequested ? '正在取消' : '取消检查'}
                </Button>
              ) : null}
              <Tooltip title={SYNC_AI_HINT}>
                <span>
                  <Button
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={extracting || !!simplifyTask}
                    disabled={actionsLoading || !!simplifyTask}
                    onClick={() => void handleSmartSimplify()}
                  >
                    {simplifyTask ? '精简中' : '智能精简'}
                  </Button>
                </span>
              </Tooltip>
              {simplifyTask ? (
                <Button
                  size="small"
                  danger
                  icon={<CloseCircleOutlined />}
                  disabled={simplifyTask.cancelRequested}
                  onClick={() => void handleCancelSimplifyTask()}
                >
                  {simplifyTask.cancelRequested ? '正在取消' : '取消精简'}
                </Button>
              ) : null}
              {mode === 'condensed' ? (
                <Button size="small" icon={<ReloadOutlined />} loading={actionsLoading} disabled={actionsLoading} onClick={handleBackToRaw}>
                  回到原文
                </Button>
              ) : (
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  loading={actionsLoading}
                  disabled={actionsLoading || !condensedText.trim()}
                  onClick={handleViewCondensed}
                >
                  查看精简
                </Button>
              )}
              <Button
                size="small"
                icon={<DiffOutlined />}
                loading={actionsLoading}
                disabled={actionsLoading}
                type={mode === 'compare' ? 'primary' : 'default'}
                onClick={() => {
                  if (mode === 'compare') {
                    setMode('raw')
                    setEditorText(rawText)
                    return
                  }
                  setCompareRaw(rawText)
                  setCompareCondensed(condensedText)
                  setMode('compare')
                }}
              >
                对比模式
              </Button>
              <Button size="small" icon={<HistoryOutlined />} loading={actionsLoading} disabled={actionsLoading} onClick={() => setHistoryOpen(true)}>
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
          <Button type="primary" loading={actionsLoading} disabled={actionsLoading} onClick={handleRequestClose}>
            关闭
          </Button>
        }
        styles={{
          header: { paddingRight: 48 },
          body: { maxHeight: '70vh', overflow: 'auto', paddingTop: 12 },
        }}
      >
        {loading ? (
          <div className="flex justify-center items-center py-10">
            <Spin />
          </div>
        ) : mode === 'compare' ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">原文</div>
              <Input.TextArea
                value={compareRaw}
                onChange={(e) => setCompareRaw(e.target.value)}
                rows={14}
                disabled={actionsLoading}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
            <div className="flex flex-col">
              <div className="text-xs text-gray-500 mb-2">精简内容</div>
              <Input.TextArea
                value={compareCondensed}
                onChange={(e) => setCompareCondensed(e.target.value)}
                rows={14}
                disabled={actionsLoading}
                style={{ resize: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[11px] text-gray-500 leading-5">
              本环境未配置后台任务 worker：「角色混淆检查 / 智能精简 / 一键优化」都在本次请求内同步执行，通常需要数十秒，期间请勿重复点击。
            </div>
            <Input.TextArea
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
                    <Tag>问题 {consistencyIssues.length} 处</Tag>
                    <Tooltip title={SYNC_AI_HINT}>
                      <span>
                        <Button
                          size="small"
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={optimizingScript || !!optimizeTask}
                          disabled={actionsLoading || !!optimizeTask}
                          onClick={() => void handleOneClickOptimize()}
                        >
                          {optimizeTask ? '优化中' : '一键优化'}
                        </Button>
                      </span>
                    </Tooltip>
                    {optimizeTask ? (
                      <Button
                        size="small"
                        danger
                        icon={<CloseCircleOutlined />}
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
                            {it?.issue_type ? `【${labelFor(SCRIPT_ISSUE_TYPE, it.issue_type)}】 ` : ''}
                            第 {idx + 1} 处问题
                          </div>
                          <div className="text-sm">{it?.description}</div>
                          {it?.character_candidates?.length ? (
                            <div className="text-xs text-gray-500 mt-1">相关角色：{it.character_candidates.join('、')}</div>
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
            <HistoryOutlined /> 历史版本
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
