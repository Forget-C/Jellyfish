import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Alert, Button, Modal, Space, Spin, Table, Tag } from 'antd'
import { FilmService, StudioDirectingService, type DivisionAnalysisDetail, type DivisionHistoryEntry, type DivisionHistoryPage, type DivisionVersionDetail } from '../../../services/generated'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { ResourceEditorFrame } from '../assets/components/ResourceEditorFrame'
import '../assets/components/resourceEditor.css'

export type DivisionHistorySelection = { kind: 'version'; detail: DivisionVersionDetail } | { kind: 'analysis'; detail: DivisionAnalysisDetail }
const origins: Record<string, string> = { manual: '手动', ai: 'AI', restore: '历史恢复' }
const statuses: Record<string, string> = { queued: '等待执行', running: '分析中', failed: '失败', cancelled: '已取消', saved: '已保存' }
const statusLabel = (row: DivisionHistoryEntry) => row.status === 'succeeded' ? (row.save_relation === 'saved' ? '已保存' : '待保存方案') : statuses[row.status] || row.status

/** 摘要分页、展开才读正文；查看和载入均由父页面维护草稿保护。 */
export function DivisionHistoryDrawer({ open, projectId, chapterId, refreshKey, onClose, onView, onLoad, targetTask }: {
  open: boolean; projectId: string; chapterId: string; refreshKey: number; onClose: () => void
  targetTask?: string | null
  onView: (detail: DivisionVersionDetail) => void; onLoad: (selection: DivisionHistorySelection) => void
}) {
  const drawerId = useId()
  const [page, setPage] = useState(1)
  const [data, setData] = useState<DivisionHistoryPage>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState<Record<string, DivisionHistorySelection>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<React.Key[]>([])
  const [retry, setRetry] = useState(0)
  const currentScope = `${projectId}:${chapterId}:${open}:${targetTask || ''}`
  const scope = useRef({ key: currentScope })
  if (scope.current.key !== currentScope) scope.current = { key: currentScope }
  const requests = useRef(new Map<string, { status: string }>())
  useEffect(() => { setPage(1); setData(undefined); setError(''); setDetails({}); setErrors({}); setExpanded([]) }, [currentScope])
  useEffect(() => {
    if (!open || targetTask) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      setLoading(true)
      try {
        const response = await StudioDirectingService.directingDivisionHistory({ projectId, chapterId, page, pageSize: 10 })
        if (!response.data) throw new Error('历史版本读取失败')
        if (!active) return
        setData(response.data); setError('')
        if (response.data.items.some(row => ['queued', 'running'].includes(row.status))) timer = setTimeout(() => { void load() }, 2500)
      } catch (cause) { if (active) setError(apiErrorMessage(cause)) }
      finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [open, projectId, chapterId, page, refreshKey, retry, targetTask])
  const readDetail = useCallback(async (row: Pick<DivisionHistoryEntry, 'kind' | 'id' | 'status'>) => {
    const key = `${row.kind}:${row.id}`, requestScope = scope.current
    const request = { status: row.status }
    requests.current.set(key, request)
    const isCurrent = () => scope.current === requestScope && requests.current.get(key) === request
    setErrors(value => ({ ...value, [key]: '' }))
    try {
      let selection: DivisionHistorySelection
      if (row.kind === 'version') {
        const response = await StudioDirectingService.directingDivisionVersion({ projectId, chapterId, versionId: row.id })
        if (!response.data) throw new Error('版本详情读取失败')
        selection = { kind: 'version', detail: response.data }
      } else {
        const response = await StudioDirectingService.directingDivisionAnalysis({ projectId, chapterId, taskId: row.id })
        if (!response.data) throw new Error('分析详情读取失败')
        selection = { kind: 'analysis', detail: response.data }
      }
      if (isCurrent()) {
        setDetails(value => ({ ...value, [key]: selection }))
        return selection
      }
    } catch (cause) { if (isCurrent()) setErrors(value => ({ ...value, [key]: apiErrorMessage(cause) })) }
  }, [projectId, chapterId])
  const targetKey = `analysis:${targetTask}`
  const target = details[targetKey]
  useEffect(() => {
    if (!open || !targetTask) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const read = async () => {
      const result = await readDetail({ kind: 'analysis', id: targetTask, status: '' })
      if (active && result?.kind === 'analysis' && ['queued', 'running'].includes(result.detail.analysis.status)) {
        timer = setTimeout(() => void read(), 2500)
      }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [open, targetTask, retry, readDetail])
  useEffect(() => {
    for (const row of data?.items || []) {
      const key = `${row.kind}:${row.id}`, selection = details[key]
      if (expanded.includes(key) && selection?.kind === 'analysis' && selection.detail.analysis.status !== row.status && requests.current.get(key)?.status !== row.status && !errors[key]) {
        void readDetail(row)
      }
    }
  }, [data, details, expanded, readDetail])
  const renderDetail = (row: DivisionHistoryEntry) => {
    const key = `${row.kind}:${row.id}`, selection = details[key]
    if (errors[key]) return <Alert type="error" message={errors[key]} action={<Button onClick={() => void readDetail(row)}>重试详情</Button>} />
    if (!selection) return <Spin />
    const scenes = selection.kind === 'analysis'
      ? (selection.detail.result?.scenes || []).map(scene => ({ title: scene.title, excerpt: scene.excerpt, span: undefined, id: undefined }))
      : (selection.detail.chapter?.sequences || []).map(scene => ({ title: scene.title, excerpt: scene.source_text, span: scene.span, id: scene.id }))
    return <div className="division-history-detail">
      <p>{origins[row.origin] || row.origin} · {new Date(row.created_at).toLocaleString()} · {statusLabel(row)}</p>
      {selection.kind === 'analysis' && <>
        {selection.detail.issues.map(issue => <Alert key={issue} type="warning" message={issue} />)}
        {selection.detail.source_changed && <Alert type="warning" message="基于旧原文，载入后需要重新定位全部范围。" />}
        {selection.detail.baseline_changed && <Alert type="warning" message="分析后划分已变化，载入后需要重新核对场次身份。" />}
      </>}
      {scenes.map((scene, index) => <section key={`${index}:${scene.id || ''}`}><strong>{index + 1}. {scene.title}</strong>
        <p className="chapter-source-excerpt">{scene.excerpt}</p>{scene.span && <small>范围 {scene.span.start}–{scene.span.end} · 身份 {scene.id}</small>}
      </section>)}
      <Space wrap>
        {selection.kind === 'version' ? <>
          <Button onClick={() => onView(selection.detail)}>查看版本</Button>
          <Button onClick={() => onLoad(selection)}>基于此版本编辑</Button>
          {selection.detail.version.source_task_id && <Button onClick={() => void readDetail({ ...row, id: selection.detail.version.source_task_id!, kind: 'analysis' })}>查看原始 AI 输出</Button>}
        </> : selection.kind === 'analysis' && selection.detail.result && <Button disabled={!!selection.detail.issues.length} onClick={() => onLoad(selection)}>载入编辑</Button>}
      </Space>
      {selection.kind === 'version' && selection.detail.version.source_task_id && (() => {
        const taskKey = `analysis:${selection.detail.version.source_task_id}`, task = details[taskKey]
        return errors[taskKey] ? <Alert type="error" message={errors[taskKey]} /> : task?.kind === 'analysis' ? <div><h4>原始 AI 输出</h4>{task.detail.result?.scenes.map((scene, index) => <p key={index} className="chapter-source-excerpt">{scene.title}：{scene.excerpt}</p>)}{task.detail.issues.map(issue => <p key={issue}>{issue}</p>)}</div> : null
      })()}
    </div>
  }
  if (targetTask) return <Modal title="划分任务详情" open={open} width={800} onCancel={onClose}
    footer={<Button aria-label="关闭" onClick={onClose}>关闭</Button>}>
    {errors[targetKey] ? <Alert type="error" showIcon message={errors[targetKey]}
      action={<Button onClick={() => setRetry(value => value + 1)}>重试详情</Button>} />
      : target?.kind === 'analysis' ? renderDetail(target.detail.analysis) : <Spin aria-label="正在读取划分任务" />}
  </Modal>
  return <ResourceEditorFrame id={drawerId} title="历史版本" drawer open={open} drawerWidth={900}
    backLabel="关闭" onClose={onClose} actions={null}>
    {error && <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试列表</Button>} />}
    <Table<DivisionHistoryEntry> className="division-history-table" size="small" loading={loading} dataSource={data?.items || []} rowKey={row => `${row.kind}:${row.id}`}
      locale={{ emptyText: '暂无历史版本或分析记录' }} pagination={{ current: page, pageSize: 10, total: data?.total || 0, showSizeChanger: false, onChange: setPage }}
      expandable={{ expandedRowKeys: expanded, onExpandedRowsChange: keys => setExpanded([...keys]), onExpand: (value, row) => { if (value) void readDetail(row) }, expandedRowRender: renderDetail }}
      columns={[
        { title: '版本／记录', render: (_, row) => <Space wrap><strong>{row.number ? `v${row.number}` : 'AI 分析'}</strong>{row.is_current && <Tag color="blue">当前</Tag>}</Space> },
        { title: '来源', dataIndex: 'origin', responsive: ['md'], render: value => origins[value] || value },
        { title: '创建时间', dataIndex: 'created_at', responsive: ['lg'], render: value => new Date(value).toLocaleString() },
        { title: '场次数', dataIndex: 'sequence_count', responsive: ['md'], render: value => value ?? '展开查看' },
        { title: '状态', render: (_, row) => <span>{statusLabel(row)}{row.progress != null && ['queued', 'running'].includes(row.status) ? ` ${row.progress}%` : ''}</span> },
        { title: '操作', render: (_, row) => ['queued', 'running'].includes(row.status) ? <Button size="small" onClick={async () => {
          try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: row.id, requestBody: { reason: '用户取消' } }); setRetry(value => value + 1) }
          catch (cause) { setError(apiErrorMessage(cause)) }
        }}>取消分析</Button> : <Button size="small" aria-label="展开" onClick={() => { setExpanded(keys => [...new Set([...keys, `${row.kind}:${row.id}`])]); void readDetail(row) }}>展开</Button> },
      ]} />
  </ResourceEditorFrame>
}
