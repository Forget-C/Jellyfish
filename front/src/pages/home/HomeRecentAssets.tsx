import { useUiText } from '../../uiText'
import { useId, useState, type ReactNode } from 'react'
import { ArrowRightOutlined, EnvironmentOutlined, InboxOutlined, SkinOutlined, UserOutlined } from '@ant-design/icons'
import { Drawer, Modal } from 'antd'
import { Link } from 'react-router-dom'
import { StudioHomeService, type HomeRecentAsset } from '../../services/generated'
import { resolveAssetUrl } from '../aiStudio/assets/utils'
import { HomeRecentFeedback, homeUpdatedAtFormat, useHomeRecentList } from './HomeRecentList'
import './home-assets.css'
import { HomePlaceholders } from './HomePlaceholders'

const assetTypes = {
  actor: { label: '演员', Icon: UserOutlined },
  scene: { label: '场景', Icon: EnvironmentOutlined },
  prop: { label: '道具', Icon: InboxOutlined },
  costume: { label: '服装', Icon: SkinOutlined },
}

function AssetImage({ asset, id, preview = false }: { asset: HomeRecentAsset; id?: string; preview?: boolean }) {
  const uiText = useUiText()
  const [failed, setFailed] = useState(false)
  const { Icon } = assetTypes[asset.type]
  const image = resolveAssetUrl(asset.thumbnail)

  return <span id={id} className="home-asset-image" data-fit={asset.type === 'scene' ? 'cover' : 'contain'}>
    {image && !failed
      ? <img src={image} alt={preview ? asset.name : ''} loading={preview ? 'eager' : 'lazy'} onError={() => setFailed(true)} />
      : <span className="home-asset-placeholder"><Icon aria-hidden />{uiText("暂无预览")}</span>}
  </span>
}

function AssetCards({ assets, onSelect, children }: {
  assets: HomeRecentAsset[]
  onSelect: (asset: HomeRecentAsset) => void
  children?: ReactNode
}) {
  const uiText = useUiText()
  const listId = useId()
  return <ul className="home-asset-grid">
    {assets.map((asset, index) => {
      const { label, Icon } = assetTypes[asset.type]
      const metaId = `${listId}-${index}-meta`
      const imageId = `${listId}-${index}-image`
      return <li key={`${asset.type}:${asset.id}`}>
        <button type="button" className="home-asset-card" aria-label={asset.name} aria-describedby={`${metaId} ${imageId}`}
          aria-haspopup="dialog" onClick={() => onSelect(asset)}>
          <AssetImage key={asset.thumbnail} id={imageId} asset={asset} />
          <span className="home-asset-caption">
            <strong className="home-asset-name" title={asset.name}>{asset.name}</strong>
            <span id={metaId} className="home-asset-meta">
              <span className="home-asset-type"><Icon aria-hidden />{uiText(label)}</span>
              <time dateTime={asset.updated_at}>{homeUpdatedAtFormat().format(new Date(asset.updated_at))}</time>
            </span>
          </span>
        </button>
      </li>
    })}
    {children}
  </ul>
}

export function HomeRecentAssets() {
  const uiText = useUiText()
  const { result, retry } = useHomeRecentList(StudioHomeService.homeRecentAssets)
  const assets = result.status === 'ready' ? result.items : []
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [preview, setPreview] = useState<HomeRecentAsset>()

  return <>
    <section className="home-recent-assets" aria-labelledby="home-recent-assets">
      <header className="home-section-heading home-assets-heading">
        <h2 id="home-recent-assets">{uiText("最近资产")}</h2>
        {assets.length ? <button type="button" className="home-text-action home-assets-open" aria-haspopup="dialog" onClick={() => setDrawerOpen(true)}>
          {uiText("查看最近资产")}
        </button> : <HomeRecentFeedback status={result.status} label={uiText("资产")} onRetry={retry} />}
        <Link className="home-text-action home-assets-library" to="/assets">{uiText("查看资产库")}<ArrowRightOutlined aria-hidden /></Link>
      </header>
      <div className="home-assets-inline">
        <AssetCards assets={assets} onSelect={setPreview}>
          <HomePlaceholders kind="asset" filled={assets.length} loading={result.status === 'loading'} />
        </AssetCards>
      </div>
    </section>
    <Drawer title={uiText("最近资产")} width="min(560px, 100vw)" open={drawerOpen} onClose={() => setDrawerOpen(false)} className="home-assets-drawer app-detail-drawer">
      <AssetCards assets={assets} onSelect={setPreview} />
    </Drawer>
    <Modal title={preview?.name} open={Boolean(preview)} footer={null} centered zIndex={1050}
      onCancel={() => setPreview(undefined)} className="home-asset-preview">
      {preview && <>
        <p className="home-asset-preview-meta">
          <span>{uiText(assetTypes[preview.type].label)}</span>
        </p>
        <AssetImage key={`${preview.type}:${preview.id}:${preview.thumbnail}`} asset={preview} preview />
      </>}
    </Modal>
  </>
}
