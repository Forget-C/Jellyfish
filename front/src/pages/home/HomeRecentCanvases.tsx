import { useState } from 'react'
import { PictureOutlined } from '@ant-design/icons'
import { StudioHomeService } from '../../services/generated'
import { buildFileDownloadUrl } from '../aiStudio/assets/utils'
import { HomeRecentFeedback, homeUpdatedAtFormat, useHomeRecentList } from './HomeRecentList'
import { HomePlaceholders } from './HomePlaceholders'

function CanvasCover({ fileId }: { fileId: string | null }) {
  const [failed, setFailed] = useState(false)
  return fileId && !failed
    ? <img className="home-canvas-cover" alt="" src={buildFileDownloadUrl(fileId)} onError={() => setFailed(true)} />
    : <div className="home-canvas-cover home-canvas-placeholder" aria-hidden="true"><PictureOutlined /></div>
}

export function HomeRecentCanvases() {
  const { result, retry } = useHomeRecentList(StudioHomeService.homeRecentCanvases)
  const canvases = result.status === 'ready' ? result.items : []

  return <section aria-labelledby="home-recent-canvases">
    <header className="home-section-heading">
      <h2 id="home-recent-canvases">最近更新的画布</h2>
    </header>
    <div className="home-slot-frame">
      <div className="home-canvas-grid">
        {canvases.map(canvas => <article className="home-canvas-card" key={canvas.id}>
          <CanvasCover key={canvas.cover_file_id} fileId={canvas.cover_file_id} />
          <div className="home-canvas-caption">
            <h3 title={canvas.name}>{canvas.name}</h3>
            <p>
              <span className="home-canvas-source" title={canvas.project_name ?? undefined}>
                {canvas.kind === 'free' ? '独立画布' : canvas.project_name}
              </span>
              <time dateTime={canvas.updated_at}>{homeUpdatedAtFormat.format(new Date(canvas.updated_at))}</time>
            </p>
          </div>
        </article>)}
        <HomePlaceholders kind="canvas" filled={canvases.length} loading={result.status === 'loading'} />
      </div>
      {!canvases.length && <HomeRecentFeedback status={result.status} label="画布" onRetry={retry} />}
    </div>
  </section>
}
