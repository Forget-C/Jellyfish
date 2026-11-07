import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Modal, Pagination, Space } from 'antd'
import { PictureOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { ApiError, StudioFilesService } from '../../../services/generated'
import type { AudioContentCard, FileRead, ImageContentCard, VideoContentCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import './imageContentEditor.css'

export type MediaCard = ImageContentCard | VideoContentCard | AudioContentCard
export type MediaContentEditorProps = {
  card: MediaCard
  projectId: string
  onChange: (card: MediaCard) => void
  disabled?: boolean
  initialLibrary?: boolean
}

/** 固定文件的原生预览保留视频音轨，音频不走图片兜底。 */
export function MediaPreview({ fileId, type, onDuration }: { fileId: string; type: string; onDuration?: (seconds: number) => void }) {
  const src = buildFileDownloadUrl(fileId)
  if (type === 'audio') return <audio aria-label="音频预览" src={src} controls onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) onDuration?.(event.currentTarget.duration) }} preload="metadata" style={{ width: '100%' }} />
  if (type === 'video') return <video aria-label="视频预览" src={src} controls playsInline onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) onDuration?.(event.currentTarget.duration) }} preload="metadata" style={{ width: '100%', maxHeight: 260 }} />
  return <img alt="图片预览" src={src} style={{ maxWidth: '100%', maxHeight: 260 }} />
}

