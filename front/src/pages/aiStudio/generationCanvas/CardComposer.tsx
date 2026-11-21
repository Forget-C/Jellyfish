import { useUiText } from '../../../uiText'
import { useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CanvasEditorFooter } from './CanvasCardEditor'
import './materialComposer.css'

/** 共用编辑骨架；底部参数操作位于滚动区外，顶部参数模式底部只保留状态。 */
export function CardComposer({ associations, children, parameters, parameterAction, status, submit, parametersPosition = 'bottom' }: {
  associations?: ReactNode; children: ReactNode; parameters: ReactNode; parameterAction?: ReactNode; status: ReactNode; submit?: ReactNode; parametersPosition?: 'top' | 'bottom'
}) {
  const uiText = useUiText()
  const footerHost = useContext(CanvasEditorFooter)
  const footer = <footer className="generation-material-footer" data-parameters-position={parametersPosition} aria-label={parametersPosition === 'top' ? uiText("状态区") : uiText("参数状态区")}>
    {parametersPosition === 'bottom' && <>
      <div className="generation-material-parameters" aria-label={uiText("模型参数")}>{parameters}</div>
      {parameterAction}
      <span className="generation-material-divider" aria-hidden="true">|</span>
    </>}
    <div className="generation-material-tools" aria-label={parametersPosition === 'top' ? uiText("状态信息") : uiText("模型状态")}>{status}</div>{submit}
  </footer>
  return <div className="generation-material-composer">
    {parametersPosition === 'top' && <div className="generation-composer-parameters" aria-label={uiText("参数区")}>{parameters}</div>}
    {associations && <aside aria-label={uiText("关联区")} role="region" className="generation-material-basis">{associations}</aside>}
    <div className="generation-material-input" aria-label={uiText("输入区")}>{children}</div>
    {footerHost ? createPortal(footer, footerHost) : footer}
  </div>
}
