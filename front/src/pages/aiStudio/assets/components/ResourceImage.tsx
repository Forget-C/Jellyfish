import { useRef, useState } from 'react'
import { Button, Image, Space } from 'antd'

/** 图片加载成功后提供键盘放大入口；失败重试不改变对象图片选择。 */
export function ResourceImage({ src, alt }: { src: string; alt: string }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const changePreview = (next: boolean) => { setPreview(next); if (!next) requestAnimationFrame(() => trigger.current?.focus()) }
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState(false)
  return <div onKeyDownCapture={event => { if (event.key === 'Escape' && preview) { event.stopPropagation(); changePreview(false) } }}>
    {failed ? <Space wrap><span>图片加载失败</span><Button onClick={() => { setAttempt(value => value + 1); setFailed(false) }}>重试图片</Button></Space>
      : <Image key={attempt} src={attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src} alt={alt}
        onLoad={() => setReady(true)} onError={() => { setReady(false); setFailed(true) }}
        preview={ready ? { visible: preview, onVisibleChange: changePreview } : false} />}
    {!failed && <Button ref={trigger} aria-label={`放大${alt}`} disabled={!ready} onClick={() => setPreview(true)}>放大</Button>}
  </div>
}
