import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Image, Input, Popover, Select, Upload } from 'antd'
import { FileAddOutlined, ImportOutlined, UploadOutlined } from '@ant-design/icons'
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
  return <><ResourceEditorFrame id={id} open drawer title={projectId ? '从资产库导入' : '上传图片创建'} backLabel="返回" onClose={close}
    actions={<Button aria-label={accepted.current ? '重试刷新' : projectId ? '导入' : '创建'} type="primary" loading={busy} disabled={uploading || loading} onClick={async () => { if (await save()) onClose() }}>{accepted.current ? '重试刷新' : projectId ? '导入' : '创建'}</Button>}>
    <div className="resource-editor-fields">
      <label>名称<Input aria-label="名称" maxLength={255} value={name} disabled={busy || accepted.current} onChange={event => setName(event.target.value)} /></label>
      <p>{projectId ? '复制全部有效图片，后续修改与资产库独立保存。' : '基础设定保留展示但不可编辑，创建后可继续生成和管理图片。'}</p>
      {error && <Alert type="error" message={error} action={projectId && !accepted.current && <Button onClick={() => setRetry(value => value + 1)}>重试读取</Button>} />}
      {projectId ? <>
        <Input.Search aria-label="搜索来源资产" placeholder="搜索资产库" onSearch={setQuery} disabled={busy || accepted.current} />
        <Select aria-label="来源资产" loading={loading} disabled={busy || accepted.current} value={sourceId} options={sources.map(source => ({ value: source.id, label: source.name }))}
          onChange={value => { setSourceId(value); setName(sources.find(source => source.id === value)?.name ?? '') }} />
        <div className="resource-reference-grid">{pictures.map(picture => <Image key={picture.id} src={buildFileDownloadUrl(picture.file_id!)} alt={`来源图片 ${picture.id}`} />)}</div>
        {sourceId && !loading && !pictures.length && <p>来源没有有效图片，暂时不能导入。</p>}
      </> : <>
        <Upload multiple accept="image/*" showUploadList={false} disabled={busy || accepted.current} beforeUpload={file => {
          const row: UploadRow = { id: crypto.randomUUID(), file, angle: 'FRONT', uploading: true }
          setRows(current => [...current, row]); void upload(row); return false
        }}><Button icon={<UploadOutlined />}>添加图片</Button></Upload>
        {rows.map((row, index) => <div key={row.id} className="resource-upload-row">
          {row.fileId && <Image width={80} height={80} src={buildFileDownloadUrl(row.fileId)} alt={row.file.name} />}
          <span>{index === 0 ? '主图 · ' : ''}{row.file.name}{row.uploading ? ' · 上传中' : ''}</span>
          <Select aria-label={`图片${index + 1}视角`} value={row.angle} options={views} disabled={busy || accepted.current} onChange={angle => setRows(current => current.map(item => item.id === row.id ? { ...item, angle } : item))} />
          {row.error && <><Alert type="error" message={row.error} /><Button onClick={() => void upload(row)}>重试上传</Button></>}
          <Button disabled={busy || row.uploading || accepted.current} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>移除</Button>
        </div>)}
      </>}
    </div>
  </ResourceEditorFrame>
    <AssetDetailLeaveGuard navigationManaged={host.managed} dirty={dirty} busy={busy || uploading} detecting={false} canCancelDetection={false} cancellingDetection={false} partialSave={false}
      closeRequested={closeRequested} onContinue={() => setCloseRequested(false)} onClose={onClose} save={save} cancelDetection={async () => true} />
  </>
}
