import { useUiText } from '../../../uiText'
import { theme } from 'antd'
import { CheckCircleFilled, ExclamationCircleOutlined, FileTextOutlined, PictureOutlined, VideoCameraOutlined, SoundOutlined } from '@ant-design/icons'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { CanvasResolvedOutput } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'

/** Model and design candidates share presentation; callers own insertion and adoption. */
export const MaterialReferenceButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { output: CanvasResolvedOutput; label: string; selected: boolean; selectedLabel?: string; children?: ReactNode; icon?: ReactNode; issue?: string }>(function MaterialReferenceButton({ output, label, selected, selectedLabel = '已采用', children, icon, issue, ...props }, ref) {
  const uiText = useUiText()
  const { token } = theme.useToken()
  return <button ref={ref} {...props} type="button" className="generation-material-reference">
    {!icon && output.file_id && output.modality === 'image' ? <img alt={uiText("图片预览")} src={buildFileDownloadUrl(output.file_id)} /> : !icon && output.file_id && output.modality === 'video' ? <video src={buildFileDownloadUrl(output.file_id)} muted playsInline preload="metadata" /> : <span aria-hidden="true">{icon || (output.modality === 'image' ? <PictureOutlined /> : output.modality === 'video' ? <VideoCameraOutlined /> : output.modality === 'audio' ? <SoundOutlined /> : <FileTextOutlined />)}</span>}
    <small>{label}</small>
    {selected && <CheckCircleFilled style={{ color: token.colorSuccess }} className="generation-material-adopted" aria-label={selectedLabel} />}
    {(issue || output.available === false || output.basis_current === false) && <ExclamationCircleOutlined style={{ color: token.colorWarning }} className="generation-material-reference-issue" aria-label={issue || (output.available === false ? uiText("来源输出缺失") : uiText("依据已变"))} />}
    {children}
  </button>
})
