import type { CSSProperties, ReactNode } from 'react'
import { ConfigProvider, Tooltip, theme } from 'antd'
import { workbenchTokens } from '../directing/ui/WorkbenchTheme'
import './editorAttribute.css'

/** 顶部属性共享标签和稳定提示位；控件保留各自的提交与校验行为。 */
export function EditorAttribute({ id, label, required, help, error, value, locked, children }: { id: string; label: string; required?: boolean; help?: string; error?: string; value?: string; locked?: boolean; children: ReactNode }) {
  const { token } = theme.useToken()
  return <div style={{ '--attribute-error': token.colorError } as CSSProperties} className="generation-attribute" data-error={!!error}>
    <label className="generation-attribute-label" htmlFor={id}>{label}{required && <span> *</span>}</label>
    <ConfigProvider theme={{ token: { colorBgContainer: workbenchTokens.surface, colorBorder: workbenchTokens.border } }}><Tooltip zIndex={1040} overlayStyle={{ pointerEvents: 'none' }} placement="bottomLeft" title={value} trigger={['hover', 'focus']}><div className="generation-attribute-control" data-locked={locked} tabIndex={locked ? 0 : undefined}>{children}</div></Tooltip></ConfigProvider>
    <div className="generation-attribute-hint" id={`${id}-hint`} role={error ? 'alert' : undefined}>{error || <span className="generation-attribute-help">{help || '\u00a0'}</span>}</div>
  </div>
}
