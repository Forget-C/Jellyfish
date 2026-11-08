import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { StudioFilesService } from '../../../services/generated'
import type { CanvasContentOrigin, FileRead } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import './imageContentEditor.css'

/** 图片内容与正式结果共享阅读布局；只有内容编辑器提供修改动作。 */
export function ImageContentReader({ fileId, origin, generatedResult = false, children }: {
  fileId: string; origin?: CanvasContentOrigin | null; generatedResult?: boolean; children?: ReactNode
}) {
  const [fileInfo, setFileInfo] = useState<FileRead>()
  const [readingFile, setReadingFile] = useState(true)
  const [size, setSize] = useState<{ width: number; height: number }>()
  const [imageState, setImageState] = useState<'loaded' | 'failed'>()
  useEffect(() => {
    let active = true
    setReadingFile(true)
    StudioFilesService.getFileDetailApiV1StudioFilesFileIdGet({ fileId })
      .then(response => { if (active) setFileInfo(response.data || undefined) })
      .catch(() => { if (active) setFileInfo(undefined) })
      .finally(() => { if (active) setReadingFile(false) })
    return () => { active = false }
  }, [fileId])

  const currentInfo = fileInfo?.id === fileId ? fileInfo : undefined
  return <section className="generation-image-content" data-empty={false}
    data-portrait={!!size && size.height > size.width} aria-label={generatedResult ? '图片内容阅读' : '图片内容编辑'}>
    <div className="generation-image-preview">
      <img alt="图片预览" src={buildFileDownloadUrl(fileId)} onLoad={event => {
        const image = event.currentTarget
        setSize({ width: image.naturalWidth, height: image.naturalHeight })
        setImageState('loaded')
      }} onError={() => setImageState('failed')} />
      {!imageState && <small role="status">图片加载中</small>}
      {imageState === 'failed' && <small role="status">图片暂不可预览，文件仍保留</small>}
    </div>
    <div className="generation-image-file-info">
      <strong title={currentInfo?.name}>{currentInfo?.name || (readingFile ? '读取文件信息…' : '文件信息不可用')}</strong>
      <dl>
        <dt>尺寸</dt><dd>{size?.width && size.height ? `${size.width} × ${size.height}` : '未知'}</dd>
        <dt>类型</dt><dd>图片</dd>
        <dt>来源</dt><dd>{generatedResult ? '生成结果' : origin ? '运行成果副本' : '项目文件'}</dd>
      </dl>
      {origin && <small>来自运行 {origin.run_id} · {origin.incomplete ? '未完成成果副本' : '完整成果副本'}</small>}
      {children}
    </div>
  </section>
}
