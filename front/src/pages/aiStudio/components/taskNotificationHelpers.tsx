import { currentLanguage } from '../../../i18n'
import { uiText, useUiText } from '../../../uiText'
import { useEffect, useMemo, useRef } from 'react'
import { Button, Space, notification } from 'antd'
import type { ReactNode } from 'react'
import type { RelationTaskState } from '../project/ProjectWorkbench/relationTasks'
import { useTaskUiStore } from './taskUiStore'

import { formatElapsedMs, formatStartedAt } from './taskTime'

const SETTLED_TASK_RETAIN_MS = 8000

type RelationTaskNotificationOptions = {
  task: RelationTaskState | null
  settledTask?: RelationTaskState | null
  title: string
  sourceLabel?: string | null
  placement?: 'topRight' | 'bottomRight'
  runningDescription: string
  cancellingDescription: string
  successDescription?: string
  cancelledDescription?: string
  failedDescription?: string
  onCancel?: (() => void) | null
  onNavigate?: (() => void) | null
}

function buildDescription(task: RelationTaskState, runningDescription: string, cancellingDescription: string, locale: ReturnType<typeof currentLanguage>): ReactNode {
  const parts: string[] = []
  parts.push(`${uiText("进度")} ${Math.max(0, Math.min(100, Math.round(task.progress)))}%`)
  const elapsedLabel = formatElapsedMs(task.elapsedMs)
  if (elapsedLabel) {
    parts.push(task.cancelRequested || task.finishedAtTs ? `${uiText("累计耗时")} ${elapsedLabel}` : `${uiText("已运行")} ${elapsedLabel}`)
  }
  const startedAtLabel = formatStartedAt(task.startedAtTs, locale)
  if (startedAtLabel) {
    parts.push(`${uiText("开始于")} ${startedAtLabel}`)
  }
  return (
    <div className="space-y-1">
      <div>{task.cancelRequested ? cancellingDescription : runningDescription}</div>
      {parts.length > 0 ? <div className="text-xs opacity-80">{parts.join(' · ')}</div> : null}
    </div>
  )
}

