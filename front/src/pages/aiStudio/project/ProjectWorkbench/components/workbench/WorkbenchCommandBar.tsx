/**
 * 工作台顶部**唯一的批量操作区**（参考项目 `#scriptCommandBar` / `.production-command` 的 sticky 口径）。
 *
 * 一屏只回答三件事：
 *   ① 现在该做什么（推荐操作标题 + 明细行）；
 *   ② 能不能做（主按钮文案与禁用一律来自 `deriveWorkbenchCommand` 的同一条状态机）；
 *   ③ 做到哪了（统一任务进度条，数字来自既有批量提交与结果状态，不另建轮询）。
 *
 * 用户点名（需求 9）：后台维度的那些词一个都不许出现在这里 ——
 * 完整清单在 `workbenchState.MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS`，
 * 由 `workbenchState.test.ts` 对**本文件源码**逐词断言（连注释都不放过）。
 */

import { Button, Dropdown, Progress, Space, Tag, Tooltip, Typography } from 'antd'
import {
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'

import {
  WORKBENCH_STATUS_LABEL,
  WORKBENCH_STATUS_ORDER,
  WORKBENCH_TAB_LABEL,
  WORKBENCH_TABS,
  describePendingReview,
  workbenchAnalysisHintMainText,
  workbenchAnalysisStatusLabel,
  type WorkbenchAnalysisLike,
  type WorkbenchCommand,
  type WorkbenchItemLike,
  type WorkbenchStatusCounts,
  type WorkbenchTypeCounts,
} from './workbenchState.ts'
/* 技术详情**只能**用全仓唯一的折叠壳（审计 §9-2 / §8.1.1-1）：
   这里不带任何内部字段名的显示标签，标签由折叠壳自己拼。 */
import { TechnicalDetailSection } from './TechnicalDetailCollapse.tsx'
import { buildUserFacingMessage } from '../../../../components/userFacingMessage.ts'
import { ASPECT_RATIO_OPTIONS } from '../assetProduction.ts'

export type WorkbenchCommandBarProps = {
  chapterLabel: string
  scriptChars: number
  /** 后端 `analysis`（含用户语言的 hint） */
  analysis: WorkbenchAnalysisLike | null
  /** 分析按钮（文案与是否主按钮由 `deriveAnalysisAction` 决定） */
  analysisLabel: string
  analysisPrimary: boolean
  analysisRunning: boolean
  onRunAnalysis: () => void
  /** 主按钮状态机的结果 */
  command: WorkbenchCommand
  /** 本轮任务进度（既有的批量提交与结果状态） */
  progress: { done: number; failed: number; generating: number; queued: number; total: number; percent: number; hasFailure: boolean }
  busy: boolean
  onGenerate: () => void
  onRegenerate: () => void
  /**
   * **「批量生成图」按钮**（需求清单第 2 条第 2 项）：与主按钮（可能是「生成图片提示词」）
   * **并排常驻**，让"已有提示词、想直接出图"的用户不必先绕一圈。
   */
  onGenerateImages: () => void
  onSelectAll: () => void
  onSelectUngenerated: () => void
  onClearSelection: () => void
  onStop: () => void
  onClearResults: () => void
  /** 生成设置（沿用既有 assetProduction 的 draw 口径） */
  aspectRatio: string
  onAspectRatioChange: (value: string) => void
  typeCounts: WorkbenchTypeCounts
  statusCounts: WorkbenchStatusCounts
  items: WorkbenchItemLike[]
  selectedKeys: string[]
  activeTab: (typeof WORKBENCH_TABS)[number]
  onSelectTab: (tab: (typeof WORKBENCH_TABS)[number]) => void
  pendingReviewCount: number
  pendingReviewLabel: string
  onOpenPendingReview: () => void
  hasPendingReview: boolean
}

/** 页签上要显示"这一类里有多少项"（与下方网格用的是同一份清单）。 */
function tabItems(items: WorkbenchItemLike[], tab: string): WorkbenchItemLike[] {
  return items.filter((item) => String(item.asset_type ?? '') === tab)
}

export function WorkbenchCommandBar(props: WorkbenchCommandBarProps) {
  const {
    chapterLabel,
    scriptChars,
    analysis,
    analysisLabel,
    analysisPrimary,
    analysisRunning,
    onRunAnalysis,
    command,
    progress,
    busy,
    onGenerate,
    onRegenerate,
    onGenerateImages,
    onSelectAll,
    onSelectUngenerated,
    onClearSelection,
    onStop,
    onClearResults,
    aspectRatio,
    onAspectRatioChange,
    typeCounts,
    statusCounts,
    items,
    activeTab,
    onSelectTab,
    pendingReviewCount,
    pendingReviewLabel,
    onOpenPendingReview,
    hasPendingReview,
  } = props

  const analyzed = analysis ? analysis.generated === true : true
  /* 主区的分析状态与下一步说明必须是**本页自己写死的句子**（审计 §7.1-8）：
     后端 `status_label` / `hint` 一律不上主区，只进下面默认收起的「技术详情」。 */
  const analysisStatusLabel = workbenchAnalysisStatusLabel(analysis)
  const analysisHintMain = workbenchAnalysisHintMainText(analysis)
  /* 折叠层只看**掩码 + 洗过**的原文（§7.1-6 的三级顺序里前两级，保留原始措辞便于排查）。 */
  const analysisHintDetail = analysis?.hint ? buildUserFacingMessage(analysis.hint).detail : ''
  const analysisStatusDetail = [String(analysis?.status ?? '').trim(), String(analysis?.status_label ?? '').trim()]
    .filter(Boolean)
    .join(' / ')

  return (
    <section
      data-testid="workbench-command-bar"
      className="sticky top-0 z-10 rounded-lg border border-slate-300 bg-white/95 px-3 py-2 shadow-sm"
      style={{ backdropFilter: 'blur(8px)' }}
    >
      {/* 当前章节（集名 + 剧本字数） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Space size={8} wrap>
          <span className="text-[11px] text-gray-500">当前章节</span>
          <span className="text-sm font-medium text-slate-900">{chapterLabel}</span>
          <Tag bordered={false}>{`剧本 ${scriptChars} 字`}</Tag>
          {analysisStatusLabel ? (
            <Tag bordered={false} data-testid="analysis-status">
              {analysisStatusLabel}
            </Tag>
          ) : null}
        </Space>
        <Space size={6} wrap>
          {hasPendingReview ? (
            <Button size="small" onClick={onOpenPendingReview} data-testid="pending-review-entry">
              {pendingReviewLabel}
            </Button>
          ) : (
            <Tag bordered={false}>{describePendingReview(pendingReviewCount)}</Tag>
          )}
          <Tooltip title={analysisLabel === '重新分析本章资产' ? '重新分析只会更新资料，你手工改过的内容不会被覆盖' : ''}>
            <Button
              size="small"
              type={analysisPrimary ? 'primary' : 'default'}
              icon={<ReloadOutlined />}
              loading={analysisRunning}
              onClick={onRunAnalysis}
              data-testid="analysis-button"
            >
              {analysisLabel}
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* 四类数量 + 七个业务状态计数 */}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {WORKBENCH_TABS.map((tab) => (
          <Tag key={tab} bordered={false} color={tab === activeTab ? 'blue' : undefined}>
            {`${WORKBENCH_TAB_LABEL[tab]} ${typeCounts[tab]}`}
          </Tag>
        ))}
        <span className="mx-1 text-gray-300">|</span>
        {WORKBENCH_STATUS_ORDER.map((key) => (
          <Tag key={key} bordered={false} data-testid={`status-count-${key}`}>
            {`${WORKBENCH_STATUS_LABEL[key]} ${statusCounts[key]}`}
          </Tag>
        ))}
      </div>

      {/* 推荐操作 + 明细 + 唯一主操作区 */}
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="text-[11px] text-gray-500">推荐操作</div>
          <div className="text-[15px] font-medium text-slate-900" data-testid="command-title">
            {command.title}
          </div>
          <div className="text-[11px] text-gray-500" data-testid="command-detail">
            {command.detail}
          </div>
          {/* 主区：本页自己写的下一步说明（后端 hint 不在这里） */}
          {analysisHintMain ? (
            <Typography.Text type="secondary" className="text-[11px]" data-testid="analysis-hint">
              {analysisHintMain}
            </Typography.Text>
          ) : null}
        </div>

        <Space size={6} wrap>
          <Tooltip title={command.primaryDisabledReason}>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              disabled={command.primaryDisabled}
              loading={busy}
              onClick={onGenerate}
              data-testid="batch-generate"
            >
              {command.primaryLabel}
            </Button>
          </Tooltip>
          <Tooltip title={command.regenerateDisabled ? '先勾选已有图片的资产' : '对已有图片的资产再生成一张（会二次确认，不会自动替换定版图）'}>
            <Button
              disabled={command.regenerateDisabled}
              onClick={onRegenerate}
              data-testid="batch-regenerate"
            >
              {command.regenerateLabel}
            </Button>
          </Tooltip>
          {/*
            「批量生成图」**常驻**并与主按钮并排（需求清单第 2 条第 2 项）。
            主按钮是可变的（"下一步真正能做的事"）：选中项还没提示词时它会变成
            「生成图片提示词（N）」——那一刻界面上就没有任何批量出图入口了。
            这个按钮把"批量生成图"这件事**永远留在一个固定的位置上**。
            它故意**不做 primary**：主操作仍然只有一个（工作台既有约定），
            这里要解决的是"找不到入口"，不是再选一个主操作。
          */}
          <Tooltip title={command.generateImagesDisabled ? command.generateImagesDisabledReason : command.generateImagesHint}>
            <Button
              disabled={command.generateImagesDisabled}
              onClick={onGenerateImages}
              data-testid="batch-generate-images"
            >
              {command.generateImagesLabel}
            </Button>
          </Tooltip>
          <Button size="small" onClick={onSelectAll} data-testid="select-all">
            全选本页签
          </Button>
          <Button size="small" onClick={onSelectUngenerated} data-testid="select-ungenerated">
            只选未生成项
          </Button>
          <Button size="small" onClick={onClearSelection} data-testid="clear-selection">
            清空选择
          </Button>
          <Button size="small" danger disabled={!busy} onClick={onStop} data-testid="stop-run">
            停止后续
          </Button>
          <Button size="small" disabled={progress.total === 0} onClick={onClearResults} data-testid="clear-results">
            清空结果
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: ASPECT_RATIO_OPTIONS.map((option) => ({
                key: option.value,
                label: option.label,
                onClick: () => onAspectRatioChange(option.value),
              })),
            }}
          >
            <Button size="small" icon={<SettingOutlined />} data-testid="generation-settings">
              {`生成设置（画面比例 ${aspectRatio}）`}
            </Button>
          </Dropdown>
        </Space>
      </div>

      {/* 统一任务进度：总数 / 完成 / 生成中 / 失败，全部来自既有提交与结果状态 */}
      <div className="mt-2">
        <Progress
          percent={progress.percent}
          size="small"
          status={progress.hasFailure ? 'exception' : undefined}
          data-testid="task-progress"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-500">
          <Space size={6} wrap>
            <span>{`本轮共 ${progress.total} 项`}</span>
            <span>{`已完成 ${progress.done}`}</span>
            <span>{`生成中 ${progress.generating}`}</span>
            <span>{`生成失败 ${progress.failed}`}</span>
          </Space>
          {!analyzed ? (
            <span>本章还没有分析：先点「分析本章资产」，生成按钮在分析完成前不可用。</span>
          ) : (
            <span>{command.primaryHint || command.primaryDisabledReason || '选好资产后点主按钮即可批量生成'}</span>
          )}
        </div>
      </div>

      {/* 四个页签：页签同时决定下方卡片区显示哪一类 */}
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-2">
        {WORKBENCH_TABS.map((tab) => {
          const count = tabItems(items, tab).length
          return (
            <Button
              key={tab}
              size="small"
              type={tab === activeTab ? 'primary' : 'text'}
              onClick={() => onSelectTab(tab)}
              data-testid={`workbench-tab-${tab}`}
            >
              {`${WORKBENCH_TAB_LABEL[tab]}（${count}）`}
            </Button>
          )
        })}
      </div>

      {/*
        技术详情（默认收起）：后端 `analysis.status` / `status_label` / `hint` 的原文落点。

        审计 §4.5 模式 3/6 点名本文件 `:121` 与 `:173` 把后端原值直接渲在主区；
        收进这里之后，主区只剩上面那两句**本页自己写的**中文结论（§7.1-8）。
        折叠壳复用全仓唯一实现，本文件不出现任何内部字段名的显示标签（§8.1.1-1）。
      */}
      {analysisHintDetail || analysisStatusDetail || command.primaryDisabledDetail ? (
        <TechnicalDetailSection testId="command-bar-technical-detail" className="mt-2">
          <div className="space-y-0.5 text-[11px] leading-5 text-slate-500">
            {analysisStatusDetail ? <div>{`本次读取到的分析状态原始值：${analysisStatusDetail}`}</div> : null}
            {analysisHintDetail ? <div>{`分析给出的原始说明：${analysisHintDetail}`}</div> : null}
            {command.primaryDisabledDetail ? (
              <div>{`主按钮不可用时给出过的原始说明：${command.primaryDisabledDetail}`}</div>
            ) : null}
          </div>
        </TechnicalDetailSection>
      ) : null}
    </section>
  )
}

export default WorkbenchCommandBar
