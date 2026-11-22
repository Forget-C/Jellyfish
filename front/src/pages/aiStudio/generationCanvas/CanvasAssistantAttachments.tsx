import { useEffect, useRef, useState } from 'react'
import { CloseOutlined, FolderOpenOutlined, PaperClipOutlined } from '@ant-design/icons'
import { Alert, Empty, Input, Pagination, Select, Spin } from 'antd'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { StudioFilesService } from '../../../services/generated'
import type { CanvasAssistantAttachment, FileRead } from '../../../services/generated'
import { useUiText } from '../../../uiText'
import { buildFileDownloadUrl } from '../assets/utils'

const attachmentLimit = 4
const pageSize = 12

/** Add existing file identities to the pending message. */
export function CanvasAssistantAttachments({ projectId, files, onChange, disabled, uploading, setUploading }: {
  projectId: string
  files: FileRead[]
  onChange: (files: FileRead[]) => void
  disabled: boolean
  uploading: boolean
  setUploading: (uploading: boolean) => void
}) {
  const uiText = useUiText()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [fileType, setFileType] = useState<'image' | 'video'>('image')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<{ rows: FileRead[], total: number }>()
  const unavailable = disabled || uploading || files.length >= attachmentLimit

  useEffect(() => {
    if (!libraryOpen) return
    let active = true
    setResult(undefined)
    setFailed(false)
    const request = StudioFilesService.listFilesApiApiV1StudioFilesGet({
      projectId: projectId || undefined, fileType, q: query || undefined, page, pageSize,
      order: 'updated_at', isDesc: true,
    })
    void request.then(({ data }) => {
      if (!data) throw new Error('missing file list')
      if (active) setResult({ rows: data.items, total: data.pagination.total })
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; request.cancel() }
  }, [fileType, libraryOpen, page, projectId, query, retry])

  const add = (file: FileRead) => {
    if (!files.some(entry => entry.id === file.id)) onChange([...files, file])
  }
  const upload = async (file: File) => {
    if (unavailable) return
    setError(false)
    setUploading(true)
    try {
      const { data } = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: {
        file: file as unknown as string, project_id: projectId || undefined,
        usage_kind: projectId ? 'generation_upload' : undefined,
      } })
      if (!data || (data.type !== 'image' && data.type !== 'video')) throw new Error('invalid reference')
      add(data)
    } catch {
      setError(true)
    } finally {
      setUploading(false)
    }
  }

  const remove = (id: string) => onChange(files.filter(file => file.id !== id))
  return <div className="canvas-assistant-reference-actions">
    <input ref={input} hidden type="file" accept="image/*,video/*" aria-label={uiText("上传对话参考素材")}
      disabled={unavailable} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void upload(file)
      }} />
    <div className="canvas-assistant-reference-toolbar">
      <WorkbenchButton variant="quiet" icon={<PaperClipOutlined />} loading={uploading} disabled={unavailable}
        onClick={() => input.current?.click()}>{uiText("上传素材")}</WorkbenchButton>
      <WorkbenchButton variant="quiet" icon={<FolderOpenOutlined />} disabled={unavailable}
        onClick={() => { setPage(1); setLibraryOpen(true) }}>{uiText("选择参考素材")}</WorkbenchButton>
    </div>
    {files.length > 0 && <ul className="canvas-assistant-reference-list">
      {files.map(file => <li key={file.id}>
        <span title={file.name}>{file.name}</span>
        <WorkbenchIconButton label={uiText("移除") + ' ' + file.name} icon={<CloseOutlined />} variant="quiet"
          disabled={disabled || uploading} onClick={() => remove(file.id)} />
      </li>)}
    </ul>}
    {files.length >= attachmentLimit && <small>{uiText("每条消息最多添加 4 份参考素材")}</small>}
    {error && <Alert type="error" message={uiText("参考素材上传失败，请选择图片或视频后重试")} />}
    <WorkbenchModal title={uiText("选择对话参考素材")} open={libraryOpen} width={520}
      onCancel={() => setLibraryOpen(false)} footer={null}>
      <div className="canvas-assistant-reference-toolbar">
        <Select value={fileType} aria-label={uiText("素材类型")} onChange={value => { setFileType(value); setPage(1) }}
          options={[{ value: 'image', label: uiText("图片") }, { value: 'video', label: uiText("视频") }]} />
        <Input.Search aria-label={uiText("搜索素材")} placeholder={uiText("搜索素材")} onSearch={value => {
          setQuery(value.trim()); setPage(1)
        }} />
      </div>
      {failed ? <Alert type="error" message={uiText("无法读取参考素材")}
        action={<WorkbenchButton onClick={() => setRetry(value => value + 1)}>{uiText("重试")}</WorkbenchButton>} />
        : !result ? <Spin aria-label={uiText("正在读取参考素材")} /> : result.rows.length === 0
          ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("暂无匹配素材")} />
          : <ul className="canvas-assistant-reference-list">
            {result.rows.map(file => <li key={file.id}>
              <WorkbenchButton disabled={unavailable || files.some(entry => entry.id === file.id)}
                onClick={() => { add(file); setLibraryOpen(false) }}>{file.name}</WorkbenchButton>
            </li>)}
          </ul>}
      {result && result.total > pageSize && <Pagination current={page} pageSize={pageSize} total={result.total}
        showSizeChanger={false} onChange={setPage} />}
    </WorkbenchModal>
  </div>
}

/** Display the attachment and the actual evidence accompanying a completed turn. */
export function CanvasAssistantEvidence({ attachments }: { attachments: CanvasAssistantAttachment[] }) {
  const uiText = useUiText()
  return <ol className="canvas-assistant-reference-list" aria-label={uiText("对话参考素材")}>
    {attachments.map(attachment => <li key={attachment.file_id}>
      {attachment.name
        ? <a href={buildFileDownloadUrl(attachment.file_id)}>{attachment.name}</a>
        : <span>{uiText("素材不可用")}</span>}
      <small>{attachment.observation === 'image' ? uiText("已读取图片")
        : attachment.observation === 'video_frame'
          ? uiText("已读取视频静帧") + ' · ' + ((attachment.at_ms ?? 0) / 1000).toFixed(3) + ' s'
          : uiText("本次未读取")}</small>
    </li>)}
  </ol>
}
