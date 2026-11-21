import { useUiText } from '../../../../uiText'
import { useRef, useState, type MouseEvent, type RefObject } from 'react'
import { PlayCircleFilled } from '@ant-design/icons'
import { Button, Modal, Spin } from 'antd'
import './experiment-result-media.css'

type MediaKind = 'image' | 'video'

type MediaFrameProps = {
  kind: MediaKind
  src: string
  label: string
  onOpen?: (event: MouseEvent<HTMLButtonElement>) => void
  playerRef?: RefObject<HTMLVideoElement>
}

function ExperimentMediaFrame({ kind, src, label, onOpen, playerRef }: MediaFrameProps) {
  const uiText = useUiText()
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const media = kind === 'image'
    ? <img key={attempt} src={src} alt={onOpen ? '' : label} onLoad={() => setState('ready')} onError={() => setState('failed')} />
    : <video key={attempt} ref={playerRef} src={src} controls={!onOpen} muted={Boolean(onOpen)} playsInline
        preload="metadata" aria-label={onOpen ? undefined : uiText("视频播放器")} aria-hidden={onOpen ? true : undefined}
        tabIndex={onOpen ? -1 : undefined}
        onLoadedMetadata={(event) => {
          setState('ready')
          const video = event.currentTarget
          if (onOpen && video.duration > 0.1) video.currentTime = 0.1
        }}
        onError={() => setState('failed')} />

  return <div className="experiment-result-frame">
    {onOpen ? <button type="button" className="experiment-result-open"
      aria-label={kind === 'image' ? uiText("查看{{label}}", { label }) : uiText("播放视频")} disabled={state !== 'ready'} onClick={onOpen}>
      {state !== 'failed' ? media : null}
      {kind === 'video' && state === 'ready' ? <span className="experiment-result-play"><PlayCircleFilled aria-hidden="true" /> {uiText("播放")}</span> : null}
    </button> : state !== 'failed' ? media : null}
    {state === 'loading' ? <div className="experiment-result-placeholder" role="status"><Spin size="small" /> {uiText("正在加载{{label}}", { label })}</div> : null}
    {state === 'failed' ? <div className="experiment-result-placeholder">
      <span role="status">{uiText("{{label}} 加载失败", { label })}</span>
      <Button size="small" onClick={() => { setState('loading'); setAttempt((current) => current + 1) }}>{uiText("重新加载{{label}}", { label })}</Button>
    </div> : null}
  </div>
}

type ExperimentResultMediaProps = {
  kind: MediaKind
  urls: string[]
}

/** 列表媒体共用加载和重试状态；查看层仅播放当前结果。 */
export function ExperimentResultMedia({ kind, urls }: ExperimentResultMediaProps) {
  const uiText = useUiText()
  const [index, setIndex] = useState<number>()
  const playerRef = useRef<HTMLVideoElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const activeUrl = index === undefined ? undefined : urls[index]
  const isImage = kind === 'image'
  const move = (direction: number) => setIndex((current) => ((current ?? 0) + direction + urls.length) % urls.length)
  const close = () => {
    playerRef.current?.pause()
    setIndex(undefined)
  }

  return <>
    <div className={`experiment-result-media experiment-result-${kind}${urls.length > 1 ? ' experiment-result-multiple' : ''}`}>
      {urls.map((url, itemIndex) => <ExperimentMediaFrame
        key={`${url}-${itemIndex}`}
        kind={kind}
        src={url}
        label={isImage ? uiText("图片 {{value1}}", { value1: itemIndex + 1 }) : uiText("视频")}
        onOpen={(event) => {
          triggerRef.current = event.currentTarget
          setIndex(itemIndex)
        }}
      />)}
    </div>
    <Modal
      title={isImage ? uiText("图片预览") : uiText("视频预览")}
      open={Boolean(activeUrl)}
      onCancel={close}
      focusTriggerAfterClose={false}
      afterClose={() => {
        if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true })
        triggerRef.current = null
      }}
      centered
      width="min(900px, calc(100vw - 24px))"
      className="experiment-result-dialog"
      footer={isImage && urls.length > 1 && index !== undefined ? <div className="experiment-result-pagination">
        <Button onClick={() => move(-1)}>{uiText("上一张")}</Button>
        <span role="status">{index + 1} / {urls.length}</span>
        <Button onClick={() => move(1)}>{uiText("下一张")}</Button>
      </div> : null}
    >
      {activeUrl ? <ExperimentMediaFrame key={activeUrl} src={activeUrl} kind={kind} label={isImage ? uiText("图片 {{value1}}", { value1: index! + 1 }) : uiText("视频")} playerRef={playerRef} /> : null}
    </Modal>
  </>
}
