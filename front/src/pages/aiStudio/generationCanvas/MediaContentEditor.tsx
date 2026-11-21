import { useUiText } from '../../../uiText'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Empty, Modal, Pagination, Space } from 'antd'
import { PictureOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { ApiError, StudioFilesService } from '../../../services/generated'
import type { AudioContentCard, FileRead, ImageContentCard, VideoContentCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { ImageContentReader } from './ImageContentReader'

export type MediaCard = ImageContentCard | VideoContentCard | AudioContentCard
export type MediaContentEditorProps = {
  card: MediaCard
  projectId: string
  onChange: (card: MediaCard) => void
  disabled?: boolean
  initialLibrary?: boolean
}

/** 固定文件的原生预览保留视频音轨，音频不走图片兜底。 */
export function MediaPreview({ fileId, type, onDuration, onError }: { fileId: string; type: string; onDuration?: (seconds: number) => void; onError?: () => void }) {
  const uiText = useUiText()
  const src = buildFileDownloadUrl(fileId)
  if (type === 'audio') return <audio aria-label={uiText("音频预览")} src={src} controls onError={onError} onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) onDuration?.(event.currentTarget.duration) }} preload="metadata" style={{ width: '100%' }} />
  if (type === 'video') return <video aria-label={uiText("视频预览")} src={src} controls playsInline onError={onError} onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) onDuration?.(event.currentTarget.duration) }} preload="metadata" style={{ width: '100%', maxHeight: 260 }} />
  return <img alt={uiText("图片预览")} src={src} style={{ maxWidth: '100%', maxHeight: 260 }} />
}

/** 同一文件的播放器随状态刷新保留，调用方按文件身份重建以清除旧播放位置。 */
export function PlaybackContent({ fileId, type, onDuration }: { fileId: string; type: 'audio' | 'video'; onDuration?: (seconds: number | undefined) => void }) {
  const uiText = useUiText()
  const preview = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const player = preview.current?.querySelector<HTMLMediaElement>('audio, video')
    return () => player?.pause()
  }, [])
  return <div className="generation-playback-content" ref={preview}>
    {failed && <small role="status">{uiText("媒体暂不可播放")}</small>}
    <MediaPreview fileId={fileId} type={type} onDuration={seconds => { setFailed(false); onDuration?.(seconds) }}
      onError={() => { setFailed(true); onDuration?.(undefined) }} />
  </div>
}

