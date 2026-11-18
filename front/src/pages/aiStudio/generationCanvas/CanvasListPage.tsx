import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Pagination, Space, Spin } from 'antd'
import { PictureOutlined, PlusOutlined } from '@ant-design/icons'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { StudioGenerationCanvasesService as Canvases, type CanvasSummary } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { CanvasDeletionDialog } from './CanvasDeletionDialog'
import './canvas-list.css'

/** 仅消费摘要；详情正文在进入编辑器时加载。 */
export function CanvasListPage() {
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const q = search.get('q') || '', page = Math.max(1, Number(search.get('page')) || 1)
  const [items, setItems] = useState<CanvasSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [target, setTarget] = useState<CanvasSummary>()
  const [name, setName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [deleting, setDeleting] = useState<CanvasSummary>()
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    const request = Canvases.canvasList({ q, page, pageSize: 24 })
    void request.then(({ data }) => { if (active && data) { setItems(data.items); setTotal(data.pagination.total) } })
      .catch(reason => { if (active) setError(apiErrorMessage(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.cancel() }
  }, [q, page, retry])
  const create = async () => {
    setBusy(true); setError('')
    try { const { data } = await Canvases.canvasCreate({ requestBody: {} }); if (data) navigate(`/canvases/${data.id}`) }
    catch (reason) { setError(apiErrorMessage(reason)) } finally { setBusy(false) }
  }
  const rename = async () => {
    if (!target || !name.trim()) return
    setBusy(true)
    try {
      await Canvases.canvasRename({ canvasId: target.id, requestBody: { name, expected_revision: target.revision } })
      setTarget(undefined); setRetry(value => value + 1)
    } catch (reason) { setRenameError(apiErrorMessage(reason)) } finally { setBusy(false) }
  }
  return <WorkspaceLayout className="canvas-list-page" aria-label="画布列表">
    <PageToolbar title="画布"><Space wrap>
      <Input.Search aria-label="搜索画布" placeholder="搜索画布名称" defaultValue={q} allowClear onSearch={value => setSearch(value ? { q: value } : {})} />
      <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={() => void create()}>新建画布</Button>
    </Space></PageToolbar>
    <WorkspaceScrollPanel className="canvas-list-scroll">
      {error && <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
      {loading ? <Spin aria-label="正在加载画布" /> : !items.length ? <Empty description={q ? '没有匹配的画布' : '暂无画布'} /> : <div className="canvas-list-grid">
        {items.map(canvas => <article key={canvas.id} className="canvas-list-card">
          <Link to={`/canvases/${canvas.id}`} className="canvas-list-link">
            <div className="canvas-list-cover"><PictureOutlined aria-hidden />{canvas.cover_file_id && <img alt="" src={buildFileDownloadUrl(canvas.cover_file_id)} onError={event => { event.currentTarget.style.visibility = 'hidden' }} />}</div>
            <h2>{canvas.name}</h2><time dateTime={canvas.updated_at}>{new Date(canvas.updated_at).toLocaleString()}</time>
          </Link>
          <Space><Button onClick={() => { setTarget(canvas); setName(canvas.name); setRenameError('') }}>重命名</Button>
            <Button danger onClick={() => setDeleting(canvas)}>删除</Button></Space>
        </article>)}
      </div>}
      <Pagination current={page} pageSize={24} total={total} showSizeChanger={false} onChange={value => setSearch({ ...(q ? { q } : {}), page: String(value) })} />
    </WorkspaceScrollPanel>
    <Modal title="重命名画布" open={!!target} onCancel={() => setTarget(undefined)} onOk={() => void rename()} confirmLoading={busy} okButtonProps={{ disabled: !name.trim() }}>
      {renameError && <Alert type="error" message={renameError} />}
      <Input aria-label="画布名称" value={name} maxLength={255} onChange={event => setName(event.target.value)} onPressEnter={() => void rename()} />
    </Modal>
    {deleting && <CanvasDeletionDialog key={deleting.id} projectId="" canvasId={deleting.id} canDelete={() => true}
      onClose={() => setDeleting(undefined)} onFailure={setError}
      onDeleted={() => { setDeleting(undefined); setRetry(value => value + 1) }} />}
  </WorkspaceLayout>
}
