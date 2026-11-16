import { useId, useState } from 'react'
import { ArrowRightOutlined, EnvironmentOutlined, InboxOutlined, SkinOutlined, UserOutlined } from '@ant-design/icons'
import { Drawer, Modal } from 'antd'
import { Link } from 'react-router-dom'
import changan from './sample-covers/changan.svg'
import rain from './sample-covers/rain.svg'
import actorStudio from './sample-assets/actor-studio.svg'
import actorPeriod from './sample-assets/actor-period.svg'
import costume from './sample-assets/costume.svg'
import './home-assets.css'

const assetTypes = {
  actor: { label: '演员', Icon: UserOutlined },
  scene: { label: '场景', Icon: EnvironmentOutlined },
  prop: { label: '道具', Icon: InboxOutlined },
  costume: { label: '服装', Icon: SkinOutlined },
}

type SampleAsset = {
  name: string
  type: keyof typeof assetTypes
  image?: string
  updatedAt: string
}

// 各分类的现有响应不能统一按更新时间合并，此处只展示本地示例。
const assets: SampleAsset[] = [
  { name: '林知远 · 都市试妆', type: 'actor', image: actorStudio, updatedAt: '2026-11-10T09:40:00+08:00' },
  { name: '长安夜市', type: 'scene', image: changan, updatedAt: '2026-11-10T09:15:00+08:00' },
  { name: '旧木匣', type: 'prop', updatedAt: '2026-11-09T16:30:00+08:00' },
  { name: '墨蓝立领外套', type: 'costume', image: costume, updatedAt: '2026-11-09T14:20:00+08:00' },
  { name: '沈月明 · 长安夜市第一场古装人物造型定妆照', type: 'actor', image: actorPeriod, updatedAt: '2026-11-09T11:05:00+08:00' },
  { name: '雨夜便利店', type: 'scene', image: rain, updatedAt: '2026-11-08T17:45:00+08:00' },
]

const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai',
})

function AssetImage({ asset, id, preview = false }: { asset: SampleAsset; id?: string; preview?: boolean }) {
  const [failed, setFailed] = useState(false)
  const { Icon } = assetTypes[asset.type]

  return <span id={id} className="home-asset-image" data-fit={asset.type === 'scene' ? 'cover' : 'contain'}>
    {asset.image && !failed
      ? <img src={asset.image} alt={preview ? asset.name : ''} loading={preview ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
      : <span className="home-asset-placeholder"><Icon aria-hidden />暂无预览</span>}
  </span>
}

function AssetCards({ onSelect }: { onSelect: (asset: SampleAsset) => void }) {
  const listId = useId()
  return <ul className="home-asset-grid">
    {assets.map((asset, index) => {
      const { label, Icon } = assetTypes[asset.type]
      const metaId = `${listId}-${index}-meta`
      const imageId = `${listId}-${index}-image`
      return <li key={asset.name}>
        <button type="button" className="home-asset-card" aria-label={asset.name} aria-describedby={`${metaId} ${imageId}`}
          aria-haspopup="dialog" onClick={() => onSelect(asset)}>
          <AssetImage id={imageId} asset={asset} />
          <span className="home-asset-caption">
            <strong className="home-asset-name" title={asset.name}>{asset.name}</strong>
            <span id={metaId} className="home-asset-meta">
              <span className="home-asset-type"><Icon aria-hidden />{label}</span>
              <time dateTime={asset.updatedAt}>{dateFormat.format(new Date(asset.updatedAt))}</time>
            </span>
          </span>
        </button>
      </li>
    })}
  </ul>
}

export function HomeRecentAssets() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [preview, setPreview] = useState<SampleAsset>()

  return <>
    <section className="home-recent-assets" aria-labelledby="home-recent-assets">
      <header className="home-section-heading home-assets-heading">
        <h2 id="home-recent-assets">最近资产</h2>
        <span className="home-sample-label">示例数据</span>
        <button type="button" className="home-text-action home-assets-open" aria-haspopup="dialog" onClick={() => setDrawerOpen(true)}>
          查看最近资产
        </button>
        <Link className="home-text-action home-assets-library" to="/assets">查看资产库<ArrowRightOutlined aria-hidden /></Link>
      </header>
      <div className="home-assets-inline"><AssetCards onSelect={setPreview} /></div>
    </section>
    <Drawer title="最近资产" width="min(560px, 100vw)" open={drawerOpen} onClose={() => setDrawerOpen(false)} className="home-assets-drawer app-detail-drawer">
      <p><span className="home-sample-label">示例数据</span></p>
      <AssetCards onSelect={setPreview} />
    </Drawer>
    <Modal title={preview?.name} open={Boolean(preview)} footer={null} centered zIndex={1050}
      onCancel={() => setPreview(undefined)} className="home-asset-preview">
      {preview && <>
        <p className="home-asset-preview-meta">
          <span className="home-sample-label">示例资产</span>
          <span>{assetTypes[preview.type].label}</span>
        </p>
        <AssetImage key={preview.name} asset={preview} preview />
      </>}
    </Modal>
  </>
}
