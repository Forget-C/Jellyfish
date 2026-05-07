import { useEffect, useMemo, useRef } from 'react'
import { Button, Space, notification } from 'antd'
import type { ReactNode } from 'react'
import type { RelationTaskState } from '../project/ProjectWorkbench/chapterDivisionTasks'
import { useTaskUiStore } from './taskUiStore'

const SETTLED_TASK_RETAIN_MS = 8000

type RelationTaskNotificationOptions = {
  task: RelationTaskState | null
  settledTask?: RelationTaskState | null
  title: string
  sourceLabel?: string | null
  runningDescription: string
  cancellingDescription: string
  successDescription?: string
  cancelledDescription?: string
  failedDescription?: string
  onCancel?: (() => void) | null
  onNavigate?: (() => void) | null
}

function formatElapsedMs(elapsedMs?: number | null): string | null {
  if (elapsedMs == null || elapsedMs < 0) return null
  const totalSeconds = Math.floor(elapsedMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`
}

function formatStartedAt(startedAtTs?: number | null): string | null {
  if (!startedAtTs) return null
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(startedAtTs * 1000))
}

function buildDescription(task: RelationTaskState, runningDescription: string, cancellingDescription: string): ReactNode {
  const parts: string[] = []
  parts.push(`进度 ${Math.max(0, Math.min(100, Math.round(task.progress)))}%`)
  const elapsedLabel = formatElapsedMs(task.elapsedMs)
  if (elapsedLabel) {
    parts.push(task.cancelRequested || task.finishedAtTs ? `累计耗时 ${elapsedLabel}` : `已运行 ${elapsedLabel}`)
  }
  const startedAtLabel = formatStartedAt(task.startedAtTs)
  if (startedAtLabel) {
    parts.push(`开始于 ${startedAtLabel}`)
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
  runningDescription,
  cancellingDescription,
  successDescription,
  cancelledDescription,
  failedDescription,
  onCancel,
  onNavigate,
}: RelationTaskNotificationOptions) {
  const previousTaskIdRef = useRef<string | null>(null)
  const previousSettledKeyRef = useRef<string | null>(null)
  const settledRemoveTimersRef = useRef<Record<string, number>>({})
  const upsertTask = useTaskUiStore((state) => state.upsertTask)
  const removeTask = useTaskUiStore((state) => state.removeTask)
  const description = useMemo(() => {
    if (!task) return null
    return buildDescription(task, runningDescription, cancellingDescription)
  }, [cancellingDescription, runningDescription, task])

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
      message: task.cancelRequested ? `${title}正在取消` : `${title}进行中`,
      description,
      duration: 0,
      placement: 'topRight',
      btn:
        onNavigate || (onCancel && !task.cancelRequested) ? (
          <Space size={8}>
            {onNavigate ? (
              <Button size="small" onClick={onNavigate}>
                查看
              </Button>
            ) : null}
            {onCancel && !task.cancelRequested ? (
              <Button size="small" danger onClick={onCancel}>
                取消任务
              </Button>
            ) : null}
          </Space>
        ) : undefined,
    })
  }, [description, onCancel, onNavigate, sourceLabel, task, title])

  useEffect(() => {
    if (!settledTask) return
    const settledKey = `${settledTask.taskId}:${settledTask.status}:${settledTask.finishedAtTs ?? ''}:${settledTask.error ?? ''}`
    if (previousSettledKeyRef.current === settledKey) return
    previousSettledKeyRef.current = settledKey

    const elapsedLabel = formatElapsedMs(settledTask.elapsedMs)
    const startedAtLabel = formatStartedAt(settledTask.startedAtTs)
    const details = [
      `进度 ${Math.max(0, Math.min(100, Math.round(settledTask.progress)))}%`,
      elapsedLabel ? `累计耗时 ${elapsedLabel}` : null,
      startedAtLabel ? `开始于 ${startedAtLabel}` : null,
    ].filter(Boolean)

    const failedMainDescription =
      settledTask.status === 'failed' && settledTask.error?.trim()
        ? settledTask.error.trim()
        : failedDescription || '任务执行失败，请稍后重试。'

    const statusMeta =
      settledTask.status === 'succeeded'
        ? { message: `${title}已完成`, description: successDescription || '任务已执行完成。', duration: 3.5 as number }
        : settledTask.status === 'cancelled'
          ? { message: `${title}已取消`, description: cancelledDescription || '任务已停止执行。', duration: 4.5 as number }
          : { message: `${title}失败`, description: failedMainDescription, duration: 8 as number }

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
      placement: 'topRight',
      btn: onNavigate ? <Button size="small" onClick={onNavigate}>查看</Button> : undefined,
    })
  }, [cancelledDescription, failedDescription, onNavigate, removeTask, settledTask, sourceLabel, successDescription, title, upsertTask])

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
