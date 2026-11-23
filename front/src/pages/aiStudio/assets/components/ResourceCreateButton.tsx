import { useUiText } from '../../../../uiText'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, ConfigProvider, Image, Input, Popover, Select, Tag, Upload, message, type UploadFile } from 'antd'
import { FileAddOutlined, ImportOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons'
import { StudioEntitiesService, StudioFilesService, type ImageSourceRequest } from '../../../../services/generated'
import { ResourceSelectionDrawer } from './ResourceSelectionDrawer'
import { ResourceEditorFrame } from './ResourceEditorFrame'
import { AssetDetailLeaveGuard } from './AssetDetailLeaveGuard'
import { useWorkspaceDraft, useWorkspaceDraftStatus } from '../../directing/WorkspaceDrafts'
import { apiErrorMessage } from '../../../../services/apiErrorMessage'
import { buildFileDownloadUrl } from '../utils'
import type { ResourceKind } from './ResourceEditorDrawer'
import './resourceCreate.css'

/** 选择方式不创建对象；上传与导入共用独立的抽屉会话。 */
export function ResourceCreateButton({ kind, projectId, onCreate, onCreated, onOpenUploads, children, projectUpload = false, initialName }: {
  kind: ResourceKind; projectId?: string; onCreate: () => void; onCreated: (resourceId: string) => void | Promise<unknown>; children: ReactNode; projectUpload?: boolean; initialName?: string
  onOpenUploads?: () => void
}) {
  const uiText = useUiText()
  const [choosing, setChoosing] = useState(false)
  const [imagesOpen, setImagesOpen] = useState(false)
  const trigger = useRef<HTMLSpanElement>(null)
  const choices = useRef<HTMLDivElement>(null)
  const close = () => { setImagesOpen(false); requestAnimationFrame(() => trigger.current?.querySelector('button')?.focus()) }
  return <><Popover open={choosing} trigger="click" placement="bottomRight" onOpenChange={next => { setChoosing(next); if (next) requestAnimationFrame(() => choices.current?.querySelector('button')?.focus()) }} content={<div ref={choices} className="resource-create-choices" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); setChoosing(false); trigger.current?.querySelector('button')?.focus() }
  }}>
    <button onClick={() => { setChoosing(false); onCreate() }}><FileAddOutlined aria-hidden /><strong>{uiText("填写设定")}</strong><span>{uiText("填写对象信息并创建")}</span></button>
    <button onClick={() => { setChoosing(false); if (onOpenUploads) onOpenUploads(); else setImagesOpen(true) }}>{projectId && !projectUpload ? <ImportOutlined aria-hidden /> : <UploadOutlined aria-hidden />}<strong>{projectId && !projectUpload ? uiText("从资产库导入") : uiText("上传图片")}</strong><span>{projectId && !projectUpload ? uiText("创建独立项目副本") : uiText("以图片创建资源")}</span></button>
  </div>}><span ref={trigger} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setChoosing(false); trigger.current?.querySelector('button')?.focus() } }}>{children}</span></Popover>
    {imagesOpen && projectId && !projectUpload ? <LibraryImportDrawer kind={kind} projectId={projectId} onClose={close} onCreated={onCreated} /> : imagesOpen && <ResourceImageSourceDrawer kind={kind} projectId={projectId} projectUpload={projectUpload} initialName={initialName} onClose={close} onCreated={onCreated} />}
  </>
}

const uploadFormTheme = {
  token: { fontSize: 13 },
  components: { Input: { controlHeight: 36 }, Select: { controlHeight: 36 } },
}

