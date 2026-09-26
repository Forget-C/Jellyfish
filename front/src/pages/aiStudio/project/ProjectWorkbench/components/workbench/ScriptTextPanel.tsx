/**
 * 工作台左侧的**剧本原文**面板（参考项目 `.workspace` 的两栏口径：左 360~390px + 右主区）。
 *
 * 为什么要它：用户在卡片上看到「出场分镜 3」时，必须当场能读到那一段剧本原文，
 * 不然就只能凭记忆判断卡片上的资料对不对。折叠后主区自动变宽（1440×900 下仍然能操作）。
 */

import { Button, Tag, Tooltip, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'

export type ScriptShotRef = {
  shotIndex: number
  title: string
  excerpt: string
}

type ScriptTextPanelProps = {
  chapterIndex: number | null
  chapterTitle: string
  scriptChars: number
  rawText: string
  /** 本章全部出场分镜（由工作台从资产关系里汇总并去重） */
  shots: ScriptShotRef[]
  collapsed: boolean
  onToggleCollapsed: () => void
  /** 点某一镜：主区滚到对应资产的卡片 */
  onFocusShot: (shotIndex: number) => void
}

export function ScriptTextPanel(props: ScriptTextPanelProps) {
  const { chapterIndex, chapterTitle, scriptChars, rawText, shots, collapsed, onToggleCollapsed, onFocusShot } = props

  if (collapsed) {
    return (
      <div className="flex h-full w-9 flex-col items-center gap-2 border-r border-slate-200 bg-slate-50 py-2">
        <Tooltip title="展开剧本原文" placement="right">
          <Button size="small" type="text" icon={<RightOutlined />} onClick={onToggleCollapsed} />
        </Tooltip>
        <span className="text-[11px] text-gray-500" style={{ writingMode: 'vertical-rl' }}>
          剧本原文
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium text-slate-800" title={chapterTitle}>
            {chapterIndex === null ? chapterTitle : `第 ${chapterIndex} 集 · ${chapterTitle}`}
          </div>
          <div className="text-[11px] text-gray-500">{`剧本 ${scriptChars} 字`}</div>
        </div>
        <Tooltip title="收起剧本原文（主区会变宽）">
          <Button size="small" type="text" icon={<LeftOutlined />} onClick={onToggleCollapsed} />
        </Tooltip>
      </div>

      {shots.length > 0 ? (
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="mb-1 text-[11px] text-gray-500">{`本章出场分镜 ${shots.length} 个`}</div>
          <div className="flex flex-wrap gap-1">
            {shots.map((shot) => (
              <Tooltip key={shot.shotIndex} title={shot.excerpt || shot.title}>
                <Tag
                  bordered={false}
                  color="blue"
                  className="cursor-pointer"
                  onClick={() => onFocusShot(shot.shotIndex)}
                >
                  {`第 ${shot.shotIndex} 镜`}
                </Tag>
              </Tooltip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {rawText.trim() ? (
          <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-[12px] leading-6 text-slate-700">
            {rawText}
          </Typography.Paragraph>
        ) : (
          <span className="text-[11px] text-gray-400">
            这一集还没有剧本正文：请先在第 1 步粘贴或导入剧本。
          </span>
        )}
      </div>
    </div>
  )
}

export default ScriptTextPanel
