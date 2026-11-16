import type { ButtonProps } from 'antd'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { Button, Drawer, Empty, Progress, Segmented, Select, Tag } from 'antd'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseCircleOutlined,
  DownOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { TaskUiItem } from './taskUiStore'
import {
  flattenPageContexts,
  isTaskHighlighted,
  mergeTaskUiItems,
  useTaskUiStore,
} from './taskUiStore'
import { useResolvedTaskCenterTasks } from './taskCenterMeta'
import { TaskHistory } from './TaskHistory'

/** 工作台实例复用灰阶动作；全站任务中心继续使用原主题。 */
function TaskCenterButton({ workbench, type, danger, ...props }: ButtonProps & { workbench: boolean }) {
  return workbench ? <WorkbenchButton {...props} variant={danger ? 'danger' : type === 'text' ? 'quiet' : type === 'primary' ? 'primary' : 'secondary'} /> : <Button {...props} type={type} danger={danger} />
}

const TASK_CENTER_OPEN_STORAGE_KEY = 'jellyfish_task_center_open_v1'
const TASK_CENTER_PAGE_SIZE = 3

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

function taskTone(task: TaskUiItem): { color: string; label: string } {
  if (task.status === 'cancelled') return { color: 'orange', label: '已取消' }
  if (task.status === 'failed') return { color: 'red', label: '失败' }
  if (task.status === 'succeeded') return { color: 'green', label: '已完成' }
  if (task.cancelRequested) return { color: 'orange', label: '取消中' }
  if (task.status === 'running') return { color: 'blue', label: '运行中' }
  return { color: 'default', label: '排队中' }
}

