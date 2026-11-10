import { useEffect, useState } from 'react'
import { Alert, Button, Empty, Spin } from 'antd'
import { PictureOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { StudioGenerationCanvasesService, type CanvasRead } from '../../../../services/generated'
import { buildFileDownloadUrl } from '../../assets/utils'
import { directingError } from '../../directing/common'
import { generationCanvasLocation } from '../../generationCanvas/navigation'

/** 预览只读取当前项目，核对画布身份后才提供导航入口。 */
export function ProjectCanvasPreview({ projectId }: { projectId: string }) {
  const [canvas, setCanvas] = useState<CanvasRead>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [failedCover, setFailedCover] = useState<string>()
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    StudioGenerationCanvasesService.canvasList({ projectId }).then(response => {
      if (!Array.isArray(response.data)) throw new Error('生成画布读取失败，请重试')
      if (active) setCanvas(response.data.find(item => item.project_id === projectId && item.document?.project_id === projectId && item.id === item.document.id))
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, retry])

  const cover = buildFileDownloadUrl(canvas?.document.cover_file_id)
  return <section aria-labelledby="project-canvas-preview">
    <h2 id="project-canvas-preview" className="project-section-title">生成画布</h2>
    {loading ? <div className="project-production-surface"><Spin /></div> : error
      ? <Alert type="error" message={error} action={<Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />
      : canvas ? <article className="project-canvas-preview">
        <div className="project-canvas-preview-image">
          {cover && cover !== failedCover ? <img src={cover} alt={`${canvas.document.name}封面`} onError={() => setFailedCover(cover)} />
            : <span><PictureOutlined aria-hidden="true" /> 暂无封面</span>}
        </div>
        <div className="project-canvas-preview-caption">
          <Link to={generationCanvasLocation(projectId, new URLSearchParams({ canvas: canvas.id }))}>{canvas.document.name}</Link>
        </div>
      </article> : <div className="project-production-surface">
        <Empty description="暂无生成画布"><Link to={generationCanvasLocation(projectId)}>打开画布生成</Link></Empty>
      </div>}
  </section>
}
