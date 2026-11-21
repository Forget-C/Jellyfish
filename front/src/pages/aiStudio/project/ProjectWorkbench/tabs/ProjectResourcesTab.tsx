import { useUiText } from '../../../../../uiText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Dropdown, Empty, Input, Modal, Popover, Radio, Space, Spin, message } from 'antd'
import { ArrowRightOutlined, FilterOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CardListPagination } from '../../../../../components/layout/CardListPagination'
import { WorkspaceScrollPanel } from '../../../../../components/layout/PageLayout'
import { useCardPageSize } from '../../../../../components/layout/useCardPageSize'
import { StudioEntitiesService } from '../../../../../services/generated'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { apiErrorMessage } from '../../../../../services/apiErrorMessage'
import { DisplayImageCard } from '../../../assets/components/DisplayImageCard'
import { ResourceCardMetadata } from '../../../assets/components/ResourceCardMetadata'
import { ResourceCreateButton } from '../../../assets/components/ResourceCreateButton'
import { ResourceEditorDrawer } from '../../../assets/components/ResourceEditorDrawer'
import { resolveAssetUrl } from '../../../assets/utils'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import { useProjectAssetDetail } from '../useProjectAssetDetail'
import './project-resources.css'

const labels = { actor: '演员', character: '角色', scene: '场景', prop: '道具', costume: '服装' }
export type ProjectResourceKind = keyof typeof labels
type Kind = ProjectResourceKind
const sources = {
  created: '设定创建', library: '资产库导入', upload: '上传', project: '项目转化', role_conversion: '从角色转化',
}
type Source = keyof typeof sources
type Cover = 'all' | 'present' | 'missing'
type Filters = { source: Source[]; cover: Cover }
type ListState = Filters & { query: string; offset: number }
type Resource = { id: string; project_id: string; name: string; thumbnail?: string; description?: string; origin?: string; source_character_id?: string; created_at?: string }
export type ProjectResourcePageResult = { items: Resource[]; total?: number; page: number; pageSize: number; query: string; filterCount: number; source: Source[]; cover: Cover }
type CreateSeed = { name: string; description: string; visual_style?: '现实' | '动漫'; style?: string }
const emptyFilters: Filters = { source: [], cover: 'all' }

function readListState(key: string): ListState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (saved) return {
      source: Array.isArray(saved.source) ? saved.source.filter((value: string) => Object.prototype.hasOwnProperty.call(sources, value)) : [],
      cover: saved.cover === 'present' || saved.cover === 'missing' ? saved.cover : 'all',
      query: typeof saved.query === 'string' ? saved.query : '',
      offset: Number.isSafeInteger(saved.offset) && saved.offset > 0 ? saved.offset : 0,
    }
  } catch { /* A fresh list remains available without browser storage. */ }
  return { ...emptyFilters, query: '', offset: 0 }
}

function ResourceFilters({ kind, value, onApply }: { kind: Kind; value: Filters; onApply: (filters: Filters) => void }) {
  const uiText = useUiText()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const count = Number(value.source.length > 0) + Number(value.cover !== 'all')
  const close = () => { setOpen(false); trigger.current?.focus() }
  const apply = (filters: Filters) => { close(); onApply(filters) }
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => panel.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])
  return <Popover trigger="click" open={open} placement="bottomLeft"
    onOpenChange={next => { if (next) setDraft(value); setOpen(next) }}
    content={<div ref={panel} tabIndex={-1} className="project-resource-filter-panel" onKeyDown={event => {
      if (event.key === 'Escape') close()
    }}>
      <fieldset><legend>{uiText("来源")}</legend>
        <Checkbox.Group value={draft.source} onChange={source => setDraft(previous => ({ ...previous, source: source as Source[] }))}
          options={Object.entries(sources).filter(([source]) => source !== 'role_conversion' || kind === 'actor')
            .map(([value, label]) => ({ label: uiText(label), value }))} />
      </fieldset>
      <fieldset><legend>{uiText("封面状态")}</legend>
        <Radio.Group value={draft.cover} onChange={event => setDraft(previous => ({ ...previous, cover: event.target.value }))}
          options={[{ label: uiText("全部"), value: 'all' }, { label: uiText("有封面"), value: 'present' }, { label: uiText("待补封面"), value: 'missing' }]} />
      </fieldset>
      <Space><Button onClick={() => apply(emptyFilters)}>{uiText("清除筛选")}</Button><Button type="primary" onClick={() => apply(draft)}>{uiText("应用")}</Button></Space>
    </div>}>
    <Button ref={trigger} aria-expanded={open} icon={<FilterOutlined aria-hidden />} onKeyDown={event => {
      if (open && event.key === 'Escape') close()
    }}>{count ? uiText("筛选（{{count}}）", { count }) : uiText("筛选")}</Button>
  </Popover>
}