/** 上传与画布保存分别提交；回调只更新原卡，调用方须按现有 ID 合并编辑。 */
export function MediaContentEditor({ card, projectId, onChange, disabled, initialLibrary = false }: MediaContentEditorProps) {
  const uiText = useUiText()
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
  const latest = useRef({ card, onChange })
  latest.current = { card, onChange }
  const operation = useRef(0)
  const libraryRequest = useRef(0)
  const type = card.type?.split('.')[1] || 'image'
  useEffect(() => () => { operation.current++; libraryRequest.current++ }, [projectId, card.id])

  const upload = async (file: File) => {
    if (disabled || uploading) return
    if (type === 'image' && file.type && !file.type.startsWith('image/')) { setError(uiText("仅支持上传图片文件")); return }
    const token = ++operation.current
    setError(''); setUploading(true)
    latest.current.onChange({ ...latest.current.card, uploading: true })
    try {
      const response = await StudioFilesService.uploadFileApiApiV1StudioFilesUploadPost({ formData: {
        file: file as unknown as string, project_id: projectId || undefined, usage_kind: 'generation_upload',
      } })
      if (!response.data || response.data.type !== type) throw new Error(uiText("文件类型不匹配"))
      if (token === operation.current) {
        latest.current.onChange({ ...latest.current.card, file_id: response.data.id, uploading: false })
      }
    } catch {
      if (token === operation.current) {
        latest.current.onChange({ ...latest.current.card, uploading: false })
        setError(uiText("上传失败，原文件已保留。请选择文件重试。"))
      }
    } finally { if (token === operation.current) setUploading(false) }
  }

  useEffect(() => {
    if (!library) return
    const requestCounter = libraryRequest
    const token = ++requestCounter.current
    setLoading(true); setError('')
    StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId: projectId || undefined, page, pageSize: 20, isDesc: true })
      .then(response => {
        if (token !== libraryRequest.current) return
        setFiles(response.data?.items || []); setTotal(response.data?.pagination.total || 0)
      }).catch(() => { if (token === libraryRequest.current) setError(projectId ? uiText("项目文件读取失败，请重试") : uiText("文件读取失败，请重试")) })
      .finally(() => { if (token === libraryRequest.current) setLoading(false) })
    return () => { requestCounter.current++ }
  }, [uiText, library, page, projectId, refresh])

  const actions = <Dropdown trigger={['click']} menu={{ items: [{ key: 'upload', label: card.file_id ? uiText("替换文件") : uiText("上传文件") }, { key: 'library', label: projectId ? uiText("从项目文件选择") : uiText("从文件管理选择") }],
    onClick: ({ key }) => { if (key === 'upload') input.current?.click(); else { setPage(1); setLibrary(true) } } }} disabled={disabled || uploading}>
    <WorkbenchIconButton label={uiText("添加媒体")} icon={<PlusOutlined />} disabled={disabled || uploading} />
  </Dropdown>
  const openLibrary = () => { setPage(1); setLibrary(true) }
  const imageActions = (empty = false) => <div className="generation-image-actions">
    <WorkbenchButton icon={<UploadOutlined />} disabled={disabled || uploading} loading={uploading} onClick={() => input.current?.click()}>{empty ? uiText("上传图片") : uiText("替换图片")}</WorkbenchButton>
    <WorkbenchButton variant="quiet" icon={<PlusOutlined />} disabled={disabled || uploading} onClick={openLibrary}>{empty ? uiText("从素材中选择") : uiText("选择素材")}</WorkbenchButton>
  </div>
  const fixedFrame = 'frame_origin' in card && !!card.frame_origin
  const imageReadonly = fixedFrame ? <small>{uiText("视频选帧素材，可通过卡片引用查看来源")}</small>
    : disabled && <small>{uiText("只读，无法上传或替换图片")}</small>
  return <Space direction="vertical" style={{ width: '100%' }}>
    {type === 'image' ? (card.file_id ? <ImageContentReader key={card.file_id} fileId={card.file_id} origin={card.origin}>
      {!fixedFrame && imageActions()}
      {imageReadonly}
    </ImageContentReader> : <section className="generation-image-content" data-empty={true} data-portrait={false} aria-label={uiText("图片内容编辑")}>
      <div className="generation-image-preview">
        <div className="generation-image-empty"><PictureOutlined aria-hidden /><strong>{uiText("添加一张图片")}</strong>{imageActions(true)}{imageReadonly}</div>
      </div>
    </section>) : <>
      {card.origin && <p>{uiText("来自运行")} {card.origin.run_id} · {card.origin.incomplete ? uiText("未完成成果副本") : uiText("完整成果副本")}</p>}
      {card.file_id ? <PlaybackContent key={card.file_id} fileId={card.file_id} type={type === 'audio' ? 'audio' : 'video'} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={uiText("尚未选择文件")} />}
      {actions}
    </>}
    {error && <Alert type="error" message={error} />}
    {(uploading || card.uploading) && <Alert type="info" message={uploading ? uiText("上传中，暂不发布有效输出") : (projectId ? uiText("上次上传未完成，请重新上传或从项目文件选择") : uiText("上次上传未完成，请重新上传或从文件管理选择"))} />}
    <input ref={input} hidden aria-label={uiText("上传媒体文件")} type="file" accept={`${type}/*`} disabled={disabled}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
    <Modal title={projectId ? uiText("项目文件库") : uiText("文件管理")} open={library} onCancel={() => setLibrary(false)} footer={null} destroyOnClose>
      {error && <Alert type="error" message={error} />}
      <Button loading={loading} onClick={() => setRefresh(value => value + 1)}>{projectId ? uiText("刷新项目文件") : uiText("刷新文件")}</Button>
      {files.filter(file => file.type === type).map(file => <div key={file.id} style={{ marginBottom: 16 }}>
        <MediaPreview fileId={file.id} type={type} />
        <Space wrap>
          <span>{file.name}</span>
          <Button disabled={disabled || uploading} onClick={() => {
            latest.current.onChange({ ...latest.current.card, file_id: file.id, uploading: false }); setLibrary(false)
          }}>{uiText("选用")} {file.name}</Button>
          {projectId && <Button danger loading={releasing === file.id} disabled={loading || disabled || !!releasing} onClick={async () => {
            setReleasing(file.id); setError('')
            try {
              await StudioFilesService.releaseUploadRetention({ fileId: file.id, projectId })
              setFiles(previous => previous.filter(item => item.id !== file.id))
            } catch (reason) {
              setError(reason instanceof ApiError && reason.status < 500
                ? reason.body?.message || uiText("无法释放上传保留：请先移除该文件的其他使用关系")
                : uiText("清理结果未确认，请刷新项目文件核实后重试"))
            } finally { setReleasing(undefined) }
          }}>{uiText("释放上传保留")}</Button>}
        </Space>
      </div>)}
      {!loading && !files.some(file => file.type === type) && <Empty description={uiText("本页没有匹配类型的文件")} />}
      <Pagination current={page} pageSize={20} total={total} showSizeChanger={false} onChange={setPage} disabled={loading} />
    </Modal>
  </Space>
}
