import { useCallback, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Modal, Spin } from 'antd'
import { ArrowRightOutlined, MoreOutlined, PictureOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import './project-resource-card.css'
import { ResourceCardMetadata } from './ResourceCardMetadata'
import { assetAdapters } from '../assetAdapters'
import { buildFileDownloadUrl, resolveAssetUrl } from '../utils'

type AssetImage = {
  id: number
  view_angle?: string | null
  file_id?: string | null
  is_primary?: boolean
}

export type LibraryAsset = {
  id: string
  name: string
  description?: string | null
  tags?: string[] | null
  thumbnail?: string | null
  details_editable?: boolean
  origin?: string
  source_character_id?: string | null
  created_at?: string | null
}

export type LibraryAssetType = 'actor' | 'scene' | 'prop' | 'costume'

const ANGLE_LABELS: Record<string, string> = {
  FRONT: '正面', LEFT: '左侧', RIGHT: '右侧', BACK: '背面',
  THREE_QUARTER: '3/4侧面', TOP: '俯视', DETAIL: '细节',
}

function preferredImage(images: AssetImage[]) {
  return images.find(image => image.is_primary && image.file_id) ?? images.find(image => image.view_angle === 'FRONT' && image.file_id) ?? images.find(image => image.file_id)
}

/** 资产库卡片提供封面预览和详情入口，档案和项目卡片由各自组件负责。 */
export function AssetImageCard({ asset, assetType, label, editPath, onDelete }: {
  asset: LibraryAsset
  assetType: LibraryAssetType
  label: string
  editPath: string
  onDelete: () => void
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
  const generatedImages = images.filter(image => Boolean(image.file_id))
  const selectedImage = generatedImages.find(image => image.id === selectedImageId) ?? preferredImage(generatedImages)
  const previewUrl = buildFileDownloadUrl(selectedImage?.file_id)

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

  const coverAvailable = Boolean(thumbnailUrl && thumbnailUrl !== brokenCover)
  const description = asset.description?.trim()
  const coverPlaceholder = <span className="asset-library-cover-placeholder">
    <PictureOutlined aria-hidden="true" />{thumbnailUrl ? '图片加载失败' : '暂无封面'}
  </span>

  return <>
    <article className="asset-library-card">
      {coverAvailable ? <button type="button" className="asset-library-cover" ref={coverTrigger}
        title="放大预览" aria-label={`预览${asset.name}`} onClick={openPreview}>
        <img style={{ objectFit: assetType === 'scene' ? 'cover' : 'contain' }} src={thumbnailUrl} alt={asset.name} loading="lazy" onError={() => setBrokenCover(thumbnailUrl)} />
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
        <ResourceCardMetadata asset={asset} />
        <p className="asset-library-description" title={description}>{description || '未填写简介'}</p>
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
