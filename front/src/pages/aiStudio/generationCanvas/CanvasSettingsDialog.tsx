import { useUiText } from '../../../uiText'
import { useEffect, useRef, useState } from 'react'
import { Alert, Input } from 'antd'
import { FolderOpenOutlined, PictureOutlined, UploadOutlined } from '@ant-design/icons'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { StudioFilesService, type CanvasDocument } from '../../../services/generated'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { FileLibraryImagePicker } from '../assets/components/FileLibraryImagePicker'
import { buildFileDownloadUrl } from '../assets/utils'
import type { CanvasSettingsChanges } from './useGenerationCanvasEditor'

/** 编辑弹窗内的草稿，确认后通过现有画布保存队列一起提交。 */
export function CanvasSettingsDialog({ document, recoveredDraft, blocked, pending, disabled, editorError, onSave, onClose }: {
  document: CanvasDocument
  recoveredDraft?: CanvasSettingsChanges
  blocked: boolean
  pending: boolean
  disabled: boolean
  editorError: string
  onSave: (changes: CanvasSettingsChanges) => Promise<boolean>
  onClose: () => void
}) {
  const uiText = useUiText()
  const [initial] = useState({ name: document.name, cover: document.cover_file_id ?? null })
  const [name, setName] = useState(recoveredDraft?.name ?? initial.name)
  const [cover, setCover] = useState<File | string | null | undefined>(recoveredDraft?.cover_file_id)
  const [localPreview, setLocalPreview] = useState<string>()
  const [failedSource, setFailedSource] = useState<string>()
  const [library, setLibrary] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const libraryTrigger = useRef<HTMLButtonElement>(null)
  const uploaded = useRef<{ file: File; id: string }>()
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const localFile = cover instanceof File ? cover : undefined

  useEffect(() => {
    if (!localFile) return
    const url = URL.createObjectURL(localFile)
    setLocalPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [localFile])

  const fileId = cover === undefined ? document.cover_file_id : typeof cover === 'string' ? cover : undefined
  const source = localFile ? localPreview : buildFileDownloadUrl(fileId)
  const dirty = name !== initial.name || (cover !== undefined && cover !== initial.cover)
  const inputsDisabled = busy || disabled || pending
  const chooseCover = (choice: File | string | null | undefined) => {
    if (uploaded.current?.file !== choice) uploaded.current = undefined
    setCover(choice)
    setError('')
    setSaveFailed(false)
  }
  const returnFromLibrary = () => {
    setLibrary(false)
    requestAnimationFrame(() => libraryTrigger.current?.focus())
  }
  const close = () => {
    if (busy || pending) return
    if (library) returnFromLibrary()
    else onClose()
  }

  const save = async () => {
    if (busy || disabled || blocked || (!pending && (!dirty || !name.trim()))) return
    setBusy(true)
    setError('')
    setSaveFailed(false)
    try {
      const changes: CanvasSettingsChanges = {}
      if (!pending) {
        if (name !== initial.name) changes.name = name
        if (localFile) {
          if (uploaded.current?.file !== localFile) {
            const { data } = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({
              formData: { file: localFile as unknown as string },
            })
            if (!mounted.current) return
            if (data?.type !== 'image' || !data.id) throw new Error(uiText("未能确认封面图片上传"))
            uploaded.current = { file: localFile, id: data.id }
          }
          changes.cover_file_id = uploaded.current.id
        } else if (cover === null || typeof cover === 'string') changes.cover_file_id = cover
      }
      if (await onSave(changes)) {
        if (mounted.current) onClose()
      } else if (mounted.current) setSaveFailed(true)
    } catch (cause) {
      if (mounted.current) setError(apiErrorMessage(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return <WorkbenchModal title={library ? uiText("从文件管理选择图片") : uiText("画布设置")} open={!blocked} width={480}
    centered rootClassName="canvas-settings-dialog"
    onCancel={close} closable={!busy && !pending} keyboard={!busy && !pending} maskClosable={false}
    footer={library
      ? <WorkbenchDialogActions secondary={<Button variant="quiet" onClick={returnFromLibrary}>{uiText("返回设置")}</Button>}>{null}</WorkbenchDialogActions>
      : <WorkbenchDialogActions secondary={<Button variant="quiet" disabled={busy || pending} onClick={close}>{uiText("取消")}</Button>}>
        <Button form="canvas-settings-form" htmlType="submit" variant="primary" loading={busy}
          disabled={disabled || (!pending && (!dirty || !name.trim()))}>{pending ? uiText("核实保存结果") : uiText("保存设置")}</Button>
      </WorkbenchDialogActions>}>
    {library ? <FileLibraryImagePicker autoFocus disabled={inputsDisabled} onSelect={id => {
      chooseCover(id)
      returnFromLibrary()
    }} /> : <form id="canvas-settings-form" className="canvas-settings-form"
      onSubmit={event => { event.preventDefault(); void save() }}>
      {(error || saveFailed) && <Alert type="error" showIcon
        message={error || editorError || uiText("当前无法保存设置，请核对画布编辑状态后重试。")} />}
      {pending && <Alert type="warning" showIcon message={uiText("保存结果待核实，请重试以确认原请求。")} />}
      <label className="canvas-settings-field">
        <span>{uiText("画布名称")}</span>
        <Input value={name} maxLength={255} disabled={inputsDisabled} required onChange={event => setName(event.target.value)} />
      </label>
      <section className="canvas-settings-field" aria-label={uiText("画布封面")}>
        <span>{uiText("画布封面")}</span>
        <div className="canvas-settings-cover">
          <div className="canvas-settings-preview">
            {source && source !== failedSource ? <img src={source} alt={uiText("画布封面预览")} onError={() => setFailedSource(source)} />
              : <span><PictureOutlined aria-hidden />{uiText("默认封面")}</span>}
          </div>
          <div className="canvas-settings-cover-actions">
            <Button icon={<UploadOutlined />} disabled={inputsDisabled} onClick={() => upload.current?.click()}>{uiText("上传图片")}</Button>
            <Button ref={libraryTrigger} icon={<FolderOpenOutlined />} disabled={inputsDisabled} onClick={() => setLibrary(true)}>{uiText("从文件管理选择")}</Button>
            {(localFile || fileId) && <Button variant="quiet" disabled={inputsDisabled}
              onClick={() => chooseCover(document.cover_file_id ? null : undefined)}>{uiText("恢复默认")}</Button>}
          </div>
        </div>
        <input ref={upload} type="file" hidden accept=".jpg,.jpeg,.png,.webp,.gif" aria-label={uiText("上传画布封面")} disabled={inputsDisabled}
          onChange={event => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name) || (file.type && !file.type.startsWith('image/'))) {
              setError(uiText("请选择 JPG、PNG、WebP 或 GIF 图片"))
              return
            }
            chooseCover(file)
          }} />
      </section>
    </form>}
  </WorkbenchModal>
}
