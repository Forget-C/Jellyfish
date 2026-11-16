import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Badge, Button as MainButton, Card, Segmented, Dropdown, Drawer, Empty, Grid, Image, Modal, Select, Space, Spin, message } from 'antd'
import { MoreOutlined, InfoCircleOutlined, ArrowRightOutlined, ScanOutlined, DiffOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, SceneObjectRead, SceneObjectsRead } from '../../../services/generated'
import { ObjectAssociationEditor } from './ObjectAssociationEditor'
import { ResourceEditorDrawer } from '../assets/components/ResourceEditorDrawer'
import { buildFileDownloadUrl } from '../assets/utils'
import { managementBrowseKey, readManagementBrowse, saveManagementBrowse } from './managementBrowse'
import { CanvasTextPreview } from './CanvasTextPreview'
import { SceneObjectCandidateReview } from './SceneObjectCandidateReview'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import './workbench-object-preparation.css'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
const kinds = { character: '角色', scene: '场所', prop: '道具' } as const
type ObjectChoice = { objectId: string; assetId?: string }
type ManagementActions = {
  host: HTMLDivElement | null; filterHost: HTMLDivElement | null; onChange: () => void;
  candidateTaskId: string | null; clearCandidateTask: () => void;
}
const referenceLabels = { unassociated: '尚未关联资产', missing: '未选参考图', ready: '已选参考图', unavailable: '关联或图片不可用' }

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
  const [descriptionObject, setDescriptionObject] = useState<SceneObjectRead>()
  const [assetEditor, setAssetEditor] = useState<AssetSummary>()
  const [draft, setDraft] = useState<{ object: SceneObjectRead; name: string; description: string }>()
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

  const choose = async (objectId: string, assetId?: string) => {
    const current = lastRead.current ?? data
    if (!current || !editable) return
    filterFocus.current = { id: objectId, index: filtered.findIndex(object => object.id === objectId) }
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
    reportChoiceError(choice.objectId, directingError(cause), retry)
    return false
  }
  const save = async (objectId: string, assetId?: string) => {
    if (!editable || saving) return false
    setSavingObject(objectId); setChoiceError(undefined)
    try { await choose(objectId, assetId); return true }
    catch (cause) { return await recoverChoice(cause, { objectId, assetId }) }
    finally { setSavingObject(undefined) }
  }

  const createSeed = useMemo(() => draft ? { name: draft.name, description: draft.description } : undefined, [draft])

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
    pendingChoice.objectId, pendingChoice.assetId)}>核对后重试选择</MainButton>
  const closeDescription = () => {
    const id = descriptionObject?.id
    setDescriptionObject(undefined)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(id ?? '')}"] button[aria-label="对象更多操作"]`)?.focus({ preventScroll: true }))
  }
  const descriptionContent = descriptionObject && <div className="management-object-description-content"><p>{descriptionObject.description || '未填写描述'}</p><p>出处：{descriptionObject.excerpt || '暂无出处'}</p></div>
  return <>
    {compact ? <Drawer aria-label="描述与出处" title="描述与出处" placement="bottom" height="min(400px, 80dvh)" open={!!descriptionObject} onClose={closeDescription}>{descriptionContent}</Drawer>
      : <Modal title="描述与出处" open={!!descriptionObject} footer={null} onCancel={closeDescription}>{descriptionContent}</Modal>}
    <section hidden={!!assetEditor} className={management ? 'management-object-preparation' : undefined} aria-labelledby="scene-object-preparation-title">
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
    {management?.filterHost && !assetEditor && createPortal(<div ref={filterControl} className="management-object-filters">
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
          const assetSelect = <Select aria-label="关联资产" allowClear placeholder="关联已有资产" value={object.asset_id ?? undefined}
            disabled={disabled} options={options} onChange={id => { filterFocus.current = { id: object.id, index: filtered.findIndex(row => row.id === object.id) }; void save(object.id, id) }} />
          const referenceFileId = object.reference_state === 'ready' ? object.image_file_id ?? undefined : undefined
          const openCreate = () => {
            setDraft({ object, name: object.name, description: object.description })
          }
          const assetAction = asset ? { key: 'prepare', label: '准备图片', onClick: () => openAsset(asset, object.id) }
            : { key: 'create', label: '新建并关联', onClick: openCreate }
          if (management) {
            const assetUnavailable = !!object.asset_id && !asset
            const imageUnavailable = object.reference_state === 'unavailable'
            const cardActions = [...(asset ? [{ key: 'references', label: '编辑对象参考', onClick: () => openAsset(asset, object.id) }] : []),
              { key: 'association', label: '修改关联资产', onClick: () => setAssociationObject(object.id) },
              { key: 'description', label: '描述与出处', onClick: () => setDescriptionObject(object) }, assetAction,
              ...(object.asset_id ? [{ key: 'clear', label: '清空', onClick: () => Modal.confirm({ title: '清空对象选用？',
                content: '保留对象名称、描述与出处、资源和图片。沿用本场对象的画布将不再有可用资源；已受理任务不变。',
                okText: '清空', cancelText: '取消', onOk: async () => { if (!await save(object.id)) throw new Error('清空失败，请重试') } }) }] : [])]
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
                    <div className="management-object-excerpt" title={object.excerpt || '暂无出处'} tabIndex={0}><span>出处</span><span>{object.excerpt || '暂无出处'}</span></div>
                    <ObjectAssociationEditor open={associationObject === object.id} onClose={() => {
                      setAssociationObject(undefined)
                      document.querySelector<HTMLElement>(`[data-management-object="${CSS.escape(object.id)}"] button[aria-label="对象更多操作"]`)?.focus({ preventScroll: true })
                    }} assetId={object.asset_id} hasReference={!!object.asset_id} disabled={disabled} options={options}
                      onSave={id => { filterFocus.current = { id: object.id, index: filtered.findIndex(row => row.id === object.id) }; return save(object.id, id) }}
                      anchor={<div className="management-object-association-row"><LinkOutlined aria-hidden />
                        {asset ? <MainButton type="link" title={asset.name} onClick={() => openAsset(asset, object.id)} aria-label={`查看${asset.name}资产`}>{asset.name}<ArrowRightOutlined /></MainButton>
                          : <span>{assetUnavailable ? '关联资产不可用，请更换或解除关联' : '尚未关联资产'}</span>}

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
    {draft && <ResourceEditorDrawer open kind={draft.object.kind} projectId={projectId} seed={createSeed}
      onClose={() => { setDraft(undefined); void read() }} onSaved={async resource => {
        const current = lastRead.current?.objects.find(object => object.id === draft.object.id)
        if (current?.asset_id !== resource.id && !await save(draft.object.id, resource.id)) throw new Error('对象已保存，场次关联尚未完成，请重试')
      }} />}
    </section>
    {assetEditor && <div className="management-inline-asset"><ResourceEditorDrawer inline open kind={assetEditor.kind} assetId={assetEditor.id} projectId={projectId}
      onClose={() => void closeAsset()} onSaved={async () => { await read() }} /></div>}
  </>
}
