import { theme } from 'antd'
import type { ReactNode } from 'react'

/** 执行状态和业务结论保留文字，语义色直接取宿主 AntD 主题。 */
export function CheckStatus({ status, children }: { status: string; children?: ReactNode }) {
  const { token } = theme.useToken()
  const color = ['明确问题', '执行失败'].includes(status) ? token.colorError
    : ['待重查', '无法判断', '风险建议'].includes(status) ? token.colorWarning
      : status === '符合' ? token.colorSuccess : token.colorTextSecondary
  return <span className="generation-check-status" data-check-status={status} style={{ color }}>{children || status}</span>
}
