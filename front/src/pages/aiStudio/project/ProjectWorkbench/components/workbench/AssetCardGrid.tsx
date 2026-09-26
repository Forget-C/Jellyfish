/**
 * 工作台的资产卡片网格（参考项目 `.results` 的 `repeat(auto-fill, minmax(260px, 1fr))` 密度）。
 *
 * 口径（用户点名，来源是原项目那套已验证的信息层级）：
 *   - **同一项资产只出现一次**：卡片就是这一项资产在这一屏里的唯一落点；
 *   - 卡片正面的信息只有用户看得懂的：名称 + 业务资料摘要 + 出场分镜 + 当前图片 + 状态词；
 *   - 状态文案只给用户语言（`status.label`），内部状态 / 模型 / 编号一律不上卡片；
 *   - 动作：编辑资料 / 修改提示词 / 单项生成或重新生成；
 *     提示词需要重新生成时，正面标出来并给单项入口（**点了才会调用，不自动调用**）。
 */

import type { ReactNode } from 'react'
import { Button, Checkbox, Empty, Tag, Tooltip } from 'antd'
import { PictureOutlined } from '@ant-design/icons'

import {
  WORKBENCH_PROMPT_REGENERATION_MAIN_TEXT,
  WORKBENCH_STATUS_TONE,
  WORKBENCH_TAB_LABEL,
  isBatchEligible,
  isWorkbenchSubmittable,
  needsPromptRegeneration,
  workbenchItemKey,
  workbenchItemName,
  workbenchItemType,
  workbenchStatusKey,
  workbenchStatusLabel,
  workbenchStatusNotice,
} from './workbenchState.ts'
import type { AssetWorkbenchItem } from './assetWorkbenchContract.ts'

const TONE_COLOR: Record<string, string | undefined> = {
  default: undefined,
  blue: 'blue',
  green: 'green',
  red: 'red',
  gold: 'gold',
  purple: 'purple',
}

export type AssetCardGridProps = {
  items: AssetWorkbenchItem[]
  selectedKeys: string[]
  /** 本轮正在提交 / 生成：卡片上的单项按钮跟着禁用 */
  busy: boolean
  onToggleSelect: (key: string, checked: boolean) => void
  /** 打开详情抽屉（点名称、点分镜、点「详情」都走它） */
  onOpenDetail: (item: AssetWorkbenchItem, focus?: { shotIndex?: number }) => void
  onEditPrompt: (item: AssetWorkbenchItem) => void
  onGenerateOne: (item: AssetWorkbenchItem, operation: 'generate' | 'regenerate') => void
  /** 资料编辑入口（由工作台注入既有「补充/修改资产资料」组件） */
  renderProfileEditor: (item: AssetWorkbenchItem) => ReactNode
}

