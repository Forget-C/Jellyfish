import { WorkbenchReadingContext } from './WorkbenchReadingContext'
import { Modal } from 'antd'
import type { ModalProps } from 'antd'
import type { ReactNode } from 'react'

/** 只共享外壳；任务阶段、关闭保护和数据生命周期仍由业务组件负责。 */
export function WorkbenchModal({ rootClassName = '', styles, width = 960, children, footer, ...props }: ModalProps) {
  return <Modal {...props} footer={footer === undefined ? (_, { OkBtn, CancelBtn }) => <WorkbenchDialogActions secondary={<CancelBtn />}><OkBtn /></WorkbenchDialogActions> : footer} width={width} rootClassName={`canvas-workbench-dialog wb-modal ${rootClassName}`} styles={{ ...styles, body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto', ...styles?.body } }}><WorkbenchReadingContext.Provider value>{children}</WorkbenchReadingContext.Provider></Modal>
}

export function WorkbenchDialogActions({ secondary, children, className = '' }: { secondary: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`wb-dialog-actions ${className}`}><div>{secondary}</div><div>{children}</div></div>
}
