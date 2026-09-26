/**
 * 工作室中间区：**本镜生产的连续工作区**（第三部分要求）。
 *
 * 为什么是一块而不是一排页签：原来「手动分镜」「视频准备」「分镜生产卡」三处各有一套
 * 提示词编辑、绑定查看、帧查看与生成入口，用户不知道以哪一处为准。现在合成**一个区域、按顺序
 * 七块**，每一块都是同一条链路上的前后环节：
 *
 *   ① 已保存的视频提示词与来源
 *   ② 单镜编辑、重新生成和保存
 *   ③ 当前绑定的人物、场景、道具、服装和声音（编辑入口＝「资产与参考帧」）
 *   ④ 实际用于视频请求的首帧、尾帧或关键帧（只读回显这次请求真正发出去的东西）
 *   ⑤ 本镜还缺什么
 *   ⑥ 生成视频
 *   ⑦ 导出绑定提示词
 *
 * 另有两条折叠：**对白与镜头内容**（有对白时才有）与**技术详情**
 * （内部标识与调用参数，默认收起）。
 *
 * 当前工作室步骤只决定**哪一块默认展开**：切换镜头不改变展开状态（用户停在哪就在哪），
 * 切换步骤才重新定位到该步骤对应的块。
 */

import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { Collapse, Segmented, Space, Tag, Typography } from 'antd'
import type { CollapseProps } from 'antd'
import { ExperimentOutlined } from '@ant-design/icons'

import type { ShotStatusText } from './shotStatusText'

export type ShotProductionStepKey = 'video_prompt' | 'binding' | 'deliver'

export type ShotProductionBlockKey =
  | 'prompt_saved'
  | 'prompt_edit'
  | 'binding'
  | 'request_frames'
  | 'gaps'
  | 'generate'
  | 'export_block'

export type ShotProductionBlocks = {
  promptSaved: ReactNode
  promptEditor: ReactNode
  binding: ReactNode
  requestFrames: ReactNode
  gaps: ReactNode
  generate: ReactNode
  exportBlock: ReactNode
  /** 对白与镜头内容（没有对白时传 null，整块消失） */
  dialogue?: ReactNode | null
  /** 技术详情（默认收起） */
  technical: ReactNode
}

/** 每块的小标题：顺序即用户的操作顺序。 */
const BLOCK_ORDER: Array<{ key: ShotProductionBlockKey; label: string; hint: string }> = [
  { key: 'prompt_saved', label: '① 已保存的视频提示词与来源', hint: '生成与导出读的就是这一份' },
  { key: 'prompt_edit', label: '② 单镜编辑、重新生成和保存', hint: '手工改、大模型重新生成，保存都落到本镜' },
  { key: 'binding', label: '③ 当前绑定的人物 / 场景 / 道具 / 服装与声音', hint: '编辑与补齐入口在「资产与参考帧」' },
  { key: 'request_frames', label: '④ 本次请求实际使用的首帧 / 关键帧 / 尾帧', hint: '只读回显：这次真的会发出去的文件' },
  { key: 'gaps', label: '⑤ 本镜还缺什么', hint: '按顺序补齐即可' },
  { key: 'generate', label: '⑥ 生成视频', hint: '参考方式 / 画幅 / 时长 / 模型方案' },
  { key: 'export_block', label: '⑦ 导出绑定提示词', hint: '导出可交付镜头的 TXT' },
]

/** 每个步骤默认展开的块（步骤切换时重新定位；切换镜头不动）。 */
const STEP_OPEN_KEYS: Record<ShotProductionStepKey, ShotProductionBlockKey[]> = {
  video_prompt: ['prompt_saved', 'prompt_edit'],
  binding: ['binding'],
  deliver: ['request_frames', 'gaps', 'generate', 'export_block'],
}

export function stepOpenKeys(step: ShotProductionStepKey): string[] {
  return STEP_OPEN_KEYS[step] ?? STEP_OPEN_KEYS.video_prompt
}

const TONE_COLOR: Record<ShotStatusText['tone'], string> = {
  default: 'default',
  gold: 'gold',
  blue: 'blue',
  green: 'green',
  red: 'red',
}