/** 展示近期活动任务，并提供独立的完整历史查询入口。 */
export function TaskCenter({ workbench = false }: { workbench?: boolean }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const [scopeFilter, setScopeFilter] = useState<'auto' | 'all' | 'current' | 'active' | 'settled'>('auto')
  const [taskKindFilter, setTaskKindFilter] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const open = useTaskUiStore((state) => state.open)
  const setOpen = useTaskUiStore((state) => state.setOpen)
  const toggleOpen = useTaskUiStore((state) => state.toggleOpen)
  const serverItems = useTaskUiStore((state) => state.serverItems)
  const optimisticItems = useTaskUiStore((state) => state.optimisticItems)
  const contextScopes = useTaskUiStore((state) => state.contextScopes)
  const cancelTask = useTaskUiStore((state) => state.cancelTask)
  useEffect(() => {
    try { setOpen(window.localStorage.getItem(TASK_CENTER_OPEN_STORAGE_KEY) === '1') }
    catch { setOpen(false) }
  }, [setOpen])

  useEffect(() => {
    try { window.localStorage.setItem(TASK_CENTER_OPEN_STORAGE_KEY, open ? '1' : '0') }
    catch { /* 存储受限时任务面板仍可在当前页面使用。 */ }
  }, [open])

  const tasks = useMemo(
    () =>
      mergeTaskUiItems(serverItems, optimisticItems).sort((a, b) => {
        const activeContexts = flattenPageContexts(contextScopes)
        const priority = (task: TaskUiItem): number => {
          if (isTaskHighlighted(task, activeContexts)) return 4
          if (task.cancelRequested && ['queued', 'running'].includes(task.status)) return 3
          if (task.status === 'running') return 2
          if (task.status === 'queued') return 1
          return 0
        }
        const priorityDelta = priority(b) - priority(a)
        if (priorityDelta !== 0) return priorityDelta
        const aTs = a.startedAtTs ?? 0
        const bTs = b.startedAtTs ?? 0
        return bTs - aTs
      }),
    [contextScopes, optimisticItems, serverItems],
  )
  const activeContexts = useMemo(() => flattenPageContexts(contextScopes), [contextScopes])
  const resolvedTasks = useResolvedTaskCenterTasks(tasks, navigate)
  const taskKindOptions = useMemo(
    () =>
      Array.from(
        new Set(resolvedTasks.map((task) => task.title).filter((value): value is string => !!value)),
      ).map((title) => ({
        label: title,
        value: title,
      })),
    [resolvedTasks],
  )
  const summaryCounts = useMemo(
    () => ({
      current: resolvedTasks.filter((task) => isTaskHighlighted(task, activeContexts)).length,
      active: resolvedTasks.filter((task) => ['queued', 'running'].includes(task.status)).length,
      settled: resolvedTasks.filter((task) => ['succeeded', 'failed', 'cancelled'].includes(task.status)).length,
    }),
    [activeContexts, resolvedTasks],
  )
  const effectiveScopeFilter = useMemo<'all' | 'current' | 'active' | 'settled'>(() => {
    if (scopeFilter !== 'auto') return scopeFilter
    if (summaryCounts.current > 0) return 'current'
    if (summaryCounts.active > 0) return 'active'
    if (summaryCounts.settled > 0) return 'settled'
    return 'all'
  }, [scopeFilter, summaryCounts.active, summaryCounts.current, summaryCounts.settled])
  const filteredTasks = useMemo(
    () =>
      resolvedTasks.filter((task) => {
        if (effectiveScopeFilter === 'current' && !isTaskHighlighted(task, activeContexts)) return false
        if (effectiveScopeFilter === 'active' && !['queued', 'running'].includes(task.status)) return false
        if (effectiveScopeFilter === 'settled' && !['succeeded', 'failed', 'cancelled'].includes(task.status)) return false
        if (taskKindFilter && task.title !== taskKindFilter) return false
        return true
      }),
    [activeContexts, effectiveScopeFilter, resolvedTasks, taskKindFilter],
  )
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / TASK_CENTER_PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedTasks = useMemo(
    () => filteredTasks.slice((currentPage - 1) * TASK_CENTER_PAGE_SIZE, currentPage * TASK_CENTER_PAGE_SIZE),
    [currentPage, filteredTasks],
  )
  const groupedTasks = useMemo(() => {
    if (effectiveScopeFilter !== 'all') {
      return [{ key: effectiveScopeFilter, title: null as string | null, tasks: pagedTasks }]
    }
    const currentTasks = pagedTasks.filter((task) => isTaskHighlighted(task, activeContexts))
    const activeTasks = pagedTasks.filter(
      (task) => !isTaskHighlighted(task, activeContexts) && ['queued', 'running'].includes(task.status),
    )
    const settledTasks = pagedTasks.filter(
      (task) => !isTaskHighlighted(task, activeContexts) && ['succeeded', 'failed', 'cancelled'].includes(task.status),
    )
    const otherTasks = pagedTasks.filter(
      (task) =>
        !isTaskHighlighted(task, activeContexts) &&
        !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(task.status),
    )
    return [
      { key: 'current', title: currentTasks.length > 0 ? `当前页 ${currentTasks.length}` : null, tasks: currentTasks },
      { key: 'active', title: activeTasks.length > 0 ? `运行中 ${activeTasks.length}` : null, tasks: activeTasks },
      { key: 'settled', title: settledTasks.length > 0 ? `最近结束 ${settledTasks.length}` : null, tasks: settledTasks },
      { key: 'all', title: otherTasks.length > 0 ? `全部 ${otherTasks.length}` : null, tasks: otherTasks },
    ].filter((group) => group.tasks.length > 0)
  }, [activeContexts, effectiveScopeFilter, pagedTasks])
  return (
    <>
      <TaskCenterButton workbench={workbench} type="text" className="app-task-trigger" aria-label="任务中心" aria-expanded={open} onClick={toggleOpen}>
        任务 {(!workbench || summaryCounts.active > 0) && <span className="app-task-count" aria-label={`${workbench ? '排队及运行任务' : '运行中任务'} ${summaryCounts.active}`}>{workbench && summaryCounts.active > 99 ? '99+' : summaryCounts.active}</span>}<DownOutlined className={workbench ? 'canvas-menu-chevron' : undefined} />
      </TaskCenterButton>
      <Drawer title="任务中心" rootClassName={workbench ? 'canvas-task-center' : undefined} className={workbench ? 'app-task-drawer' : 'app-task-drawer app-detail-drawer'} width={416} open={open} onClose={() => setOpen(false)} extra={<TaskCenterButton workbench={workbench} onClick={() => { setHistoryOpen(true); setOpen(false) }}>历史</TaskCenterButton>}>
        {/\/chapters\/[^/]+\/sequences\/[^/]+$/.test(location.pathname) && <TaskCenterButton workbench={workbench} block style={{ marginBottom: 12 }} onClick={() => { setOpen(false); window.dispatchEvent(new Event('sequence-open-task-results')) }}>查看本场任务与业务结果</TaskCenterButton>}
            <div className="app-task-filters mb-3 flex flex-col gap-2">
              <Segmented
                size="small"
                value={scopeFilter}
                onChange={(value) => {
                  setScopeFilter(value as 'auto' | 'all' | 'current' | 'active' | 'settled')
                  setPage(1)
                }}
                options={[
                  { label: '智能', value: 'auto' },
                  { label: `当前页 ${summaryCounts.current}`, value: 'current' },
                  { label: `运行中 ${summaryCounts.active}`, value: 'active' },
                  { label: `最近结束 ${summaryCounts.settled}`, value: 'settled' },
                  { label: '全部', value: 'all' },
                ]}
              />
              <Select
                size="small"
                allowClear
                placeholder="按任务类型筛选"
                value={taskKindFilter}
                onChange={(value) => {
                  setTaskKindFilter(value)
                  setPage(1)
                }}
                options={taskKindOptions}
              />
              <div className="text-[11px] text-gray-400">
                默认优先：当前页 → 运行中 → 最近结束 → 全部 · 每页最多 3 条
              </div>
            </div>
            {filteredTasks.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有任务记录" />
            ) : (
              <div className="space-y-3">
                {groupedTasks.map((group) => (
                  <div key={group.key} className="space-y-2">
                    {group.title ? <div className="text-[11px] font-medium text-gray-400">{group.title}</div> : null}
                    {group.tasks.map((task) => {
                      const tone = taskTone(task)
                      const elapsed = formatElapsedMs(task.elapsedMs)
                      const startedAt = formatStartedAt(task.startedAtTs)
                      const highlighted = isTaskHighlighted(task, activeContexts)
                      return (
                        <div
                          key={task.taskId}
                          className={`app-task-card rounded-lg border px-3 py-2 ${
                            workbench ? (highlighted ? 'is-current' : '') : highlighted ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                          }`}
                        >
                          <div className="app-task-card-header flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="app-task-title font-medium text-sm truncate">{task.title}</div>
                              {task.sourceLabel ? <div className="mt-1 text-xs text-gray-500 truncate">{task.sourceLabel}</div> : null}
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                                {highlighted ? <Tag color="blue">当前页面</Tag> : null}
                                <Tag color={tone.color}>{tone.label}</Tag>
                                {task.progress == null ? null : <span>进度 {Math.max(0, Math.min(100, Math.round(task.progress)))}%</span>}
                                {elapsed ? <span>耗时 {elapsed}</span> : null}
                              </div>
                              {startedAt ? <div className="mt-1 text-xs text-gray-400">开始于 {startedAt}</div> : null}
                            </div>
                            <div className="app-task-actions flex flex-col gap-2">
                              {task.onNavigate ? (
                                <TaskCenterButton workbench={workbench}
                                  size="small"
                                  icon={<ArrowRightOutlined />}
                                  onClick={() => {
                                    task.onNavigate?.()
                                    setOpen(false)
                                  }}
                                >
                                  查看
                                </TaskCenterButton>
                              ) : null}
                              {task.onCancel ? (
                                <TaskCenterButton workbench={workbench}
                                  size="small"
                                  danger
                                  icon={<CloseCircleOutlined />}
                                  disabled={task.cancelRequested}
                                  onClick={task.onCancel}
                                >
                                  {task.cancelRequested ? '正在取消' : '取消'}
                                </TaskCenterButton>
                              ) : task.status === 'queued' || task.status === 'running' ? (
                                <TaskCenterButton workbench={workbench}
                                  size="small"
                                  danger
                                  icon={<CloseCircleOutlined />}
                                  disabled={task.cancelRequested}
                                  onClick={() => {
                                    void cancelTask(task.taskId)
                                  }}
                                >
                                  {task.cancelRequested ? '正在取消' : '取消'}
                                </TaskCenterButton>
                              ) : null}
                            </div>
                          </div>
                          {task.progress == null ? null : <Progress
                            percent={Math.max(0, Math.min(100, Math.round(task.progress)))}
                            size="small"
                            status={
                              task.cancelRequested || task.status === 'failed'
                                ? 'exception'
                                : task.status === 'succeeded'
                                  ? 'success'
                                  : 'active'
                            }
                            showInfo={false}
                            className="mt-2"
                          />}
                        </div>
                      )
                    })}
                  </div>
                ))}
                {filteredTasks.length > TASK_CENTER_PAGE_SIZE ? (
                  <div className="flex items-center justify-end gap-1 pt-1 text-xs text-gray-500">
                    <TaskCenterButton workbench={workbench}
                      size="small"
                      type="text"
                      icon={<ArrowLeftOutlined />}
                      aria-label="上一页任务" title="上一页任务"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    />
                    <span className="min-w-[32px] text-center">{currentPage}/{totalPages}</span>
                    <TaskCenterButton workbench={workbench}
                      size="small"
                      type="text"
                      icon={<ArrowRightOutlined />}
                      aria-label="下一页任务" title="下一页任务"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    />
                  </div>
                ) : null}
              </div>
            )}
      </Drawer>
      <TaskHistory open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  )
}
