import { MessageOutlined, UserOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

type ExperimentMessageBubbleProps = {
  children?: ReactNode
  footer?: ReactNode
  identity: string
  tone: 'assistant' | 'user'
  status?: ReactNode
}

/** 统一身份、正文和轻量操作的顺序，正文宽度随消息内容收缩。 */
export function ExperimentMessageBubble({ children, footer, identity, tone, status }: ExperimentMessageBubbleProps) {
  const Icon = tone === 'user' ? UserOutlined : MessageOutlined
  return <article className={`experiment-message experiment-message-${tone}`}>
    <header className="experiment-message-header"><span><Icon aria-hidden="true" /> {identity}</span>{status}</header>
    {children ? <div className="experiment-message-body">{children}</div> : null}
    {footer ? <footer className="experiment-message-footer">{footer}</footer> : null}
  </article>
}
