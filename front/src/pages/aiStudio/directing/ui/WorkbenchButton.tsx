import { forwardRef } from 'react'
import type { ReactNode } from 'react'
import { Button, Tooltip } from 'antd'
import type { ButtonProps } from 'antd'

export type WorkbenchButtonProps = Omit<ButtonProps, 'type' | 'danger'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger'
}

/** 动作层级只决定外观；加载、禁用与业务授权由调用方控制。 */
export const WorkbenchButton = forwardRef<HTMLElement, WorkbenchButtonProps>(function WorkbenchButton({ variant = 'secondary', className = '', ...props }, ref) {
  return <Button {...props} aria-label={props['aria-label'] ?? (typeof props.children === 'string' ? props.children : undefined)} ref={ref} type={variant === 'quiet' ? 'text' : 'default'} danger={variant === 'danger'} data-variant={variant} data-size={props.size || 'middle'} className={`wb-action ${className}`} />
})

/** 纯图标操作必须有可读名称，禁用时仍可查看说明。 */
export const WorkbenchIconButton = forwardRef<HTMLElement, Omit<WorkbenchButtonProps, 'children' | 'icon'> & { label: string; icon: ReactNode }>(function WorkbenchIconButton({ label, className = '', ...props }, ref) {
  return <Tooltip title={label}><span className="wb-icon-trigger"><WorkbenchButton {...props} ref={ref} aria-label={label} className={`wb-icon-action ${className}`} /></span></Tooltip>
})
