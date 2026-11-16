import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Image, Input, Popover, Select, Tag, Upload, message, type UploadFile } from 'antd'
import { FileAddOutlined, ImportOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons'
import { StudioEntitiesService, StudioFilesService, type ImageSourceRequest } from '../../../../services/generated'
import { ResourceEditorFrame } from './ResourceEditorFrame'
import { AssetDetailLeaveGuard } from './AssetDetailLeaveGuard'
import { useWorkspaceDraft, useWorkspaceDraftStatus } from '../../directing/WorkspaceDrafts'
import { directingError } from '../../directing/common'
import { buildFileDownloadUrl } from '../utils'
import { readResourceImages } from '../resourceImages'
import type { ResourceKind } from './ResourceEditorDrawer'
import './resourceCreate.css'

/** 选择方式不创建对象；上传与导入共用独立的抽屉会话。 */
export function ResourceCreateButton({ kind, projectId, onCreate, onCreated, children }: {
  kind: ResourceKind; projectId?: string; onCreate: () => void; onCreated: () => void | Promise<unknown>; children: ReactNode
}) {
  const [choosing, setChoosing] = useState(false)
  const [imagesOpen, setImagesOpen] = useState(false)
  const trigger = useRef<HTMLSpanElement>(null)
  const choices = useRef<HTMLDivElement>(null)
  const close = () => { setImagesOpen(false); requestAnimationFrame(() => trigger.current?.querySelector('button')?.focus()) }
  return <><Popover open={choosing} trigger="click" placement="bottomRight" onOpenChange={next => { setChoosing(next); if (next) requestAnimationFrame(() => choices.current?.querySelector('button')?.focus()) }} content={<div ref={choices} className="resource-create-choices" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setChoosing(false); trigger.current?.querySelector('button')?.focus() }
  }}>
    <button onClick={() => { setChoosing(false); onCreate() }}><FileAddOutlined aria-hidden /><strong>填写设定</strong><span>填写对象信息并创建</span></button>
    <button onClick={() => { setChoosing(false); setImagesOpen(true) }}>{projectId ? <ImportOutlined aria-hidden /> : <UploadOutlined aria-hidden />}<strong>{projectId ? '从资产库导入' : '上传图片'}</strong><span>{projectId ? '创建独立项目副本' : '以图片创建资源'}</span></button>
  </div>}><span ref={trigger} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setChoosing(false); trigger.current?.querySelector('button')?.focus() } }}>{children}</span></Popover>
    {imagesOpen && <ImageSourceDrawer kind={kind} projectId={projectId} onClose={close} onCreated={onCreated} />}
  </>
}

