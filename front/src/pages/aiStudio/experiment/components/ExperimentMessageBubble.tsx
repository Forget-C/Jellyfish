import { MessageOutlined, PictureOutlined, RightOutlined, UserOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { useId, useState, type ReactNode } from 'react'
import type { MediaTaskReceipt } from '../../../../services/generated'
import { useUiText } from '../../../../uiText'
import { elapsedBetween, useElapsedLabel } from './ExperimentElapsed'
import { MediaTaskDetails } from './MediaTaskDetails'
import { Bubble } from '@ant-design/x'

type ExperimentMessageBubbleProps = {
  children?: ReactNode
  footer?: ReactNode
  identity: string
  tone: 'assistant' | 'user'
  status?: ReactNode
  result?: boolean
  media?: { kind: 'image' | 'video'; receipt?: MediaTaskReceipt; hideElapsed?: boolean }
}

/** 统一身份、正文和轻量操作的顺序，用户气泡和结果卡片随内容收缩。 */
export function ExperimentMessageBubble({ children, footer, identity, tone, status, result, media }: ExperimentMessageBubbleProps) {
  const uiText = useUiText()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  const receipt = media?.receipt
  const terminal = receipt && ['succeeded', 'failed', 'cancelled'].includes(receipt.status)
  const elapsed = useElapsedLabel(elapsedBetween(receipt?.accepted_at_ms, receipt?.finished_at_ms))
  const Icon = tone === 'user' ? UserOutlined
    : media?.kind === 'image' ? PictureOutlined : media?.kind === 'video' ? VideoCameraOutlined : MessageOutlined
  return <article className={`experiment-message experiment-message-${tone}${result ? ' experiment-message-result' : ''}`}>
    <header className="experiment-message-header">
      <span><Icon aria-hidden="true" /> {identity}</span>
      {status}
      {terminal && <button type="button" className="experiment-media-details-toggle"
        aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(open => !open)}>
        {(!media?.hideElapsed && elapsed) || uiText('生成详情')} <RightOutlined aria-hidden="true" />
      </button>}
    </header>
    {terminal && <div id={detailsId} hidden={!detailsOpen}>
      <MediaTaskDetails receipt={receipt} elapsed={media?.hideElapsed ? elapsed : undefined} />
    </div>}
    {children ? <Bubble content={children} placement={tone === 'user' ? 'end' : 'start'}
      variant="borderless" classNames={{ content: 'experiment-message-body' }} /> : null}
    {footer ? <footer className="experiment-message-footer">{footer}</footer> : null}
  </article>
}
