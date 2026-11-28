import { uiText } from '../../../uiText'
import { message } from 'antd'
import { create } from 'zustand'
import { FilmService } from '../../../services/generated'
import type { TaskListItemRead, TaskSourceRead, TaskStatus } from '../../../services/generated'
import { resolveTaskSourceLabel, resolveTaskTitle } from './taskCopy'

export type TaskUiItem = {
  taskId: string
  taskKind?: string | null
  title?: string | null
  sourceLabel?: string | null
  source?: TaskSourceRead | null
  sourceResolved?: boolean
  status: TaskStatus
  progress: number | null
  cancelRequested: boolean
  remoteCancellation?: TaskListItemRead['remote_cancellation']
  startedAtTs?: number | null
  finishedAtTs?: number | null
  elapsedMs?: number | null
  relationType?: string | null
  relationEntityId?: string | null
  resourceType?: string | null
  navigateRelationType?: string | null
  navigateRelationEntityId?: string | null
  onCancel?: (() => void) | null
  onNavigate?: (() => void) | null
}

export type TaskPageContext = {
  relationType: string
  relationEntityId: string
}

type AssetGeneration = { status: 'submitting' } | { status: 'submitted'; taskId: string }

type TaskUiState = {
  serverItems: Record<string, TaskListItemRead>
  optimisticItems: Record<string, TaskUiItem>
  contextScopes: Record<string, TaskPageContext[]>
  assetGenerations: Record<string, AssetGeneration>
  setAssetGeneration: (key: string, generation?: AssetGeneration) => void
  open: boolean
  setServerTasks: (tasks: TaskListItemRead[]) => void
  upsertTask: (task: TaskUiItem) => void
  removeTask: (taskId: string) => void
  registerPageContext: (scopeId: string, contexts: TaskPageContext[]) => void
  unregisterPageContext: (scopeId: string) => void
  cancelTask: (taskId: string) => Promise<void>
  setOpen: (open: boolean) => void
  toggleOpen: () => void
}

export function mergeTaskUiItems(
  serverItems: Record<string, TaskListItemRead>,
  optimisticItems: Record<string, TaskUiItem>,
): TaskUiItem[] {
  const taskIds = new Set([...Object.keys(serverItems), ...Object.keys(optimisticItems)])
  return Array.from(taskIds).map((taskId) => {
    const server = serverItems[taskId]
    const optimistic = optimisticItems[taskId]
    return {
      taskId,
      taskKind: server?.task_kind ?? optimistic?.taskKind,
      title: server?.title && server.title !== server.task_kind
        ? server.title : optimistic?.title || resolveTaskTitle(server?.task_kind),
      source: server?.source,
      sourceResolved: !!server,
      sourceLabel:
        optimistic?.sourceLabel ??
        resolveTaskSourceLabel(server?.target_type, server?.target_id),
      status: server?.status ?? optimistic?.status ?? 'queued',
      progress: server ? server.progress ?? null : optimistic?.progress ?? null,
      cancelRequested: !!(server?.cancel_requested ?? optimistic?.cancelRequested),
      remoteCancellation: server?.remote_cancellation ?? optimistic?.remoteCancellation,
      startedAtTs: server?.started_at_ts ?? optimistic?.startedAtTs,
      finishedAtTs: server?.finished_at_ts ?? optimistic?.finishedAtTs,
      elapsedMs: server?.elapsed_ms ?? optimistic?.elapsedMs,
      relationType: server?.target_type ?? optimistic?.relationType,
      relationEntityId: server?.target_id ?? optimistic?.relationEntityId,
      resourceType: (server?.task_kind === 'video_generation' ? 'video' : server?.task_kind === 'image_generation' ? 'image' : 'text') ?? optimistic?.resourceType,
      navigateRelationType: server?.target_type ?? optimistic?.navigateRelationType,
      navigateRelationEntityId:
        server?.target_id ?? optimistic?.navigateRelationEntityId,
      onCancel: optimistic?.onCancel ?? null,
      onNavigate: optimistic?.onNavigate ?? null,
    }
  })
}

export function flattenPageContexts(contextScopes: Record<string, TaskPageContext[]>): TaskPageContext[] {
  return Object.values(contextScopes).flat()
}

export function isTaskHighlighted(task: TaskUiItem, contexts: TaskPageContext[]): boolean {
  const matchRelationType = task.navigateRelationType ?? task.relationType
  const matchRelationEntityId =
    task.navigateRelationEntityId ?? task.relationEntityId
  if (!matchRelationType || !matchRelationEntityId) return false
  return contexts.some(
    (context) =>
      context.relationType === matchRelationType &&
      context.relationEntityId === matchRelationEntityId,
  )
}

export const useTaskUiStore = create<TaskUiState>((set, get) => ({
  serverItems: {},
  optimisticItems: {},
  contextScopes: {},
  assetGenerations: {},
  setAssetGeneration: (key, generation) => set(state => {
    const assetGenerations = { ...state.assetGenerations }
    if (generation) assetGenerations[key] = generation
    else delete assetGenerations[key]
    return { assetGenerations }
  }),
  open: false,
  setServerTasks: (tasks) =>
    set(() => ({
      serverItems: Object.fromEntries(tasks.map((task) => [task.task_id, task])),
    })),
  upsertTask: (task) =>
    set((state) => ({
      optimisticItems: {
        ...state.optimisticItems,
        [task.taskId]: task,
      },
    })),
  removeTask: (taskId) =>
    set((state) => {
      const nextOptimisticItems = { ...state.optimisticItems }
      delete nextOptimisticItems[taskId]
      return {
        optimisticItems: nextOptimisticItems,
      }
    }),
  registerPageContext: (scopeId, contexts) =>
    set((state) => ({
      contextScopes: {
        ...state.contextScopes,
        [scopeId]: contexts,
      },
    })),
  unregisterPageContext: (scopeId) =>
    set((state) => {
      const next = { ...state.contextScopes }
      delete next[scopeId]
      return { contextScopes: next }
    }),
  cancelTask: async (taskId) => {
    const optimisticTask = get().optimisticItems[taskId]
    if (optimisticTask?.onCancel) {
      optimisticTask.onCancel()
      return
    }
    try {
      const res = await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({
        taskId,
        requestBody: { reason: '用户在任务中心取消任务' },
      })
      const data = res.data
      set((state) => {
        const nextServerItems = { ...state.serverItems }
        const currentServer = nextServerItems[taskId]
        if (currentServer) {
          nextServerItems[taskId] = {
            ...currentServer,
            status: data?.status ?? currentServer.status,
            cancel_requested: data?.cancel_requested ?? true,
          }
        }
        const nextOptimisticItems = { ...state.optimisticItems }
        const currentOptimistic = nextOptimisticItems[taskId]
        if (currentOptimistic) {
          nextOptimisticItems[taskId] = {
            ...currentOptimistic,
            status: data?.status ?? currentOptimistic.status,
            cancelRequested: data?.cancel_requested ?? true,
          }
        }
        return {
          serverItems: nextServerItems,
          optimisticItems: nextOptimisticItems,
        }
      })
      message.success(data?.effective_immediately ? uiText("任务已取消") : uiText("已发送取消请求"))
    } catch (error) {
      const response = error as { status?: number; body?: { detail?: unknown; message?: unknown } }
      const detail = response.body?.message || response.body?.detail
      message.error(response.status === 404 ? uiText("任务不存在") : typeof detail === 'string' && detail ? detail : uiText("取消任务失败"))
    }
  },
  setOpen: (open) => set(() => ({ open })),
  toggleOpen: () => set((state) => ({ open: !state.open })),
}))
