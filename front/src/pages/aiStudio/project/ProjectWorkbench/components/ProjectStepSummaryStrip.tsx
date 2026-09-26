import type { ReactNode } from 'react'
import { Button, Card, Space, Spin, Tag, Tooltip } from 'antd'
import { ArrowLeftOutlined, InfoCircleOutlined, RightOutlined } from '@ant-design/icons'
import {
  DISPLAY_STEPS,
  getDisplayStep,
  getDisplayStepIndex,
  getPrevProjectStepKey,
  type ProjectStepKey,
  type ProjectStepResolution,
} from '../projectSteps'

type ProjectStepSummaryStripProps = {
  /** 当前渲染的步骤 */
  step: ProjectStepKey
  /** resolveProjectStep 的结果 */
  resolution: ProjectStepResolution
  /** 当前集显示名，例如「第1集 出租屋里的争吵」 */
  chapterLabel: string | null
  /** 「返回修改」：回到上一步 */
  onGoStep: (step: ProjectStepKey) => void
  /** 「继续」：进入判定出的下一步/当前未完成步骤 */
  onContinue: () => void
  /**
   * 进度判定是否仍在进行（信号未抓完）。
   *
   * 为什么必须有：判定入参的初值是「全 0 快照」，在信号回来之前它会得出
   * 「项目还没有章节」这种确信但错误的结论，并把六步标签摆到一个错误的步骤上。
   * 加载期间只允许说「正在判断项目进度」，不允许给出任何结论。
   */
  loading?: boolean
  /**
   * 「继续」不可用的原因（非空则禁用按钮并把原因显示在 tooltip 里）。
   * 文案、目标步骤与点击动作必须同源，所以禁用理由与按钮文案都由调用方按同一份判定算出。
   */
  continueDisabledReason?: string
  /** 「继续」按钮文案（与顶部主按钮同一份判定算出的同一句话）。 */
  continueLabel?: string
  /**
   * 折叠起来的「技术详情」节点（默认收起）。
   *
   * 接口路径、字段口径、模型与供应商、原始状态值、任务编号、内部文件编号这类
   * 排查用的信息都收在里面，普通生产页面上一律不显示。
   */
  devInfo?: ReactNode
}

/**
 * 六步流程摘要条（T3/T4）：
 * - 当前步骤 + 描述；
 * - 完成当前步骤还缺什么（与 resolveProjectStep 同源）；
 * - 主行动按钮「继续」与「返回修改」；
 * - 排查用的内部信息统一挂在默认收起的「技术详情」里。
 * 刻意做得很薄——这是摘要条，不是仪表盘。
 */
export function ProjectStepSummaryStrip({
  step,
  resolution,
  chapterLabel,
  onGoStep,
  onContinue,
  loading = false,
  continueDisabledReason = '',
  continueLabel,
  devInfo,
}: ProjectStepSummaryStripProps) {
  // 用户看到的是五步：第 2 步内部由 extract_assets + image_prep 共同构成
  const display = getDisplayStep(step)
  const index = getDisplayStepIndex(step)
  const prevStep = getPrevProjectStepKey(step)
  // 同一个展示步骤内部的切换（extract_assets ↔ image_prep）不算「还没走到」
  const onResolvedStep = getDisplayStepIndex(resolution.step) === index
  const isLastStep = index === DISPLAY_STEPS.length - 1

  // 判定中：只说明正在判定，不摆任何结论（步骤标签、缺失项、继续按钮全部让位）。
  if (loading) {
    return (
      <Card size="small" className="mb-3" styles={{ body: { padding: '8px 12px' } }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <Spin size="small" />
            <span>正在判断项目进度…</span>
            <span className="text-gray-400">（读取章节、分镜、资产与提示词状态后给出下一步）</span>
          </div>
          <Space size="small" className="shrink-0">
            <Button size="small" type="primary" icon={<RightOutlined />} disabled loading>
              正在判断项目进度
            </Button>
          </Space>
        </div>
        {devInfo ? <div className="mt-2">{devInfo}</div> : null}
      </Card>
    )
  }

  return (
    <Card size="small" className="mb-3" styles={{ body: { padding: '8px 12px' } }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag color="blue" className="mr-0">
              第 {index + 1} 步 / 共 {DISPLAY_STEPS.length} 步
            </Tag>
            <span className="font-medium">{display.label}</span>
            <span className="text-xs text-gray-500 truncate">{display.description}</span>
            {chapterLabel ? (
              <Tag bordered={false} className="mr-0 text-[11px]">
                当前集：{chapterLabel}
              </Tag>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-600">
            <span className="text-gray-500">
              {onResolvedStep
                ? '当前缺失：'
                : `当前未完成步骤：第 ${getDisplayStepIndex(resolution.step) + 1} 步 ${getDisplayStep(resolution.step).label} ·`}
            </span>
            {resolution.missing.length > 0 ? (
              resolution.missing.map((item) => (
                <Tag key={item} color="gold" bordered={false} className="mr-0 text-[11px]">
                  {item}
                </Tag>
              ))
            ) : (
              <Tag color="green" bordered={false} className="mr-0 text-[11px]">
                没有阻塞项
              </Tag>
            )}
            {!onResolvedStep ? (
              <Tooltip title={resolution.reason}>
                <InfoCircleOutlined className="text-gray-400" />
              </Tooltip>
            ) : null}
          </div>
        </div>

        <Space size="small" className="shrink-0">
          {prevStep ? (
            <Button size="small" type="text" icon={<ArrowLeftOutlined />} onClick={() => onGoStep(prevStep)}>
              返回修改
            </Button>
          ) : null}
          <Tooltip title={continueDisabledReason || resolution.reason}>
            <Button
              size="small"
              type="primary"
              icon={<RightOutlined />}
              disabled={Boolean(continueDisabledReason)}
              onClick={onContinue}
            >
              {continueLabel ?? (isLastStep && onResolvedStep ? '生成与交付' : `继续：${resolution.nextActionLabel}`)}
            </Button>
          </Tooltip>
        </Space>
      </div>

      {devInfo ? <div className="mt-2">{devInfo}</div> : null}
    </Card>
  )
}
