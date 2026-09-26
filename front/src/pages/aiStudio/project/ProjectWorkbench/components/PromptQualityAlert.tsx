/**
 * 提示词质量的**统一呈现**（批量面板与结果卡片共用一份文案）。
 *
 * 用户要求：当提示词不可用（外观信息不足 / 空 / 只有名称+通用摄影词 / 多个资产高度重复）时，
 * **不得**显示成「提示词已就绪」、**不得**让它当成可用提示词进批量出图；
 * 页面要给出**真实原因 + 怎么修**（后端结构化中文原因优先）。
 */

import { Alert, Tag, Tooltip } from 'antd'
import { buildQualityNotice, type PromptQualityVerdict } from './assetPromptQuality.ts'

const TONE_COLOR: Record<string, string> = {
  error: 'red',
  warning: 'gold',
  info: 'default',
}

export type PromptQualityAlertProps = {
  verdict: PromptQualityVerdict
  /** 紧凑模式（卡片里用，少占地方） */
  compact?: boolean
  /** 前缀（例如资产名） */
  prefix?: string
}

export function PromptQualityAlert({ verdict, compact, prefix }: PromptQualityAlertProps) {
  const notice = buildQualityNotice(verdict)
  return (
    <Alert
      type={notice.tone}
      showIcon
      banner={compact}
      style={compact ? { padding: '2px 8px' } : undefined}
      message={
        <span className={compact ? 'text-[11px]' : 'text-xs'}>
          {prefix ? `${prefix}：` : ''}
          {notice.title}
        </span>
      }
      description={
        compact ? undefined : (
          <ul className="list-disc pl-5 text-[11px] leading-5">
            {notice.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )
      }
    />
  )
}

/** 标签形态（表格列/卡片头部用）：不出现「已就绪」这类说法。 */
export function PromptQualityTag({ verdict }: { verdict: PromptQualityVerdict }) {
  const color =
    verdict.status === 'usable' ? 'green' : verdict.status === 'unusable' ? TONE_COLOR.error : TONE_COLOR.warning
  return (
    <Tooltip title={verdict.reason}>
      <Tag color={color} bordered={false} className="mr-0">
        {verdict.label}
      </Tag>
    </Tooltip>
  )
}

export default PromptQualityAlert
