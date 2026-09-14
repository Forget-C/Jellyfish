import { useEffect, useState, type ReactNode } from 'react'
import { Image } from 'antd'
import { PictureOutlined } from '@ant-design/icons'

/** 统一资产档案的横向分节，让不同数量的字段沿相同边界自然展开。 */
export function AssetDossierSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="asset-dossier-section" aria-label={title}>
      <h2 className="asset-dossier-section-title">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/** 主图和视角缩略图共用完整比例展示，缺图或加载失败时保留明确的空状态。 */
export function AssetDossierImage({ src, alt, preview = false }: { src?: string; alt: string; preview?: boolean }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <div className="asset-dossier-image">
      {src && !failed ? (
        <Image src={src} alt={alt} width="100%" height="100%" style={{ objectFit: 'contain' }}
          preview={preview} onError={() => setFailed(true)} />
      ) : (
        <span className="asset-dossier-image-empty"><PictureOutlined /><span>{failed ? '图片加载失败' : '暂无图片'}</span></span>
      )}
    </div>
  )
}
