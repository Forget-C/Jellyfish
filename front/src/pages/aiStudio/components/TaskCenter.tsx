import { Badge, Button, Card, Empty, Progress, Segmented, Select, Tag } from 'antd'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseCircleOutlined,
  PushpinOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskUiItem } from './taskUiStore'
import {
  flattenPageContexts,
  isTaskHighlighted,
  mergeTaskUiItems,
  useTaskUiStore,
} from './taskUiStore'
import { useResolvedTaskCenterTasks } from './taskCenterMeta'
import {
  TASK_STALE_ADVICE,
  TASK_STALE_STATUS_LABEL,
  assessTaskFreshness,
  formatTaskElapsedMs,
  taskTimeLabel,
  type TaskFreshness,
} from './taskCopy'
import { maskInternalIds } from './maskInternalIds'

const TASK_CENTER_OPEN_STORAGE_KEY = 'jellyfish_task_center_open_v1'
const TASK_CENTER_POSITION_STORAGE_KEY = 'jellyfish_task_center_position_v1'
const TASK_CENTER_EDGE_PADDING = 24
const TASK_CENTER_BUTTON_WIDTH = 132
const TASK_CENTER_BUTTON_HEIGHT = 40
const TASK_CENTER_PANEL_WIDTH = 360
const TASK_CENTER_PANEL_HEIGHT = 420
const TASK_CENTER_PANEL_GAP = 12
const TASK_CENTER_PAGE_SIZE = 3

function getDefaultButtonPosition() {
  if (typeof window === 'undefined') {
    return { x: TASK_CENTER_EDGE_PADDING, y: 520 }
  }
  return {
    x: TASK_CENTER_EDGE_PADDING,
    y: Math.max(
      TASK_CENTER_EDGE_PADDING,
      window.innerHeight - TASK_CENTER_BUTTON_HEIGHT - TASK_CENTER_EDGE_PADDING,
    ),
  }
}

function getButtonBounds() {
  if (typeof window === 'undefined') {
    return {
      minX: TASK_CENTER_EDGE_PADDING,
      maxX: TASK_CENTER_EDGE_PADDING,
      minY: TASK_CENTER_EDGE_PADDING,
      maxY: 520,
    }
  }
  return {
    minX: TASK_CENTER_EDGE_PADDING,
    maxX: Math.max(
      TASK_CENTER_EDGE_PADDING,
      window.innerWidth - TASK_CENTER_BUTTON_WIDTH - TASK_CENTER_EDGE_PADDING,
    ),
    minY: TASK_CENTER_EDGE_PADDING,
    maxY: Math.max(
      TASK_CENTER_EDGE_PADDING,
      window.innerHeight - TASK_CENTER_BUTTON_HEIGHT - TASK_CENTER_EDGE_PADDING,
    ),
  }
}

function clampButtonPosition(position: { x: number; y: number }) {
  const bounds = getButtonBounds()
  return {
    x: Math.max(bounds.minX, Math.min(position.x, bounds.maxX)),
    y: Math.max(bounds.minY, Math.min(position.y, bounds.maxY)),
  }
}

function snapButtonPosition(position: { x: number; y: number }) {
  const bounds = getButtonBounds()
  const middleX = (bounds.minX + bounds.maxX) / 2
  return {
    x: position.x <= middleX ? bounds.minX : bounds.maxX,
    y: Math.max(bounds.minY, Math.min(position.y, bounds.maxY)),
  }
}

/**
 * 状态标签。
 *
 * 审计 §4.4 R16：陈旧任务（超过 `TASK_STALE_AFTER_HOURS` 小时没有任何更新）继续显示
 * 「运行中」是**误导**。这里对「还在跑但早就断了」的任务改说「状态未知（超过 N 小时未更新）」，
 * 而不是替它下「失败」的结论（前端无权改后端状态）。
 */
function taskTone(task: TaskUiItem, freshness: TaskFreshness): { color: string; label: string } {
  if (freshness.stale) return { color: 'default', label: TASK_STALE_STATUS_LABEL }
  if (task.cancelRequested) return { color: 'orange', label: '取消中' }
  if (task.status === 'cancelled') return { color: 'orange', label: '已取消' }
  if (task.status === 'failed') return { color: 'red', label: '失败' }
  if (task.status === 'succeeded') return { color: 'green', label: '已完成' }
  if (task.status === 'streaming') return { color: 'cyan', label: '处理中' }
  if (task.status === 'running') return { color: 'blue', label: '运行中' }
  return { color: 'default', label: '排队中' }
}

