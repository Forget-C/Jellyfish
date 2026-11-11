import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Modal, Spin, message } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PictureOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { FilmService } from '../../../../services/generated'
import { useTaskUiStore } from '../../components/taskUiStore'
import './project-resource-card.css'
import { assetAdapters } from '../assetAdapters'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'

type AssetImage = {
  id: number
  view_angle?: string | null
  file_id?: string | null
}

export type LibraryAsset = {
  id: string
  name: string
  description?: string | null
  tags?: string[] | null
  thumbnail?: string | null
}

export type LibraryAssetType = 'actor' | 'scene' | 'prop' | 'costume'

const ANGLE_LABELS: Record<string, string> = {
  FRONT: '正面', LEFT: '左侧', RIGHT: '右侧', BACK: '背面',
  THREE_QUARTER: '3/4侧面', TOP: '俯视', DETAIL: '细节',
}

function preferredImage(images: AssetImage[]) {
  return images.find(image => image.view_angle === 'FRONT' && image.file_id) ?? images.find(image => image.file_id)
}

/** 资产库卡片将预览、编辑和生成分别绑定到明确入口，档案和项目卡片由各自组件负责。 */
export function AssetImageCard({ asset, assetType, label, editPath, onDelete, onGenerated }: {
  asset: LibraryAsset
  assetType: LibraryAssetType
  label: string
  editPath: string
  onDelete: () => void
  onGenerated: () => void
}) {
  const adapter = assetAdapters[assetType]
  const thumbnailUrl = resolveAssetUrl(asset.thumbnail)
  const [brokenCover, setBrokenCover] = useState<string>()
  const [previewOpen, setPreviewOpen] = useState(false)
  const coverTrigger = useRef<HTMLButtonElement>(null)
  const [images, setImages] = useState<AssetImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [imagesFailed, setImagesFailed] = useState(false)
  const [selectedImageId, setSelectedImageId] = useState<number>()
  const [failedPreview, setFailedPreview] = useState<string>()
  const generationKey = `${assetType}:${asset.id}`
  const generation = useTaskUiStore(state => state.assetGenerations[generationKey])
  const taskId = generation?.status === 'submitted' ? generation.taskId : undefined
  const [taskReadFailed, setTaskReadFailed] = useState(false)
  const hasActiveTask = useTaskUiStore(state => Object.values(state.serverItems).some(task =>
    (task.status === 'queued' || task.status === 'running') && task.target_type === `${assetType}_image_slot`
    && task.source?.kind === assetType && task.source.id === asset.id,
  ))

  const generatedImages = images.filter(image => Boolean(image.file_id))
  const selectedImage = generatedImages.find(image => image.id === selectedImageId) ?? preferredImage(generatedImages)
  const previewUrl = buildFileDownloadUrl(selectedImage?.file_id)
  const generating = Boolean(generation) || hasActiveTask

  const loadImages = useCallback(async () => {
    setImagesLoading(true)
    setImagesFailed(false)
    try {
      setImages(await adapter.listImages(asset.id))
      setFailedPreview(undefined)
    } catch {
      setImagesFailed(true)
    } finally {
      setImagesLoading(false)
    }
  }, [adapter, asset.id])

  const openPreview = () => {
    setSelectedImageId(undefined)
    setPreviewOpen(true)
    void loadImages()
  }

  useEffect(() => {
    if (!taskId) return
    let active = true
    let timer: number
    const poll = async () => {
      try {
        const response = await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId })
        if (!active) return
        const status = response.data?.status
        if (!status) throw new Error('生成状态缺失')
        setTaskReadFailed(false)
        if (status === 'queued' || status === 'running') {
          timer = window.setTimeout(poll, 2000)
          return
        }
        useTaskUiStore.getState().setAssetGeneration(generationKey)
        if (status === 'succeeded') {
          message.success(`${label}图片已生成`)
          onGenerated()
        } else if (status === 'failed') message.error(`${label}图片生成失败`)
        else if (status === 'cancelled') message.info(`${label}图片生成已取消`)
      } catch {
        if (!active) return
        setTaskReadFailed(true)
        timer = window.setTimeout(poll, 2000)
      }
    }
    timer = window.setTimeout(poll, 2000)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [generationKey, label, onGenerated, taskId])

  const generate = async () => {
    const { assetGenerations, setAssetGeneration } = useTaskUiStore.getState()
    if (assetGenerations[generationKey] || hasActiveTask) return
    setAssetGeneration(generationKey, { status: 'submitting' })
    try {
      let slots: AssetImage[] = await adapter.listImages(asset.id)
      let target = slots.find(image => image.view_angle === 'FRONT') ?? slots[0]
      if (!target) {
        await adapter.createImageSlot(asset.id, 'FRONT')
        slots = await adapter.listImages(asset.id)
        target = slots.find(image => image.view_angle === 'FRONT') ?? slots[0]
      }
      if (!target) throw new Error('无法创建正面图片槽位')
      const draft = await adapter.renderPrompt(asset.id, target.id)
      const id = await adapter.createGenerationTask(asset.id, target.id, draft)
      if (!id) throw new Error('未创建生成任务')
      setAssetGeneration(generationKey, { status: 'submitted', taskId: id })
      message.success(`已创建${label}图片生成任务`)
    } catch {
      setAssetGeneration(generationKey)
      message.error(`创建${label}图片生成任务失败`)
    }
  }

  const coverAvailable = Boolean(thumbnailUrl && thumbnailUrl !== brokenCover)
  const generateLabel = generating ? '生成中' : thumbnailUrl ? '重新生成' : '生成'
  const description = asset.description?.trim()
  const coverPlaceholder = <span className="asset-library-cover-placeholder">
    <PictureOutlined aria-hidden="true" />{thumbnailUrl ? '图片加载失败' : '暂无封面'}
  </span>

  return <>
    <article className="asset-library-card">
      {coverAvailable ? <button type="button" className="asset-library-cover" ref={coverTrigger}
        title="放大预览" aria-label={`预览${asset.name}`} onClick={openPreview}>
        {coverAvailable ? <img style={{objectFit: assetType === 'scene' ? 'cover' : 'contain'}} src={thumbnailUrl} alt={asset.name} loading="lazy" onError={() => setBrokenCover(thumbnailUrl)} /> : coverPlaceholder}
      </button> : <div className="asset-library-cover">{coverPlaceholder}</div>}
      <div className="asset-library-card-content">
        <div className="project-resource-title-row">
        <h2>
          <Link to={editPath} className="asset-library-name">
            <span title={asset.name}>{asset.name}</span><ArrowRightOutlined aria-hidden="true" />
          </Link>
        </h2>
          <Dropdown menu={{ items: [{ key: 'delete', label: '删除', danger: true, onClick: onDelete }] }} trigger={['click']}>
            <Button type="text" size="small" icon={<MoreOutlined aria-hidden="true" />} aria-label={`${asset.name}更多操作`} />
          </Dropdown>
        </div>
        <p className="asset-library-description" title={description}>{description || '未填写简介'}</p>
        <div className="asset-library-card-actions">
          <Button type="text" size="small" icon={<ThunderboltOutlined aria-hidden="true" />}
            aria-label={generateLabel} loading={generating} disabled={generating} onClick={() => void generate()}>
            {generateLabel}
          </Button>
          {taskReadFailed && <span role="status">状态读取失败，正在重试</span>}

        </div>
      </div>
    </article>

    <Modal title={`${asset.name} · 图片预览`} open={previewOpen} footer={null}
      width="min(960px, calc(100vw - 24px))" className="asset-library-preview"
      onCancel={() => setPreviewOpen(false)} afterClose={() => coverTrigger.current?.focus({ preventScroll: true })}>
      {imagesLoading ? <div className="asset-library-preview-image"><Spin /></div> : imagesFailed
        ? <Alert type="error" message={`加载${label}图片失败`} action={<Button onClick={() => void loadImages()}>重试</Button>} />
        : <>
          <div className="asset-library-preview-image">
            {previewUrl && previewUrl !== failedPreview ? <img src={previewUrl} alt={asset.name} onError={() => setFailedPreview(previewUrl)} />
              : <span>{previewUrl ? '图片加载失败' : '暂未生成任何视角图片'}</span>}
          </div>
          {generatedImages.length > 0 && <div className="asset-library-preview-angles">
            {generatedImages.map(image => <Button key={image.id} type={selectedImage?.id === image.id ? 'primary' : 'default'}
              aria-pressed={selectedImage?.id === image.id} onClick={() => setSelectedImageId(image.id)}>
              {ANGLE_LABELS[image.view_angle ?? ''] ?? image.view_angle ?? '图片'}
            </Button>)}
          </div>}
        </>}
    </Modal>
  </>
}