export function AssetCardGrid(props: AssetCardGridProps) {
  const { items, selectedKeys, busy, onToggleSelect, onOpenDetail, onEditPrompt, onGenerateOne, renderProfileEditor } = props
  const selected = new Set(selectedKeys)

  if (items.length === 0) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="这一类还没有资产：先点上面的「分析本章资产」，确认后再回到这里生产图片"
      />
    )
  }

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
      data-testid="asset-card-grid"
    >
      {items.map((item) => {
        const key = workbenchItemKey(item)
        const type = workbenchItemType(item)
        const statusKey = workbenchStatusKey(item)
        const label = workbenchStatusLabel(item)
        const requiresNewPrompt = needsPromptRegeneration(item)
        const eligible = isBatchEligible(item)
        const submittable = isWorkbenchSubmittable(type)
        /** 单项生成按钮的禁用原因（不撒谎：能点就点，不能点就说清楚为什么） */
        const generateBlockedReason = !submittable
          ? '服装暂不支持批量出图，可以先保存资料与提示词'
          : requiresNewPrompt
            ? '这条提示词需要先重新生成提示词，再生成图片'
            : !eligible
              ? '这一项暂时不能直接出图：先按卡片上的提示补齐资料或提示词'
              : ''
        const hasImg = item.image?.has_image === true
        const thumbnail = String(item.image?.thumbnail ?? '')
        const shotRefs = item.script_relation?.shot_refs ?? []
        /* 审计 §4.5 模式 6（`:158`）：改前这里把 `item.status?.reason` 原文渲在卡片正面
           （原文来自 `assetWorkbenchContract.ts:249-250` 的 `toText(raw.reason)`，未掩码）。
           现在卡片正面只放**按业务状态键映射出的中文结论**；后端原文不在这里渲染 ——
           它的落点是「资产详情」抽屉里默认收起的「技术详情」（`AssetDetailDrawer`）。 */
        const statusNotice = workbenchStatusNotice(item)
        return (
          <article
            key={key}
            data-testid="asset-card"
            data-asset-key={key}
            data-asset-name={workbenchItemName(item)}
            className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2">
              <div className="flex min-w-0 items-start gap-2">
                <Checkbox
                  checked={selected.has(key)}
                  onChange={(event) => onToggleSelect(key, event.target.checked)}
                  aria-label={`选择 ${workbenchItemName(item)}`}
                />
                <div className="min-w-0">
                  <button
                    type="button"
                    className="block max-w-full truncate text-left text-sm font-medium text-slate-900 hover:text-blue-600"
                    title={workbenchItemName(item)}
                    onClick={() => onOpenDetail(item)}
                  >
                    {workbenchItemName(item)}
                  </button>
                  <div className="text-[11px] text-gray-400">{WORKBENCH_TAB_LABEL[type]}</div>
                </div>
              </div>
              <Tag bordered={false} color={TONE_COLOR[WORKBENCH_STATUS_TONE[statusKey]]}>
                {label}
              </Tag>
            </div>

            <div
              className="grid w-full place-items-center bg-slate-100 text-gray-400"
              style={{ aspectRatio: '16 / 9' }}
            >
              {thumbnail ? (
                <img src={thumbnail} alt={workbenchItemName(item)} className="h-full w-full object-cover" />
              ) : (
                <span className="flex items-center gap-1 text-[11px]">
                  <PictureOutlined />
                  还没有图片
                </span>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2">
              <div className="line-clamp-3 text-[12px] leading-5 text-slate-700" title={item.profile_digest}>
                {item.profile_digest || '这一章还没有它的资料摘要'}
              </div>
              {shotRefs.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-gray-400">出场分镜</span>
                  {shotRefs.slice(0, 6).map((shot) => (
                    <Tag
                      key={`${key}-shot-${shot.shot_index}`}
                      bordered={false}
                      className="cursor-pointer"
                      onClick={() => onOpenDetail(item, { shotIndex: shot.shot_index })}
                    >
                      {`第 ${shot.shot_index} 镜`}
                    </Tag>
                  ))}
                  {shotRefs.length > 6 ? <span className="text-[11px] text-gray-400">{`等 ${shotRefs.length} 个`}</span> : null}
                </div>
              ) : null}
              {statusNotice ? <div className="text-[11px] text-red-500">{statusNotice}</div> : null}
              {requiresNewPrompt ? (
                <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-700">
                  <div className="font-medium">提示词需要重新生成</div>
                  {/* 卡片正面只留写死的中文结论 + 按钮；后端 `quality.reasons[]` 数组
                      只进「资产详情」抽屉的技术详情层（审计 §4.5 模式 6，`:162`）。 */}
                  <div>{WORKBENCH_PROMPT_REGENERATION_MAIN_TEXT}</div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 px-2 py-2">
              <Button size="small" type="text" onClick={() => onOpenDetail(item)}>
                详情
              </Button>
              {renderProfileEditor(item)}
              <Button size="small" type="text" onClick={() => onEditPrompt(item)}>
                {requiresNewPrompt ? '重新生成提示词' : '修改提示词'}
              </Button>
              {hasImg ? (
                <Tooltip title={generateBlockedReason}>
                  <Button
                    size="small"
                    type="text"
                    disabled={busy || Boolean(generateBlockedReason)}
                    onClick={() => onGenerateOne(item, 'regenerate')}
                  >
                    重新生成图片
                  </Button>
                </Tooltip>
              ) : (
                <Tooltip title={generateBlockedReason}>
                  <Button
                    size="small"
                    type="text"
                    disabled={busy || Boolean(generateBlockedReason)}
                    onClick={() => onGenerateOne(item, 'generate')}
                  >
                    生成图片
                  </Button>
                </Tooltip>
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default AssetCardGrid
