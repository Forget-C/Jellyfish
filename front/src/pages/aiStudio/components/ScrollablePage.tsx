import type { ReactNode } from 'react'

/**
 * 提供统一的页面级滚动容器，避免父级布局锁定 `overflow: hidden` 时内容被裁切。
 */
export function ScrollablePage({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`h-full min-h-0 overflow-y-auto overflow-x-hidden ${className}`.trim()}>
      {children}
    </div>
  )
}
