import { useUiText } from '../../uiText'
import { useEffect, useRef, useState } from 'react'
import { PictureOutlined } from '@ant-design/icons'
import { StudioHomeService } from '../../services/generated'
import { buildFileDownloadUrl } from '../aiStudio/assets/utils'
import { HomeRecentFeedback, homeUpdatedAtFormat, useHomeRecentList } from './HomeRecentList'
import { HomePlaceholders } from './HomePlaceholders'

function CanvasCover({ fileId }: { fileId: string | null }) {
  const [failed, setFailed] = useState(false)
  const [showBackdrop, setShowBackdrop] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const src = buildFileDownloadUrl(fileId)

  useEffect(() => {
    const image = imageRef.current
    if (!image) return
    const updateBackdrop = () => {
      const { width, height } = image.getBoundingClientRect()
      // With contain, a width of at most 70% at full height leaves at least 30% at the sides.
      setShowBackdrop(image.naturalHeight > 0 && height > 0 &&
        height * image.naturalWidth * 10 <= width * image.naturalHeight * 7)
    }
    const observer = new ResizeObserver(updateBackdrop)
    observer.observe(image)
    image.addEventListener('load', updateBackdrop)
    return () => {
      observer.disconnect()
      image.removeEventListener('load', updateBackdrop)
    }
  }, [src, failed])

  if (!src || failed) return <div className="home-canvas-cover home-canvas-placeholder" aria-hidden="true"><PictureOutlined /></div>
  return <div className="home-canvas-cover">
    {showBackdrop && <span className="home-canvas-backdrop" aria-hidden="true" style={{ backgroundImage: `url("${src}")` }} />}
    <img ref={imageRef} alt="" src={src} onError={() => setFailed(true)} />
  </div>
}

export function HomeRecentCanvases() {
  const uiText = useUiText()
  const { result, retry } = useHomeRecentList(StudioHomeService.homeRecentCanvases)
  const canvases = result.status === 'ready' ? result.items : []

  return <section aria-labelledby="home-recent-canvases">
    <header className="home-section-heading">
      <h2 id="home-recent-canvases">{uiText("最近更新的画布")}</h2>
    </header>
    <div className="home-slot-frame">
      <div className="home-canvas-grid">
        {canvases.map(canvas => <article className="home-canvas-card" key={canvas.id}>
          <CanvasCover key={canvas.cover_file_id} fileId={canvas.cover_file_id} />
          <div className="home-canvas-caption">
            <h3 title={canvas.name}>{canvas.name}</h3>
            <p>
              <span className="home-canvas-source" title={canvas.project_name ?? undefined}>
                {canvas.kind === 'free' ? uiText("独立画布") : canvas.project_name}
              </span>
              <time dateTime={canvas.updated_at}>{homeUpdatedAtFormat().format(new Date(canvas.updated_at))}</time>
            </p>
          </div>
        </article>)}
        {result.status === 'loading' && <HomePlaceholders kind="canvas" />}
      </div>
      {!canvases.length && <HomeRecentFeedback status={result.status} label={uiText("画布")} emptyText={uiText("暂无最近更新的画布")} onRetry={retry} />}
    </div>
  </section>
}
