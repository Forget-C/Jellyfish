import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Empty, Input, Select, Space, Spin } from 'antd'
import { ApiError, StudioDirectingService, StudioFilesService } from '../../../services/generated'
import type { AssetSummary, SceneObjectRead, SceneObjectsRead } from '../../../services/generated'
import { AssetEditPageBase } from '../assets/components/AssetEditPageBase'
import { assetAdapters } from '../assets/assetAdapters'
import { buildFileDownloadUrl } from '../assets/utils'
import { CanvasTextPreview } from './CanvasTextPreview'
import { directingError } from './common'
import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from './ui/WorkbenchModal'

type Scope = { projectId: string; chapterId: string; sequenceId: string }
const kinds = { character: '角色', scene: '场所', prop: '道具' } as const
const referenceLabels = { unassociated: '尚未关联资产', missing: '未选参考图', ready: '已选参考图', unavailable: '关联或图片不可用' }

function activeTask(data?: SceneObjectsRead) {
  return data?.task?.status === 'queued' || data?.task?.status === 'running'
}

/** 对象和参考选择属于场次准备，单独保存于画布及旧版本之外。 */
export function SceneObjectPreparation({ projectId, chapterId, sequenceId, editable }: Scope & { editable: boolean }) {
  const [data, setData] = useState<SceneObjectsRead>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [assetEditor, setAssetEditor] = useState<AssetSummary>()
  const [draft, setDraft] = useState<{ object: SceneObjectRead; name: string; description: string; requestId: string; attempted: boolean }>()
  const [createError, setCreateError] = useState('')
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
      setData(response.data); setError('')
    } catch (cause) {
      if (generation === loadVersion.current) setError(directingError(cause))
    } finally {
      if (generation === loadVersion.current) setLoading(false)
    }
  }, [projectId, chapterId, sequenceId])
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
    setData(response.data); setError('')
  }
  const save = async (objectId: string, assetId?: string, imageFileId?: string) => {
    if (saving) return
    setSaving(true)
    try { await choose(objectId, assetId, imageFileId) }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) await read()
      setError(directingError(cause))
    } finally { setSaving(false) }
  }

  const upload = async (object: SceneObjectRead, file: File) => {
    if (!editable || saving) return
    if (file.type && !file.type.startsWith('image/')) { setError('仅支持上传图片文件'); return }
    setSaving(true); setError('')
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: {
        file: file as unknown as string, project_id: projectId, chapter_id: chapterId, usage_kind: 'generation_upload',
        source_ref: `scene-object:${sequenceId}:${object.id}`,
      } })
      if (response.data?.type !== 'image') throw new Error('上传结果不是可用图片')
      await choose(object.id, object.asset_id ?? undefined, response.data.id)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) await read()
      setError(directingError(cause))
    } finally { setSaving(false) }
  }

  const create = async () => {
    if (!draft?.name.trim() || saving) return
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

  return <section aria-labelledby="scene-object-preparation-title">
    <div className="scene-canvas-list-header">
      <h2 id="scene-object-preparation-title">场次对象与参考</h2>
      <Button variant="primary" loading={submitting} disabled={!editable || loading || running && !pendingRequest || saving}
        onClick={() => void extract()}>{pendingRequest ? '核实提取请求' : action}</Button>
    </div>
    <p>这里选的是场次候选。各画布采用后独立管理，参考图可留空。</p>
    {loading && <Spin aria-label="正在读取对象准备" />}
    {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void read()}>刷新对象准备</Button>} />}
    {running && <p role="status">{data?.task?.status === 'queued' ? '对象提取排队中' : '正在提取对象'}</p>}
    {data?.task?.status === 'failed' && <Alert type="warning" showIcon message="对象提取失败，已保留此前准备"
      description={data.task.error} />}
    {data?.task?.status === 'cancelled' && <Alert type="warning" message="对象提取已取消，已保留此前准备" />}
    {data?.source_changed && <Alert type="warning" showIcon message="场次原文已变更，请重新提取对象后核对参考。" />}
    {data && !data.objects.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={data.revision ? '本场未提取到对象' : '尚未提取对象'} />}
    {(Object.keys(kinds) as Array<keyof typeof kinds>).map(kind => {
      const rows = data?.objects.filter(object => object.kind === kind) ?? []
      if (!rows.length) return null
      return <section key={kind} className="scene-object-kind" aria-label={kinds[kind]}>
        <h3>{kinds[kind]}</h3>
        <ul className="scene-object-list">{rows.map(object => {
          const asset = data?.assets.find(item => item.kind === kind && item.id === object.asset_id)
          const options = (data?.assets ?? []).filter(item => item.kind === kind).map(item => ({
            value: item.id, label: item.name + (item.id === object.suggested_asset_id ? '（提取建议）' : ''),
          }))
          if (object.asset_id && !asset) options.push({ value: object.asset_id, label: '关联资产不可用' })
          const images = asset?.image_file_ids ?? []
          return <li key={object.id}>
            <section className="scene-object-row" aria-label={`${object.name} · ${object.excerpt}`}>
              <div className="scene-object-identity">
                {object.reference_state === 'ready' && object.image_file_id &&
                  <img alt={`${object.name}已选参考图`} src={buildFileDownloadUrl(object.image_file_id)} />}
                <div><strong>{object.name}</strong><CanvasTextPreview label="对象描述" text={object.description} lines={2} />
                  <small>出处：{object.excerpt}</small></div>
              </div>
              <div className="scene-object-choices">
                <Select aria-label="关联资产" allowClear placeholder="关联已有资产" value={object.asset_id ?? undefined}
                  disabled={!editable || saving} options={options} onChange={id => void save(object.id, id)} />
                {asset && <Select aria-label="选择参考图" allowClear placeholder="选择参考图" disabled={!editable || saving || !images.length}
                  value={images.includes(object.image_file_id ?? '') ? object.image_file_id ?? undefined : undefined}
                  options={images.map((id, index) => ({ value: id, label: `参考图 ${index + 1}` }))}
                  onChange={id => void save(object.id, asset.id, id)} />}
                <Space wrap>
                  {asset ? <Button disabled={!editable || saving} onClick={() => setAssetEditor(asset)}>准备图片</Button>
                    : <Button disabled={!editable || saving} onClick={() => {
                      setCreateError(''); setDraft({ object, name: object.name, description: '', requestId: crypto.randomUUID(), attempted: false })
                    }}>新建并关联</Button>}
                  <Button disabled={!editable || saving} onClick={() => {
                    uploadObject.current = object; fileInput.current?.click()
                  }}>上传参考图</Button>
                  {object.image_file_id && !images.includes(object.image_file_id) &&
                    <Button variant="quiet" disabled={!editable || saving}
                      onClick={() => void save(object.id, asset?.id)}>清除参考图</Button>}
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
        <Button variant="primary" loading={saving} disabled={!draft?.name.trim()} onClick={() => void create()}>
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
