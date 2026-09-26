/**
 * 「待处理 N 项」抽屉：只放后端给的待复核项（别名冲突 / 同名异类 / 多来源 / 服装缺资产）。
 *
 * 用户口径（本轮点名）：
 *   - **不要求**逐条确认"无冲突项" —— 这里只列真正需要人决定的那几项；
 *   - 每一项都要**看得到原因**，并且有一个"去处理"的入口；
 *   - 原因用中文说人话（后端枚举值不直接摆出来）。
 *
 * 阶段 B 第 5 批（审计 §4.5 模式 6，`:64`）：主区那一句改成**按类型映射出的中文结论**
 * （本页自己写死，§7.1-8），后端 `reason` 原文先过 `maskInternalIds` + `sanitizeUserText`
 * 再收进每行默认收起的「技术详情」——「看得到原因」这条要求由折叠区满足。
 */

import { Button, Drawer, Empty, Space, Tag, Typography } from 'antd'

import {
  WORKBENCH_TAB_LABEL,
  describePendingReview,
  describePendingReviewKind,
  pendingReviewReasonMainText,
} from './workbenchState.ts'
import { TechnicalDetailSection } from './TechnicalDetailCollapse.tsx'
import { buildUserFacingMessage } from '../../../../components/userFacingMessage.ts'
import type { WorkbenchAssetType } from './workbenchState.ts'
import type { AssetWorkbenchPendingReview } from './assetWorkbenchContract.ts'

const TYPE_BY_KEY: Record<string, WorkbenchAssetType> = {
  character: 'character',
  scene: 'scene',
  prop: 'prop',
  costume: 'costume',
}

export type PendingReviewDrawerProps = {
  open: boolean
  rows: AssetWorkbenchPendingReview[]
  onClose: () => void
  /** 「去处理」：按类型跳回对应页签 / 打开对应的资产卡 */
  onGoHandle: (row: AssetWorkbenchPendingReview) => void
}

export function PendingReviewDrawer(props: PendingReviewDrawerProps) {
  const { open, rows, onClose, onGoHandle } = props
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={520}
      title={describePendingReview(rows.length)}
      data-testid="pending-review-drawer"
    >
      {rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有需要你决定的项" />
      ) : (
        <div className="space-y-2">
          <Typography.Text type="secondary" className="text-[11px]">
            这里只列需要你决定的项：没有冲突的资产不需要逐条确认，直接在生产区里勾选生成即可。
          </Typography.Text>
          {rows.map((row, index) => (
            <div
              key={`${row.kind}-${row.name}-${index}`}
              className="rounded-lg border border-slate-200 px-3 py-2"
              data-testid="pending-review-row"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Space size={6} wrap>
                  <span className="text-sm font-medium text-slate-800">{row.name || '未命名'}</span>
                  <Tag bordered={false}>{describePendingReviewKind(row.kind)}</Tag>
                  <Tag bordered={false}>{WORKBENCH_TAB_LABEL[TYPE_BY_KEY[row.asset_type] ?? 'character']}</Tag>
                </Space>
                <Button size="small" onClick={() => onGoHandle(row)}>
                  去处理
                </Button>
              </div>
              <div className="mt-1 text-[12px] leading-5 text-slate-600">
                {pendingReviewReasonMainText(row.kind)}
              </div>
              {String(row.reason ?? '').trim() ? (
                <TechnicalDetailSection testId="pending-review-technical-detail" className="mt-1">
                  <div className="text-[11px] leading-5 text-slate-500">
                    {`这一项给出的原始原因：${buildUserFacingMessage(row.reason).detail}`}
                  </div>
                </TechnicalDetailSection>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}

export default PendingReviewDrawer
