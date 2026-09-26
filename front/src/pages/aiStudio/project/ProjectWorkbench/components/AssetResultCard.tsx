/**
 * 出图结果卡片（要求 11）。
 *
 * 只展示用户能决定的东西：生成图、**图片类型标签**、资产名称与类型、当前状态、以及
 * 「查看详情 / 编辑提示词 / 重新生成 / 采纳 / 设为定版 / 已定版标识」这几个动作。
 * 任务号、归一化状态、模型名、供应商一律**不在这里出现**（它们在默认收起的「技术详情」里）。
 *
 * 图片类型标签与按钮文案**都按 asset_type 取**（用户点名）：
 * 人物 = 参考图；场景 / 道具 / 服装 = 各自的资产图 / 设定图，
 * 卡片上不许把场景 / 道具的结果说成「参考图」。
 */

import { useState } from 'react'
import { Alert, Button, Card, Space, Tag, Tooltip, Typography } from 'antd'
import {
  CheckCircleFilled,
  PictureOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import {
  ASSET_TYPE_LABEL,
  describeTaskStatus,
  isPlaceholderUrl,
  type ProductionAsset,
  type ProductionTask,
} from './assetProduction'
import { buildResultKindTag, resultArtifactCopy } from './assetResultKind.ts'
import { PromptQualityAlert } from './PromptQualityAlert'
import { resolvePromptQuality } from './assetPromptQuality.ts'

const TONE_COLOR: Record<string, string> = {
  green: 'green',
  red: 'red',
  blue: 'blue',
  gold: 'gold',
  default: 'default',
}

export type AssetResultCardProps = {
  task: ProductionTask
  asset?: ProductionAsset
  /** 该卡片上的某个动作正在执行 */
  busy: boolean
  onViewDetail: (task: ProductionTask) => void
  onEditPrompt: (task: ProductionTask) => void
  /** 默认主流程：按提示词再生成一张参考图 */
  onRegenerate: (task: ProductionTask) => void
  /**
   * 可选返工流程：使用**已有参考图**重新生成（走 Jellyfish 自己的图片通道）。
   * 该资产还没有参考图时不给这个入口。
   */
  onRegenerateWithExistingReference: (task: ProductionTask) => void
  /** 该资产是否已有参考图（返工流程的前置条件） */
  canUseExistingReference: boolean
  /** 返工端点是否已上线（没上线就禁用并如实说明） */
  reworkAvailable: boolean
  reworkUnavailableHint: string
  onRetry: (task: ProductionTask) => void
  onAdopt: (task: ProductionTask) => void
  onSetPrimary: (task: ProductionTask) => void
  onRefresh: (task: ProductionTask) => void
}

export function AssetResultCard(props: AssetResultCardProps) {
  const { task, asset, busy } = props
  const [imageBroken, setImageBroken] = useState(false)
  const status = describeTaskStatus(task.status)
  /** 按类型取的结果文案：人物 = 参考图；场景/道具/服装 = 各自的图名（不让场景出现「参考图」） */
  const copy = resultArtifactCopy(task.assetType, {
    resultKind: task.resultKind,
    resultLabel: task.resultLabel,
  })
  /** 卡片上的**图片类型标签**：消费后端回包的 result_kind / result_label */
  const kindTag = buildResultKindTag(task.assetType, {
    resultKind: task.resultKind,
    resultLabel: task.resultLabel,
  })
  // 演练占位地址是不可达域名：不要拿它去发请求（页面会白报一堆网络错误），直接说明"这是演练占位"
  const rawUrl = task.adoptedUrl || task.ossUrl || task.imageUrl
  const previewUrl = rawUrl && !isPlaceholderUrl(rawUrl) ? rawUrl : ''
  /**
   * 这一张结果用的提示词**能不能用**（后端结构化判定优先，前端自查兜底）。
   *
   * 还在排队/生成中的卡片不判（那时提示词还没定），一旦有提示词或已经跑完就判：
   * 判定不可用时**不许**把这张的结果当成可用提示词继续出图（重生成/返工按钮会被拦住并说明原因）。
   */
  const promptQualityKnown = Boolean(task.prompt) || task.status === 'done' || task.status === 'failed'
  const promptQualityVerdict = promptQualityKnown
    ? resolvePromptQuality({
        prompt: task.prompt || '',
        assetName: task.assetName,
        serverQuality: task.promptQuality ?? null,
        serverWarnings: task.promptWarnings,
      })
    : null
  const promptBlocked = promptQualityVerdict?.status === 'unusable'
  const canAdopt = task.status === 'done' && !task.adoptedImageId
  // 「设为定版」在结果可用时就可以点：它内部会先把这张保存进资产、再设为定版；
  // 资产已有定版时会先弹二次确认（硬边界 B），不会静默替换。
  // 注意：提示词不可用**不拦**这一步 —— 那是"采纳已经生成的这张图"，不是再花钱出图。
  const canSetPrimary = task.status === 'done' && !task.isPrimary
  // 但**再生成**（重新生成 / 重试 / 返工）会被拦住：提示词不可用时再出图只会再浪费一次计费调用
  const canRetry = task.status === 'failed' && !promptBlocked
  const canRefresh = task.status === 'generating' || task.status === 'submitting'

  return (
    <Card size="small" className="h-full" styles={{ body: { padding: 12 } }}>
      <div className="flex gap-3">
        <div className="h-[96px] w-[96px] shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center">
          {previewUrl && !imageBroken ? (
            <img
              src={previewUrl}
              alt={task.assetName}
              className="h-full w-full object-cover"
              onError={() => setImageBroken(true)}
            />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-gray-400">
              <PictureOutlined />
              {task.status === 'dry_run' ? '演练占位（非真实图片）' : '暂无图片'}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1">
            <Tag color="purple" className="mr-0" bordered={false}>
              {ASSET_TYPE_LABEL[task.assetType]}
            </Tag>
            {/* 图片类型标签：本次这张到底属于哪一类结果（人物参考图 / 场景资产图 / 道具资产图 / 服装设定图） */}
            <Tooltip
              title={
                kindTag.fromServer
                  ? '这是本次出图结果自带的图片类型（后端按资产类型分流返回）'
                  : '后端回包里没有带图片类型字段，这里按资产类型给出的图片类型'
              }
            >
              <Tag color={kindTag.tone} className="mr-0" bordered={false}>
                {kindTag.label}
              </Tag>
            </Tooltip>
            <span className="truncate text-sm font-medium text-slate-900" title={task.assetName}>
              {task.assetName}
            </span>
            <Tag color={TONE_COLOR[status.tone]} bordered={false} className="mr-0">
              {status.label}
            </Tag>
            {task.isPrimary ? (
              <Tag color="green" bordered={false} className="mr-0">
                <CheckCircleFilled /> 已定版
              </Tag>
            ) : asset?.hasPrimary ? (
              <Tooltip title="该资产已有定版图；这张只是本次生成的结果，要换定版需要你手动确认">
                <Tag bordered={false} className="mr-0 text-gray-400">
                  未定版（资产已有定版）
                </Tag>
              </Tooltip>
            ) : null}
            {task.adoptedImageId !== null ? (
              <Tag color="blue" bordered={false} className="mr-0">
                已保存进资产
              </Tag>
            ) : null}
          </div>

          {task.errorMessage ? (
            <Alert
              type="error"
              showIcon
              banner
              style={{ padding: '2px 8px' }}
              message={<span className="text-[11px]">{task.errorMessage}</span>}
            />
          ) : task.note ? (
            <div className="text-[11px] text-slate-500">{task.note}</div>
          ) : null}

          {/*
            提示词质量：判定不可用时**不显示成"提示词已就绪"**，而是给出真实原因与怎么修。
            这里的拦截与批量面板用的是同一份文案（assetPromptQuality）。
          */}
          {promptQualityVerdict ? <PromptQualityAlert verdict={promptQualityVerdict} compact /> : null}

          <Typography.Paragraph
            className="!mb-0 text-[11px] text-gray-500"
            ellipsis={{ rows: 2, tooltip: task.prompt || '（还没有提示词）' }}
          >
            {task.prompt || '（还没有提示词）'}
          </Typography.Paragraph>

          <Space size={4} wrap>
            {canAdopt ? (
              <Tooltip title="把这张图存进该资产的图片里（不会自动改定版）">
                <Button size="small" type="primary" loading={busy} onClick={() => props.onAdopt(task)}>
                  采纳
                </Button>
              </Tooltip>
            ) : null}
            {canSetPrimary ? (
              <Tooltip title="把这张设为该资产的定版图（会先保存进资产）；资产已有定版时会先与你确认">
                <Button size="small" loading={busy} onClick={() => props.onSetPrimary(task)}>
                  设为定版
                </Button>
              </Tooltip>
            ) : null}
            <Button size="small" onClick={() => props.onEditPrompt(task)}>
              编辑提示词
            </Button>
            <Tooltip
              title={
                promptBlocked
                  ? `这一项不能按当前提示词再生成：${promptQualityVerdict?.reason ?? ''}（先点「编辑提示词」补好）`
                  : undefined
              }
            >
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={busy}
                disabled={promptBlocked}
                onClick={() => props.onRegenerate(task)}
              >
                {copy.regenerateAction}
              </Button>
            </Tooltip>
            {props.canUseExistingReference ? (
              <Tooltip
                title={
                  props.reworkAvailable
                    ? `该资产已有${copy.noun}：把这张作为输入重新生成一张（会先与你确认用哪张、会不会产生费用）`
                    : props.reworkUnavailableHint
                }
              >
                <Button
                  size="small"
                  disabled={!props.reworkAvailable || busy || promptBlocked}
                  onClick={() => props.onRegenerateWithExistingReference(task)}
                >
                  {copy.existingImageAction}
                </Button>
              </Tooltip>
            ) : null}
            {canRetry ? (
              <Button size="small" onClick={() => props.onRetry(task)}>
                重试这一项
              </Button>
            ) : null}
            {task.status === 'failed' && promptBlocked ? (
              <span className="text-[11px] text-red-500">提示词不可用：先按上面的原因补好再重试</span>
            ) : null}
            {canRefresh ? (
              <Button size="small" icon={<SyncOutlined />} onClick={() => props.onRefresh(task)}>
                刷新进度
              </Button>
            ) : null}
            <Button size="small" type="link" className="!px-1" onClick={() => props.onViewDetail(task)}>
              查看详情
            </Button>
          </Space>
        </div>
      </div>
    </Card>
  )
}

export default AssetResultCard
