import { Alert, Button, DatePicker, Modal, Select, Space, Table, Tag } from 'antd'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { useNavigate } from 'react-router-dom'
import { FilmService, StudioProjectsService, type TaskListItemRead, type TaskStatus } from '../../../services/generated'
import { TASK_KIND_TITLE_MAP } from './taskCopy'
import { mergeTaskUiItems, useTaskUiStore, type TaskUiItem } from './taskUiStore'
import { useResolvedTaskCenterTasks } from './taskCenterMeta'

const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: '排队中', running: '运行中', succeeded: '已完成', failed: '失败', cancelled: '已取消',
}

/** 按服务端游标查询全部历史，独立于短期活动快照，刷新失败保留已显示结果。 */
export function TaskHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const cancelTask = useTaskUiStore((state) => state.cancelTask)
  const [status, setStatus] = useState<TaskStatus>()
  const [kind, setKind] = useState<string>()
  const [project, setProject] = useState<string>()
  const [dates, setDates] = useState<ComponentProps<typeof DatePicker.RangePicker>['value']>(null)
  const [projects, setProjects] = useState<{ value: string; label: string }[]>([])
  const [projectError, setProjectError] = useState(false)
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [rows, setRows] = useState<TaskListItemRead[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const cursor = cursors[cursors.length - 1]
  const createdFrom = dates?.[0]?.startOf('day').toISOString()
  const createdBefore = dates?.[1]?.add(1, 'day').startOf('day').toISOString()

  /** 筛选条件改变后从第一页查询，避免沿用另一组条件的游标。 */
  const resetPage = () => {
    setCursors([undefined])
    setNextCursor(null)
    setRows([])
  }

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(false)
    const request = FilmService.listTasksApiV1FilmTasksGet({
      statuses: status ? [status] : undefined, taskKind: kind, projectId: project,
      createdFrom, createdBefore, cursor, limit: 25,
    })
    void request.then((response) => {
      if (!active) return
      if (!response.data) throw new Error('任务历史响应缺少数据')
      setRows(response.data.items)
      setNextCursor(response.data.next_cursor ?? null)
    }).catch(() => {
      if (active) setError(true)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false; request.cancel() }
  }, [open, status, kind, project, createdFrom, createdBefore, cursor, revision])

  useEffect(() => {
    if (!open) return
    let active = true
    /** 分页加载项目名称，项目筛选不要求用户输入内部 ID。 */
    const loadProjects = async () => {
      const options: { value: string; label: string }[] = []
      setProjectError(false)
      try {
        for (let page = 1; ; page += 1) {
          const response = await StudioProjectsService.listProjectsApiV1StudioProjectsGet({ page, pageSize: 100 })
          if (!active) return
          if (!response.data) throw new Error('项目列表响应缺少数据')
          options.push(...response.data.items.map((item) => ({ value: item.id, label: item.name })))
          if (page * 100 >= response.data.pagination.total) break
        }
        setProjects(options)
      } catch {
        if (active) setProjectError(true)
      }
    }
    void loadProjects()
    return () => { active = false }
  }, [open])

  const items = useMemo(() => mergeTaskUiItems(Object.fromEntries(rows.map((row) => [row.task_id, row])), {}), [rows])
  const resolved = useResolvedTaskCenterTasks(items, navigate)
  const byId = useMemo(() => new Map(rows.map((row) => [row.task_id, row])), [rows])

  return (
    <Modal title="任务历史" open={open} onCancel={onClose} footer={null} width={900} centered zIndex={1300}>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Select aria-label="任务状态" allowClear placeholder="全部状态" value={status}
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => { setStatus(value); resetPage() }} />
        <Select aria-label="任务类型" allowClear placeholder="全部任务类型" value={kind}
          options={Object.entries(TASK_KIND_TITLE_MAP).map(([value, label]) => ({ value, label }))}
          onChange={(value) => { setKind(value); resetPage() }} />
        <Select aria-label="所属项目" allowClear showSearch optionFilterProp="label" placeholder="全部项目" value={project}
          options={projects} onChange={(value) => { setProject(value); resetPage() }} />
        <DatePicker.RangePicker value={dates} onChange={(value) => { setDates(value); resetPage() }} />
      </div>
      {projectError ? <Alert type="warning" showIcon message="项目列表加载失败，仍可按其他条件查询" className="mb-2" /> : null}
      {error ? <Alert type="error" showIcon message="历史加载失败，当前保留上次结果，请重试" className="mb-2" /> : null}
      <Table<TaskUiItem> rowKey="taskId" dataSource={resolved} loading={loading} pagination={false} size="small"
        scroll={{ x: 640, y: 'max(120px, calc(100vh - 330px))' }} columns={[
          { title: '任务', dataIndex: 'title', ellipsis: true },
          { title: '来源', dataIndex: 'sourceLabel', ellipsis: true, render: (value) => value || '—' },
          { title: '状态', width: 95, render: (_, item) => <Tag>{item.cancelRequested && ['queued', 'running'].includes(item.status) ? '取消中' : STATUS_LABELS[item.status]}</Tag> },
          { title: '进度', width: 75, render: (_, item) => { const progress = byId.get(item.taskId)?.progress; return progress == null ? '—' : `${progress}%` } },
          { title: '创建时间', width: 170, render: (_, item) => new Date((byId.get(item.taskId)?.created_at_ts ?? 0) * 1000).toLocaleString('zh-CN', { hour12: false }) },
          { title: '操作', width: 125, render: (_, item) => <Space>
            {item.onNavigate ? <Button type="link" size="small" onClick={() => { item.onNavigate?.(); onClose() }}>查看</Button> : null}
            {['queued', 'running'].includes(item.status) ? <Button type="link" danger size="small" disabled={item.cancelRequested}
              onClick={() => { void cancelTask(item.taskId).then(() => setRevision((value) => value + 1)) }}>取消</Button> : null}
          </Space> },
        ]} />
      <div className="mt-4 flex items-center justify-between">
        <Button loading={loading} onClick={() => setRevision((value) => value + 1)}>刷新</Button>
        <Space>
          <Button disabled={loading || cursors.length === 1} onClick={() => setCursors((values) => values.slice(0, -1))}>上一页</Button>
          <span>第 {cursors.length} 页</span>
          <Button disabled={loading || error || !nextCursor} onClick={() => { if (nextCursor) setCursors((values) => [...values, nextCursor]) }}>下一页</Button>
        </Space>
      </div>
    </Modal>
  )
}