/**
 * 任务中心是**全站常驻角标**（审计原话）：它的文案会出现在每一个页面上，
 * 所以主区口径必须格外保守 —— 宁可用「后台任务」这类中性词，也不许出现任务号 / 枚举原值。
 *
 * 两个字段都需要掩码：`title` 与 `sourceLabel` 都可能由**上游页面**直接塞进
 * `upsertTask(...)`（例如 `sourceLabel: '章节：<uuid>'`），不是只有 `taskCopy` 一个来源。
 * 这是整条链路唯一的渲染咽喉（审计 §4.4 模式 1 第 5 条），必须在这里兜住。
 */
function maskTaskText(text?: string | null): string | null {
  const value = String(text ?? '')
  if (!value.trim()) return null
  return maskInternalIds(value)
}

export function TaskCenter() {
  const navigate = useNavigate()
  const [scopeFilter, setScopeFilter] = useState<'auto' | 'all' | 'current' | 'active' | 'settled'>('auto')
  const [taskKindFilter, setTaskKindFilter] = useState<string | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [buttonPosition, setButtonPosition] = useState(getDefaultButtonPosition)
  const [dragging, setDragging] = useState(false)
  const open = useTaskUiStore((state) => state.open)
  const setOpen = useTaskUiStore((state) => state.setOpen)
  const toggleOpen = useTaskUiStore((state) => state.toggleOpen)
  const serverItems = useTaskUiStore((state) => state.serverItems)
  const optimisticItems = useTaskUiStore((state) => state.optimisticItems)
  const contextScopes = useTaskUiStore((state) => state.contextScopes)
  const cancelTask = useTaskUiStore((state) => state.cancelTask)
  const dragStateRef = useRef<{
    pointerId: number
    offsetX: number
    offsetY: number
    moved: boolean
  } | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const defaultPosition = getDefaultButtonPosition()
    try {
      setOpen(window.localStorage.getItem(TASK_CENTER_OPEN_STORAGE_KEY) === '1')
      const rawPosition = window.localStorage.getItem(TASK_CENTER_POSITION_STORAGE_KEY)
      if (!rawPosition) {
        setButtonPosition(defaultPosition)
        return
      }
      const parsed = JSON.parse(rawPosition) as { x?: number; y?: number }
      const x = Number.isFinite(parsed?.x) ? Number(parsed.x) : defaultPosition.x
      const y = Number.isFinite(parsed?.y) ? Number(parsed.y) : defaultPosition.y
      setButtonPosition({ x, y })
    } catch {
      setOpen(false)
      setButtonPosition(defaultPosition)
    }
  }, [setOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(TASK_CENTER_OPEN_STORAGE_KEY, open ? '1' : '0')
  }, [open])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(TASK_CENTER_POSITION_STORAGE_KEY, JSON.stringify(buttonPosition))
  }, [buttonPosition])

  useEffect(() => {
    const clampPosition = () => {
      if (typeof window === 'undefined') return
      setButtonPosition((prev) => snapButtonPosition(clampButtonPosition(prev)))
    }
    clampPosition()
    window.addEventListener('resize', clampPosition)
    return () => {
      window.removeEventListener('resize', clampPosition)
    }
  }, [])

  const tasks = useMemo(
    () =>
      mergeTaskUiItems(serverItems, optimisticItems).sort((a, b) => {
        const activeContexts = flattenPageContexts(contextScopes)
        const priority = (task: TaskUiItem): number => {
          if (isTaskHighlighted(task, activeContexts)) return 4
          if (task.cancelRequested) return 3
          if (task.status === 'running' || task.status === 'streaming') return 2
          if (task.status === 'pending') return 1
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
        new Set(
          resolvedTasks
            .map((task) => maskTaskText(task.title))
            .filter((value): value is string => !!value),
        ),
      ).map((title) => ({
        // 下拉项的 label 也是主区：同样过掩码，避免把任务号摆进筛选列表
        label: title,
        value: title,
      })),
    [resolvedTasks],
  )
  const summaryCounts = useMemo(
    () => ({
      current: resolvedTasks.filter((task) => isTaskHighlighted(task, activeContexts)).length,
      active: resolvedTasks.filter((task) => ['pending', 'running', 'streaming'].includes(task.status)).length,
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
        if (effectiveScopeFilter === 'active' && !['pending', 'running', 'streaming'].includes(task.status)) return false
        if (effectiveScopeFilter === 'settled' && !['succeeded', 'failed', 'cancelled'].includes(task.status)) return false
        if (taskKindFilter && maskTaskText(task.title) !== taskKindFilter) return false
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
      (task) => !isTaskHighlighted(task, activeContexts) && ['pending', 'running', 'streaming'].includes(task.status),
    )
    const settledTasks = pagedTasks.filter(
      (task) => !isTaskHighlighted(task, activeContexts) && ['succeeded', 'failed', 'cancelled'].includes(task.status),
    )
    const otherTasks = pagedTasks.filter(
      (task) =>
        !isTaskHighlighted(task, activeContexts) &&
        !['pending', 'running', 'streaming', 'succeeded', 'failed', 'cancelled'].includes(task.status),
    )
    return [
      { key: 'current', title: currentTasks.length > 0 ? `当前页 ${currentTasks.length}` : null, tasks: currentTasks },
      { key: 'active', title: activeTasks.length > 0 ? `运行中 ${activeTasks.length}` : null, tasks: activeTasks },
      { key: 'settled', title: settledTasks.length > 0 ? `最近结束 ${settledTasks.length}` : null, tasks: settledTasks },
      { key: 'all', title: otherTasks.length > 0 ? `全部 ${otherTasks.length}` : null, tasks: otherTasks },
    ].filter((group) => group.tasks.length > 0)
  }, [activeContexts, effectiveScopeFilter, pagedTasks])
  const panelStyle = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        left: TASK_CENTER_EDGE_PADDING,
        top: TASK_CENTER_EDGE_PADDING,
        width: TASK_CENTER_PANEL_WIDTH,
      }
    }
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const panelWidth = Math.min(TASK_CENTER_PANEL_WIDTH, viewportWidth - TASK_CENTER_EDGE_PADDING * 2)
    const preferTop = buttonPosition.y - TASK_CENTER_PANEL_GAP - TASK_CENTER_PANEL_HEIGHT
    const preferBottom = buttonPosition.y + TASK_CENTER_BUTTON_HEIGHT + TASK_CENTER_PANEL_GAP
    const hasSpaceAbove = preferTop >= TASK_CENTER_EDGE_PADDING
    const rawTop = hasSpaceAbove
      ? preferTop
      : Math.min(
          preferBottom,
          Math.max(TASK_CENTER_EDGE_PADDING, viewportHeight - TASK_CENTER_PANEL_HEIGHT - TASK_CENTER_EDGE_PADDING),
        )
    const alignedLeft = buttonPosition.x
    const alignedRight = buttonPosition.x + TASK_CENTER_BUTTON_WIDTH - panelWidth
    const rawLeft = alignedLeft + panelWidth <= viewportWidth - TASK_CENTER_EDGE_PADDING ? alignedLeft : alignedRight
    return {
      left: Math.max(
        TASK_CENTER_EDGE_PADDING,
        Math.min(rawLeft, viewportWidth - panelWidth - TASK_CENTER_EDGE_PADDING),
      ),
      top: Math.max(
        TASK_CENTER_EDGE_PADDING,
        Math.min(rawTop, viewportHeight - TASK_CENTER_PANEL_HEIGHT - TASK_CENTER_EDGE_PADDING),
      ),
      width: panelWidth,
    }
  }, [buttonPosition.x, buttonPosition.y])

  const handleButtonPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleButtonPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const nextX = event.clientX - drag.offsetX
    const nextY = event.clientY - drag.offsetY
    drag.moved = true
    setButtonPosition(clampButtonPosition({ x: nextX, y: nextY }))
  }

  const handleButtonPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setButtonPosition((prev) => snapButtonPosition(prev))
    setDragging(false)
  }

  const handleButtonClick = () => {
    const drag = dragStateRef.current
    if (drag?.moved) {
      dragStateRef.current = null
      return
    }
    dragStateRef.current = null
    toggleOpen()
  }

  return (
    <div
      className={`fixed z-[1200] pointer-events-none ${dragging ? '' : 'transition-[left,top] duration-200 ease-out'}`}
      style={{ left: buttonPosition.x, top: buttonPosition.y }}
    >
      {open ? (
        <div
          className={`fixed pointer-events-auto ${dragging ? '' : 'transition-[left,top] duration-200 ease-out'}`}
          style={{ left: panelStyle.left, top: panelStyle.top, width: panelStyle.width }}
        >
          <Card
            title="任务中心"
            size="small"
            className="shadow-lg"
            extra={
              <Button size="small" type="text" onClick={() => setOpen(false)}>
                收起
              </Button>
            }
            bodyStyle={{ maxHeight: 304, overflow: 'auto' }}
          >
            <div className="mb-3 flex flex-col gap-2">
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
                      const freshness = assessTaskFreshness(task)
                      const tone = taskTone(task, freshness)
                      const elapsed = formatTaskElapsedMs(task.elapsedMs)
                      const startedAt = taskTimeLabel(task.startedAtTs)
                      const lastUpdateAt = taskTimeLabel(freshness.lastUpdateTs)
                      const highlighted = isTaskHighlighted(task, activeContexts)
                      /* 渲染咽喉：两个字段都过掩码（审计 §4.4 模式 1 第 5 条） */
                      const title = maskTaskText(task.title) ?? '后台任务'
                      const sourceLabel = maskTaskText(task.sourceLabel)
                      return (
                        <div
                          key={task.taskId}
                          className={`rounded-lg border px-3 py-2 ${
                            highlighted ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-medium text-sm truncate">{title}</div>
                              {sourceLabel ? (
                                <div className="mt-1 text-xs text-gray-500 truncate">{sourceLabel}</div>
                              ) : null}
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                                {highlighted ? <Tag color="blue">当前页面</Tag> : null}
                                <Tag color={tone.color}>{tone.label}</Tag>
                                <span>进度 {Math.max(0, Math.min(100, Math.round(task.progress)))}%</span>
                                {freshness.stale ? null : elapsed ? <span>耗时 {elapsed}</span> : null}
                              </div>
                              {freshness.stale ? (
                                <div className="mt-1 text-xs text-amber-600">
                                  {lastUpdateAt ? <div>最后更新于 {lastUpdateAt}</div> : null}
                                  <div>{TASK_STALE_ADVICE}</div>
                                </div>
                              ) : null}
                              {startedAt && !freshness.stale ? (
                                <div className="mt-1 text-xs text-gray-400">开始于 {startedAt}</div>
                              ) : null}
                            </div>
                            <div className="flex flex-col gap-2">
                              {task.onNavigate ? (
                                <Button
                                  size="small"
                                  icon={<ArrowRightOutlined />}
                                  onClick={() => {
                                    task.onNavigate?.()
                                    setOpen(false)
                                  }}
                                >
                                  查看
                                </Button>
                              ) : null}
                              {task.onCancel ? (
                                <Button
                                  size="small"
                                  danger
                                  icon={<CloseCircleOutlined />}
                                  disabled={task.cancelRequested}
                                  onClick={task.onCancel}
                                >
                                  {task.cancelRequested ? '正在取消' : '取消'}
                                </Button>
                              ) : task.status === 'pending' || task.status === 'running' || task.status === 'streaming' ? (
                                <Button
                                  size="small"
                                  danger
                                  icon={<CloseCircleOutlined />}
                                  disabled={task.cancelRequested}
                                  onClick={() => {
                                    void cancelTask(task.taskId)
                                  }}
                                >
                                  {task.cancelRequested ? '正在取消' : '取消'}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          <Progress
                            percent={Math.max(0, Math.min(100, Math.round(task.progress)))}
                            size="small"
                            status={
                              freshness.stale
                                ? /* 陈旧任务不再显示「进行中」的动效条：那会让人觉得后台真的还在跑 */
                                  'normal'
                                : task.cancelRequested || task.status === 'failed'
                                  ? 'exception'
                                  : task.status === 'succeeded'
                                    ? 'success'
                                    : 'active'
                            }
                            showInfo={false}
                            className="mt-2"
                          />
                        </div>
                      )
                    })}
                  </div>
                ))}
                {filteredTasks.length > TASK_CENTER_PAGE_SIZE ? (
                  <div className="flex items-center justify-end gap-1 pt-1 text-xs text-gray-500">
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowLeftOutlined />}
                      disabled={currentPage <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    />
                    <span className="min-w-[32px] text-center">{currentPage}/{totalPages}</span>
                    <Button
                      size="small"
                      type="text"
                      icon={<ArrowRightOutlined />}
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <Badge count={tasks.length} size="small" offset={[-4, 4]} showZero={false}>
        <Button
          type="primary"
          size="middle"
          shape="round"
          icon={<UnorderedListOutlined />}
          onClick={handleButtonClick}
          onPointerDown={handleButtonPointerDown}
          onPointerMove={handleButtonPointerMove}
          onPointerUp={handleButtonPointerUp}
          onPointerCancel={handleButtonPointerUp}
          className="shadow-lg pointer-events-auto touch-none select-none"
        >
          <span className="inline-flex items-center gap-1">
            <span>{open ? '收起任务' : '任务中心'}</span>
            <PushpinOutlined className="text-[11px] opacity-70" />
          </span>
        </Button>
      </Badge>
    </div>
  )
}
