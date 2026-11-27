import { MessageOutlined, UserOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { Bubble } from '@ant-design/x'

type ExperimentMessageBubbleProps = {
  children?: ReactNode
  footer?: ReactNode
  identity: string
  tone: 'assistant' | 'user'
  status?: ReactNode
  result?: boolean
}

/** 统一身份、正文和轻量操作的顺序，用户气泡和结果卡片随内容收缩。 */
export function ExperimentMessageBubble({ children, footer, identity, tone, status, result }: ExperimentMessageBubbleProps) {
  const Icon = tone === 'user' ? UserOutlined : MessageOutlined
  return <article className={`experiment-message experiment-message-${tone}${result ? ' experiment-message-result' : ''}`}>
    <header className="experiment-message-header"><span><Icon aria-hidden="true" /> {identity}</span>{status}</header>
    {children ? <Bubble content={children} placement={tone === 'user' ? 'end' : 'start'}
      variant="borderless" classNames={{ content: 'experiment-message-body' }} /> : null}
    {footer ? <footer className="experiment-message-footer">{footer}</footer> : null}
  </article>
}