type UploadRow = { id: string; file: File; angle: string; fileId?: string; uploading: boolean; error?: string }
const views = [{ value: 'FRONT', label: '正面' }, { value: 'LEFT', label: '侧面' }, { value: 'TOP', label: '俯视' }, { value: 'BACK', label: '背面' }]
function ImageSourceDrawer({ kind, projectId, onClose, onCreated }: { kind: ResourceKind; projectId?: string; onClose: () => void; onCreated: () => void | Promise<unknown> }) {
  const id = useId(), requestId = useRef(crypto.randomUUID())
  const [name, setName] = useState(''), [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string>()
  const [sources, setSources] = useState<{ id: string; name: string }[]>([])
  const [sourceId, setSourceId] = useState<string>()
  const [pictures, setPictures] = useState<{ id: number; file_id?: string | null; view_angle?: string | null }[]>([])
  const [rows, setRows] = useState<UploadRow[]>([])
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [closeRequested, setCloseRequested] = useState(false)
  const active = useRef(true), lock = useRef(false), accepted = useRef(false)
  const sourceKind = kind === 'character' ? 'actor' : kind
  const dirty = !accepted.current && (!!name || rows.length > 0 || !!sourceId)
  const uploading = rows.some(row => row.uploading)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (!projectId) return
    let current = true
    setLoading(true); setError('')
    void StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: sourceKind, q: query, page: 1, pageSize: 100 })
      .then(response => { if (current) setSources((response.data?.items ?? []) as { id: string; name: string }[]) })
      .catch(cause => { if (current) setError(directingError(cause)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [projectId, sourceKind, query, retry])
  useEffect(() => {
    if (!sourceId) return
    let current = true
    setLoading(true); setPictures([]); setError('')
    void readResourceImages(sourceKind, sourceId).then(images => { if (current) setPictures(images.filter(image => image.file_id)) })
      .catch(cause => { if (current) setError(directingError(cause)) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [sourceKind, sourceId, retry])
  const upload = async (row: UploadRow) => {
    setRows(current => current.map(item => item.id === row.id ? { ...item, uploading: true, error: undefined } : item))
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: row.file as unknown as string } })
      if (!response.data?.id) throw new Error('上传未返回图片')
      if (active.current) setRows(current => current.map(item => item.id === row.id ? { ...item, uploading: false, fileId: response.data!.id } : item))
    } catch (cause) { if (active.current) setRows(current => current.map(item => item.id === row.id ? { ...item, uploading: false, error: directingError(cause) } : item)) }
  }
  const save = async () => {
    if (lock.current || uploading || loading) return false
    if (!accepted.current && (!name.trim() || (projectId ? !sourceId || !pictures.length : !rows.length || rows.some(row => !row.fileId)))) { setError('请填写名称并准备至少一张有效图片；失败项须重试或移除'); return false }
    lock.current = true; setBusy(true); setError('')
    try {
      if (!accepted.current) {
        const requestBody: ImageSourceRequest = { id: requestId.current, name: name.trim(), project_id: projectId,
          ...(projectId ? { source_id: sourceId } : { images: rows.map(row => ({ file_id: row.fileId!, view_angle: row.angle })) }) }
        await StudioEntitiesService.createImageSourceEntityApiV1StudioEntitiesEntityTypeImageSourcePost({ entityType: kind, requestBody })
        accepted.current = true
      }
      await onCreated()
      return true
    } catch (cause) { setError((accepted.current ? '资源已创建，列表刷新失败；重试不会重复创建。' : '') + directingError(cause)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  const host = useWorkspaceDraftStatus()
  useWorkspaceDraft({ name: projectId ? '导入资源' : '上传资源', dirty, busy: busy || uploading, save, discard: onClose })
  const close = () => { if (dirty || busy || uploading) setCloseRequested(true); else onClose() }
  return <><ResourceEditorFrame id={id} open drawer drawerWidth={projectId ? undefined : 600} title={projectId ? '从资产库导入' : '上传图片创建'} backLabel="返回" onClose={close}
    actions={<Button aria-label={accepted.current ? '重试刷新' : projectId ? '导入' : '创建'} type="primary" loading={busy} disabled={uploading || loading || !projectId && !accepted.current && (!name.trim() || !rows.length || rows.some(row => !row.fileId))} onClick={async () => { if (await save()) onClose() }}>{accepted.current ? '重试刷新' : projectId ? '导入' : '创建'}</Button>}>
    <div className={`resource-editor-fields${projectId ? '' : ' resource-upload-form'}`}>
      <label>名称<Input aria-label="名称" maxLength={255} value={name} disabled={busy || accepted.current} onChange={event => setName(event.target.value)} /></label>
      {projectId && <p>复制全部有效图片，后续修改与资产库独立保存。</p>}
      {error && <Alert type="error" message={error} action={projectId && !accepted.current && <Button onClick={() => setRetry(value => value + 1)}>重试读取</Button>} />}
      {projectId ? <>
        <Input.Search aria-label="搜索来源资产" placeholder="搜索资产库" onSearch={setQuery} disabled={busy || accepted.current} />
        <Select aria-label="来源资产" loading={loading} disabled={busy || accepted.current} value={sourceId} options={sources.map(source => ({ value: source.id, label: source.name }))}
          onChange={value => { setSourceId(value); setName(sources.find(source => source.id === value)?.name ?? '') }} />
        <div className="resource-reference-grid">{pictures.map(picture => <Image key={picture.id} src={buildFileDownloadUrl(picture.file_id!)} alt={`来源图片 ${picture.id}`} />)}</div>
        {sourceId && !loading && !pictures.length && <p>来源没有有效图片，暂时不能导入。</p>}
      </> : <>
        <div className="resource-upload-heading"><strong>图片</strong><span>{rows.length ? `已上传 ${rows.filter(row => row.fileId).length} / ${rows.length} 张` : '至少上传一张图片'}</span></div>
        <Upload.Dragger multiple accept="image/*" height={168} listType="picture" disabled={busy || accepted.current}
          fileList={rows.map(row => ({ uid: row.id, name: row.file.name, type: row.file.type, status: row.uploading ? 'uploading' : row.error ? 'error' : 'done', url: row.fileId ? buildFileDownloadUrl(row.fileId) : undefined, originFileObj: row.file as UploadFile['originFileObj'], error: row.error ? new Error(row.error) : undefined }))}
          showUploadList={{ showRemoveIcon: false }} onPreview={file => { if (file.url) setPreview(file.url) }}
          itemRender={(node, file) => {
            const index = rows.findIndex(row => row.id === file.uid), row = rows[index]
            if (!row) return node
            return <div className="resource-upload-item">{node}<div className="resource-upload-item-controls">
              {index === 0 && <Tag>主图</Tag>}
              <label>视角<Select aria-label={`图片${index + 1}视角`} value={row.angle} options={views} disabled={busy || accepted.current} onChange={angle => setRows(current => current.map(item => item.id === row.id ? { ...item, angle } : item))} /></label>
              {row.error && <Button size="small" disabled={busy || accepted.current} onClick={() => void upload(row)}>重试上传</Button>}
              <Button type="text" size="small" disabled={busy || row.uploading || accepted.current} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>移除</Button>
            </div></div>
          }} beforeUpload={file => {
          if (!file.type.startsWith('image/')) { void message.error('仅支持上传图片文件'); return Upload.LIST_IGNORE }
          const row: UploadRow = { id: crypto.randomUUID(), file, angle: 'FRONT', uploading: true }
          setRows(current => [...current, row]); void upload(row); return false
        }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击选择或将图片拖到这里</p>
          <p className="ant-upload-hint">支持多张图片，上传后可逐张选择视角</p>
        </Upload.Dragger>
        <p className="resource-upload-hint">列表首张图片作为主图；创建后可继续管理图片和补充详情。</p>
        <Image wrapperStyle={{ display: 'none' }} src={preview} preview={{ visible: !!preview, onVisibleChange: visible => { if (!visible) setPreview(undefined) } }} />
      </>}
    </div>
  </ResourceEditorFrame>
    <AssetDetailLeaveGuard navigationManaged={host.managed} dirty={dirty} busy={busy || uploading} detecting={false} canCancelDetection={false} cancellingDetection={false} partialSave={false}
      closeRequested={closeRequested} onContinue={() => setCloseRequested(false)} onClose={onClose} save={save} cancelDetection={async () => true} />
  </>
}
