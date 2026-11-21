import { useUiText } from '../../../uiText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Modal, Skeleton, message, type InputRef } from 'antd'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceScrollPanel } from '../../../components'
import { CardListPagination } from '../../../components/layout/CardListPagination'
import { useCardPageSize } from '../../../components/layout/useCardPageSize'
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

const assetFocusStorage = 'jellyfish_asset_library_focus'
type ListResult = { assets: LibraryAsset[]; total?: number; query: string; page: number; pageSize: number }
type AssetReturn = { id: string; search?: string }
type CreateSeed = { name: string; description: string; visual_style?: '现实' | '动漫'; style?: string }

/** 四类资产共享列表、分页与危险操作，创建表单沿用各实体的原业务规则。 */
export function AssetLibraryTab({ assetType, active }: { assetType: LibraryAssetType; active: boolean }) {
  const uiText = useUiText()
  const { route } = assetLibraryTypes[assetType]
  const label = uiText(assetLibraryTypes[assetType].label)
  const [params, setParams] = useSearchParams()
  const { key: locationKey } = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const paramsRef = useRef(params)
  paramsRef.current = params
  const queryKey = `${assetType}Query`
  const offsetKey = `${assetType}Offset`
  const query = params.get(queryKey) ?? ''
  const offset = Number(params.get(offsetKey))
  const { panel, measureGrid, measureCard, pageSize } = useCardPageSize(active)
  const page = pageSize && Number.isSafeInteger(offset) && offset > 0 ? Math.floor(offset / pageSize) + 1 : 1
  const [search, setSearch] = useState(query)
  const searchInput = useRef<InputRef>(null)
  const [compact, setCompact] = useState(() => !window.matchMedia('(min-width: 1024px)').matches)
  const [assetReturn, setAssetReturn] = useState<AssetReturn | null>(() => {
    const explicitFocus = params.get('focusAsset')
    if (!active) return null
    if (explicitFocus) return { id: explicitFocus }
    if (navigationType !== 'POP') return null
    try {
      const remembered = JSON.parse(sessionStorage.getItem(assetFocusStorage) ?? 'null')
      return remembered?.key === locationKey && typeof remembered.id === 'string'
        ? { id: remembered.id, search: typeof remembered.search === 'string' ? remembered.search : undefined }
        : null
    } catch {
      return null
    }
  })
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
  const restoringSearch = assetReturn?.search

  const reload = useCallback(() => setRevision(value => value + 1), [])
  const setPage = useCallback((nextPage: number) => {
    const next = new URLSearchParams(paramsRef.current)
    next.set('tab', assetType)
    if (nextPage > 1) next.set(offsetKey, String((nextPage - 1) * pageSize))
    else next.delete(offsetKey)
    // Paging only updates the current list and keeps an open asset drawer mounted.
    navigate({ pathname: '/assets', search: next.toString() }, {
      replace: true, state: { assetLibraryPagination: true },
    })
  }, [assetType, navigate, offsetKey, pageSize])

  useEffect(() => {
    if (!active) return
    const media = window.matchMedia('(min-width: 1024px)')
    const update = () => setCompact(!media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [active])

  useEffect(() => {
    if (!active || restoringSearch === undefined) return
    navigate({ pathname: '/assets', search: restoringSearch }, { replace: true })
    setAssetReturn(previous => previous && { id: previous.id })
  }, [active, navigate, restoringSearch])

  useEffect(() => {
    if (!active || !pageSize || restoringSearch !== undefined) return
    let current = true
    setLoading(true)
    setFailed(false)
    const request = StudioEntitiesApi.list(assetType, {
      q: query || null, page, pageSize,
      ...(assetType === 'actor' ? { order: 'updated_at', isDesc: true } : {}),
    })
    void request.then(response => {
      if (!current) return
      const data = response.data
      if (!data || !Array.isArray(data.items)) throw new Error(uiText("资产列表缺失"))
      const reportedTotal = data.pagination?.total
      const total = Number.isSafeInteger(reportedTotal) && reportedTotal >= data.items.length ? reportedTotal : undefined
      if (total !== undefined) {
        const lastPage = Math.max(1, Math.ceil(total / pageSize))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
      }
      setResult({ assets: data.items as LibraryAsset[], total, query, page, pageSize })
      setLoading(false)
    }).catch(() => {
      if (current) {
        setFailed(true)
        setLoading(false)
      }
    })
    return () => { current = false; request.cancel() }
  }, [uiText, active, assetType, page, pageSize, query, restoringSearch, revision, setPage])

  // The offset anchors the old first item while capacity changes.
  useEffect(() => {
    if (active && restoringSearch === undefined && pageSize && Number.isSafeInteger(offset) && offset >= 0 && offset !== (page - 1) * pageSize) setPage(page)
  }, [active, offset, page, pageSize, restoringSearch, setPage])

  useEffect(() => { setSearch(query) }, [query])

  const resultIsCurrent = result?.query === query && result.page === page && result.pageSize === pageSize
  useEffect(() => {
    if (!active || !assetReturn || restoringSearch !== undefined || loading || (!failed && !resultIsCurrent)) return
    const link = !failed && panel.current?.querySelector<HTMLAnchorElement>(`a[data-library-asset="${CSS.escape(assetReturn.id)}"]`)
    if (link) link.focus()
    else searchInput.current?.focus()
    setAssetReturn(null)
    if (params.get('focusAsset')) {
      const next = new URLSearchParams(params)
      next.delete('focusAsset')
      setParams(next, { replace: true })
    }
    try {
      sessionStorage.removeItem(assetFocusStorage)
    } catch {
      // Explicit returns still carry the focus target in the URL.
    }
  }, [active, assetReturn, failed, loading, panel, params, restoringSearch, resultIsCurrent, setParams])

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
    setSearch(next)
    panel.current?.scrollTo(0, 0)
    if (page === 1 && next === query) {
      reload()
      return
    }
    const nextParams = new URLSearchParams(params)
    if (next) nextParams.set(queryKey, next)
    else nextParams.delete(queryKey)
    nextParams.delete(offsetKey)
    setParams(nextParams, { replace: true })
  }

  const displayedListParams = () => {
    const returnParams = new URLSearchParams(params)
    returnParams.set('tab', assetType)
    if (result?.query) returnParams.set(queryKey, result.query)
    else returnParams.delete(queryKey)
    if (result && result.page > 1) returnParams.set(offsetKey, String((result.page - 1) * result.pageSize))
    else returnParams.delete(offsetKey)
    return returnParams
  }
  const assetEditPath = (id: string) => {
    const returnParams = displayedListParams()
    returnParams.set('focusAsset', id)
    const detailParams = new URLSearchParams({ returnTo: `/assets?${returnParams}` })
    return `/assets/${route}/${encodeURIComponent(id)}/edit?${detailParams}`
  }
  const rememberAssetReturn = (id: string) => {
    try {
      const search = !resultIsCurrent ? displayedListParams().toString() : undefined
      sessionStorage.setItem(assetFocusStorage, JSON.stringify({ key: locationKey, id, search }))
    } catch {
      // Explicit returns use the URL.
    }
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
      setResult(previous => previous?.assets.some(asset => asset.id === deleteTarget.id) ? {
        ...previous,
        assets: previous.assets.filter(asset => asset.id !== deleteTarget.id),
        total: previous.total === undefined ? undefined : Math.max(0, previous.total - 1),
      } : previous)
      setDeleteTarget(undefined)
      message.success(uiText("已删除{{label}}", { label }))
      reload()
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
        <Input.Search ref={searchInput} aria-label={uiText("搜索{{label}}", { label })} placeholder={uiText("搜索{{label}}名称或描述", { label })} allowClear
          value={search} onChange={event => setSearch(event.target.value)} onSearch={searchAssets} />
        <Button aria-label={uiText("刷新")} icon={<ReloadOutlined aria-hidden="true" />} loading={loading && Boolean(result)} onClick={reload}>{uiText("刷新")}</Button>
        {result && <span className="management-count">{result.total === undefined ? uiText("已加载 {{length}} 项", { length: result.assets.length }) : uiText("{{value1}} {{total}} 项", { value1: result.query ? '匹配' : '共', total: result.total })}</span>}
      </div>
      <ResourceCreateButton kind={assetType} onCreate={() => setCreateOpen(true)} onCreated={refreshCreated}><Button className="management-primary" type="primary" icon={<PlusOutlined aria-hidden="true" />}>{uiText("新建{{label}}", { label })}</Button></ResourceCreateButton>
    </PageToolbar>
    <div className="app-card-list-content">
      <div ref={measureGrid} className="asset-library-measure app-card-list-measure" aria-hidden="true">
        <div ref={measureCard}>
          <div className="asset-library-cover" />
          <div className="asset-library-card-content" />
        </div>
      </div>
      <WorkspaceScrollPanel ref={panel} className="management-panel asset-library-scroll">
        {failed && <Alert type="error" showIcon message={result ? resultIsCurrent ? uiText("刷新资产失败，保留已显示的数据") : uiText("读取当前请求失败，仍显示上一次结果") : uiText("读取{{label}}资产失败", { label })}
          action={<Button size="small" aria-label={uiText("重试")} onClick={reload}>{uiText("重试")}</Button>} />}
        {!result && loading && <div className="asset-library-grid" role="status" aria-label={uiText("正在读取资产")}>
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="asset-library-card asset-library-skeleton">
            <Skeleton.Image active /><Skeleton active title paragraph={{ rows: 2 }} />
          </div>)}
        </div>}
        {result && (result.assets.length ? <div className="asset-library-grid" aria-busy={loading}>
          {result.assets.map(asset => <AssetImageCard key={asset.id} asset={asset} assetType={assetType} label={label}
            editPath={assetEditPath(asset.id)} onOpen={() => rememberAssetReturn(asset.id)}
            onDelete={() => { setDeleteFailed(false); setDeleteTarget(asset) }} />)}
        </div> : !failed && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? uiText("无匹配资产") : uiText("暂无{{label}}资产", { label })}>
          {query ? <Button onClick={() => { setSearch(''); searchAssets('') }}>{uiText("清除搜索")}</Button>
            : <ResourceCreateButton kind={assetType} onCreate={() => setCreateOpen(true)} onCreated={refreshCreated}><Button type="primary">{uiText("新建{{label}}", { label })}</Button></ResourceCreateButton>}
        </Empty>)}
      </WorkspaceScrollPanel>
    </div>
    <CardListPagination label={uiText("{{label}}资产分页", { label })} page={result?.page ?? page} pageSize={result?.pageSize ?? pageSize}
      total={result?.total ?? 0} compact={compact} disabled={loading || failed || deleting || !resultIsCurrent}
      onChange={nextPage => {
        panel.current?.scrollTo(0, 0)
        setPage(nextPage)
      }} />

    <ResourceEditorDrawer key={assetType} open={createOpen} kind={assetType} seed={createSeed}
      onClose={closeCreate} onSaved={async () => { refreshCreated() }} />
    <Modal title={deleteTarget ? uiText("删除{{label}}「{{name}}」？", { label, name: deleteTarget.name }) : undefined} open={Boolean(deleteTarget)} className="asset-library-delete"
      okText={uiText("删除")} cancelText={uiText("取消")} okButtonProps={{ danger: true }} confirmLoading={deleting}
      cancelButtonProps={{ disabled: deleting }} closable={!deleting} keyboard={!deleting} maskClosable={!deleting}
      onCancel={() => { if (!deleteInFlight.current) setDeleteTarget(undefined) }} onOk={() => void deleteAsset()}>
      <p>{uiText("删除后无法恢复。已关联的资产仍受现有引用限制。")}</p>
      {deleteFailed && <Alert type="error" message={deleteError || uiText("删除{{label}}失败，请重试", { label })} />}
    </Modal>
  </>
}
