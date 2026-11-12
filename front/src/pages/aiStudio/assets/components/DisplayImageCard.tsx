import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Card, Modal } from 'antd'
import { PictureOutlined } from '@ant-design/icons'
import './project-resource-card.css'

type DisplayImageCardProps = {
  variant?: 'default' | 'project'
  imageFit?: 'contain' | 'cover'
  lazyImage?: boolean
  title: ReactNode
  imageUrl?: string
  imageAlt: string
  placeholder?: ReactNode
  extra?: ReactNode
  actions?: ReactNode[]
  meta?: ReactNode
  footer?: ReactNode
  onImageClick?: () => void
  enablePreview?: boolean
  size?: 'small' | 'default'
  hoverable?: boolean
  imageHeightClassName?: string
}

export function DisplayImageCard({
  variant = 'default',
  imageFit = 'contain',
  lazyImage = false,
  title,
  imageUrl,
  imageAlt,
  placeholder = '暂无图片',
  extra,
  actions,
  meta,
  footer,
  onImageClick,
  enablePreview = true,
  size = 'small',
  hoverable = true,
  imageHeightClassName = 'h-44',
}: DisplayImageCardProps) {
  const previewTrigger = useRef<HTMLButtonElement>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    setImgError(false)
  }, [imageUrl])

  const handleImageClick = () => {
    if (onImageClick) {
      onImageClick()
      return
    }
    if (enablePreview && imageUrl) {
      setPreviewOpen(true)
    }
  }

  const displayUrl = imgError ? undefined : imageUrl

  if (variant === 'project') {
    const content = displayUrl
      ? <img loading={lazyImage ? 'lazy' : undefined} src={displayUrl} alt={imageAlt} style={{ objectFit: imageFit }} onError={() => setImgError(true)} />
      : <span className="project-resource-placeholder">{imgError ? <><PictureOutlined aria-hidden />图片加载失败</> : onImageClick ? placeholder : <><PictureOutlined aria-hidden />暂无封面</>}</span>
    const canOpen = !!onImageClick || !!(enablePreview && displayUrl)
    return <>
      <article className="project-resource-card">
        {canOpen ? <button ref={previewTrigger} type="button" className="project-resource-cover" title="放大预览" aria-label={`预览${imageAlt}`} onClick={handleImageClick}>{content}</button>
          : <div className="project-resource-cover">{content}</div>}
        <div className="project-resource-card-body">
          <div className="project-resource-title-row"><h2>{title}</h2>{extra}</div>
          {meta}
          {footer}
          {actions && <div className="project-resource-actions">{actions}</div>}
        </div>
      </article>
      <Modal className="project-resource-dialog" focusTriggerAfterClose={false} title={imageAlt} open={previewOpen} onCancel={() => setPreviewOpen(false)}
        afterClose={() => previewTrigger.current?.focus({ preventScroll: true })} footer={null} width={960}>
        {displayUrl && <img className="project-resource-preview" src={displayUrl} alt={imageAlt} />}
      </Modal>
    </>
  }

  return (
    <>
      <Card title={title} extra={extra} actions={actions} size={size} hoverable={hoverable}>
        <div
          className={`${imageHeightClassName} rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center text-gray-500 text-sm overflow-hidden ${(onImageClick || (enablePreview && displayUrl)) ? 'cursor-pointer' : ''}`}
          onClick={handleImageClick}
        >
          {displayUrl ? (
            <img
              src={displayUrl}
              alt={imageAlt}
              className="w-full h-full object-contain p-1"
              onError={() => setImgError(true)}
            />
          ) : (
            placeholder
          )}
        </div>
        {meta ? <div className="mt-2">{meta}</div> : null}
        {footer ? <div className="mt-3">{footer}</div> : null}
      </Card>

      <Modal title={imageAlt} open={previewOpen} onCancel={() => setPreviewOpen(false)} footer={null} width={960}>
        <div className="w-full flex justify-center bg-gray-50 rounded-md overflow-hidden">
          {displayUrl ? <img src={displayUrl} alt={imageAlt} className="max-h-[75vh] object-contain" /> : null}
        </div>
      </Modal>
    </>
  )
}

