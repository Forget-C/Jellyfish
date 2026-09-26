/**
 * 生成入口的「点击前状态条」。
 *
 * 统一显示五类状态里的当前一类：已配置但被 DRY_RUN 阻止 / 模型未配置 /
 * 参数缺失 / 服务错误 / 正在处理。默认显示门禁与模型配置，
 * 调用方传入 `failure` 时改为显示本次失败的真实原因（不再出现 `status=unknown` 这种空话）。
 */

import { Alert, Space, Tag } from 'antd'
import type { GenerationFailure, GenerationGateInfo, GenerationGateSnapshot } from './generationGate'
import { classifyGenerationFailure, describeGenerationGate } from './generationGate'
import type { GenerationOutlet } from './generationGate'
import { GENERATION_GATE_STATE, labelFor } from './enumLabels.ts'
import { buildUserFacingMessage } from './userFacingMessage.ts'
// 阶段 B ①：技术详情折叠壳全仓唯一实现（不再各页自建折叠区）
import { TechnicalDetailSection } from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'

type GenerationGateBannerProps = {
  gate: GenerationGateSnapshot
  outlet: GenerationOutlet
  /** 正在处理中（请求已发出） */
  running?: boolean
  runningText?: string
  /** 本次失败的分类结果；传了就优先显示失败原因 */
  failure?: GenerationFailure | null
  /** 失败时的原始异常（没传 failure 时由它自动分类） */
  error?: unknown
  compact?: boolean
}

export function GenerationGateBanner({
  gate,
  outlet,
  running = false,
  runningText,
  failure,
  error,
  compact = false,
}: GenerationGateBannerProps) {
  const resolvedFailure = failure ?? (error ? classifyGenerationFailure(error, outlet) : null)
  /**
   * 失败分支（审计 §4.4 模式 6）：原来把 `resolvedFailure.reason`（后端原文）
   * 直接拼进 Alert 的 description。现在主区只留中文结论，
   * 原文经三级管道后进默认收起的「技术详情」。
   */
  const failureView = resolvedFailure !== null ? buildUserFacingMessage(resolvedFailure.reason, '生成失败，请稍后重试') : null
  const info: GenerationGateInfo =
    resolvedFailure !== null && failureView
      ? {
          state: resolvedFailure.state,
          tone: resolvedFailure.tone,
          label: resolvedFailure.title,
          description: failureView.title,
          technicalDetail: failureView.detail,
        }
      : describeGenerationGate(gate, outlet, { running, runningText })

  const toneToAlert: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
    success: 'success',
    warning: 'warning',
    error: 'error',
    info: 'info',
  }

  return (
    <Alert
      type={toneToAlert[info.tone] ?? 'info'}
      showIcon
      message={
        <Space size={6} wrap>
          <span className="text-xs font-medium">{info.label}</span>
          {/* 审计 §4.4 模式 3：这里原来直渲 `状态：{info.state}`，把 ready / dry_run /
              not_configured 这类英文枚举原值摆到 Alert 主行。改走唯一映射表，未登记值给中文兜底。 */}
          <Tag bordered={false} className="mr-0 text-[10px]">
            状态：{labelFor(GENERATION_GATE_STATE, info.state)}
          </Tag>
        </Space>
      }
      description={
        compact ? undefined : (
          <div className="space-y-1">
            <span className="text-xs">{info.description}</span>
            {info.technicalDetail ? (
              <TechnicalDetailSection testId={`generation-gate-detail-${outlet}`}>
                <div className="text-[11px] leading-5 text-gray-600">{info.technicalDetail}</div>
              </TechnicalDetailSection>
            ) : null}
          </div>
        )
      }
      style={{ marginBottom: compact ? 0 : 8 }}
    />
  )
}

export default GenerationGateBanner
