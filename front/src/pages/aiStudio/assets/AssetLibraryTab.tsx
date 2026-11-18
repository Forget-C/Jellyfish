import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Pagination, Skeleton, message } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceScrollPanel } from '../../../components'
import { StudioEntitiesApi } from '../../../services/studioEntities'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { ResourceCreateButton } from './components/ResourceCreateButton'
import { ResourceEditorDrawer } from './components/ResourceEditorDrawer'
import { AssetImageCard, type LibraryAsset, type LibraryAssetType } from './components/AssetImageCard'

export const assetLibraryTypes = {
  actor: { label: '演员', route: 'actors' },
  scene: { label: '场景', route: 'scenes' },
  prop: { label: '道具', route: 'props' },
  costume: { label: '服装', route: 'costumes' },
} as const

const pageSize = 12
type ListResult = { assets: LibraryAsset[]; total?: number }
type CreateSeed = { name: string; description: string; visual_style?: '现实' | '动漫'; style?: string }

/** 四类资产共享列表、分页与危险操作，创建表单沿用各实体的原业务规则。 */
export function AssetLibraryTab({ assetType }: { assetType: LibraryAssetType }) {
  const { label, route } = assetLibraryTypes[assetType]
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<ListResult>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [createSeed, setCreateSeed] = useState<CreateSeed>()
  const [deleteTarget, setDeleteTarget] = useState<LibraryAsset>()
  const [deleting, setDeleting] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteInFlight = useRef(false)

  const reload = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    void StudioEntitiesApi.list(assetType, {
      q: query || null, page, pageSize,
      ...(assetType === 'actor' ? { order: 'updated_at', isDesc: true } : {}),
    }).then(response => {
      if (!active) return
      const data = response.data
      if (!data || !Array.isArray(data.items)) throw new Error('资产列表缺失')
      const total = data.pagination?.total
      setResult({
        assets: data.items as LibraryAsset[],
        total: typeof total === 'number' ? total : undefined,
      })
    }).catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [assetType, page, query, revision])

  useEffect(() => {
    if (params.get('create') !== '1' || params.get('tab') !== assetType) return
    if (assetType !== 'actor') {
      const visualStyle = params.get('visualStyle')?.trim()
      setCreateSeed({
        name: params.get('name') ?? '',
        description: params.get('desc') ?? '',
        visual_style: visualStyle === '现实' || visualStyle === '动漫' ? visualStyle : undefined,
        style: params.get('style')?.trim() || undefined,
      })
    }
    setCreateOpen(true)
    const next = new URLSearchParams(params)
    for (const key of ['create', 'name', 'desc', 'projectId', 'chapterId']) next.delete(key)
    if (assetType !== 'actor') {
      next.delete('visualStyle')
      next.delete('style')
    }
    setParams(next, { replace: true })
  }, [assetType, params, setParams])

  const searchAssets = (value: string) => {
    const next = value.trim()
    if (page === 1 && next === query) reload()
    setPage(1)
    setQuery(next)
  }
  const closeCreate = () => {
    setCreateOpen(false)
    setCreateSeed(undefined)
  }
  const refreshCreated = () => {
    if (page === 1) reload()
    else setPage(1)
  }

  const deleteAsset = async () => {
    if (!deleteTarget || deleteInFlight.current) return
    deleteInFlight.current = true
    setDeleting(true)
    setDeleteFailed(false)
    try {
      await StudioEntitiesApi.remove(assetType, deleteTarget.id)
      setResult(previous => previous ? {
        assets: previous.assets.filter(asset => asset.id !== deleteTarget.id),
        total: previous.total === undefined ? undefined : Math.max(0, previous.total - 1),
      } : previous)
      setDeleteTarget(undefined)
      message.success(`已删除${label}`)
      if (page > 1 && result?.assets.length === 1) setPage(page - 1)
      else reload()
    } catch (cause) {
      setDeleteError(apiErrorMessage(cause))
      setDeleteFailed(true)
    } finally {
      deleteInFlight.current = false
      setDeleting(false)
    }
  }

  return <>
    <PageToolbar className="management-toolbar">
      <div className="management-tools">
        <Input.Search aria-label={`搜索${label}`} placeholder={`搜索${label}名称或描述`} allowClear
          value={search} onChange={event => setSearch(event.target.value)} onSearch={searchAssets} />
        <Button aria-label="刷新" icon={<ReloadOutlined aria-hidden="true" />} loading={loading && Boolean(result)} onClick={reload}>刷新</Button>
        {result && <span className="management-count">{result.total === undefined ? `已加载 ${result.assets.length} 项` : `共 ${result.total} 项`}</span>}
      </div>
      <ResourceCreateButton kind={assetType} onCreate={() => setCreateOpen(true)} onCreated={refreshCreated}><Button className="management-primary" type="primary" icon={<PlusOutlined aria-hidden="true" />}>新建{label}</Button></ResourceCreateButton>
    </PageToolbar>
    <WorkspaceScrollPanel className="management-panel">
      {failed && <Alert type="error" showIcon message={result ? '刷新资产失败，保留已显示的数据' : `读取${label}资产失败`}
        action={<Button size="small" aria-label="重试" onClick={reload}>重试</Button>} />}
      {!result && loading && <div className="asset-library-grid" role="status" aria-label="正在读取资产">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="asset-library-card asset-library-skeleton">
          <Skeleton.Image active /><Skeleton active title paragraph={{ rows: 2 }} />
        </div>)}
      </div>}
      {result && (result.assets.length ? <div className="asset-library-grid" aria-busy={loading}>
        {result.assets.map(asset => <AssetImageCard key={asset.id} asset={asset} assetType={assetType} label={label}
          editPath={`/assets/${route}/${encodeURIComponent(asset.id)}/edit`}
          onDelete={() => { setDeleteFailed(false); setDeleteTarget(asset) }} />)}
      </div> : !failed && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '无匹配资产' : `暂无${label}资产`}>
        {query ? <Button onClick={() => { setSearch(''); searchAssets('') }}>清除搜索</Button>
          : <ResourceCreateButton kind={assetType} onCreate={() => setCreateOpen(true)} onCreated={refreshCreated}><Button type="primary">新建{label}</Button></ResourceCreateButton>}
      </Empty>)}
      {result?.total !== undefined && result.total > pageSize && <div className="asset-library-pagination">
        <Pagination current={page} pageSize={pageSize} total={result.total} showSizeChanger={false}
          disabled={loading} onChange={setPage} />
      </div>}
    </WorkspaceScrollPanel>

    <ResourceEditorDrawer key={assetType} open={createOpen} kind={assetType} seed={createSeed}
      onClose={closeCreate} onSaved={async () => { refreshCreated() }} />
    <Modal title={deleteTarget ? `删除${label}「${deleteTarget.name}」？` : undefined} open={Boolean(deleteTarget)} className="asset-library-delete"
      okText="删除" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={deleting}
      cancelButtonProps={{ disabled: deleting }} closable={!deleting} keyboard={!deleting} maskClosable={!deleting}
      onCancel={() => { if (!deleteInFlight.current) setDeleteTarget(undefined) }} onOk={() => void deleteAsset()}>
      <p>删除后无法恢复。已关联的资产仍受现有引用限制。</p>
      {deleteFailed && <Alert type="error" message={deleteError || `删除${label}失败，请重试`} />}
    </Modal>
  </>
}
