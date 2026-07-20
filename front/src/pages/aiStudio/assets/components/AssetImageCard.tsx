/**
 * 资产列表中的统一展示卡片。
 *
 * 将演员、场景、道具、服装的封面、快速生成与多视角预览收敛到同一交互，
 * 详情页仍负责编辑完整的资产和图片信息。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Image, Modal, Space, Tag, message } from 'antd'
import { DeleteOutlined, EditOutlined, EyeOutlined, LoadingOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'
import { DisplayImageCard } from './DisplayImageCard'

type AssetImage = {
  id: number
  view_angle?: string | null
  file_id?: string | null
}

export type AssetCardAsset = {
  id: string
  name: string
  description?: string | null
  tags?: string[]
  thumbnail?: string
  view_count?: number | null
}

type AssetImageCardProps = {
  asset: AssetCardAsset
  assetLabel: string
  listImages: (assetId: string) => Promise<AssetImage[]>
  createImageSlot: (assetId: string, angle: string) => Promise<void>
  renderPrompt: (assetId: string, imageId: number) => Promise<{ prompt: string; images: string[] }>
  createGenerationTask: (assetId: string, imageId: number, payload: { prompt: string; images: string[] }) => Promise<string | null>
  onEdit: () => void
  onDelete: () => void
  onDetails?: () => void
}

const ANGLE_LABELS: Record<string, string> = {
  FRONT: '正面',
  LEFT: '左侧',
  RIGHT: '右侧',
  BACK: '背面',
  THREE_QUARTER: '3/4侧面',
  TOP: '俯视',
  DETAIL: '细节',
}

/** Returns the image that should represent an asset, preferring its front view. */
function preferredImage(images: AssetImage[]): AssetImage | null {
  return images.find((image) => image.view_angle === 'FRONT' && image.file_id) ?? images.find((image) => image.file_id) ?? null
}

export function AssetImageCard({
  asset,
  assetLabel,
  listImages,
  createImageSlot,
  renderPrompt,
  createGenerationTask,
  onEdit,
  onDelete,
  onDetails,
}: AssetImageCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [images, setImages] = useState<AssetImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [selectedImageId, setSelectedImageId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)

  const generatedImages = useMemo(() => images.filter((image) => Boolean(image.file_id)), [images])
  const selectedImage = generatedImages.find((image) => image.id === selectedImageId) ?? preferredImage(generatedImages)

  const loadImages = useCallback(async () => {
    setImagesLoading(true)
    try {
      const nextImages = await listImages(asset.id)
      setImages(nextImages)
      const nextSelected = preferredImage(nextImages)
      setSelectedImageId(nextSelected?.id ?? null)
      return nextImages
    } catch {
      message.error(`加载${assetLabel}图片失败`)
      return []
    } finally {
      setImagesLoading(false)
    }
  }, [asset.id, assetLabel, listImages])

  useEffect(() => {
    if (previewOpen) void loadImages()
  }, [loadImages, previewOpen])

  const openPreview = () => {
    setPreviewOpen(true)
  }

  const handleQuickGenerate = async () => {
    setGenerating(true)
    try {
      let imageRows = await listImages(asset.id)
      let target = imageRows.find((image) => image.view_angle === 'FRONT') ?? imageRows[0]
      if (!target) {
        await createImageSlot(asset.id, 'FRONT')
        imageRows = await listImages(asset.id)
        target = imageRows.find((image) => image.view_angle === 'FRONT') ?? imageRows[0]
      }
      if (!target) throw new Error('无法创建正面图片槽位')

      const draft = await renderPrompt(asset.id, target.id)
      const taskId = await createGenerationTask(asset.id, target.id, draft)
      if (!taskId) throw new Error('未创建生成任务')
      message.success(`已创建${assetLabel}图片生成任务`)
      if (previewOpen) await loadImages()
    } catch {
      message.error(`创建${assetLabel}图片生成任务失败`)
    } finally {
      setGenerating(false)
    }
  }

  const thumbnailUrl = resolveAssetUrl(asset.thumbnail)

  return (
    <>
      <DisplayImageCard
        title={<span className="truncate">{asset.name}</span>}
        imageUrl={thumbnailUrl}
        imageAlt={asset.name}
        placeholder={
          <div className="flex flex-col items-center gap-2">
            <span>未生成图片</span>
            <Button
              type="primary"
              size="small"
              icon={generating ? <LoadingOutlined /> : <ThunderboltOutlined />}
              loading={generating}
              onClick={(event) => {
                event.stopPropagation()
                void handleQuickGenerate()
              }}
            >
              快速生成
            </Button>
          </div>
        }
        onImageClick={openPreview}
        extra={<Tag color="blue">{assetLabel}</Tag>}
        actions={[
          <Button key="generate" type="text" size="small" icon={<ThunderboltOutlined />} loading={generating} onClick={() => void handleQuickGenerate()}>
            {thumbnailUrl ? '重新生成' : '快速生成'}
          </Button>,
          <Button key="edit" type="text" size="small" icon={<EditOutlined />} onClick={onEdit}>
            编辑
          </Button>,
          ...(onDetails ? [<Button key="detail" type="text" size="small" icon={<EyeOutlined />} onClick={onDetails}>详情</Button>] : []),
          <Button key="delete" type="text" danger size="small" icon={<DeleteOutlined />} onClick={onDelete} />,
        ]}
        meta={
          <>
            <div className="text-xs text-gray-500 mb-2 line-clamp-2">{asset.description || '暂无描述'}</div>
            <div className="flex flex-wrap gap-1">
              {(asset.tags ?? []).slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)}
            </div>
          </>
        }
      />

      <Modal title={`${asset.name} · 图片预览`} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={960}>
        {imagesLoading ? (
          <div className="h-80 flex items-center justify-center"><LoadingOutlined /></div>
        ) : generatedImages.length === 0 ? (
          <div className="h-80 flex flex-col items-center justify-center gap-3 text-gray-500">
            <span>暂未生成任何视角图片</span>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={generating} onClick={() => void handleQuickGenerate()}>快速生成正面图</Button>
          </div>
        ) : (
          <Space direction="vertical" size="middle" className="w-full">
            <div className="min-h-80 flex items-center justify-center rounded-md bg-gray-50 overflow-hidden">
              {selectedImage?.file_id ? <Image preview={false} src={buildFileDownloadUrl(selectedImage.file_id)} alt={asset.name} className="max-h-[65vh] object-contain" /> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {generatedImages.map((image) => (
                <Button key={image.id} type={selectedImage?.id === image.id ? 'primary' : 'default'} onClick={() => setSelectedImageId(image.id)}>
                  {ANGLE_LABELS[image.view_angle ?? ''] ?? image.view_angle ?? '图片'}
                </Button>
              ))}
            </div>
          </Space>
        )}
      </Modal>
    </>
  )
}
