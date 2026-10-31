import { useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CanvasEditorFooter } from './CanvasCardEditor'
import './materialComposer.css'

/** 模型、参考与描述共用编辑骨架；顶部参数模式底部只保留状态，提交由模型提供。 */
export function CardComposer({ associations, children, parameters, status, submit, parametersPosition = 'bottom' }: {
  associations?: ReactNode; children: ReactNode; parameters: ReactNode; status: ReactNode; submit?: ReactNode; parametersPosition?: 'top' | 'bottom'
}) {
  const footerHost = useContext(CanvasEditorFooter)
  const footer = <footer className="generation-material-footer" data-parameters-position={parametersPosition} aria-label={parametersPosition === 'top' ? '状态区' : '参数状态区'}>
    {parametersPosition === 'bottom' && <><div className="generation-material-parameters" aria-label="模型参数">{parameters}</div><span className="generation-material-divider" aria-hidden="true">|</span></>}
    <div className="generation-material-tools" aria-label={parametersPosition === 'top' ? '状态信息' : '模型状态'}>{status}</div>{submit}
  </footer>
  return <div className="generation-material-composer">
    {parametersPosition === 'top' && <div className="generation-composer-parameters" aria-label="参数区">{parameters}</div>}
    {associations && <aside aria-label="关联区" role="region" className="generation-material-basis">{associations}</aside>}
    <div className="generation-material-input" aria-label="输入区">{children}</div>
    {footerHost ? createPortal(footer, footerHost) : footer}
  </div>
}