type ShotProductionWorkspaceProps = {
  shot: { index: number; title: string } | null
  status: ShotStatusText
  /** 本集 / 选中范围的可生成与可导出数量（与状态文案同一份就绪数据） */
  scopeSummary?: ReactNode
  step: ShotProductionStepKey
  steps: Array<{ key: ShotProductionStepKey; label: string }>
  onStepChange: (step: ShotProductionStepKey) => void
  blocks: ShotProductionBlocks
}

export function ShotProductionWorkspace({
  shot,
  status,
  scopeSummary,
  step,
  steps,
  onStepChange,
  blocks,
}: ShotProductionWorkspaceProps) {
  const [openKeys, setOpenKeys] = useState<string[]>(() => stepOpenKeys(step))

  // 只在**步骤切换**时重新定位展开项：切换镜头保持用户当前停的位置。
  useEffect(() => {
    setOpenKeys(stepOpenKeys(step))
  }, [step])

  const items = useMemo<CollapseProps['items']>(() => {
    const contentByKey: Record<ShotProductionBlockKey, ReactNode> = {
      prompt_saved: blocks.promptSaved,
      prompt_edit: blocks.promptEditor,
      binding: blocks.binding,
      request_frames: blocks.requestFrames,
      gaps: blocks.gaps,
      generate: blocks.generate,
      export_block: blocks.exportBlock,
    }
    const list: CollapseProps['items'] = BLOCK_ORDER.map((block) => ({
      key: block.key,
      label: (
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-900">{block.label}</div>
          <div className="text-[11px] text-gray-500">{block.hint}</div>
        </div>
      ),
      children: contentByKey[block.key],
    }))
    if (blocks.dialogue) {
      list.push({
        key: 'dialogue',
        label: (
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900">对白与镜头内容</div>
            <div className="text-[11px] text-gray-500">本镜有对白时在这里查看与维护</div>
          </div>
        ),
        children: blocks.dialogue,
      })
    }
    list.push({
      key: 'technical',
      label: (
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-700">
            <ExperimentOutlined /> 技术详情
          </div>
          <div className="text-[11px] text-gray-500">
            内部标识与调用参数（默认收起）
          </div>
        </div>
      ),
      children: blocks.technical,
    })
    return list
  }, [blocks])

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="cs-inspector-header flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-medium truncate">本镜生产</div>
          <div className="text-xs text-gray-500 truncate">
            {shot ? `${String(shot.index).padStart(2, '0')} · ${shot.title}` : '未选择分镜'}
          </div>
        </div>
        <Space size={6} wrap>
          <Tag color={TONE_COLOR[status.tone]}>{status.label}</Tag>
          <Tag color={status.canGenerate ? 'green' : 'default'}>{status.canGenerate ? '可生成' : '不可生成'}</Tag>
          <Tag color={status.canExport ? 'green' : 'default'}>{status.canExport ? '可导出' : '不可导出'}</Tag>
        </Space>
      </div>

      <div className="px-3 pb-2 border-b border-gray-100">
        <div className="mb-1 text-[11px] text-gray-500">{`下一步：${status.nextAction}`}</div>
        {scopeSummary}
      </div>

      <div className="px-3 py-2 border-b border-gray-100">
        <Segmented
          block
          size="small"
          value={step}
          onChange={(value) => onStepChange(value as ShotProductionStepKey)}
          options={steps.map((item) => ({ value: item.key, label: item.label }))}
        />
      </div>

      <div className="cs-inspector flex-1 min-h-0 overflow-auto px-3 py-3">
        <Collapse
          activeKey={openKeys}
          onChange={(keys) => setOpenKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
          items={items}
          size="small"
        />
        <div className="mt-3">
          <Typography.Text type="secondary" className="text-[11px]">
            整集批量生成与批量导入在项目第 3 步「整集视频提示词」完成；工作室只做单镜补漏。
          </Typography.Text>
        </div>
      </div>
    </div>
  )
}

export default ShotProductionWorkspace