type UploadRow = { id: string; file: File; angle: string; fileId?: string; uploading: boolean; error?: string }
const views = [{ value: 'FRONT', label: '正面' }, { value: 'LEFT', label: '侧面' }, { value: 'TOP', label: '俯视' }, { value: 'BACK', label: '背面' }]
export function ResourceImageSourceDrawer({ kind, projectId, onClose, onCreated, projectUpload = false, initialName }: { kind: ResourceKind; projectId?: string; onClose: () => void; onCreated: (resourceId: string) => void | Promise<unknown>; projectUpload?: boolean; initialName?: string }) {
  const uiText = useUiText()
  const id = useId(), requestId = useRef(crypto.randomUUID())
  const [name, setName] = useState(initialName ?? '')
  const [preview, setPreview] = useState<string>()
  const [rows, setRows] = useState<UploadRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [closeRequested, setCloseRequested] = useState(false)
  const active = useRef(true), lock = useRef(false), accepted = useRef(false)
  const dirty = !accepted.current && (name !== (initialName ?? '') || rows.length > 0)
  const uploading = rows.some(row => row.uploading)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const upload = async (row: UploadRow) => {
    setRows(current => current.map(item => item.id === row.id ? { ...item, uploading: true, error: undefined } : item))
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: { file: row.file as unknown as string, ...(projectUpload ? { project_id: projectId, usage_kind: 'generation_upload' } : {}) } })
      if (!response.data?.id) throw new Error(uiText("上传未返回图片"))
      if (active.current) setRows(current => current.map(item => item.id === row.id ? { ...item, uploading: false, fileId: response.data!.id } : item))
    } catch (cause) { if (active.current) setRows(current => current.map(item => item.id === row.id ? { ...item, uploading: false, error: apiErrorMessage(cause) } : item)) }
  }
  const save = async () => {
    if (lock.current || uploading) return false
    if (!accepted.current && (!name.trim() || (!rows.length || rows.some(row => !row.fileId)))) { setError(uiText("请填写名称并准备至少一张有效图片；失败项须重试或移除")); return false }
    lock.current = true; setBusy(true); setError('')
    try {
      if (!accepted.current) {
        const requestBody: ImageSourceRequest = { id: requestId.current, name: name.trim(), project_id: projectId,
          images: rows.map(row => ({ file_id: row.fileId!, view_angle: row.angle })) }
        await StudioEntitiesService.createImageSourceEntityApiV1StudioEntitiesEntityTypeImageSourcePost({ entityType: kind, requestBody })
        accepted.current = true
      }
      await onCreated(requestId.current)
      return true
    } catch (cause) { setError((accepted.current ? projectUpload ? uiText("资源已创建，选用或刷新失败；重试不会重复创建。") : uiText("资源已创建，列表刷新失败；重试不会重复创建。") : '') + apiErrorMessage(cause)); return false }
    finally { lock.current = false; setBusy(false) }
  }
  const host = useWorkspaceDraftStatus()
  useWorkspaceDraft({ name: '上传资源', dirty, busy: busy || uploading, save, discard: onClose })
  const close = () => { if (dirty || busy || uploading) setCloseRequested(true); else onClose() }
  return <><ResourceEditorFrame id={id} className="resource-upload-drawer" open drawer drawerWidth={720} title={uiText("上传图片创建")} backLabel={uiText("返回")} onClose={close}
    actions={<Button aria-label={accepted.current ? projectUpload ? uiText("重试选用") : uiText("重试刷新") : uiText("创建")} type="primary" loading={busy} disabled={uploading || !accepted.current && (!name.trim() || (!rows.length || rows.some(row => !row.fileId)))} onClick={async () => { if (await save()) onClose() }}>{accepted.current ? projectUpload ? uiText("重试选用") : uiText("重试刷新") : uiText("创建")}</Button>}>
    <ConfigProvider theme={uploadFormTheme}>
      <div className="resource-editor-fields resource-upload-form">
        <label>{uiText("名称")}<Input aria-label={uiText("名称")} maxLength={255} value={name} disabled={busy || accepted.current} onChange={event => setName(event.target.value)} /></label>
        {error && <Alert type="error" message={error} />}
        <div className="resource-upload-heading"><strong>{uiText("图片")}</strong><span>{rows.length ? uiText("已上传 {{value1}} / {{value2}} 张", { value1: rows.filter(row => row.fileId).length, value2: rows.length }) : uiText("至少上传一张图片")}</span></div>
        <Upload.Dragger multiple accept="image/*" height={168} listType="picture" disabled={busy || accepted.current}
          fileList={rows.map(row => ({ uid: row.id, name: row.file.name, type: row.file.type, status: row.uploading ? 'uploading' : row.error ? 'error' : 'done', url: row.fileId ? buildFileDownloadUrl(row.fileId) : undefined, originFileObj: row.file as UploadFile['originFileObj'], error: row.error ? new Error(row.error) : undefined }))}
          showUploadList={{ showRemoveIcon: false }} onPreview={file => { if (file.url) setPreview(file.url) }}
          itemRender={(node, file) => {
            const index = rows.findIndex(row => row.id === file.uid), row = rows[index]
            if (!row) return node
            return <div className="resource-upload-item">{node}<div className="resource-upload-item-controls">
              {index === 0 && <Tag>{uiText("主图")}</Tag>}
              {projectUpload && index > 0 && <Button size="small" disabled={busy || accepted.current} onClick={() => setRows(current => [row, ...current.filter(item => item.id !== row.id)])}>{uiText("设为主图")}</Button>}
              <label>{uiText("视角")}<Select aria-label={uiText("图片{{value1}}视角", { value1: index + 1 })} value={row.angle} options={views} disabled={busy || accepted.current} onChange={angle => setRows(current => current.map(item => item.id === row.id ? { ...item, angle } : item))} /></label>
              {row.error && <Button size="small" disabled={busy || accepted.current} onClick={() => void upload(row)}>{uiText("重试上传")}</Button>}
              <Button type="text" size="small" disabled={busy || row.uploading || accepted.current} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>{uiText("移除")}</Button>
            </div></div>
          }} beforeUpload={file => {
          if (!file.type.startsWith('image/')) { void message.error(uiText("仅支持上传图片文件")); return Upload.LIST_IGNORE }
          const row: UploadRow = { id: crypto.randomUUID(), file, angle: 'FRONT', uploading: true }
          setRows(current => [...current, row]); void upload(row); return false
        }}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{uiText("点击选择或将图片拖到这里")}</p>
          <p className="ant-upload-hint">{uiText("支持多张图片，上传后可逐张选择视角")}</p>
        </Upload.Dragger>
        <p className="resource-upload-hint">{uiText("列表首张图片作为主图；创建后可继续管理图片和补充详情。")}</p>
        <Image wrapperStyle={{ display: 'none' }} src={preview} preview={{ visible: !!preview, onVisibleChange: visible => { if (!visible) setPreview(undefined) } }} />
      </div>
    </ConfigProvider>
  </ResourceEditorFrame>
    <AssetDetailLeaveGuard navigationManaged={host.managed} dirty={dirty} busy={busy || uploading} detecting={false} canCancelDetection={false} cancellingDetection={false} partialSave={false}
      closeRequested={closeRequested} onContinue={() => setCloseRequested(false)} onClose={onClose} save={save} cancelDetection={async () => true} />
  </>
}

function LibraryImportDrawer({ kind, projectId, onClose, onCreated }: { kind: ResourceKind; projectId: string; onClose: () => void; onCreated: (id: string) => void | Promise<unknown> }) {
  const importedId = useRef<string>()
  return <ResourceSelectionDrawer mode="import" kind={kind} projectId={projectId} onClose={onClose} onConfirm={async (choice, name, requestId) => {
    try {
      if (!importedId.current) {
        await StudioEntitiesService.createImageSourceEntityApiV1StudioEntitiesEntityTypeImageSourcePost({ entityType: kind,
          requestBody: { id: requestId, name, project_id: projectId, source_id: choice.id } })
        importedId.current = requestId
      }
      await onCreated(importedId.current)
      return { complete: true, created: true }
    } catch (cause) { return { complete: false, created: !!importedId.current, error: (importedId.current ? '资源已创建，列表刷新失败；重试不会重复创建。' : '') + apiErrorMessage(cause) } }
  }} />
}
