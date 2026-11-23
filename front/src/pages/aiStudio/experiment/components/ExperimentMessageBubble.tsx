import { MessageOutlined, UserOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { WorkbenchConversation } from '../../../../components/workbench/WorkbenchConversation'

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
    {children ? <WorkbenchConversation gap={0} items={[{
      key: 'body', role: tone === 'assistant' ? 'ai' : 'user', placement: tone === 'user' ? 'end' : 'start',
      variant: 'borderless', content: children, classNames: { content: 'experiment-message-body' },
      styles: { content: { background: tone === 'user' ? 'var(--app-selected)' : 'white', padding: '8px 12px' } },
    }]} /> : null}
    {footer ? <footer className="experiment-message-footer">{footer}</footer> : null}
  </article>
}
