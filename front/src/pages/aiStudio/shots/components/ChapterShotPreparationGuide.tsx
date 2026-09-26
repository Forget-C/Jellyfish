import { useMemo, useState } from 'react'
import { Button, Tag, Tooltip } from 'antd'
import { DownOutlined, UpOutlined } from '@ant-design/icons'

type ChecklistItem = {
  key: string
  label: string
  tone: 'success' | 'warning' | 'default'
  text: string
}

type ChapterShotPreparationGuideProps = {
  statusReady: boolean
  checklistItems: readonly ChecklistItem[]
  nextStepTitle: string
  nextStepDescription: string
  /**
   * 继续项目流程：回到项目工作台的下一个步骤。
   *
   * 以前这里叫 onGoToStudio，直接跳分镜工作室——分镜刚做完就进工作室会跳过
   * 资产提取 / 图片准备 / 整集提示词 / 关联绑定。现在交给六步流程。
   */
  onContinueFlow: () => void
}

export function ChapterShotPreparationGuide({
  statusReady,
  checklistItems,
  nextStepTitle,
  nextStepDescription,
  onContinueFlow,
}: ChapterShotPreparationGuideProps) {
  const [expanded, setExpanded] = useState(false)

  const warningCount = useMemo(
    () => checklistItems.filter((item) => item.tone !== 'success').length,
    [checklistItems],
  )

  const summaryText = statusReady
    ? '已完成准备，可继续项目流程。'
    : `还有 ${warningCount} 项待处理，建议先继续完成准备。`

  return (
    <div
      className="rounded-xl border px-3 py-2"
      style={{
        borderColor: statusReady ? '#86efac' : '#cbd5e1',
        background: statusReady ? '#f0fdf4' : '#f8fafc',
      }}
    >
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Tag color={statusReady ? 'green' : 'gold'} className="m-0">
              {statusReady ? '准备完成' : '待继续准备'}
            </Tag>
            <span className="text-sm font-medium text-slate-900">{nextStepTitle}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">{summaryText}</div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="small"
            type="text"
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '收起' : '详情'}
          </Button>
          <Tooltip title="回到项目工作台，按顺序继续：剧本与分镜 → 资产准备 → 整集视频提示词 → 资产与声音绑定 → 生成与交付。分镜工作室保留单镜查看与补漏。">
            <Button
              type={statusReady ? 'primary' : 'default'}
              size="small"
              onClick={onContinueFlow}
            >
              下一步：提取资产
            </Button>
          </Tooltip>
        </div>
      </div>

      {expanded ? (
        <div className="mt-2 space-y-2 border-t border-slate-200/70 pt-2">
          <div className="rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-600">
            这里负责当前镜头的准备工作：提取并确认资产、对白和基础信息。完成后再回到项目工作台继续后续步骤
            （剧本与分镜 → 资产准备 → 整集视频提示词 → 资产与声音绑定 → 生成与交付）。
          </div>

          <div className="flex flex-wrap gap-2">
            {checklistItems.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border px-3 py-2 bg-white/70 min-w-[160px] flex-1"
                style={{
                  borderColor:
                    item.tone === 'success'
                      ? '#86efac'
                      : item.tone === 'warning'
                        ? '#fcd34d'
                        : '#dbeafe',
                  background:
                    item.tone === 'success'
                      ? '#f0fdf4'
                      : item.tone === 'warning'
                        ? '#fffbeb'
                        : '#f8fafc',
                }}
              >
                <div className="text-[11px] text-gray-500 mb-1">{item.label}</div>
                <div className="text-xs font-medium text-gray-900">{item.text}</div>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-500">{nextStepDescription}</div>
        </div>
      ) : null}
    </div>
  )
}
