import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Modal, Pagination, Space } from 'antd'
import { StudioFilesService } from '../../../services/generated'
import type { AudioContentCard, FileRead, ImageContentCard, VideoContentCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'

export type MediaCard = ImageContentCard | VideoContentCard | AudioContentCard
export type MediaContentEditorProps = {
  card: MediaCard
  projectId: string
  onChange: (card: MediaCard) => void
  disabled?: boolean
}

/** 固定文件的原生预览保留视频音轨，音频不走图片兜底。 */
export function MediaPreview({ fileId, type }: { fileId: string; type: string }) {
  const src = buildFileDownloadUrl(fileId)
  if (type === 'audio') return <audio aria-label="音频预览" src={src} controls preload="metadata" style={{ width: '100%' }} />
  if (type === 'video') return <video aria-label="视频预览" src={src} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 260 }} />
  return <img alt="图片预览" src={src} style={{ maxWidth: '100%', maxHeight: 260 }} />
}

/** 上传与画布保存分别提交；回调只更新原卡，调用方须按现有 ID 合并编辑。 */
export function MediaContentEditor({ card, projectId, onChange, disabled }: MediaContentEditorProps) {
  const [error, setError] = useState('')
  const [library, setLibrary] = useState(false)
  const [files, setFiles] = useState<FileRead[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const latest = useRef({ card, onChange })
  latest.current = { card, onChange }
  const operation = useRef(0)
  const libraryRequest = useRef(0)
  const type = card.type?.split('.')[1] || 'image'
  useEffect(() => () => { operation.current++; libraryRequest.current++ }, [projectId, card.id])

  const upload = async (file: File) => {
    const token = ++operation.current
    setError(''); setUploading(true)
    latest.current.onChange({ ...latest.current.card, uploading: true })
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: {
        file: file as unknown as string, project_id: projectId, usage_kind: 'generation_upload',
      } })
      if (!response.data || response.data.type !== type) throw new Error('文件类型不匹配')
      if (token === operation.current) {
        latest.current.onChange({ ...latest.current.card, file_id: response.data.id, uploading: false })
      }
    } catch {
      if (token === operation.current) {
        latest.current.onChange({ ...latest.current.card, uploading: false })
        setError('上传失败，原文件已保留。请选择文件重试。')
      }
    } finally { if (token === operation.current) setUploading(false) }
  }

  useEffect(() => {
    if (!library) return
    const token = ++libraryRequest.current
    setLoading(true); setError('')
    StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId, page, pageSize: 20, isDesc: true })
      .then(response => {
        if (token !== libraryRequest.current) return
        setFiles(response.data?.items || []); setTotal(response.data?.pagination.total || 0)
      }).catch(() => { if (token === libraryRequest.current) setError('项目文件读取失败，请重试') })
      .finally(() => { if (token === libraryRequest.current) setLoading(false) })
    return () => { libraryRequest.current++ }
  }, [library, page, projectId])

  return <Space direction="vertical" style={{ width: '100%' }}>
    {card.origin && <p>来自运行 {card.origin.run_id} · {card.origin.incomplete ? '未完成成果副本' : '完整成果副本'}</p>}
    {card.file_id ? <MediaPreview fileId={card.file_id} type={type} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择文件" />}
    {error && <Alert type="error" message={error} />}
    {(uploading || card.uploading) && <Alert type="info" message={uploading ? '上传中，暂不发布有效输出' : '上次上传未完成，请重新上传或从项目文件选择'} />}
    <Space wrap>
      <label>
        <span>{card.file_id ? '替换文件' : '上传文件'}</span>
        <input aria-label="上传媒体文件" type="file" accept={`${type}/*`} disabled={disabled}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
      </label>
      <Button disabled={disabled || uploading} onClick={() => { setPage(1); setLibrary(true) }}>从项目文件选择</Button>
    </Space>
    <Modal title="项目文件库" open={library} onCancel={() => setLibrary(false)} footer={null} destroyOnClose>
      {files.filter(file => file.type === type).map(file => <div key={file.id} style={{ marginBottom: 16 }}>
        <MediaPreview fileId={file.id} type={type} />
        <Space wrap>
          <span>{file.name}</span>
          <Button disabled={disabled || uploading} onClick={() => {
            latest.current.onChange({ ...latest.current.card, file_id: file.id, uploading: false }); setLibrary(false)
          }}>选用 {file.name}</Button>
          <Button danger disabled={loading || disabled} onClick={async () => {
            try {
              await StudioFilesService.releaseUploadRetention({ fileId: file.id, projectId })
              setFiles(previous => previous.filter(item => item.id !== file.id))
            } catch { setError('无法释放上传保留：请先移除该文件的其他使用关系') }
          }}>释放上传保留</Button>
        </Space>
      </div>)}
      {!loading && !files.some(file => file.type === type) && <Empty description="本页没有匹配类型的文件" />}
      <Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={setPage} disabled={loading} />
    </Modal>
  </Space>
}
