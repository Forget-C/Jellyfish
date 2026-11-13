import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Badge, Button as MainButton, Card, Segmented, Dropdown, Drawer, Empty, Grid, Image, Input, Modal, Select, Space, Spin, message } from 'antd'
import { CheckOutlined, MoreOutlined, InfoCircleOutlined, ArrowRightOutlined, ScanOutlined, DiffOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { ApiError, StudioDirectingService, StudioFilesService } from '../../../services/generated'
import type { AssetSummary, SceneObjectRead, SceneObjectsRead } from '../../../services/generated'
import { AssetEditPageBase } from '../assets/components/AssetEditPageBase'
import { assetAdapters } from '../assets/assetAdapters'
import { buildFileDownloadUrl } from '../assets/utils'
import { managementBrowseKey, readManagementBrowse, saveManagementBrowse } from './managementBrowse'
import { PageToolbar } from '../../../components/layout/PageLayout'
import { CanvasTextPreview } from './CanvasTextPreview'
import { SceneObjectCandidateReview } from './SceneObjectCandidateReview'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchModal } from './ui/WorkbenchModal'
import { ObjectAssociationEditor } from './ObjectAssociationEditor'
import './workbench-object-preparation.css'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
const kinds = { character: '角色', scene: '场所', prop: '道具' } as const
type ObjectChoice = { objectId: string; assetId?: string; imageFileId?: string }
type ManagementActions = {
  host: HTMLDivElement | null; filterHost: HTMLDivElement | null; onChange: () => void;
  candidateTaskId: string | null; clearCandidateTask: () => void;
}
const referenceLabels = { unassociated: '尚未关联资产', missing: '未选参考图', ready: '已选参考图', unavailable: '关联或图片不可用' }
const assetModalStyles = { body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } } as const

function activeTask(data?: SceneObjectsRead) {
  return data?.task?.status === 'queued' || data?.task?.status === 'running'
}

