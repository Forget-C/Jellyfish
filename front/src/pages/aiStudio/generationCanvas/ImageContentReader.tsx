import { useUiText } from '../../../uiText'
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
  const uiText = useUiText()
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
    data-portrait={!!size && size.height > size.width} aria-label={generatedResult ? uiText("图片内容阅读") : uiText("图片内容编辑")}>
    <div className="generation-image-preview">
      <img alt={uiText("图片预览")} src={buildFileDownloadUrl(fileId)} onLoad={event => {
        const image = event.currentTarget
        setSize({ width: image.naturalWidth, height: image.naturalHeight })
        setImageState('loaded')
      }} onError={() => setImageState('failed')} />
      {!imageState && <small role="status">{uiText("图片加载中")}</small>}
      {imageState === 'failed' && <small role="status">{uiText("图片暂不可预览，文件仍保留")}</small>}
    </div>
    <div className="generation-image-file-info">
      <strong title={currentInfo?.name}>{currentInfo?.name || (readingFile ? uiText("读取文件信息…") : uiText("文件信息不可用"))}</strong>
      <dl>
        <dt>{uiText("尺寸")}</dt><dd>{size?.width && size.height ? `${size.width} × ${size.height}` : uiText("未知")}</dd>
        <dt>{uiText("类型")}</dt><dd>{uiText("图片")}</dd>
        <dt>{uiText("来源")}</dt><dd>{generatedResult ? uiText("生成结果") : origin ? uiText("运行成果副本") : uiText("项目文件")}</dd>
      </dl>
      {origin && <small>{uiText("来自运行")} {origin.run_id} · {origin.incomplete ? uiText("未完成成果副本") : uiText("完整成果副本")}</small>}
      {children}
    </div>
  </section>
}
