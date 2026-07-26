/** 统一实验室历史消息的三段式气泡外观与交互容器。 */
import type { ReactNode } from 'react'

type ExperimentMessageBubbleProps = {
  align: 'left' | 'right'
  children: ReactNode
  footer?: ReactNode
  header: ReactNode
  tone: 'assistant' | 'user'
}

/**
 * 用稳定的 header、content、footer 结构呈现实验室消息。
 *
 * 三种实验室的消息载荷各不相同，但身份标记、内容容器和操作区的布局规则一致。
 * footer 始终保留在 DOM 中，使悬浮操作和未来的状态/复制操作无需再脱离气泡定位。
 */
export function ExperimentMessageBubble({ align, children, footer, header, tone }: ExperimentMessageBubbleProps) {
  const hasFooter = Boolean(footer)

  return (
    <article className={`group max-w-[85%] ${align === 'right' ? 'ml-auto' : 'mr-auto'}`}>
      <header className="flex min-h-6 items-center px-1 text-xs">
        {header}
      </header>
      <div className={`rounded-lg px-3 py-2 ${tone === 'user' ? 'bg-blue-50' : 'bg-gray-50'}`}>
        <div className="whitespace-pre-wrap">
          {children}
        </div>
      </div>
      <footer className={`flex items-center justify-end px-1 ${hasFooter ? 'min-h-8 pt-1' : 'min-h-2'}`}>
        {footer}
      </footer>
    </article>
  )
}
