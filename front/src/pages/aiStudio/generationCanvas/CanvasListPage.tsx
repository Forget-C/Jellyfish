import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Input, Modal, Spin } from 'antd'
import { ArrowRightOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined, MoreOutlined, PictureOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CardListPagination } from '../../../components/layout/CardListPagination'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { useCardPageSize } from '../../../components/layout/useCardPageSize'
import { StudioGenerationCanvasesService as Canvases, type CanvasSummary } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { CanvasDeletionDialog } from './CanvasDeletionDialog'
import './canvas-list.css'

function CanvasCover({ fileId }: { fileId: CanvasSummary['cover_file_id'] }) {
  const [failed, setFailed] = useState(false)
  return <div className="canvas-list-cover" aria-hidden="true">
    {fileId && !failed ? <img alt="" src={buildFileDownloadUrl(fileId)} onError={() => setFailed(true)} />
      : <span className="canvas-list-placeholder"><PictureOutlined /></span>}
  </div>
}

/** 仅消费摘要；详情正文在进入编辑器时加载。 */
export function CanvasListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const searchText = search.get('q') ?? ''
  const q = searchText.trim()
  const offset = Math.max(0, Number(search.get('offset')) || 0)
  const legacyPage = Number(search.get('page'))
  const { panel, measureGrid, measureCard, pageSize } = useCardPageSize()
  const page = pageSize && Number.isSafeInteger(offset) && offset > 0 ? Math.floor(offset / pageSize) + 1
    : Number.isSafeInteger(legacyPage) && legacyPage > 1 ? legacyPage : 1
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [items, setItems] = useState<CanvasSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [retry, setRetry] = useState(0)
  const [target, setTarget] = useState<CanvasSummary>()
  const [name, setName] = useState('')
  const [renameError, setRenameError] = useState('')
  const [deleting, setDeleting] = useState<CanvasSummary>()
  const returnState = { canvasListSearch: location.search }

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const setPage = useCallback((nextPage: number) => {
    const params = new URLSearchParams()
    if (searchText) params.set('q', searchText)
    if (nextPage > 1) params.set('offset', String((nextPage - 1) * pageSize))
    navigate({ pathname: '/canvases', search: params.toString() }, { replace: true })
  }, [navigate, pageSize, searchText])

  useEffect(() => {
    if (!pageSize) return
    let active = true
    setLoading(true)
    setLoadError('')
    const request = Canvases.canvasList({ q, page, pageSize })
    void request.then(({ data }) => {
      if (!active) return
      if (!data) throw new Error('无法读取画布列表')
      const lastPage = Math.max(1, Math.ceil(data.pagination.total / pageSize))
      if (page > lastPage) {
        setPage(lastPage)
        return
      }
      setItems(data.items)
      setTotal(data.pagination.total)
      setLoading(false)
    }).catch(reason => {
      if (active) {
        setLoadError(apiErrorMessage(reason))
        setLoading(false)
      }
    })
    return () => { active = false; request.cancel() }
  }, [q, page, pageSize, retry, setPage])

  // Resize preserves the old first position, then records the new page's start.
  useEffect(() => {
    if (pageSize && (legacyPage || offset !== (page - 1) * pageSize)) setPage(page)
  }, [legacyPage, offset, page, pageSize, setPage])

  const create = async () => {
    setBusy(true)
    setActionError('')
    try {
      const { data } = await Canvases.canvasCreate({ requestBody: {} })
      if (data) navigate(`/canvases/${data.id}`, { state: returnState })
    } catch (reason) {
      setActionError(apiErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const rename = async () => {
    if (!target || !name.trim() || busy) return
    setBusy(true)
    try {
      await Canvases.canvasRename({ canvasId: target.id, requestBody: { name, expected_revision: target.revision } })
      setTarget(undefined)
      setRetry(value => value + 1)
    } catch (reason) {
      setRenameError(apiErrorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const searchControl = <div key="search" className="canvas-list-search">
    <Input aria-label="搜索画布" placeholder="搜索画布名称" prefix={<SearchOutlined />} allowClear value={searchText}
      onChange={event => {
        const value = event.target.value
        panel.current?.scrollTo(0, 0)
        setSearch(value ? { q: value } : {}, { replace: true })
      }} />
  </div>
  const createControl = <Button key="create" className="canvas-list-create" type="primary" icon={<PlusOutlined />}
    loading={busy && !target} onClick={() => void create()}>新建画布</Button>

  return <WorkspaceLayout className="canvas-list-page" aria-label="画布列表">
    <PageToolbar>
      <div className="canvas-list-heading">
        <h1 className="app-page-title">画布</h1>
        <span className="canvas-list-count" role="status">
          {!loading && !loadError && (q ? `匹配 ${total} 张画布` : `共 ${total} 张画布`)}
        </span>
      </div>
      {wide ? [searchControl, createControl] : [createControl, searchControl]}
    </PageToolbar>
    {actionError && <Alert className="canvas-list-action-error" type="error" showIcon message={actionError}
      closable onClose={() => setActionError('')} />}
    <div className="app-card-list-content">
      <div ref={measureGrid} className="app-card-list-grid app-card-list-measure" aria-hidden="true">
        <div ref={measureCard}>
          <div className="canvas-list-cover" />
          <div className="canvas-list-card-body" />
        </div>
      </div>
      <WorkspaceScrollPanel ref={panel} className="canvas-list-scroll">
        {loadError ? <Alert type="error" showIcon message={loadError}
          action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />
          : loading ? <Spin aria-label="正在加载画布" />
            : !items.length ? <Empty description={q ? '没有匹配的画布' : '暂无画布'} />
              : <div className="app-card-list-grid canvas-list-grid">
                {items.map(canvas => {
                  const updated = new Date(canvas.updated_at).toLocaleString()
                  return <article key={canvas.id} className="canvas-list-card">
                    <CanvasCover key={canvas.cover_file_id} fileId={canvas.cover_file_id} />
                    <div className="canvas-list-card-body">
                      <h2 title={canvas.name}>
                        <Link to={`/canvases/${canvas.id}`} state={returnState} className="canvas-list-link">
                          <span>{canvas.name}</span><ArrowRightOutlined aria-hidden />
                        </Link>
                      </h2>
                      <div className="canvas-list-date">
                        <ClockCircleOutlined aria-hidden />
                        <time dateTime={canvas.updated_at}>更新于 {updated}</time>
                      </div>
                    </div>
                    <Dropdown trigger={['click']} autoFocus menu={{ items: [
                      { key: 'rename', label: '重命名', icon: <EditOutlined />, onClick: () => {
                        setTarget(canvas); setName(canvas.name); setRenameError('')
                      } },
                      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true, onClick: () => {
                        setActionError(''); setDeleting(canvas)
                      } },
                    ] }}>
                      <Button className="canvas-list-more" aria-label={`${canvas.name}的更多操作`} icon={<MoreOutlined />} />
                    </Dropdown>
                  </article>
                })}
              </div>}
      </WorkspaceScrollPanel>
    </div>
    <CardListPagination label="画布列表分页" page={page} pageSize={pageSize} total={loadError ? 0 : total}
      compact={!wide} disabled={loading || busy || !!deleting} onChange={nextPage => {
        panel.current?.scrollTo(0, 0)
        setPage(nextPage)
      }} />
    <Modal title="重命名画布" open={!!target} onCancel={() => { if (!busy) setTarget(undefined) }} onOk={() => void rename()}
      confirmLoading={busy} okButtonProps={{ disabled: !name.trim() }}>
      {renameError && <Alert type="error" message={renameError} />}
      <Input aria-label="画布名称" value={name} maxLength={255} onChange={event => setName(event.target.value)} onPressEnter={() => void rename()} />
    </Modal>
    {deleting && <CanvasDeletionDialog key={deleting.id} projectId="" canvasId={deleting.id} canDelete={() => true}
      onClose={() => setDeleting(undefined)} onFailure={setActionError}
      onDeleted={() => { setDeleting(undefined); setRetry(value => value + 1) }} />}
  </WorkspaceLayout>
}
