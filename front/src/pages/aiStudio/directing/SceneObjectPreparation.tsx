import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button as MainButton, Checkbox, Dropdown, Empty, Input, Select, Space, Spin } from 'antd'
import { MoreOutlined, PictureOutlined } from '@ant-design/icons'
import { ApiError, StudioDirectingService, StudioFilesService } from '../../../services/generated'
import type { AssetSummary, SceneObjectRead, SceneObjectsRead } from '../../../services/generated'
import { AssetEditPageBase } from '../assets/components/AssetEditPageBase'
import { assetAdapters } from '../assets/assetAdapters'
import { buildFileDownloadUrl } from '../assets/utils'
import { CanvasTextPreview } from './CanvasTextPreview'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'
import './workbench-object-preparation.css'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
const kinds = { character: '角色', scene: '场所', prop: '道具' } as const
type ObjectChoice = { objectId: string; assetId?: string; imageFileId?: string }
type ManagementActions = { host: HTMLDivElement | null; onContinue: () => void; onChange: () => void }
const referenceLabels = { unassociated: '尚未关联资产', missing: '未选参考图', ready: '已选参考图', unavailable: '关联或图片不可用' }

function activeTask(data?: SceneObjectsRead) {
  return data?.task?.status === 'queued' || data?.task?.status === 'running'
}

