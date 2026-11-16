import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Empty, Image, Input, Pagination, Popover, Select, Skeleton, Tag, Upload, message, type UploadFile } from 'antd'
import { CheckCircleFilled, FileAddOutlined, ImportOutlined, InboxOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import { StudioEntitiesService, StudioFilesService, type ImageSourceRequest } from '../../../../services/generated'
import { ResourceEditorFrame } from './ResourceEditorFrame'
import { AssetDetailLeaveGuard } from './AssetDetailLeaveGuard'
import { useWorkspaceDraft, useWorkspaceDraftStatus } from '../../directing/WorkspaceDrafts'
import { directingError } from '../../directing/common'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'
import { readResourceImages, type ResourcePicture } from '../resourceImages'
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
type LibrarySource = { id: string; name: string; thumbnail?: string | null }
const sourcePageSize = 12
const views = [{ value: 'FRONT', label: '正面' }, { value: 'LEFT', label: '侧面' }, { value: 'TOP', label: '俯视' }, { value: 'BACK', label: '背面' }]
function ImageSourceDrawer({ kind, projectId, onClose, onCreated }: { kind: ResourceKind; projectId?: string; onClose: () => void; onCreated: () => void | Promise<unknown> }) {
  const id = useId(), requestId = useRef(crypto.randomUUID())
  const [name, setName] = useState(''), [query, setQuery] = useState('')
  const [preview, setPreview] = useState<string>()
  const [sources, setSources] = useState<LibrarySource[]>([])
  const [page, setPage] = useState(1), [total, setTotal] = useState(0)
  const [sourceName, setSourceName] = useState('')
  const [failedCovers, setFailedCovers] = useState<Record<string, string>>({})
  const [sourceId, setSourceId] = useState<string>()
  const [pictures, setPictures] = useState<ResourcePicture[]>([])
  const [rows, setRows] = useState<UploadRow[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(false), [picturesLoading, setPicturesLoading] = useState(false), [busy, setBusy] = useState(false)
  const [sourceError, setSourceError] = useState(''), [pictureError, setPictureError] = useState('')
  const [sourceRetry, setSourceRetry] = useState(0), [pictureRetry, setPictureRetry] = useState(0)
  const [error, setError] = useState(''), [closeRequested, setCloseRequested] = useState(false)
  const active = useRef(true), lock = useRef(false), accepted = useRef(false)
  const sourceKind = kind === 'character' ? 'actor' : kind
  const dirty = !accepted.current && (!!name || rows.length > 0 || !!sourceId)
  const uploading = rows.some(row => row.uploading)
  const loading = sourcesLoading || picturesLoading
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (!projectId) return
    let current = true
    setSourcesLoading(true); setSourceError('')
    void StudioEntitiesService.listEntitiesApiV1StudioEntitiesEntityTypeGet({ entityType: sourceKind, q: query, page, pageSize: sourcePageSize })
      .then(response => { if (current) { setSources((response.data?.items ?? []) as LibrarySource[]); setTotal(response.data?.pagination.total ?? 0) } })
      .catch(cause => { if (current) setSourceError(directingError(cause)) }).finally(() => { if (current) setSourcesLoading(false) })
    return () => { current = false }
  }, [projectId, sourceKind, query, page, sourceRetry])
  useEffect(() => {
    if (!sourceId) return
    let current = true
    setPicturesLoading(true); setPictures([]); setPictureError('')
    void readResourceImages(sourceKind, sourceId).then(images => { if (current) setPictures(images.filter(image => image.file_id)) })
      .catch(cause => { if (current) setPictureError(directingError(cause)) }).finally(() => { if (current) setPicturesLoading(false) })
    return () => { current = false }
  }, [sourceKind, sourceId, pictureRetry])
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
  return <><ResourceEditorFrame id={id} open drawer drawerWidth={projectId ? 720 : 600} title={projectId ? '从资产库导入' : '上传图片创建'} backLabel="返回" onClose={close}
    actions={<Button aria-label={accepted.current ? '重试刷新' : projectId ? '导入' : '创建'} type="primary" loading={busy} disabled={uploading || loading || !accepted.current && (!name.trim() || (projectId ? !sourceId || !pictures.length || !!pictureError : !rows.length || rows.some(row => !row.fileId)))} onClick={async () => { if (await save()) onClose() }}>{accepted.current ? '重试刷新' : projectId ? '导入' : '创建'}</Button>}>
    <div className={`resource-editor-fields ${projectId ? 'resource-import-form' : 'resource-upload-form'}`}>
      {!projectId && <label>名称<Input aria-label="名称" maxLength={255} value={name} disabled={busy || accepted.current} onChange={event => setName(event.target.value)} /></label>}
      {projectId && <p>复制全部有效图片，后续修改与资产库独立保存。</p>}
      {error && <Alert type="error" message={error} />}
      {projectId ? <>
        <Input.Search aria-label="搜索来源资产" placeholder="搜索资产名称或描述" allowClear onSearch={value => { setQuery(value.trim()); setPage(1) }} onChange={event => { if (!event.target.value) { setQuery(''); setPage(1) } }} disabled={busy || accepted.current} />
        <div className="resource-upload-heading"><strong>选择来源资产</strong><span>{sourcesLoading ? '正在读取…' : `共 ${total} 项`}</span></div>
        {sourcesLoading ? <Skeleton active title={false} paragraph={{ rows: 3 }} /> : sourceError ? <Alert type="error" message={sourceError} action={<Button onClick={() => setSourceRetry(value => value + 1)}>重试来源</Button>} /> : sources.length ? <>
          <div className="resource-import-grid" role="group" aria-label="资产库图片选择">{sources.map(source => {
            const cover = resolveAssetUrl(source.thumbnail)
            return <button key={source.id} type="button" aria-label={`选择${source.name}`} aria-pressed={sourceId === source.id} disabled={busy || accepted.current} onClick={() => {
              if (sourceId === source.id) return
              setPictures([]); setPicturesLoading(true); setPictureError(''); setError('')
              setSourceId(source.id); setSourceName(source.name); setName(source.name)
            }}>
              <span className={`resource-import-cover${sourceKind === 'scene' ? ' resource-import-cover-scene' : ''}`}>{cover && failedCovers[source.id] !== cover ? <img src={cover} alt="" loading="lazy" onError={() => setFailedCovers(current => ({ ...current, [source.id]: cover }))} /> : <span><PictureOutlined aria-hidden />{cover ? '封面加载失败' : '暂无封面'}</span>}</span>
              <span className="resource-import-name" title={source.name}>{source.name}</span>
              {sourceId === source.id && <CheckCircleFilled className="resource-import-selected" aria-hidden />}
            </button>
          })}</div>
          {total > sourcePageSize && <Pagination size="small" showLessItems current={page} pageSize={sourcePageSize} total={total} showSizeChanger={false} onChange={setPage} disabled={busy || accepted.current} />}
        </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? '未找到匹配的资产' : '资产库暂无可导入资产'} />}
        {sourceId && <section className="resource-import-selection">
          <strong>已选来源：{sourceName}</strong>
          <label>名称<Input aria-label="名称" maxLength={255} value={name} disabled={busy || accepted.current} onChange={event => setName(event.target.value)} /></label>
          <span className="resource-upload-hint">将导入全部有效图片{!picturesLoading && !pictureError && `（${pictures.length} 张）`}</span>
          {picturesLoading ? <Skeleton active title={false} paragraph={{ rows: 2 }} /> : pictureError ? <Alert type="error" message={pictureError} action={<Button onClick={() => setPictureRetry(value => value + 1)}>重试图片</Button>} /> : pictures.length ? <Image.PreviewGroup><div className="resource-import-pictures">{pictures.map(picture => <figure key={picture.id}>
            <Image loading="lazy" src={buildFileDownloadUrl(picture.file_id!)} alt={`来源图片 ${picture.id}`} />
            <figcaption>{views.find(view => view.value === picture.view_angle)?.label ?? picture.view_angle ?? '图片'}{picture.is_primary ? ' · 主图' : ''}</figcaption>
          </figure>)}</div></Image.PreviewGroup> : <p>来源没有有效图片，暂时不能导入。</p>}
        </section>}
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
