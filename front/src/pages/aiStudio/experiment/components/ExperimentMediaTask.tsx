import { useState } from 'react'
import { Button } from 'antd'
import type { MediaTaskReceipt } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'
import { ExperimentResultMedia } from './ExperimentResultMedia'
import { ExperimentTaskStatus } from './ExperimentTaskStatus'
import { elapsedBetween, useElapsedLabel } from './ExperimentElapsed'
import { MediaTaskDetails } from './MediaTaskDetails'
import './experiment-media-task.css'

type Props = {
  kind: 'image' | 'video'
  receipt?: MediaTaskReceipt
  status?: string
  progress?: number | null
  urls: string[]
  error?: string
  unavailable?: boolean
  submittedPrompt?: string
  sourceUrl?: string
  onRetry?: () => void
  onCancel?: () => Promise<boolean>
}

function mediaAspect(kind: Props['kind'], ratio: unknown) {
  if (kind === 'image') return 1
  if (typeof ratio !== 'string' || !/^\d+:\d+$/.test(ratio)) return 16 / 9
  const [width, height] = ratio.split(':').map(Number)
  return width > 0 && height > 0 ? width / height : 16 / 9
}

export function ExperimentMediaTask({
  kind, receipt, status, progress, urls, error, unavailable, submittedPrompt, sourceUrl, onRetry, onCancel,
}: Props) {
  const uiText = useUiText()
  const [cancelling, setCancelling] = useState(false)
  const [cancelSent, setCancelSent] = useState(false)
  const active = status === 'queued' || status === 'pending' || status === 'running'
  const terminal = status === 'succeeded' || status === 'failed' || status === 'cancelled'
  const elapsed = useElapsedLabel(terminal ? elapsedBetween(receipt?.accepted_at_ms, receipt?.finished_at_ms) : undefined)
  const prompt = receipt?.execution_prompt?.trim() || submittedPrompt?.trim()
  const cancellingTask = active && (cancelling || cancelSent || receipt?.cancel_requested)
  const image = kind === 'image'
  const aspectRatio = mediaAspect(kind, receipt?.parameters?.ratio)
  const outcome = status === 'succeeded'
    ? urls.length ? uiText(image ? '已生成 {{count}} 张图片' : '已生成 {{count}} 段视频', { count: urls.length }) : uiText('已完成')
    : status === 'failed' ? uiText(image ? '图片生成失败' : '视频生成失败')
      : status === 'cancelled' ? uiText(image ? '图片生成已取消' : '视频生成已取消') : undefined

  async function cancel() {
    if (!onCancel || cancellingTask) return
    setCancelling(true)
    try { setCancelSent(await onCancel()) }
    finally { setCancelling(false) }
  }

  return <div className="experiment-media-task">
    {terminal && receipt && <MediaTaskDetails receipt={receipt} label={elapsed} />}
    {active && <>
      <p>{uiText(image ? '正在生成图片' : '正在生成视频')}</p>
      <div className={`experiment-media-placeholder experiment-media-placeholder-${kind}`}
        style={{ aspectRatio, maxWidth: `min(100%, ${240 * aspectRatio}px)` }}>
        {cancellingTask
          ? <span className="experiment-task-status" role="status">{uiText('正在取消')}</span>
          : <ExperimentTaskStatus status={status} progress={progress} compact />}
      </div>
      {onCancel && !cancellingTask && <Button type="text" size="small" onClick={() => void cancel()}>{uiText('取消生成')}</Button>}
    </>}
    {(unavailable || !active && !terminal) && <ExperimentTaskStatus unavailable onRetry={onRetry} />}
    {outcome && <p role="status">{outcome}{status === 'succeeded' && urls.length === 1 && <>
      {' · '}<a href={urls[0]} target="_blank" rel="noreferrer">{uiText(image ? '查看原图' : '打开视频文件')}</a>
    </>}</p>}
    {error && <p className="experiment-result-error">{error}</p>}
    {sourceUrl && <a href={sourceUrl}>{uiText('原版产物')}</a>}
    {status === 'succeeded' && prompt && <details className="experiment-media-prompt">
      <summary>{uiText(receipt?.execution_prompt ? '生成提示词' : '提交的提示词')}</summary>
      <p>{prompt}</p>
    </details>}
    {!active && urls.length > 0 && <ExperimentResultMedia kind={kind} urls={urls} />}
  </div>
}