/** 对象和参考选择属于场次准备，单独保存于画布及旧版本之外。 */
export function SceneObjectPreparation({ projectId, chapterId, sequenceId, editable, management }: Scope & {
  editable: boolean; management?: ManagementActions;
}) {
  const [data, setData] = useState<SceneObjectsRead>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assetEditor, setAssetEditor] = useState<AssetSummary>()
  const [draft, setDraft] = useState<{ object: SceneObjectRead; name: string; description: string; requestId: string; attempted: boolean }>()
  const [createError, setCreateError] = useState('')
  const [failedChoice, setFailedChoice] = useState<ObjectChoice>()
  const [kindFilter, setKindFilter] = useState<keyof typeof kinds | 'all'>('all')
  const [unpreparedOnly, setUnpreparedOnly] = useState(false)
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
    const response = await StudioDirectingService.directingSceneObjectChoose({ ...scope, objectId,
      requestBody: { expected_revision: data.revision, asset_id: assetId ?? null, image_file_id: imageFileId ?? null },
    })
    if (!response.data) throw new Error('保存结果待核实，请刷新对象准备')
    loadVersion.current++
    accept(response.data)
  }
  const recoverChoice = async (cause: unknown, choice: ObjectChoice) => {
    const conflict = cause instanceof ApiError && cause.status === 409
    const recoverable = conflict || !(cause instanceof ApiError) || cause.status >= 500
    const latest = conflict || management && recoverable ? await read() : undefined
    if (management && recoverable) {
      const selected = latest?.objects.find(object => object.id === choice.objectId)
      if (selected && (selected.asset_id ?? undefined) === choice.assetId &&
          (selected.image_file_id ?? undefined) === choice.imageFileId) return
      if (!latest || selected) setFailedChoice(choice)
    }
    setError(directingError(cause))
  }
  const save = async (objectId: string, assetId?: string, imageFileId?: string) => {
    if (!editable || saving) return
    setSaving(true); setFailedChoice(undefined)
    try { await choose(objectId, assetId, imageFileId) }
    catch (cause) { await recoverChoice(cause, { objectId, assetId, imageFileId }) }
    finally { setSaving(false) }
  }

  const upload = async (object: SceneObjectRead, file: File) => {
    if (!editable || saving) return
    if (file.type && !file.type.startsWith('image/')) { setError('仅支持上传图片文件'); return }
    let uploaded: string | undefined
    setSaving(true); setError(''); setFailedChoice(undefined)
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
      else setError(directingError(cause))
    } finally { setSaving(false) }
  }

  const create = async () => {
    if (!editable || !draft?.name.trim() || saving) return
    setSaving(true); setCreateError(''); setDraft({ ...draft, attempted: true })
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
    } finally { setSaving(false) }
  }

  const closeAsset = useCallback(() => { setAssetEditor(undefined); void read() }, [read])
  const action = data?.task?.status === 'failed' || data?.task?.status === 'cancelled' ? '重试提取对象'
    : data?.revision ? '重新提取对象' : '提取对象'

  const disabled = !editable || saving
  const extractionDisabled = disabled || loading || running && !pendingRequest
  const extractionLabel = pendingRequest ? '核实提取请求' : action
  const retryRead = () => void read()
  const filtered = (data?.objects ?? []).filter(object => !management ||
    (kindFilter === 'all' || object.kind === kindFilter) && (!unpreparedOnly || object.reference_state !== 'ready' ||
      !!object.asset_id && !data?.assets.some(asset => asset.id === object.asset_id && asset.kind === object.kind)))
  return <section className={management ? 'management-object-preparation' : undefined} aria-labelledby="scene-object-preparation-title">
    {management ? <>
      <h3 id="scene-object-preparation-title">场次对象与参考</h3>
      {management.host && createPortal(<>
        <MainButton type="primary" loading={submitting} disabled={extractionDisabled} onClick={() => void extract()}>{extractionLabel}</MainButton>
        <MainButton onClick={management.onContinue}>{editable ? '继续到分镜与画布' : '查看本场画布'}</MainButton>
      </>, management.host)}
    </> : <div className="scene-canvas-list-header">
      <h2 id="scene-object-preparation-title">场次对象与参考</h2>
      <Button variant="primary" loading={submitting} disabled={extractionDisabled} onClick={() => void extract()}>{extractionLabel}</Button>
    </div>}
    <p>参考图可留空，各画布采用后独立管理。</p>
    {loading && <Spin aria-label="正在读取对象准备" />}
    {(error || failedChoice) && <Alert type="error" showIcon message={error || '尚有未保存的对象选择'} action={management
      ? <Space wrap>
        <MainButton onClick={retryRead}>刷新对象准备</MainButton>
        {failedChoice && <MainButton disabled={disabled} onClick={() => void save(
          failedChoice.objectId, failedChoice.assetId, failedChoice.imageFileId)}>核对后重试选择</MainButton>}
      </Space> : <Button onClick={retryRead}>刷新对象准备</Button>} />}
    {running && <p role="status">{data?.task?.status === 'queued' ? '对象提取排队中' : '正在提取对象'}</p>}
    {data?.task?.status === 'failed' && <Alert type="warning" showIcon message="对象提取失败，已保留此前准备"
      description={data.task.error} />}
    {data?.task?.status === 'cancelled' && <Alert type="warning" message="对象提取已取消，已保留此前准备" />}
    {data?.source_changed && <Alert type="warning" showIcon message="场次原文已变更，请重新提取对象后核对参考。" />}
    {data && !data.objects.length && !error && (management
      ? <p>{data.revision ? '本场未提取到对象，可以继续分镜。' : '尚未提取对象，可提取后准备参考，也可直接继续。'}</p>
      : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={data.revision ? '本场未提取到对象' : '尚未提取对象'} />)}
    {management && !!data?.objects.length && <div className="management-object-filters">
      <Select aria-label="对象类型" value={kindFilter} onChange={setKindFilter} options={[
        { value: 'all', label: '全部类型' }, ...Object.entries(kinds).map(([value, label]) => ({ value, label })),
      ]} />
      <Checkbox checked={unpreparedOnly} onChange={event => setUnpreparedOnly(event.target.checked)}>仅看未准备参考</Checkbox>
      {!filtered.length && <span>没有匹配的对象</span>}
    </div>}
    {(Object.keys(kinds) as Array<keyof typeof kinds>).map(kind => {
      const rows = filtered.filter(object => object.kind === kind)
      if (!rows.length) return null
      return <section key={kind} className={management ? 'management-object-kind' : 'scene-object-kind'} aria-label={kinds[kind]}>
        <h3>{kinds[kind]}</h3>
        <ul className={management ? 'management-object-list' : 'scene-object-list'}>{rows.map(object => {
          const asset = data?.assets.find(item => item.kind === kind && item.id === object.asset_id)
          const options = (data?.assets ?? []).filter(item => item.kind === kind).map(item => ({
            value: item.id, label: item.name + (item.id === object.suggested_asset_id ? '（提取建议）' : ''),
          }))
          if (object.asset_id && !asset) options.push({ value: object.asset_id, label: '关联资产不可用' })
          const images = asset?.image_file_ids ?? []
          const assetSelect = <Select aria-label="关联资产" allowClear placeholder="关联已有资产" value={object.asset_id ?? undefined}
            disabled={disabled} options={options} onChange={id => void save(object.id, id)} />
          const thumbnail = object.reference_state === 'ready' && object.image_file_id &&
            <img alt={`${object.name}已选参考图`} src={buildFileDownloadUrl(object.image_file_id)} />
          const openCreate = () => {
            setCreateError(''); setDraft({ object, name: object.name, description: '', requestId: crypto.randomUUID(), attempted: false })
          }
          const openUpload = () => { uploadObject.current = object; fileInput.current?.click() }
          const actions = [asset ? { key: 'prepare', label: '准备图片', onClick: () => setAssetEditor(asset) }
            : { key: 'create', label: '新建并关联', onClick: openCreate },
          { key: 'upload', label: '上传参考图', onClick: openUpload }]
          if (management) {
            const imageOptions = images.map((id, index) => ({ key: `file:${id}`,
              label: <span className="management-reference-option"><img alt="" src={buildFileDownloadUrl(id)} />参考图 {index + 1}</span>,
              onClick: () => void save(object.id, asset?.id, id),
            }))
            const imageUnavailable = object.image_file_id && object.reference_state === 'unavailable'
            const referenceStatus = imageUnavailable ? '参考图不可用'
              : object.reference_state === 'unavailable' ? '未选参考图' : referenceLabels[object.reference_state]
            const referenceMenu = [...imageOptions, ...(object.image_file_id ? [{ key: 'clear-reference', label: '清除参考图',
              onClick: () => void save(object.id, asset?.id) }] : [])]
            return <li key={object.id}>
              <section className="management-object-row" aria-label={`${object.name} · ${object.excerpt}`}>
                <div className="management-object-info">
                  <strong>{object.name}</strong>
                  {!!object.description && <small className="management-object-description">{object.description}</small>}
                  <details><summary>描述与出处</summary>
                    {object.description && <p>{object.description}</p>}
                    <small>出处：{object.excerpt}</small>
                  </details>
                </div>
                <div className="management-object-asset">
                  {assetSelect}
                  {object.asset_id && !asset && <small className="management-object-warning">关联资产不可用</small>}
                </div>
                <div className="management-object-reference">
                  <Dropdown autoFocus trigger={['click']} disabled={disabled || !referenceMenu.length} menu={{ items: referenceMenu }}>
                    <MainButton className="management-reference-button" aria-label="选择参考图" disabled={disabled || !referenceMenu.length}>
                      {thumbnail || <PictureOutlined aria-hidden />}
                    </MainButton>
                  </Dropdown>
                  <small className={imageUnavailable ? 'management-object-warning' : undefined}>{referenceStatus}</small>
                </div>
                <Dropdown autoFocus trigger={['click']} disabled={disabled} menu={{ items: actions }}>
                  <MainButton type="text" icon={<MoreOutlined />} aria-label="对象更多操作" disabled={disabled} />
                </Dropdown>
              </section>
            </li>
          }
          return <li key={object.id}>
            <section className="scene-object-row" aria-label={`${object.name} · ${object.excerpt}`}>
              <div className="scene-object-identity">
                {thumbnail}
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
                  {actions.map(({ key, label, onClick }) => <Button key={key} disabled={disabled} onClick={onClick}>{label}</Button>)}
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
    <WorkbenchModal title="新建并关联资产" open={!!draft} width={480} closable={!saving} maskClosable={false}
      onCancel={() => { if (!saving) setDraft(undefined) }}
      footer={<WorkbenchDialogActions secondary={<Button variant="quiet" disabled={saving} onClick={() => setDraft(undefined)}>取消</Button>}>
        <Button variant="primary" loading={saving} disabled={!editable || !draft?.name.trim()} onClick={() => void create()}>
          {draft?.attempted ? '核实并重试关联' : '创建并关联'}</Button>
      </WorkbenchDialogActions>}>
      {createError && <Alert type="error" showIcon message={createError} />}
      {draft && <div className="scene-object-asset-form">
        <label htmlFor="scene-object-asset-name">{kinds[draft.object.kind]}名称</label>
        <Input id="scene-object-asset-name" maxLength={255} value={draft.name} disabled={saving || draft.attempted}
          onChange={event => setDraft({ ...draft, name: event.target.value })} />
        <label htmlFor="scene-object-asset-description">资产稳定设定</label>
        <Input.TextArea id="scene-object-asset-description" maxLength={8000} value={draft.description} disabled={saving || draft.attempted}
          onChange={event => setDraft({ ...draft, description: event.target.value })} />
      </div>}
    </WorkbenchModal>
    <WorkbenchModal title={assetEditor ? `准备${kinds[assetEditor.kind]}图片 · ${assetEditor.name}` : '准备资产图片'}
      open={!!assetEditor} closable={false} keyboard={false} maskClosable={false} footer={null}
      width="min(1200px, 96vw)" destroyOnClose>
      {assetEditor && <AssetEditPageBase assetId={assetEditor.id} {...assetAdapters[assetEditor.kind]} embedded backTo="本场资产" onNavigate={closeAsset} />}
    </WorkbenchModal>
  </section>
}
