import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Badge, Button as MainButton, Card, Segmented, Dropdown, Drawer, Empty, Grid, Image, Modal, Select, Space, Spin, message } from 'antd'
import { MoreOutlined, InfoCircleOutlined, ScanOutlined, DiffOutlined, ReloadOutlined } from '@ant-design/icons'
import { ApiError, StudioDirectingService, StudioEntitiesService } from '../../../services/generated'
import type { AssetSummary, SceneObjectRead, SceneObjectsRead } from '../../../services/generated'
import { ObjectAssociationEditor } from './ObjectAssociationEditor'
import { ResourceCreateButton, ResourceImageSourceDrawer } from '../assets/components/ResourceCreateButton'
import { ResourceEditorDrawer } from '../assets/components/ResourceEditorDrawer'
import { buildFileDownloadUrl } from '../assets/utils'
import { managementBrowseKey, readManagementBrowse, saveManagementBrowse } from './managementBrowse'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'
import { SceneObjectCandidateReview } from './SceneObjectCandidateReview'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { CardListPagination } from '../../../components/layout/CardListPagination'
import { WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { useCardPageSize } from '../../../components/layout/useCardPageSize'
import './workbench-object-preparation.css'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
const kinds = { character: '角色', scene: '场所', prop: '道具' } as const
type ObjectChoice = { objectId: string; assetId?: string }
type AssetOrigin = { top: number; page: number; index: number; objectId: string; trigger?: HTMLElement; mainImageSaved?: boolean }
type ManagementActions = {
  host: HTMLDivElement | null; filterHost: HTMLDivElement | null; onChange: () => void;
  candidateTaskId: string | null; clearCandidateTask: () => void;
  notices: ReactNode;
}
const referenceLabels = { unassociated: '尚未关联资产', missing: '未选参考图', ready: '已选参考图', unavailable: '关联或图片不可用' }
const referenceFilters = { all: '全部参考状态', ready: '已选参考图', missing: '已选资源但缺图', unavailable: '参考不可用' }

function activeTask(data?: SceneObjectsRead) {
  return data?.task?.status === 'queued' || data?.task?.status === 'running'
}

function ReferenceImage({ name, fileId, unavailable, controls }: { name: string; fileId?: string; unavailable?: boolean; controls?: ReactNode }) {
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  return <>
    <div className="management-reference-frame">
      {controls && <div className="management-reference-angle">{controls}</div>}
      {unavailable && <div className="management-reference-failed">参考图不可用</div>}
      {failed && <div role="status" className="management-reference-failed"><Badge status="warning" text="图片加载失败" /><MainButton type="text" icon={<ReloadOutlined />} aria-label="重试参考图" onClick={() => { setFailed(false); setRetry(value => value + 1) }} /></div>}
      {fileId && !failed && <button type="button" aria-label={`预览${name}参考图`} onClick={event => {
        // 预览浮层通过 portal 挂载，关闭操作不会重新触发卡面预览。
        if (event.currentTarget.contains(event.target as Node)) setPreviewOpen(true)
      }}>
        <Image key={retry} alt={`${name}已选参考图`} src={buildFileDownloadUrl(fileId)} onError={() => setFailed(true)}
          preview={{ visible: previewOpen, onVisibleChange: setPreviewOpen, mask: false }} />
      </button>}
    </div>

  </>
}

/** 对象和参考选择属于场次准备，单独保存于画布及旧版本之外。 */
export function SceneObjectPreparation({ projectId, chapterId, sequenceId, editable, management }: Scope & {
  editable: boolean; management?: ManagementActions;
}) {
  const mobile = !Grid.useBreakpoint().md
  const [filterWidth, setFilterWidth] = useState(0)
  useEffect(() => {
    const host = management?.filterHost
    if (!host) return
    const observer = new ResizeObserver(([entry]) => setFilterWidth(entry.contentRect.width))
    observer.observe(host)
    return () => observer.disconnect()
  }, [management?.filterHost])
  const compact = mobile || (!!management && filterWidth < 620)
  const [data, setData] = useState<SceneObjectsRead>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [savingObject, setSavingObject] = useState<string>()
  const saving = !!savingObject
  const [associationObject, setAssociationObject] = useState<string>()
  const associationTrigger = useRef<HTMLElement>()
  const [sameNameOnly, setSameNameOnly] = useState(false)
  const [sameNames, setSameNames] = useState<Record<string, boolean>>({})
  const [sameNameError, setSameNameError] = useState('')
  const [sameNameRetry, setSameNameRetry] = useState(0)
  const [descriptionObject, setDescriptionObject] = useState<SceneObjectRead>()
  const [assetEditor, setAssetEditor] = useState<AssetSummary>()
  const [draft, setDraft] = useState<{ object: SceneObjectRead; name: string; description: string }>()
  const [uploadObject, setUploadObject] = useState<SceneObjectRead>()
  const [choiceError, setChoiceError] = useState<{ objectId: string; message: string; retry?: ObjectChoice }>()
  const [localReview, setLocalReview] = useState<string>()
  const reviewTaskId = management?.candidateTaskId ?? localReview
  const browseKey = managementBrowseKey(projectId, chapterId, sequenceId, 'objects')
  const [kindFilter, setKindFilter] = useState<keyof typeof kinds | 'all'>(() => management ? readManagementBrowse(browseKey).kind ?? 'all' : 'all')

  const [association, setAssociation] = useState(() => readManagementBrowse(browseKey).association ?? 'all')
  const [reference, setReference] = useState(() => readManagementBrowse(browseKey).reference ?? 'all')
  const [page, setPage] = useState(() => readManagementBrowse(browseKey).page ?? 1)
  const [compactPager, setCompactPager] = useState(() => !matchMedia('(min-width: 1024px)').matches)
  const inManagement = !!management
  const paginated = inManagement && !assetEditor
  const { panel, measureGrid, measureCard, pageSize } = useCardPageSize(paginated)
  const previousPage = useRef<{ size: number; start: number; firstId?: string }>()
  const restoredScroll = useRef(false)
  const filterControl = useRef<HTMLDivElement>(null)
  const filterFocus = useRef<{ id: string; index: number }>()
  const refreshFocus = useRef<Element>()
  const focusFilter = useCallback(() => {
    filterControl.current?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')?.focus()
  }, [])
  const focusNeighbor = useCallback((position: number) => {
    const rows = panel.current?.querySelectorAll<HTMLElement>('[data-management-object]')
    const index = Math.min(Math.max(position, 0), (rows?.length ?? 0) - 1)
    const button = rows?.[index]?.querySelector<HTMLElement>('button[aria-label="对象更多操作"]')
    if (button) button.focus()
    else focusFilter()
  }, [focusFilter, panel])

  useEffect(() => {
    if (!inManagement) return
    const media = matchMedia('(min-width: 1024px)')
    const update = () => setCompactPager(!media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [inManagement])
  const lastRead = useRef<SceneObjectsRead>()
  const summaryChanged = useRef(management?.onChange)
  summaryChanged.current = management?.onChange
  const accept = useCallback((value: SceneObjectsRead) => {
    const previous = lastRead.current
    lastRead.current = value
    const activeElement = document.activeElement
    if (activeElement?.closest('[data-management-object]') && panel.current?.contains(activeElement)) refreshFocus.current = activeElement
    setData(value)
    setError('')
    if (previous && (previous.revision !== value.revision || previous.task?.task_id !== value.task?.task_id ||
        previous.task?.status !== value.task?.status)) summaryChanged.current?.()
  }, [panel])
  const requestKey = 'jellyfish:scene-object-request:' + JSON.stringify([projectId, chapterId, sequenceId])
  const [pendingRequest, setPendingRequest] = useState(() => {
    try { return localStorage.getItem(requestKey) ?? undefined } catch { return undefined }
  })
  const loadVersion = useRef(0)
  const scope = { projectId, chapterId, sequenceId }
  const read = useCallback(async () => {
    const generation = ++loadVersion.current
    try {
      const response = await StudioDirectingService.directingSceneObjects({ projectId, chapterId, sequenceId })
      if (generation !== loadVersion.current) return
      if (!response.data) throw new Error('对象准备读取失败')
      accept(response.data)
      return response.data
    } catch (cause) {
      if (generation === loadVersion.current) setError(apiErrorMessage(cause))
    } finally {
      if (generation === loadVersion.current) setLoading(false)
    }
  }, [projectId, chapterId, sequenceId, accept])
  const invalidateRead = useCallback(() => { loadVersion.current++ }, [])
  useEffect(() => {
    void read()
    return invalidateRead
  }, [read, invalidateRead])
  const running = activeTask(data)
  useEffect(() => {
    if (!running || submitting || saving) return
    const timer = window.setTimeout(() => void read(), 1200)
    return () => window.clearTimeout(timer)
  }, [running, submitting, saving, data, error, read])

  const extract = async () => {
    if (!editable || submitting || running && !pendingRequest) return
    let requestId: string
    try {
      requestId = localStorage.getItem(requestKey) || pendingRequest || crypto.randomUUID()
      localStorage.setItem(requestKey, requestId)
    } catch (cause) { setError(apiErrorMessage(cause)); return }
    setPendingRequest(requestId); setSubmitting(true); setError('')
    const clear = () => {
      try { if (localStorage.getItem(requestKey) === requestId) localStorage.removeItem(requestKey) }
      catch { /* 相同身份可安全重放。 */ }
      setPendingRequest(undefined)
    }
    try {
      const response = await StudioDirectingService.directingSceneObjectExtract({ ...scope, requestBody: { request_id: requestId } })
      if (!response.data) throw new Error('提取提交结果待核实，请使用原请求重试')
      clear()
      const task = response.data
      setData(previous => previous && { ...previous, task })
      await read()
    } catch (cause) {
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status)) {
        clear()
        if (cause.status === 409) await read()
      }
      setError(apiErrorMessage(cause))
    } finally { setSubmitting(false) }
  }

  const choose = async (objectId: string, assetId?: string) => {
    const current = lastRead.current ?? data
    if (!current || !editable) return
    const response = await StudioDirectingService.directingSceneObjectChoose({ ...scope, objectId,
      requestBody: { expected_revision: current.revision, asset_id: assetId ?? null,
        },
    })
    if (!response.data) throw new Error('保存结果待核实，请刷新对象准备')
    loadVersion.current++; accept(response.data)
  }
  const reportChoiceError = (objectId: string, message: string, retry?: ObjectChoice) => {
    if (management) setChoiceError({ objectId, message, retry })
    else setError(message)
  }
  const recoverChoice = async (cause: unknown, choice: ObjectChoice) => {
    const conflict = cause instanceof ApiError && cause.status === 409
    const recoverable = conflict || !(cause instanceof ApiError) || cause.status >= 500
    const latest = recoverable ? await read() : undefined
    let retry: ObjectChoice | undefined
    if (recoverable) {
      const selected = latest?.objects.find(object => object.id === choice.objectId)
      if (selected && (selected.asset_id ?? undefined) === choice.assetId) return true
      if (!latest || selected) retry = choice
    }
    reportChoiceError(choice.objectId, apiErrorMessage(cause), retry)
    return false
  }
  const save = async (objectId: string, assetId?: string) => {
    if (!editable || saving) return false
    const index = filtered.findIndex(object => object.id === objectId)
    setSavingObject(objectId); setChoiceError(undefined)
    let saved = false
    try { await choose(objectId, assetId); saved = true }
    catch (cause) { saved = await recoverChoice(cause, { objectId, assetId }) }
    finally {
      if (saved && inManagement && index >= 0) filterFocus.current = { id: objectId, index }
      setSavingObject(undefined)
    }
    return saved
  }

  const createSeed = useMemo(() => draft ? { name: draft.name, description: draft.description } : undefined, [draft])

  const listHeading = useRef<HTMLHeadingElement>(null)
  const assetOrigin = useRef<AssetOrigin>()
  const [assetReturn, setAssetReturn] = useState<AssetOrigin>()
  const openAsset = (asset: AssetSummary, objectId: string) => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const outer = panel.current?.closest<HTMLElement>('.management-panel')
    assetOrigin.current = { top: panel.current?.scrollTop ?? 0, page: currentPage,
      index: filtered.findIndex(object => object.id === objectId), objectId, trigger }
    setAssetEditor(asset)
    if (outer) outer.scrollTop = 0
  }
  const closeAsset = useCallback(async () => {
    await read()
    setAssetEditor(undefined)
    if (inManagement) setAssetReturn(assetOrigin.current)
  }, [inManagement, read])
  const confirmExtraction = () => {
    if (pendingRequest) { void extract(); return }
    Modal.confirm({ title: '确认提取对象？', content: '将调用 AI 提取本场角色、场所和道具。已有对象准备会保留，重新提取的差异需核对后应用。', okText: '开始提取', cancelText: '取消', onOk: extract })
  }
  const action = data?.task?.status === 'failed' || data?.task?.status === 'cancelled' ? '重试提取对象'
    : data?.revision ? '重新提取对象' : '提取对象'

  const sameNameKey = JSON.stringify(data?.objects.filter(object => !object.asset_id).map(object => [object.id, object.kind, object.name]) ?? [])
  useEffect(() => {
    let current = true
    setSameNames({}); setSameNameError('')
    const objects: [string, 'character' | 'scene' | 'prop', string][] = JSON.parse(sameNameKey)
    void Promise.all(objects.map(async ([id, kind, name]) => {
      const responses = await Promise.all([
        StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: kind, projectId, exactName: name, pageSize: 1 }),
        StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: kind === 'character' ? 'actor' : kind, exactName: name, pageSize: 1 }),
      ])
      return [id, responses.some(response => !!response.data?.pagination.total)] as const
    })).then(matches => { if (current) setSameNames(Object.fromEntries(matches)) })
      .catch(cause => { if (current) setSameNameError(apiErrorMessage(cause)) })
    return () => { current = false }
  }, [sameNameKey, projectId, sameNameRetry])

  const disabled = !editable || saving
  const extractionDisabled = disabled || loading || running && !pendingRequest
  const extractionLabel = pendingRequest ? '核实提取请求' : action
  const candidateTask = !pendingRequest ? data?.candidate_task_id : undefined
  const retryRead = () => void read()
  const filtered = useMemo(() => {
    const objects = data?.objects ?? []
    if (!inManagement) return objects
    const assets = new Set(data?.assets.map(asset => `${asset.kind}:${asset.id}`))
    return objects.filter(object => {
      const selection = !object.asset_id ? 'unassociated' : assets.has(`${object.kind}:${object.asset_id}`) ? 'associated' : 'unavailable'
      return (association === 'all' || association === selection) &&
        (reference === 'all' || reference === object.reference_state) &&
        (kindFilter === 'all' || object.kind === kindFilter)
    })
  }, [data, inManagement, association, reference, kindFilter])
  const lastPage = Math.max(1, Math.ceil(filtered.length / (pageSize || 1)))
  const currentPage = Math.min(page, lastPage)
  const start = (currentPage - 1) * pageSize
  const shown = management ? filtered.slice(start, start + pageSize) : filtered
  const listReady = paginated && !!data && pageSize > 0
  useLayoutEffect(() => {
    if (!listReady) return
    const previous = previousPage.current
    previousPage.current = { size: pageSize, start, firstId: filtered[start]?.id }
    if (previous && previous.size !== pageSize) {
      const anchor = filtered.findIndex(object => object.id === previous.firstId)
      setPage(Math.min(lastPage, Math.floor((anchor < 0 ? previous.start : anchor) / pageSize) + 1))
    } else if (page > lastPage) setPage(lastPage)
  }, [filtered, lastPage, listReady, page, pageSize, start])
  useLayoutEffect(() => {
    if (!listReady) return
    if (panel.current) panel.current.scrollTop = restoredScroll.current ? 0 : readManagementBrowse(browseKey).top ?? 0
    restoredScroll.current = true
    saveManagementBrowse(browseKey, { page: currentPage })
  }, [association, browseKey, currentPage, kindFilter, listReady, panel, reference])
  useLayoutEffect(() => {
    if (!assetReturn || !listReady) return
    const index = filtered.findIndex(object => object.id === assetReturn.objectId)
    const targetPage = index < 0 ? Math.min(lastPage, assetReturn.page) : Math.floor(index / pageSize) + 1
    if (page !== targetPage) {
      setPage(targetPage)
      return
    }
    const frame = requestAnimationFrame(() => {
      if (index < 0) {
        if (assetReturn.mainImageSaved && data?.objects.some(object => object.id === assetReturn.objectId)) {
          void message.info('已保存，该对象已移出当前筛选')
          focusNeighbor(assetReturn.index - start)
        } else focusFilter()
      }
      else {
        if (panel.current && targetPage === assetReturn.page) panel.current.scrollTop = assetReturn.top
        const card = panel.current?.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(assetReturn.objectId)}"]`)
        const trigger = assetReturn.trigger?.isConnected && card?.contains(assetReturn.trigger)
          ? assetReturn.trigger : card?.querySelector<HTMLElement>('.management-object-title-row h4 button, button[aria-label="对象更多操作"]')
        if (trigger) trigger.focus()
        else focusFilter()
      }
      setAssetReturn(undefined)
    })
    return () => cancelAnimationFrame(frame)
  }, [assetReturn, data, filtered, focusFilter, focusNeighbor, lastPage, listReady, page, pageSize, panel, start])
  const changeFilters = (next: { kind?: typeof kindFilter; association?: string; reference?: string }) => {
    const nextKind = next.kind ?? kindFilter
    const nextAssociation = next.association ?? association
    const nextReference = next.reference ?? reference
    if (nextKind === kindFilter && nextAssociation === association && nextReference === reference) return
    setKindFilter(nextKind)
    setAssociation(nextAssociation)
    setReference(nextReference)
    setPage(1)
  }
  useEffect(() => {
    if (inManagement) saveManagementBrowse(browseKey, { kind: kindFilter, association, reference })
  }, [association, browseKey, inManagement, kindFilter, reference])
  useLayoutEffect(() => {
    if (!listReady || saving) return
    const previous = filterFocus.current
    filterFocus.current = undefined
    const focused = refreshFocus.current
    refreshFocus.current = undefined
    if (previous && !filtered.some(object => object.id === previous.id)) {
      void message.info('已保存，该对象已移出当前筛选')
      requestAnimationFrame(() => focusNeighbor(previous.index - start))
    } else if (focused && !focused.isConnected && document.activeElement === document.body) {
      focusFilter()
    }
  }, [filtered, focusFilter, focusNeighbor, listReady, saving, start])
  const choiceErrorOnCard = choiceError && shown.some(object => object.id === choiceError.objectId)
  const associationTarget = data?.objects.find(object => object.id === associationObject)
  const openAssociation = (id: string, sameName: boolean, trigger: HTMLElement) => {
    associationTrigger.current = trigger
    setSameNameOnly(sameName)
    setAssociationObject(id)
  }
  const attachUploadedResource = async (objectId: string, resourceId: string) => {
    if (!await save(objectId, resourceId)) throw new Error('资源已创建，选用尚未完成，请重试')
  }
  const pendingChoice = choiceError?.retry
  const retryChoice = pendingChoice && <MainButton size="small" disabled={disabled} onClick={() => void save(
    pendingChoice.objectId, pendingChoice.assetId)}>核对后重试选择</MainButton>
  const closeDescription = () => {
    const id = descriptionObject?.id
    setDescriptionObject(undefined)
    requestAnimationFrame(() => {
      const button = panel.current?.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(id ?? '')}"] button[aria-label="对象更多操作"]:not([disabled])`)
      if (button) button.focus()
      else focusFilter()
    })
  }
  const descriptionContent = descriptionObject && <div className="management-object-description-content"><p>{descriptionObject.description || '未填写描述'}</p><p>出处：{descriptionObject.excerpt || '暂无出处'}</p></div>
  const listContent = <>
    {!management && <p>选用对象可暂时无图，动态画布在实际生产时读取当前资源。</p>}
    {loading && <Spin aria-label="正在读取对象准备" />}
    {(error || choiceError && !choiceErrorOnCard) && <Alert type="error" showIcon message={error || choiceError?.message} action={management
      ? <Space wrap>
        <MainButton onClick={retryRead}>刷新对象准备</MainButton>
        {!choiceErrorOnCard && retryChoice}
      </Space> : <Button onClick={retryRead}>刷新对象准备</Button>} />}
    {running && <p role="status">{data?.task?.status === 'queued' ? '对象提取排队中' : '正在提取对象'}</p>}
    {data?.task?.status === 'failed' && <Alert type="warning" showIcon message="对象提取失败，已保留此前准备"
      description={data.task.error} />}
    {data?.task?.status === 'cancelled' && <Alert type="warning" message="对象提取已取消，已保留此前准备" />}
    {data?.source_changed && <Alert type="warning" showIcon message="场次原文已变更，请重新提取对象后核对参考。" />}
    {data?.candidate_task_id && <Alert type="info" showIcon message="对象候选已就绪，当前准备仍可使用。" action={!management && <Button onClick={() => setLocalReview(data.candidate_task_id ?? undefined)}>核对对象差异</Button>} />}
    {reviewTaskId && <SceneObjectCandidateReview key={reviewTaskId} {...scope} taskId={reviewTaskId} editable={editable} management={!!management}
      onClose={() => {
        setLocalReview(undefined)
        if (management?.candidateTaskId) management.clearCandidateTask()
        void read()
      }} />}
    {data && !data.objects.length && !error && (management
      ? <p>{data.revision ? '本场未提取到对象，可以继续分镜。' : '尚未提取对象，可提取后准备参考，也可直接继续。'}</p>
      : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={data.revision ? '本场未提取到对象' : '尚未提取对象'} />)}
    {management?.filterHost && !assetEditor && createPortal(<div ref={filterControl} className="management-object-filters">
      {compact ? <Select disabled={!data} aria-label="对象类型" value={kindFilter} onChange={kind => changeFilters({ kind })} options={[{value:'all',label:'全部类型'},...Object.entries(kinds).map(([value,label])=>({value,label}))]} /> : <Segmented disabled={!data} aria-label="对象类型" value={kindFilter} onChange={kind => changeFilters({ kind: kind as typeof kindFilter })} options={[{ value: 'all', label: '全部' }, ...Object.entries(kinds).map(([value, label]) => ({ value, label }))]} />}
      <Select disabled={!data} aria-label="选用状态" value={association} onChange={association => changeFilters({ association })} options={[{value:'all',label:'全部选用状态'},{value:'unassociated',label:'未选用'},{value:'associated',label:'已选用'},{value:'unavailable',label:'选用失效'}]} />
      <Dropdown trigger={['click']} menu={{ selectable: true, selectedKeys: [reference], onClick: ({ key }) => changeFilters({ reference: key }),
        items: Object.entries(referenceFilters).map(([key, label]) => ({ key, label })) }}>
        <MainButton disabled={!data} type="text" aria-label={`参考状态 ${referenceFilters[reference as keyof typeof referenceFilters]}`}>
          {referenceFilters[reference as keyof typeof referenceFilters]}
        </MainButton>
      </Dropdown>
      <span role="status">{data ? `${kindFilter !== 'all' || association !== 'all' || reference !== 'all' ? '匹配 ' : ''}${filtered.length} 个对象` : '对象数量未确认'}</span>
      <span title="选用对象可暂时无图，动态画布在实际生产时读取当前资源。" tabIndex={0}><InfoCircleOutlined aria-hidden /></span>
    </div>, management.filterHost)}
    {management && !!data?.objects.length && !filtered.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的对象">
      <MainButton onClick={() => { focusFilter(); changeFilters({ kind: 'all', association: 'all', reference: 'all' }) }}>清除筛选</MainButton>
    </Empty>}
    {(management ? ['all' as const] : Object.keys(kinds) as Array<keyof typeof kinds>).map(group => {
      const rows = group === 'all' ? shown : filtered.filter(object => object.kind === group)
      if (!rows.length) return null
      return <section key={group} className={management ? 'management-object-kind' : 'scene-object-kind'} aria-label={group === 'all' ? '场次对象' : kinds[group]}>
        {group !== 'all' && <h3>{kinds[group]}</h3>}
        <ul className={management ? 'management-card-grid' : 'scene-object-list'}>{rows.map(object => {
          const kind = object.kind
          const asset = data?.assets.find(item => item.kind === kind && item.id === object.asset_id)
          const options = (data?.assets ?? []).filter(item => item.kind === kind).map(item => ({
            value: item.id, label: item.name + (item.id === object.suggested_asset_id ? '（提取建议）' : ''),
          }))
          if (object.asset_id && !asset) options.push({ value: object.asset_id, label: '关联资产不可用' })
          const assetSelect = <Select aria-label="关联资产" allowClear placeholder="关联已有资产" value={object.asset_id ?? undefined}
            disabled={disabled} options={options} onChange={id => void save(object.id, id)} />
          const referenceFileId = object.reference_state === 'ready' ? object.image_file_id ?? undefined : undefined
          const openCreate = () => {
            setDraft({ object, name: object.name, description: object.description })
          }
          const assetAction = asset ? { key: 'prepare', label: '准备图片', onClick: () => openAsset(asset, object.id) }
            : { key: 'create', label: '新建并关联', onClick: openCreate }
          if (management) {
                        const cardActions = [
              { key: 'description', label: '描述与出处', onClick: () => setDescriptionObject(object) },
              ...(object.asset_id ? [{ key: 'clear', label: '清空', disabled: !editable, onClick: () => Modal.confirm({ title: '清空对象选用？',
                content: '保留对象名称、描述与出处、资源和图片。沿用本场对象的画布将不再有可用资源；已受理任务不变。',
                okText: '清空', cancelText: '取消', onOk: async () => { if (!await save(object.id)) throw new Error('清空失败，请重试') } }) }] : [])]
            return <li key={object.id} data-management-object={object.id}>
              <section aria-label={`${object.name} · ${object.excerpt}`}>
                <Card size="small" className="management-object-card">
                  <ReferenceImage key={referenceFileId ?? ''} name={object.name} fileId={referenceFileId} unavailable={object.reference_state === 'unavailable'} />
                  <div className="management-object-body">
                    <div className="management-object-title-row"><h4 title={object.name}>{asset ? <MainButton type="link" aria-label={`编辑${object.name}资源`} onClick={() => openAsset(asset, object.id)}>{object.name}</MainButton> : object.name}</h4><small>{kinds[kind]}</small>
                      <Dropdown autoFocus trigger={['click']} disabled={saving} menu={{ items: cardActions }}>
                        <MainButton type="text" icon={<MoreOutlined />} aria-label="对象更多操作" disabled={saving} />
                      </Dropdown>
                    </div>
                    <div className="management-object-excerpt" title={object.description || '未填写描述'}>{object.description || '未填写描述'}</div>
                    <div className="management-object-actions-row">
                      {!object.asset_id && sameNames[object.id] && <MainButton type="primary" aria-label="选用同名" disabled={disabled} onClick={event => openAssociation(object.id, true, event.currentTarget)}>选用同名</MainButton>}
                      <MainButton aria-label={object.asset_id ? '重新选用' : '选用'} disabled={disabled} onClick={event => openAssociation(object.id, false, event.currentTarget)}>{object.asset_id ? '重新选用' : '选用'}</MainButton>
                      <ResourceCreateButton kind={kind} projectId={projectId} projectUpload onCreate={openCreate} onOpenUploads={() => setUploadObject(object)}
                        onCreated={resourceId => attachUploadedResource(object.id, resourceId)}>
                        <MainButton type={!object.asset_id && sameNames[object.id] ? 'default' : 'primary'} data-object-create
                          aria-label={object.asset_id ? '重新创建' : '创建'} disabled={disabled}>{object.asset_id ? '重新创建' : '创建'}</MainButton>
                      </ResourceCreateButton>
                      {!object.asset_id && sameNames[object.id] === undefined && <small role="status">{sameNameError ? <MainButton type="text" onClick={() => setSameNameRetry(value => value + 1)}>重试同名查询</MainButton> : '同名查询中'}</small>}
                    </div>
                  </div>
                  {choiceError?.objectId === object.id && <Alert type="error" showIcon message={choiceError.message}
                    description={retryChoice} />}
                </Card>
              </section>
            </li>
          }
          return <li key={object.id} data-management-object={object.id}>
            <section className="scene-object-row" aria-label={`${object.name} · ${object.excerpt}`}>
              <div className="scene-object-identity">
                {referenceFileId && <img alt={`${object.name}已选参考图`} src={buildFileDownloadUrl(referenceFileId)} />}
                <div><strong>{object.name}</strong><CanvasTextPreview label="对象描述" text={object.description} lines={2} />
                  <small>出处：{object.excerpt}</small></div>
              </div>
              <div className="scene-object-choices">
                {assetSelect}
                {asset && <Button disabled={disabled} onClick={() => openAsset(asset, object.id)}>编辑对象参考</Button>}
                <Space wrap>
                  {[assetAction]
                    .map(({ key, label, onClick }) => <Button key={key} disabled={disabled} onClick={onClick}>{label}</Button>)}
                  <small>{referenceLabels[object.reference_state]}</small>
                </Space>
              </div>
            </section>
          </li>
        })}</ul>
      </section>
    })}
  </>
  return <>
    {compact ? <Drawer className="app-detail-drawer" aria-label="描述与出处" title="描述与出处" placement="bottom" height="min(400px, 80dvh)" open={!!descriptionObject} onClose={closeDescription}>{descriptionContent}</Drawer>
      : <Modal title="描述与出处" open={!!descriptionObject} footer={null} onCancel={closeDescription}>{descriptionContent}</Modal>}
    <section hidden={!!assetEditor} className={management ? 'management-object-preparation' : undefined} aria-labelledby="scene-object-preparation-title">
    {management ? <>
      <h3 className="management-accessible-heading" ref={listHeading} tabIndex={-1} id="scene-object-preparation-title">场次对象与参考</h3>
      {management.host && !assetEditor && createPortal(<>
        <MainButton type="primary" icon={candidateTask ? <DiffOutlined aria-hidden /> : <ScanOutlined aria-hidden />} loading={submitting} disabled={candidateTask ? loading || submitting || saving : extractionDisabled}
          onClick={() => candidateTask ? setLocalReview(candidateTask) : confirmExtraction()}>
          {candidateTask ? '核对对象差异' : extractionLabel}
        </MainButton>
        {candidateTask && <Dropdown trigger={['click']} menu={{ items: [
          { key: 'extract', label: action, disabled: extractionDisabled, onClick: confirmExtraction },
        ] }}><MainButton type="text" icon={<MoreOutlined />} aria-label="对象步骤更多操作" /></Dropdown>}
      </>, management.host)}
    </> : <div className="scene-canvas-list-header">
      <h2 id="scene-object-preparation-title">场次对象与参考</h2>
      <Button variant="primary" loading={submitting} disabled={extractionDisabled} onClick={confirmExtraction}>{extractionLabel}</Button>
    </div>}
    {management && <div className="app-card-list-content management-object-list-content">
      <div ref={measureGrid} className="app-card-list-grid app-card-list-measure" aria-hidden="true">
        {/* Measure the regular card with all three actions, including their narrow-screen wrap. */}
        <div ref={measureCard}>
          <Card size="small" className="management-object-card">
            <div className="management-reference-frame" />
            <div className="management-object-body">
              <div className="management-object-title-row"><MainButton type="text" disabled /></div>
              <div className="management-object-excerpt" />
              <div className="management-object-actions-row">
                <MainButton disabled /><MainButton disabled /><MainButton disabled />
              </div>
            </div>
          </Card>
        </div>
      </div>
      <WorkspaceScrollPanel ref={panel} className="management-object-scroll" onScroll={event => {
        if (restoredScroll.current && !assetEditor) saveManagementBrowse(browseKey, { top: event.currentTarget.scrollTop })
      }}>
        {management.notices}
        {listContent}
      </WorkspaceScrollPanel>
    </div>}
    {management ? <CardListPagination label="本场对象分页" page={currentPage} pageSize={pageSize} total={filtered.length}
      compact={compactPager} disabled={saving} onChange={setPage} /> : listContent}
    {associationTarget && <ObjectAssociationEditor key={associationTarget.id} open projectId={projectId} kind={associationTarget.kind}
      objectName={associationTarget.name} sameName={sameNameOnly} assetId={associationTarget.asset_id} disabled={disabled}
      onSave={id => save(associationTarget.id, id)} onClose={() => {
        const trigger = associationTrigger.current
        associationTrigger.current = undefined
        setAssociationObject(undefined)
        requestAnimationFrame(() => {
          const row = panel.current?.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(associationTarget.id)}"]`)
          const action = trigger?.isConnected && !trigger.matches(':disabled')
            ? trigger : row?.querySelector<HTMLElement>('.management-object-actions-row button:not([disabled])')
          if (action) action.focus()
          else if (document.activeElement === document.body) focusFilter()
        })
      }} />}
    {uploadObject && <ResourceImageSourceDrawer kind={uploadObject.kind} projectId={projectId} projectUpload initialName={uploadObject.name}
      onCreated={resourceId => attachUploadedResource(uploadObject.id, resourceId)} onClose={() => {
        setUploadObject(undefined)
        requestAnimationFrame(() => {
          const action = panel.current?.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(uploadObject.id)}"] [data-object-create]`)
          if (action) action.focus()
          else if (document.activeElement === document.body) focusFilter()
        })
      }} />}
    {draft && <ResourceEditorDrawer open kind={draft.object.kind} projectId={projectId} seed={createSeed}
      onClose={() => { setDraft(undefined); void read() }} onSaved={async resource => {
        const current = lastRead.current?.objects.find(object => object.id === draft.object.id)
        if (current?.asset_id !== resource.id && !await save(draft.object.id, resource.id)) throw new Error('对象已保存，场次关联尚未完成，请重试')
      }} />}
    </section>
    {assetEditor && <div className="management-inline-asset"><ResourceEditorDrawer inline fullDetails open kind={assetEditor.kind} assetId={assetEditor.id} projectId={projectId}
      onClose={() => void closeAsset()} onSaved={async () => { await read() }}
      onMainImageSaved={() => { if (assetOrigin.current) assetOrigin.current.mainImageSaved = true }} /></div>}
  </>
}