function ReferenceImage({ name, fileId, unavailable }: { name: string; fileId?: string; unavailable?: boolean }) {
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  return <>
    <div className="management-reference-frame">
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
  const [descriptionObject, setDescriptionObject] = useState<SceneObjectRead>()
  const [assetEditor, setAssetEditor] = useState<AssetSummary>()
  const [draft, setDraft] = useState<{ object: SceneObjectRead; name: string; description: string; requestId: string; attempted: boolean }>()
  const [createError, setCreateError] = useState('')
  const [choiceError, setChoiceError] = useState<{ objectId: string; message: string; retry?: ObjectChoice }>()
  const [localReview, setLocalReview] = useState<string>()
  const reviewTaskId = management?.candidateTaskId ?? localReview
  const browseKey = managementBrowseKey(projectId, chapterId, sequenceId, 'objects')
  const [kindFilter, setKindFilter] = useState<keyof typeof kinds | 'all'>(() => management ? readManagementBrowse(browseKey).kind ?? 'all' : 'all')

  const [association, setAssociation] = useState(() => readManagementBrowse(browseKey).association ?? 'all')
  const [reference, setReference] = useState(() => readManagementBrowse(browseKey).reference ?? 'all')
  const filterControl = useRef<HTMLDivElement>(null)
  const filterFocus = useRef<{ id: string; index: number }>()

  useEffect(() => { if (management) saveManagementBrowse(browseKey, { kind: kindFilter }) }, [browseKey, kindFilter, management])
  const lastRead = useRef<SceneObjectsRead>()
  const summaryChanged = useRef(management?.onChange)
  summaryChanged.current = management?.onChange
  const accept = useCallback((value: SceneObjectsRead) => {
    const previous = lastRead.current
    lastRead.current = value
    setData(value)
    setError('')
    if (previous && (previous.revision !== value.revision || previous.task?.task_id !== value.task?.task_id ||
        previous.task?.status !== value.task?.status)) summaryChanged.current?.()
  }, [])
  const requestKey = 'jellyfish:scene-object-request:' + JSON.stringify([projectId, chapterId, sequenceId])
  const [pendingRequest, setPendingRequest] = useState(() => {
    try { return localStorage.getItem(requestKey) ?? undefined } catch { return undefined }
  })
  const loadVersion = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const uploadObject = useRef<SceneObjectRead>()
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
      if (generation === loadVersion.current) setError(directingError(cause))
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
    } catch (cause) { setError(directingError(cause)); return }
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
      setError(directingError(cause))
    } finally { setSubmitting(false) }
  }

  const choose = async (objectId: string, assetId?: string, imageFileId?: string) => {
    if (!data || !editable) return
    filterFocus.current = { id: objectId, index: filtered.findIndex(object => object.id === objectId) }
    const response = await StudioDirectingService.directingSceneObjectChoose({ ...scope, objectId,
      requestBody: { expected_revision: data.revision, asset_id: assetId ?? null, image_file_id: imageFileId ?? null },
    })
    if (!response.data) throw new Error('保存结果待核实，请刷新对象准备')
    loadVersion.current++
    accept(response.data)
  }
  const reportChoiceError = (objectId: string, message: string, retry?: ObjectChoice) => {
    if (management) setChoiceError({ objectId, message, retry })
    else setError(message)
  }
  const recoverChoice = async (cause: unknown, choice: ObjectChoice) => {
    const conflict = cause instanceof ApiError && cause.status === 409
    const recoverable = conflict || !(cause instanceof ApiError) || cause.status >= 500
    const latest = conflict || management && recoverable ? await read() : undefined
    let retry: ObjectChoice | undefined
    if (management && recoverable) {
      const selected = latest?.objects.find(object => object.id === choice.objectId)
      if (selected && (selected.asset_id ?? undefined) === choice.assetId &&
          (selected.image_file_id ?? undefined) === choice.imageFileId) return
      if (!latest || selected) retry = choice
    }
    reportChoiceError(choice.objectId, directingError(cause), retry)
  }
  const save = async (objectId: string, assetId?: string, imageFileId?: string) => {
    if (!editable || saving) return false
    setSavingObject(objectId); setChoiceError(undefined)
    try { await choose(objectId, assetId, imageFileId); return true }
    catch (cause) { await recoverChoice(cause, { objectId, assetId, imageFileId }); return false }
    finally { setSavingObject(undefined) }
  }

  const upload = async (object: SceneObjectRead, file: File) => {
    if (!editable || saving) return
    if (file.type && !file.type.startsWith('image/')) { reportChoiceError(object.id, '仅支持上传图片文件'); return }
    let uploaded: string | undefined
    setSavingObject(object.id); setError(''); setChoiceError(undefined)
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: {
        file: file as unknown as string, project_id: projectId, chapter_id: chapterId, usage_kind: 'generation_upload',
        source_ref: `scene-object:${sequenceId}:${object.id}`,
      } })
      if (response.data?.type !== 'image') throw new Error('上传结果不是可用图片')
      uploaded = response.data.id
      await choose(object.id, object.asset_id ?? undefined, uploaded)
    } catch (cause) {
      if (uploaded) await recoverChoice(cause, { objectId: object.id, assetId: object.asset_id ?? undefined, imageFileId: uploaded })
      else reportChoiceError(object.id, directingError(cause))
    } finally { setSavingObject(undefined) }
  }

  const create = async () => {
    if (!editable || !draft?.name.trim() || saving) return
    setSavingObject(draft.object.id); setCreateError(''); setDraft({ ...draft, attempted: true })
    try {
      const response = await StudioDirectingService.directingCreateAsset({ projectId, sequenceId,
        requestBody: { request_id: draft.requestId, kind: draft.object.kind, name: draft.name.trim(), description: draft.description },
      })
      if (!response.data) throw new Error('资产创建结果待核实，请使用原请求重试')
      await choose(draft.object.id, response.data.id)
      setDraft(undefined)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) await read()
      if (cause instanceof ApiError && [400, 422].includes(cause.status)) setDraft({ ...draft, attempted: false })
      setCreateError(directingError(cause))
    } finally { setSavingObject(undefined) }
  }

  const listHeading = useRef<HTMLHeadingElement>(null)
  const assetOrigin = useRef<{ panel: HTMLElement | null; top: number; objectId: string; trigger?: HTMLElement }>({ panel: null, top: 0, objectId: '' })
  const openAsset = (asset: AssetSummary, objectId: string) => {
    const panel = document.activeElement?.closest<HTMLElement>('.management-panel') ?? document.querySelector<HTMLElement>('.management-workspace .management-panel')
    assetOrigin.current = { panel, top: panel?.scrollTop ?? 0, objectId, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : undefined }
    setAssetEditor(asset)
    if (management && panel) panel.scrollTop = 0
  }
  const closeAsset = useCallback(async () => {
    await read()
    setAssetEditor(undefined)
    requestAnimationFrame(() => {
      const { panel, top, objectId, trigger: originTrigger } = assetOrigin.current
      if (!panel?.isConnected) return
      panel.scrollTop = top
      const trigger = panel.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(objectId)}"] button[aria-label="对象更多操作"]`)
      ;(originTrigger?.isConnected && originTrigger.closest('[data-management-object]') ? originTrigger : trigger ?? filterControl.current?.querySelector<HTMLElement>('button, input, [tabindex="0"]') ?? document.getElementById('management-current-scene'))?.focus({ preventScroll: true })
    })
  }, [read])
  const action = data?.task?.status === 'failed' || data?.task?.status === 'cancelled' ? '重试提取对象'
    : data?.revision ? '重新提取对象' : '提取对象'

  const disabled = !editable || saving
  const extractionDisabled = disabled || loading || running && !pendingRequest
  const extractionLabel = pendingRequest ? '核实提取请求' : action
  const candidateTask = !pendingRequest ? data?.candidate_task_id : undefined
  const retryRead = () => void read()
  const associated = (object: SceneObjectRead) => !!object.asset_id && !!data?.assets.some(asset => asset.id === object.asset_id && asset.kind === object.kind)
  const filtered = (data?.objects ?? []).filter(object => !management ||
    (association === 'all' || association === 'associated' && associated(object) || association === 'unassociated' && !object.asset_id || association === 'unavailable' && !!object.asset_id && !associated(object)) &&
    (reference === 'all' || reference === 'missing' && !object.image_file_id || reference === 'ready' && object.reference_state === 'ready' || reference === 'unavailable' && object.reference_state === 'unavailable') &&
    (kindFilter === 'all' || object.kind === kindFilter))
  useEffect(() => {
    saveManagementBrowse(browseKey, { association, reference })
    const previous = filterFocus.current
    if (!saving && previous && !filtered.some(object => object.id === previous.id)) {
      const rows = document.querySelectorAll<HTMLElement>('.management-object-preparation [data-management-object]')
      const target = rows[previous.index]?.querySelector<HTMLElement>('button[aria-label="编辑关联资产"]')
      void message.info('已保存，该对象已移出当前筛选')
      ;(target ?? filterControl.current?.querySelector<HTMLElement>('button, input, [tabindex="0"]'))?.focus({ preventScroll: true })
    }
    if (!saving) filterFocus.current = undefined
  }, [association, reference, browseKey, filtered, saving])
  const choiceErrorOnCard = choiceError && filtered.some(object => object.id === choiceError.objectId)
  const pendingChoice = choiceError?.retry
  const retryChoice = pendingChoice && <MainButton size="small" disabled={disabled} onClick={() => void save(
    pendingChoice.objectId, pendingChoice.assetId, pendingChoice.imageFileId)}>核对后重试选择</MainButton>
  const AssetModal = management ? Modal : WorkbenchModal
  const closeDescription = () => {
    const id = descriptionObject?.id
    setDescriptionObject(undefined)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(id ?? '')}"] button[aria-label="对象更多操作"]`)?.focus({ preventScroll: true }))
  }
  const descriptionContent = descriptionObject && <div className="management-object-description-content"><p>{descriptionObject.description || '未填写描述'}</p><p>出处：{descriptionObject.excerpt || '暂无出处'}</p></div>
  return <>
    {compact ? <Drawer aria-label="描述与出处" title="描述与出处" placement="bottom" height="min(400px, 80dvh)" open={!!descriptionObject} onClose={closeDescription}>{descriptionContent}</Drawer>
      : <Modal title="描述与出处" open={!!descriptionObject} footer={null} onCancel={closeDescription}>{descriptionContent}</Modal>}
    <section hidden={!!management && !!assetEditor} className={management ? 'management-object-preparation' : undefined} aria-labelledby="scene-object-preparation-title">
    {management ? <>
      <h3 className="management-accessible-heading" ref={listHeading} tabIndex={-1} id="scene-object-preparation-title">场次对象与参考</h3>
      {management.host && !assetEditor && createPortal(<>
        <MainButton type="primary" icon={candidateTask ? <DiffOutlined aria-hidden /> : <ScanOutlined aria-hidden />} loading={submitting} disabled={candidateTask ? loading || submitting || saving : extractionDisabled}
          onClick={() => candidateTask ? setLocalReview(candidateTask) : void extract()}>
          {candidateTask ? '核对对象差异' : extractionLabel}
        </MainButton>
        {candidateTask && <Dropdown trigger={['click']} menu={{ items: [
          { key: 'extract', label: action, disabled: extractionDisabled, onClick: () => void extract() },
        ] }}><MainButton type="text" icon={<MoreOutlined />} aria-label="对象步骤更多操作" /></Dropdown>}
      </>, management.host)}
    </> : <div className="scene-canvas-list-header">
      <h2 id="scene-object-preparation-title">场次对象与参考</h2>
      <Button variant="primary" loading={submitting} disabled={extractionDisabled} onClick={() => void extract()}>{extractionLabel}</Button>
    </div>}
    {!management && <p>参考图可留空，各画布采用后独立管理。</p>}
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
    {management?.filterHost && createPortal(<div ref={filterControl} className="management-object-filters">
      {compact ? <Select disabled={!data?.objects.length} aria-label="对象类型" value={kindFilter} onChange={setKindFilter} options={[{value:'all',label:'全部类型'},...Object.entries(kinds).map(([value,label])=>({value,label}))]} /> : <Segmented disabled={!data?.objects.length} aria-label="对象类型" value={kindFilter} onChange={value => setKindFilter(value as typeof kindFilter)} options={[{ value: 'all', label: '全部' }, ...Object.entries(kinds).map(([value, label]) => ({ value, label }))]} />}
      <Select disabled={!data?.objects.length} aria-label="关联状态" value={association} onChange={setAssociation} options={[{value:'all',label:'全部关联状态'},{value:'unassociated',label:'未关联'},{value:'associated',label:'已关联'},{value:'unavailable',label:'关联不可用'}]} />
      <Dropdown trigger={['click']} menu={{ selectable: true, selectedKeys: [reference], onClick: ({ key }) => { setReference(key) }, items: [{key:'all',label:'全部参考状态'},{key:'missing',label:'未选参考图'},{key:'ready',label:'已选参考图'},{key:'unavailable',label:'参考图不可用'}] }}><MainButton disabled={!data?.objects.length} type="text" aria-label="参考筛选">参考筛选{reference !== 'all' ? ' · 已筛选' : ''}</MainButton></Dropdown>
      <span>{data ? `${filtered.length} 个对象` : '对象数量未确认'}</span>
      {!!data?.objects.length && !filtered.length && <MainButton type="text" onClick={() => { setKindFilter('all'); setAssociation('all'); setReference('all') }}>清除筛选</MainButton>}
      <span title="参考图可留空，各画布采用后独立管理。" tabIndex={0}><InfoCircleOutlined aria-hidden /></span>
    </div>, management.filterHost)}
    {(management ? ['all' as const] : Object.keys(kinds) as Array<keyof typeof kinds>).map(group => {
      const rows = group === 'all' ? filtered : filtered.filter(object => object.kind === group)
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
          const images = asset?.image_file_ids ?? []
          const assetSelect = <Select aria-label="关联资产" allowClear placeholder="关联已有资产" value={object.asset_id ?? undefined}
            disabled={disabled} options={options} onChange={id => { filterFocus.current = { id: object.id, index: filtered.findIndex(row => row.id === object.id) }; void save(object.id, id) }} />
          const referenceFileId = object.reference_state === 'ready' ? object.image_file_id ?? undefined : undefined
          const openCreate = () => {
            setCreateError(''); setDraft({ object, name: object.name, description: '', requestId: crypto.randomUUID(), attempted: false })
          }
          const openUpload = () => { uploadObject.current = object; fileInput.current?.click() }
          const assetAction = asset ? { key: 'prepare', label: '准备图片', onClick: () => openAsset(asset, object.id) }
            : { key: 'create', label: '新建并关联', onClick: openCreate }
          if (management) {
            const imageOptions = images.map((id, index) => ({ key: `file:${id}`,
              label: <span className="management-reference-option"><img alt="" src={buildFileDownloadUrl(id)} />
                <span>参考图 {index + 1}</span>{id === object.image_file_id && <CheckOutlined aria-label="当前已选" />}</span>,
              onClick: () => void save(object.id, asset?.id, id),
            }))
            const assetUnavailable = !!object.asset_id && !asset
            const imageUnavailable = object.image_file_id && object.reference_state === 'unavailable'
            const referenceAction = object.image_file_id ? '更换参考图' : images.length ? '选择参考图' : '上传参考图'
            const currentUpload = referenceFileId && !images.includes(referenceFileId) ? [{ key: 'current-upload', disabled: true,
              label: <span className="management-reference-option"><img alt="" src={buildFileDownloadUrl(referenceFileId)} />当前已选参考图</span>,
            }] : []
            const referenceMenu = [...currentUpload, ...imageOptions, { key: 'upload', label: '上传参考图', onClick: openUpload }]
            const cardActions = [{ key: 'association', label: '修改关联资产', onClick: () => setAssociationObject(object.id) }, { key: 'description', label: '描述与出处', onClick: () => setDescriptionObject(object) }, assetAction, ...(object.image_file_id ? [{ key: 'clear-reference', label: '清除参考图', disabled: assetUnavailable,
              onClick: () => void save(object.id, object.asset_id ?? undefined) }] : [])]
            const referenceButton = <MainButton disabled={disabled || assetUnavailable} loading={savingObject === object.id}
              onClick={images.length ? undefined : openUpload}>{referenceAction}</MainButton>
            return <li key={object.id} data-management-object={object.id}>
              <section aria-label={`${object.name} · ${object.excerpt}`}>
                <Card size="small" className="management-object-card">
                  <ReferenceImage key={referenceFileId ?? ''} name={object.name} fileId={referenceFileId} unavailable={!!imageUnavailable} />
                  <div className="management-object-body">
                    <div className="management-object-title-row"><h4 title={object.name}>{object.name}</h4><small>{kinds[kind]}</small>
                      <Dropdown autoFocus trigger={['click']} disabled={disabled} menu={{ items: cardActions }}>
                        <MainButton type="text" icon={<MoreOutlined />} aria-label="对象更多操作" disabled={disabled} />
                      </Dropdown>
                    </div>
                    <ObjectAssociationEditor open={associationObject === object.id} onClose={() => {
                      setAssociationObject(undefined)
                      document.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(object.id)}"] button[aria-label="对象更多操作"]`)?.focus({ preventScroll: true })
                    }} assetId={object.asset_id} hasReference={!!object.image_file_id} disabled={disabled} options={options}
                      onSave={id => { filterFocus.current = { id: object.id, index: filtered.findIndex(row => row.id === object.id) }; return save(object.id, id) }}
                      anchor={<div className="management-object-association-row"><LinkOutlined aria-hidden />
                        {asset ? <MainButton type="link" title={asset.name} onClick={() => openAsset(asset, object.id)} aria-label={`查看${asset.name}资产`}>{asset.name}<ArrowRightOutlined /></MainButton>
                          : <span>{assetUnavailable ? '关联资产不可用，请更换或解除关联' : '尚未关联资产'}</span>}
                        {images.length ? <Dropdown autoFocus trigger={['click']} disabled={disabled}
                          menu={{ items: referenceMenu }}>{referenceButton}</Dropdown> : referenceButton}
                      </div>} />
                    {imageUnavailable && <Badge status="warning" text="参考图不可用" />}

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
                {asset && <Select aria-label="选择参考图" allowClear placeholder="选择参考图" disabled={disabled || !images.length}
                  value={images.includes(object.image_file_id ?? '') ? object.image_file_id ?? undefined : undefined}
                  options={images.map((id, index) => ({ value: id, label: `参考图 ${index + 1}` }))}
                  onChange={id => void save(object.id, asset.id, id)} />}
                <Space wrap>
                  {[assetAction, { key: 'upload', label: '上传参考图', onClick: openUpload }]
                    .map(({ key, label, onClick }) => <Button key={key} disabled={disabled} onClick={onClick}>{label}</Button>)}
                  {object.image_file_id && !images.includes(object.image_file_id) &&
                    <Button variant="quiet" disabled={disabled} onClick={() => void save(object.id, asset?.id)}>清除参考图</Button>}
                  <small>{referenceLabels[object.reference_state]}</small>
                </Space>
              </div>
            </section>
          </li>
        })}</ul>
      </section>
    })}
    <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => {
      const object = uploadObject.current, file = event.target.files?.[0]
      event.target.value = ''
      if (object && file) void upload(object, file)
    }} />
    <AssetModal className={management ? 'management-object-dialog' : undefined} title="新建并关联资产" open={!!draft} width={480} closable={!saving} maskClosable={false} styles={assetModalStyles}
      onCancel={() => { if (!saving) setDraft(undefined) }}
      onOk={() => void create()} confirmLoading={saving}
      okText={draft?.attempted ? '核实并重试关联' : '创建并关联'} cancelText="取消"
      okButtonProps={{ disabled: !editable || !draft?.name.trim() }} cancelButtonProps={{ disabled: saving }}>
      {createError && <Alert type="error" showIcon message={createError} />}
      {draft && <div className="scene-object-asset-form">
        <label htmlFor="scene-object-asset-name">{kinds[draft.object.kind]}名称</label>
        <Input id="scene-object-asset-name" maxLength={255} value={draft.name} disabled={saving || draft.attempted}
          onChange={event => setDraft({ ...draft, name: event.target.value })} />
        <label htmlFor="scene-object-asset-description">资产稳定设定</label>
        <Input.TextArea id="scene-object-asset-description" maxLength={8000} value={draft.description} disabled={saving || draft.attempted}
          onChange={event => setDraft({ ...draft, description: event.target.value })} />
      </div>}
    </AssetModal>
    {!management && <AssetModal title={assetEditor ? `准备${kinds[assetEditor.kind]}图片 · ${assetEditor.name}` : '准备资产图片'}
      open={!!assetEditor} closable={false} keyboard={false} maskClosable={false} footer={null}
      width="min(1200px, 96vw)" styles={assetModalStyles} destroyOnClose>
      {assetEditor && <AssetEditPageBase assetId={assetEditor.id} {...assetAdapters[assetEditor.kind]} embedded backTo="本场资产" onNavigate={closeAsset} />}
    </AssetModal>}
  </section>
  {management && assetEditor && <section className="management-inline-asset" aria-label="本场资产详情">
    <AssetEditPageBase key={assetEditor.id} assetId={assetEditor.id} {...assetAdapters[assetEditor.kind]} localDetail
      backTo="本场资产" backLabel="返回对象参考" onNavigate={closeAsset}
      renderToolbar={(title, actions) => <PageToolbar className="management-asset-toolbar" title={title}>{actions}</PageToolbar>} />
  </section>}
  </>
}
