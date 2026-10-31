import { useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CanvasEditorFooter } from './CanvasCardEditor'

/** 三类模型共用三区骨架；固定参数状态条不随正文滚动，业务采用与提交仍由调用方控制。 */
export function ModelComposer({ associations, children, parameters, status, submit }: {
  associations: ReactNode; children: ReactNode; parameters: ReactNode; status: ReactNode; submit: ReactNode
}) {
  const footerHost = useContext(CanvasEditorFooter)
  const footer = <footer className="generation-material-footer" aria-label="参数状态区">
    <div className="generation-material-parameters" aria-label="模型参数">{parameters}</div>
    <span className="generation-material-divider" aria-hidden="true">|</span>
    <div className="generation-material-tools" aria-label="模型状态">{status}</div>{submit}
  </footer>
  return <div className="generation-material-composer">
    <aside aria-label="关联区" role="region" className="generation-material-basis">{associations}</aside>
    <div className="generation-material-input" aria-label="输入区">{children}</div>
    {footerHost ? createPortal(footer, footerHost) : footer}
  </div>
}