export function ProjectResourcesTab({ projectId, kind, resultCache }: {
  projectId: string; kind: Kind; resultCache: Map<string, ProjectResourcePageResult>
}) {
  const uiText = useUiText()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const role = kind === 'character'
  const label = uiText(labels[kind])
  const storageKey = `jellyfish:project-resources:${projectId}:${kind}`
  const [state, setState] = useState(() => readListState(storageKey))
  const [input, setInput] = useState(state.query)
  const [result, setResult] = useState(() => resultCache.get(storageKey))
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Resource>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletePending = useRef(false)
  const deleteTrigger = useRef<HTMLElement | null>(null)
  const createTrigger = useRef<HTMLButtonElement>(null)
  const [seed, setSeed] = useState<CreateSeed>()
  const [compact, setCompact] = useState(() => !matchMedia('(min-width: 1024px)').matches)
  const { panel, measureGrid, measureCard, pageSize } = useCardPageSize()
  const page = pageSize ? Math.floor(state.offset / pageSize) + 1 : 1
  const requestEpoch = useRef(0)
  const pendingCreated = useRef<string>()
  const { query, source, cover } = state
  const filterCount = Number(source.length > 0) + Number(cover !== 'all')

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(state)) } catch { /* Keep in-memory state. */ }
  }, [state, storageKey])

  useEffect(() => {
    const media = matchMedia('(min-width: 1024px)')
    const update = () => setCompact(!media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!role || params.get('tab') !== 'roles' || params.get('create') !== '1') return
    const visualStyle = params.get('visualStyle')
    setSeed({ name: params.get('name') ?? '', description: params.get('desc') ?? '',
      visual_style: visualStyle === '现实' || visualStyle === '动漫' ? visualStyle : undefined, style: params.get('style') ?? undefined })
    setCreateOpen(true)
    const next = new URLSearchParams(params)
    for (const key of ['create', 'name', 'desc', 'visualStyle', 'style']) next.delete(key)
    setParams(next, { replace: true })
  }, [params, role, setParams])

  const load = useCallback(async () => {
    if (!pageSize) return
    const epoch = ++requestEpoch.current
    setLoading(true)
    setFailed(false)
    const options = { entityType: kind, projectId, q: query || undefined, source: source.length ? source : undefined,
      hasCover: cover === 'all' ? undefined : cover === 'present', order: 'created_at', isDesc: true }
    try {
      const { data } = await StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ ...options, page, pageSize })
      if (epoch !== requestEpoch.current) return
      if (!data?.items || data.items.some(item => item.project_id !== projectId)) throw new Error(uiText("项目资源列表读取失败"))
      const total = data.pagination?.total
      const knownTotal = Number.isSafeInteger(total) && total >= data.items.length ? total : undefined
      const lastPage = knownTotal === undefined ? page : Math.max(1, Math.ceil(knownTotal / pageSize))
      if (page > lastPage) {
        setState(previous => ({ ...previous, offset: (lastPage - 1) * pageSize }))
        return
      }
      const next = { items: data.items as Resource[], total: knownTotal, page, pageSize, query, filterCount, source, cover }
      resultCache.set(storageKey, next)
      setResult(next)
      setLoading(false)
      const createdId = pendingCreated.current
      if (createdId && page === 1) {
        pendingCreated.current = undefined
        if ((query || filterCount) && !data.items.some(item => item.id === createdId)) {
          try {
            const { data: created } = await StudioEntitiesApi.get(kind, createdId)
            if (!created || epoch !== requestEpoch.current) return
            const match = await StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({
              ...options, exactName: created.name, page: 1, pageSize: 1,
            })
            if (epoch === requestEpoch.current && match.data && !match.data.items.some(item => item.id === createdId)) {
              message.info(uiText("资源已保存，未出现在当前查询结果中"))
            }
          } catch { /* Keep the successful save when match verification is unavailable. */ }
        }
      }
    } catch {
      if (epoch === requestEpoch.current) { setFailed(true); setLoading(false) }
    }
  }, [uiText, cover, filterCount, kind, page, pageSize, projectId, query, resultCache, source, storageKey])

  useEffect(() => {
    void load()
    return () => { requestEpoch.current += 1 }
  }, [load])

  const setPage = (nextPage: number) => {
    panel.current?.scrollTo(0, 0)
    setState(previous => ({ ...previous, offset: (nextPage - 1) * pageSize }))
  }

  useEffect(() => {
    if (pageSize) setState(previous => {
      const offset = Math.floor(previous.offset / pageSize) * pageSize
      return offset === previous.offset ? previous : { ...previous, offset }
    })
  }, [pageSize])

  const onCreated = (id: string) => {
    pendingCreated.current = id
    if (page === 1) return load()
    setPage(1)
  }

  const activeResult = !!result && result.query === query && result.source.join(',') === source.join(',') && result.cover === cover
    && result.page === page && result.pageSize === pageSize
  const { openDetail, detailView } = useProjectAssetDetail(kind, load, !loading && (failed || activeResult))
  const openResource = (id: string) => {
    if (result && !activeResult) {
      setInput(result.query)
      setState({ query: result.query, source: result.source, cover: result.cover, offset: (result.page - 1) * result.pageSize })
    }
    openDetail(id)
  }
  const goToLibrary = () => navigate(kind === 'actor' ? '/assets' : `/assets?tab=${kind}`)
  const confirmDelete = async () => {
    if (!deleteTarget || deletePending.current) return
    deletePending.current = true
    setDeleting(true)
    setDeleteError('')
    try {
      await StudioEntitiesApi.remove(kind, deleteTarget.id)
      const cached = resultCache.get(storageKey)
      if (cached) {
        const items = cached.items.filter(item => item.id !== deleteTarget.id)
        const cachedTotal = cached.total === undefined ? undefined : Math.max(0, cached.total - (cached.items.length - items.length))
        const next = { ...cached, items, total: cachedTotal }
        resultCache.set(storageKey, next)
        setResult(next)
      }
      setDeleteTarget(undefined)
      message.success(uiText("已删除"))
      await load()
    } catch (reason) { setDeleteError(apiErrorMessage(reason)) }
    finally { deletePending.current = false; setDeleting(false) }
  }

  return <>
    {detailView || <ProjectContentToolbar>
      <h1 className="app-page-title">{uiText("项目{{label}}", { label })}</h1>
      <div className="project-resource-tools">
        <Input.Search aria-label={uiText("搜索项目资源")} placeholder={uiText("搜索名称或描述")} data-project-resource-search allowClear value={input}
          onChange={event => setInput(event.target.value)} onSearch={value => {
            const next = value.trim()
            setInput(next)
            if (next === query && page === 1) void load()
            else { panel.current?.scrollTo(0, 0); setState(previous => ({ ...previous, query: next, offset: 0 })) }
          }} />
        <ResourceFilters kind={kind} value={state} onApply={filters => {
          panel.current?.scrollTo(0, 0)
          setState(previous => ({ ...previous, ...filters, offset: 0 }))
        }} />
        <Button aria-label={uiText("刷新")} icon={<ReloadOutlined />} onClick={() => void load()} loading={loading && !!result} />
        {result && <span role="status" className="management-count">{result.total === undefined ? uiText("已加载 {{length}} 项", { length: result.items.length })
          : uiText("{{value1}} {{total}} 项", { value1: uiText(result.query || result.filterCount ? '匹配' : '共'), total: result.total })}</span>}
      </div>
      <Space size="small" wrap className="project-resource-create">
        <ResourceCreateButton kind={kind} projectId={projectId} onCreate={() => { setSeed(undefined); setCreateOpen(true) }} onCreated={onCreated}>
          <Button ref={createTrigger} aria-label={role ? uiText("新建角色") : uiText("新建")} type="primary" icon={<PlusOutlined />}>{role ? uiText("新建角色") : uiText("新建")}</Button>
        </ResourceCreateButton>
        {!role && <Button type="link" onClick={goToLibrary}>{uiText("查看资产库")}</Button>}
      </Space>
    </ProjectContentToolbar>}
    <div className="project-resource-page" hidden={!!detailView}>
      <div className="app-card-list-content project-resource-list-content">
        <div ref={measureGrid} className="project-resource-measure app-card-list-measure" aria-hidden="true">
          <div ref={measureCard}><div className="project-resource-cover" /><div className="project-resource-card-body">
            <div className="project-resource-title-row"><Button type="text" tabIndex={-1} icon={<MoreOutlined />} /></div>
            <div className="resource-card-metadata" /><div className="project-resource-description" />
          </div></div>
        </div>
        <WorkspaceScrollPanel ref={panel} className="project-resource-scroll">
          {failed && <Alert type="error" showIcon message={result ? uiText("读取项目资源失败，仍显示上一次结果") : uiText("读取项目资源失败")}
            action={<Button aria-label={uiText("重试")} onClick={() => void load()}>{uiText("重试")}</Button>} />}
          {!result && loading && <Spin aria-label={uiText("正在读取项目资源")} />}
          {result?.items.length === 0 && !failed && !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={query || filterCount ? uiText("无匹配资源") : uiText("暂无项目{{label}}", { label })} />}
          {!detailView && !!result?.items.length && <div className="project-resource-grid" aria-busy={loading}>{result.items.map(asset => {
            const thumbnail = resolveAssetUrl(asset.thumbnail)
            return <DisplayImageCard key={asset.id} variant="project" imageFit={kind === 'scene' ? 'cover' : 'contain'}
              imageAlt={asset.name} imageUrl={thumbnail} lazyImage
              title={<button type="button" data-project-asset-id={asset.id} className="project-resource-name" title={asset.name} onClick={() => openResource(asset.id)}>
                <span>{asset.name}</span><ArrowRightOutlined aria-hidden />
              </button>}
              extra={<Dropdown trigger={['click']} menu={{ items: [
                { key: 'edit', label: uiText("编辑"), onClick: () => openResource(asset.id) },
                { key: 'delete', danger: true, label: role ? uiText("删除角色") : uiText("删除项目对象"), onClick: () => {
                  setDeleteError(''); setDeleteTarget(asset)
                } },
              ] }}><Button type="text" icon={<MoreOutlined />} aria-label={uiText("{{name}}更多操作", { name: asset.name })}
                onClick={event => { deleteTrigger.current = event.currentTarget }} /></Dropdown>}
              meta={<><ResourceCardMetadata asset={asset} /><div className="project-resource-description" title={asset.description || undefined}>{asset.description?.trim() || uiText("未填写简介")}</div></>} />
          })}</div>}
        </WorkspaceScrollPanel>
      </div>
      <CardListPagination label={uiText("项目{{label}}分页", { label })} page={result?.page ?? page} pageSize={result?.pageSize ?? pageSize}
        total={result?.total ?? 0} compact={compact} disabled={loading || failed || deleting || !activeResult} onChange={setPage} />
    </div>
    <ResourceEditorDrawer open={createOpen} kind={kind} projectId={projectId} seed={seed}
      onClose={() => { setCreateOpen(false); setSeed(undefined) }} onSaved={resource => onCreated(resource.id)} />
    <Modal className="project-resource-dialog" title={deleteTarget ? `${role ? '删除角色' : '删除项目对象'}「${deleteTarget.name}」？` : undefined}
      open={!!deleteTarget} onCancel={() => { if (!deletePending.current) setDeleteTarget(undefined) }}
      onOk={() => void confirmDelete()} okText={role ? uiText("删除角色") : uiText("删除项目对象")} cancelText={uiText("取消")}
      confirmLoading={deleting} okButtonProps={{ danger: true, disabled: deleting }} cancelButtonProps={{ disabled: deleting }}
      closable={!deleting} keyboard={!deleting} maskClosable={!deleting} focusTriggerAfterClose={false}
      afterClose={() => (deleteTrigger.current?.isConnected ? deleteTrigger.current : createTrigger.current)?.focus({ preventScroll: true })}>
      <p>{role ? uiText("删除角色将移除该项目角色配置，不会删除曾作为参考的资产。") : uiText("删除此项目对象及其图片关联，已入库的独立副本继续保留。")}</p>
      {deleteError && <Alert type="error" showIcon message={deleteError} />}
    </Modal>
  </>
}