/** 上传与画布保存分别提交；回调只更新原卡，调用方须按现有 ID 合并编辑。 */
export function MediaContentEditor({ card, projectId, onChange, disabled, initialLibrary = false }: MediaContentEditorProps) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [library, setLibrary] = useState(initialLibrary)
  const [files, setFiles] = useState<FileRead[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [releasing, setReleasing] = useState<string>()
  const [uploading, setUploading] = useState(false)
  const [fileInfo, setFileInfo] = useState<FileRead>()
  const [readingFile, setReadingFile] = useState(false)
  const [imageSize, setImageSize] = useState<{ id: string; width: number; height: number }>()
  const [imageState, setImageState] = useState<{ id: string; state: 'loaded' | 'failed' }>()
  const latest = useRef({ card, onChange })
  latest.current = { card, onChange }
  const operation = useRef(0)
  const libraryRequest = useRef(0)
  const type = card.type?.split('.')[1] || 'image'
  useEffect(() => () => { operation.current++; libraryRequest.current++ }, [projectId, card.id])

  // Read current file identity through the existing API; dimensions come from the loaded image.
  useEffect(() => {
    if (type !== 'image' || !card.file_id) return
    let active = true
    setReadingFile(true)
    StudioFilesService.getFileDetailApiV1StudioFilesFileIdGet({ fileId: card.file_id })
      .then(response => { if (active) setFileInfo(response.data || undefined) })
      .catch(() => { if (active) setFileInfo(undefined) })
      .finally(() => { if (active) setReadingFile(false) })
    return () => { active = false }
  }, [type, card.file_id])

  const upload = async (file: File) => {
    if (disabled || uploading) return
    if (type === 'image' && file.type && !file.type.startsWith('image/')) { setError('仅支持上传图片文件'); return }
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
    const requestCounter = libraryRequest
    const token = ++requestCounter.current
    setLoading(true); setError('')
    StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId, page, pageSize: 20, isDesc: true })
      .then(response => {
        if (token !== libraryRequest.current) return
        setFiles(response.data?.items || []); setTotal(response.data?.pagination.total || 0)
      }).catch(() => { if (token === libraryRequest.current) setError('项目文件读取失败，请重试') })
      .finally(() => { if (token === libraryRequest.current) setLoading(false) })
    return () => { requestCounter.current++ }
  }, [library, page, projectId, refresh])

  const actions = <Dropdown trigger={['click']} menu={{ items: [{ key: 'upload', label: card.file_id ? '替换文件' : '上传文件' }, { key: 'library', label: '从项目文件选择' }],
    onClick: ({ key }) => { if (key === 'upload') input.current?.click(); else { setPage(1); setLibrary(true) } } }} disabled={disabled || uploading}>
    <WorkbenchIconButton label="添加媒体" icon={<PlusOutlined />} disabled={disabled || uploading} />
  </Dropdown>
  const openLibrary = () => { setPage(1); setLibrary(true) }
  const imageActions = (empty = false) => <div className="generation-image-actions">
    <WorkbenchButton icon={<UploadOutlined />} disabled={disabled || uploading} loading={uploading} onClick={() => input.current?.click()}>{empty ? '上传图片' : '替换图片'}</WorkbenchButton>
    <WorkbenchButton variant="quiet" icon={<PlusOutlined />} disabled={disabled || uploading} onClick={openLibrary}>{empty ? '从素材中选择' : '选择素材'}</WorkbenchButton>
  </div>
  const currentInfo = fileInfo?.id === card.file_id ? fileInfo : undefined
  const currentSize = imageSize?.id === card.file_id ? imageSize : undefined
  const currentImage = imageState?.id === card.file_id ? imageState?.state : undefined
  return <Space direction="vertical" style={{ width: '100%' }}>
    {type === 'image' ? <section className="generation-image-content" data-empty={!card.file_id} data-portrait={!!currentSize && currentSize.height > currentSize.width} aria-label="图片内容编辑">
      <div className="generation-image-preview">
        {card.file_id ? <>
          <img alt="图片预览" src={buildFileDownloadUrl(card.file_id)} onLoad={event => {
            const image = event.currentTarget
            setImageSize({ id: card.file_id!, width: image.naturalWidth, height: image.naturalHeight })
            setImageState({ id: card.file_id!, state: 'loaded' })
          }} onError={() => setImageState({ id: card.file_id!, state: 'failed' })} />
          {!currentImage && <small role="status">图片加载中</small>}
          {currentImage === 'failed' && <small role="status">图片暂不可预览，文件仍保留</small>}
        </> : <div className="generation-image-empty"><PictureOutlined aria-hidden /><strong>添加一张图片</strong>{imageActions(true)}{disabled && <small>只读，无法上传或替换图片</small>}</div>}
      </div>
      {card.file_id && <div className="generation-image-file-info">
        <strong title={currentInfo?.name}>{currentInfo?.name || (card.file_id ? readingFile ? '读取文件信息…' : '文件信息不可用' : '尚未选择图片')}</strong>
        {card.file_id && <dl>
          <dt>尺寸</dt><dd>{currentSize?.width && currentSize.height ? `${currentSize.width} × ${currentSize.height}` : '未知'}</dd>
          <dt>类型</dt><dd>图片</dd>
          <dt>来源</dt><dd>{card.origin ? '运行成果副本' : '项目文件'}</dd>
        </dl>}
        {card.origin && <small>来自运行 {card.origin.run_id} · {card.origin.incomplete ? '未完成成果副本' : '完整成果副本'}</small>}
        {imageActions()}
        {disabled && <small>只读，无法上传或替换图片</small>}
      </div>}
    </section> : <>
      {card.origin && <p>来自运行 {card.origin.run_id} · {card.origin.incomplete ? '未完成成果副本' : '完整成果副本'}</p>}
      {card.file_id ? <MediaPreview fileId={card.file_id} type={type} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择文件" />}
      {actions}
    </>}
    {error && <Alert type="error" message={error} />}
    {(uploading || card.uploading) && <Alert type="info" message={uploading ? '上传中，暂不发布有效输出' : '上次上传未完成，请重新上传或从项目文件选择'} />}
    <input ref={input} hidden aria-label="上传媒体文件" type="file" accept={`${type}/*`} disabled={disabled}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
    <Modal title="项目文件库" open={library} onCancel={() => setLibrary(false)} footer={null} destroyOnClose>
      {error && <Alert type="error" message={error} />}
      <Button loading={loading} onClick={() => setRefresh(value => value + 1)}>刷新项目文件</Button>
      {files.filter(file => file.type === type).map(file => <div key={file.id} style={{ marginBottom: 16 }}>
        <MediaPreview fileId={file.id} type={type} />
        <Space wrap>
          <span>{file.name}</span>
          <Button disabled={disabled || uploading} onClick={() => {
            latest.current.onChange({ ...latest.current.card, file_id: file.id, uploading: false }); setLibrary(false)
          }}>选用 {file.name}</Button>
          <Button danger loading={releasing === file.id} disabled={loading || disabled || !!releasing} onClick={async () => {
            setReleasing(file.id); setError('')
            try {
              await StudioFilesService.releaseUploadRetention({ fileId: file.id, projectId })
              setFiles(previous => previous.filter(item => item.id !== file.id))
            } catch (reason) {
              setError(reason instanceof ApiError && reason.status < 500
                ? reason.body?.message || '无法释放上传保留：请先移除该文件的其他使用关系'
                : '清理结果未确认，请刷新项目文件核实后重试')
            } finally { setReleasing(undefined) }
          }}>释放上传保留</Button>
        </Space>
      </div>)}
      {!loading && !files.some(file => file.type === type) && <Empty description="本页没有匹配类型的文件" />}
      <Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={setPage} disabled={loading} />
    </Modal>
  </Space>
}
