import type React from 'react'
/**
 * 「生成依据」面板（用户点名：**默认收起**）。
 *
 * 用户的问题：图片提示词生成结果里大量出现「外观信息不足、需人工补充」，
 * 说明**生成时并没有拿到剧本里的资产资料**。所以每次生成之后，
 * 用户要能当场看到**本次实际用了什么**：
 *   ① 项目整体风格 ② 该资产的结构化资料 ③ 相关的剧本片段与分镜依据
 *   ④ 用户自己的补充/修改 ⑤ 该资产类型的出图要求
 *
 * 三条硬口径：
 *   1. **默认收起**（`defaultActiveKey={[]}`），收起时只在标题旁给一行摘要；
 *   2. **不编造**：后端没返回的项显示「本次未提供」；整块没字段时显示
 *      「本次未提供生成依据」，但**渲染位置保留**（字段上线后自动出现）；
 *   3. **技术字段进「技术详情」**：字段名只放在默认收起的嵌套区块里
 *      （antd Collapse 默认不渲染未展开面板的内容，所以主界面上不会出现它们）。
 */

import { Alert, Collapse, Descriptions, Tag, Typography } from 'antd'
import {
  GLOBAL_ASSET_SCOPE_NOTE,
  BASIS_ITEM_EMPTY_TEXT,
  BASIS_PANEL_HINT,
  BASIS_PANEL_PLACEHOLDER,
  BASIS_PANEL_TITLE,
  BASIS_TECHNICAL_TITLE,
  buildBasisItems,
  describeBasisAvailability,
  describeBasisFieldNames,
  readGenerationBasis,
  summarizeGenerationBasis,
  type GenerationBasis,
  type GenerationBasisExtras,
} from './assetGenerationBasis.ts'

export type AssetGenerationBasisPanelProps = {
  /** 后端回包（整包 / 槽位 / 就是依据对象本身都可以），依据字段由本组件容错读取 */
  payload?: unknown
  /** 已经解析好的依据（给了就不再解析 payload） */
  basis?: GenerationBasis
  /**
   * 调用方（前端）自己知道的证据：④ 脱敏请求结构 / ⑤ 最终提示词与差异 / 是否全局资产。
   *
   * 这几样后端回包里不会有（它们是"本次真的发生了什么"），所以由调用方如实传进来；
   * 不传就显示「本次未提供」，不假装有。
   */
  extras?: GenerationBasisExtras
  /** 标题右侧的补充说明（例如「本次生成」/资产名） */
  caption?: string
  /** 默认是否展开（默认收起，用户点名） */
  defaultOpen?: boolean
  /** 是否显示「技术详情：本次用到的字段名」（默认显示；只在展开时渲染） */
  showTechnical?: boolean
  /**
   * 面板下方的操作区（可选）：例如「补充/修改资产资料」入口。
   *
   * 为什么要一个插槽：用户要求这个入口要出现在**每项资产的「生成依据」附近**，
   * 而「生成依据」由本组件渲染 —— 插槽能让入口跟着依据走，不必在每个调用点各写一遍定位逻辑。
   * 折叠收起时也显示（用户不必先展开依据才能补资料）。
   */
  footer?: React.ReactNode
}

export function AssetGenerationBasisPanel(props: AssetGenerationBasisPanelProps) {
  const basis = props.basis ?? readGenerationBasis(props.payload, props.extras ?? {})
  const items = buildBasisItems(basis)
  const summary = summarizeGenerationBasis(basis)
  const availability = describeBasisAvailability(basis)
  const defaultActiveKey = props.defaultOpen ? ['basis'] : []

  const panel = (
    <Collapse
      ghost
      size="small"
      defaultActiveKey={defaultActiveKey}
      items={[
        {
          key: 'basis',
          label: (
            <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-medium text-slate-700">{BASIS_PANEL_TITLE}</span>
              <Tag color={basis.available ? 'blue' : 'default'} bordered={false} className="mr-0">
                {summary}
              </Tag>
              {props.caption ? <span className="text-[11px] text-gray-400">{props.caption}</span> : null}
            </span>
          ),
          children: (
            <div className="space-y-2">
              <Typography.Text type="secondary" className="text-[11px]">
                {BASIS_PANEL_HINT}
              </Typography.Text>
              <Alert
                type={basis.available ? 'success' : 'warning'}
                showIcon
                message={<span className="text-xs">{availability}</span>}
              />
              {basis.globalAsset ? (
                <Alert
                  type="info"
                  showIcon
                  banner
                  style={{ padding: '2px 8px' }}
                  message={<span className="text-[11px]">{GLOBAL_ASSET_SCOPE_NOTE}</span>}
                />
              ) : null}
              <Descriptions size="small" column={1} bordered>
                {items.map((item) => (
                  <Descriptions.Item key={item.key} label={<span className="text-xs">{item.label}</span>}>
                    {item.provided ? (
                      <ul className="list-disc pl-5 text-xs leading-5">
                        {item.lines.map((line, index) => (
                          <li key={`${item.key}-${index}`}>{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-xs text-gray-400">{BASIS_ITEM_EMPTY_TEXT}</span>
                    )}
                  </Descriptions.Item>
                ))}
              </Descriptions>
              {props.showTechnical !== false ? (
                <Collapse
                  ghost
                  size="small"
                  items={[
                    {
                      key: 'basis-tech',
                      label: (
                        <span className="text-[11px] text-gray-500">
                          {`${BASIS_TECHNICAL_TITLE}：本次用到的字段名`}
                        </span>
                      ),
                      children: (
                        <div className="space-y-1 text-[11px] text-gray-500">
                          <div>{`命中的依据字段：${describeBasisFieldNames(basis)}`}</div>
                          <div>{`面板占位：${BASIS_PANEL_PLACEHOLDER}`}</div>
                        </div>
                      ),
                    },
                  ]}
                />
              ) : null}
            </div>
          ),
        },
      ]}
    />
  )

  if (!props.footer) return panel
  return (
    <div className="space-y-1">
      {panel}
      <div className="pl-1">{props.footer}</div>
    </div>
  )
}

export default AssetGenerationBasisPanel
