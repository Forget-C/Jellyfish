import { useUiText } from '../../../../uiText'
import { useRef, useState } from 'react'
import { Button } from 'antd'
import { PictureOutlined } from '@ant-design/icons'
import { buildFileDownloadUrl } from '../../assets/utils'

/** 参考文件缩略图和完整预览使用稳定占位；完整预览可重试失效的读取。 */
export function ExperimentReferenceImage({ id, name, full = false }: { id: string; name: string; full?: boolean }) {
  const uiText = useUiText()
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const previewRef = useRef<HTMLDivElement>(null)
  return <div ref={previewRef} tabIndex={full ? -1 : undefined} className={`experiment-reference-image${full ? ' is-full' : ''}`}>
    {status !== 'failed' && <img
      src={buildFileDownloadUrl(id)}
      alt={full ? name : ''}
      className={status === 'loading' ? 'is-loading' : undefined}
      onLoad={() => setStatus('ready')}
      onError={() => setStatus('failed')}
    />}
    {status !== 'ready' && <div className="experiment-reference-placeholder" role="status">
      <PictureOutlined aria-hidden="true" />
      <span>{status === 'loading' ? uiText("加载中") : uiText("图片不可用")}</span>
      {full && status === 'failed' && <Button onClick={() => {
        previewRef.current?.focus({ preventScroll: true })
        setStatus('loading')
      }}>{uiText("重试加载")}</Button>}
    </div>}
  </div>
}