export function useRelationTaskNotification({
  task,
  settledTask,
  title,
  sourceLabel,
  placement = 'topRight',
  runningDescription,
  cancellingDescription,
  successDescription,
  cancelledDescription,
  failedDescription,
  onCancel,
  onNavigate,
}: RelationTaskNotificationOptions) {
  const uiText = useUiText()
  const previousTaskIdRef = useRef<string | null>(null)
  const previousSettledKeyRef = useRef<string | null>(null)
  const settledRemoveTimersRef = useRef<Record<string, number>>({})
  const upsertTask = useTaskUiStore((state) => state.upsertTask)
  const removeTask = useTaskUiStore((state) => state.removeTask)
  const language = currentLanguage()
  const description = useMemo(() => {
    if (!task) return null
    return buildDescription(task, runningDescription, cancellingDescription, language)
  }, [cancellingDescription, runningDescription, task, language])

  useEffect(() => {
    const previousTaskId = previousTaskIdRef.current
    if (!task) {
      if (previousTaskId) {
        notification.destroy(previousTaskId)
        previousTaskIdRef.current = null
      }
      return
    }

    if (previousTaskId && previousTaskId !== task.taskId) {
      notification.destroy(previousTaskId)
    }

    previousTaskIdRef.current = task.taskId
    const existingTimer = settledRemoveTimersRef.current[task.taskId]
    if (existingTimer) {
      window.clearTimeout(existingTimer)
      delete settledRemoveTimersRef.current[task.taskId]
    }
    upsertTask({
      taskId: task.taskId,
      title,
      sourceLabel,
      status: task.status,
      progress: task.progress,
      cancelRequested: task.cancelRequested,
      startedAtTs: task.startedAtTs,
      finishedAtTs: task.finishedAtTs,
      elapsedMs: task.elapsedMs,
      onCancel,
      onNavigate,
    })
    notification.open({
      key: task.taskId,
      message: task.cancelRequested ? uiText("{{title}}正在取消", { title }) : uiText("{{title}}进行中", { title }),
      description,
      duration: 0,
      placement,
      btn:
        onNavigate || (onCancel && !task.cancelRequested) ? (
          <Space size={8}>
            {onNavigate ? (
              <Button size="small" onClick={onNavigate}>
                {uiText("查看")}
              </Button>
            ) : null}
            {onCancel && !task.cancelRequested ? (
              <Button size="small" danger onClick={onCancel}>
                {uiText("取消任务")}
              </Button>
            ) : null}
          </Space>
        ) : undefined,
    })
  }, [uiText, description, onCancel, onNavigate, placement, sourceLabel, task, title, upsertTask])

  useEffect(() => {
    if (!settledTask) return
    const settledKey = `${settledTask.taskId}:${settledTask.status}:${settledTask.finishedAtTs ?? ''}`
    if (previousSettledKeyRef.current === settledKey) return
    previousSettledKeyRef.current = settledKey

    const elapsedLabel = formatElapsedMs(settledTask.elapsedMs)
    const startedAtLabel = formatStartedAt(settledTask.startedAtTs)
    const details = [
      `${uiText("进度")} ${Math.max(0, Math.min(100, Math.round(settledTask.progress)))}%`,
      elapsedLabel ? `${uiText("累计耗时")} ${elapsedLabel}` : null,
      startedAtLabel ? `${uiText("开始于")} ${startedAtLabel}` : null,
    ].filter(Boolean)

    const statusMeta =
      settledTask.status === 'succeeded'
        ? { message: uiText("{{title}}已完成", { title }), description: successDescription || uiText("任务已执行完成。"), duration: 3.5 as number }
        : settledTask.status === 'cancelled'
          ? { message: uiText("{{title}}已取消", { title }), description: cancelledDescription || uiText("任务已停止执行。"), duration: 4.5 as number }
          : { message: uiText("{{title}}失败", { title }), description: failedDescription || uiText("任务执行失败，请稍后重试。"), duration: 6 as number }

    upsertTask({
      taskId: settledTask.taskId,
      title,
      sourceLabel,
      status: settledTask.status,
      progress: settledTask.progress,
      cancelRequested: false,
      startedAtTs: settledTask.startedAtTs,
      finishedAtTs: settledTask.finishedAtTs,
      elapsedMs: settledTask.elapsedMs,
      onCancel: null,
      onNavigate,
    })

    const existingTimer = settledRemoveTimersRef.current[settledTask.taskId]
    if (existingTimer) {
      window.clearTimeout(existingTimer)
    }
    settledRemoveTimersRef.current[settledTask.taskId] = window.setTimeout(() => {
      removeTask(settledTask.taskId)
      delete settledRemoveTimersRef.current[settledTask.taskId]
    }, SETTLED_TASK_RETAIN_MS)

    notification.open({
      key: `${settledTask.taskId}:settled`,
      message: statusMeta.message,
      description: (
        <div className="space-y-1">
          <div>{statusMeta.description}</div>
          {details.length > 0 ? <div className="text-xs opacity-80">{details.join(' · ')}</div> : null}
        </div>
      ),
      duration: statusMeta.duration,
      placement,
      btn: onNavigate ? <Button size="small" onClick={onNavigate}>{uiText("查看")}</Button> : undefined,
    })
  }, [uiText, cancelledDescription, failedDescription, onNavigate, placement, removeTask, settledTask, sourceLabel, successDescription, title, upsertTask])

  useEffect(() => {
    return () => {
      if (previousTaskIdRef.current) {
        notification.destroy(previousTaskIdRef.current)
        removeTask(previousTaskIdRef.current)
      }
      Object.values(settledRemoveTimersRef.current).forEach((timer) => {
        window.clearTimeout(timer)
      })
      settledRemoveTimersRef.current = {}
    }
  }, [removeTask])
}
