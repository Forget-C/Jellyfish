import { useUiText } from '../../../uiText'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { FilmService, type TaskListItemRead } from '../../../services/generated'
import { useTaskUiStore } from './taskUiStore'

const TASK_POLL_INTERVAL_MS = 4000
const TASK_RECENT_SECONDS = 15
const TASK_PAGE_SIZE = 50

type TaskRuntimeProviderProps = {
  children: ReactNode
}

export function TaskRuntimeProvider({ children }: TaskRuntimeProviderProps) {
  const uiText = useUiText()
  const setServerTasks = useTaskUiStore((state) => state.setServerTasks)

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    const load = async () => {
      try {
        const tasks: TaskListItemRead[] = []
        let cursor: string | null = null
        // 完整读取活动集合后一次替换，避免只展示第一页或分页中间状态。
        do {
          const res = await FilmService.listTasksApiV1FilmTasksGet({
            recentSeconds: TASK_RECENT_SECONDS,
            limit: TASK_PAGE_SIZE,
            cursor,
          })
          if (cancelled) return
          if (!res.data) throw new Error(uiText("任务列表响应缺少数据"))
          tasks.push(...res.data.items)
          cursor = res.data.next_cursor ?? null
        } while (cursor)
        if (!cancelled) setServerTasks(tasks)
      } catch {
        // 查询失败保留上一次完整快照，下一轮继续刷新。

      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void load()
          }, TASK_POLL_INTERVAL_MS)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [uiText, setServerTasks])

  return <>{children}</>
}
