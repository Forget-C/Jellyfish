import { Space, Tabs, Tag, Tooltip } from 'antd'
import {
  AppstoreOutlined,
  CheckCircleFilled,
  ExportOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  StopOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'
import {
  DISPLAY_STEPS,
  getDisplayStepEntryKey,
  getDisplayStepIndex,
  isStudioProjectStep,
  type ProjectStepKey,
} from '../projectSteps'

/** 五步图标（按展示步骤 key）。 */
const DISPLAY_STEP_ICONS: Record<string, ReactNode> = {
  script_shots: <FileTextOutlined />,
  asset_prep: <AppstoreOutlined />,
  episode_prompt: <VideoCameraOutlined />,
  asset_binding: <LinkOutlined />,
  generate_deliver: <PlayCircleOutlined />,
}


type ProjectStepNavProps = {
  /** 当前 URL/渲染对应的步骤；旧功能页（仪表盘/文件/剪辑/设置）为 null */
  activeStep: ProjectStepKey | null
  /** 判定出的当前未完成步骤，用于把前面的步骤标记为已完成 */
  resolvedStep: ProjectStepKey
  /** 项目起点：prompts 时第一步显示「已跳过：提示词起步」 */
  startMode?: 'script' | 'prompts'
  /** 进度判定中：不标「当前」也不标「已完成」，避免用空快照给出错误结论 */
  loading?: boolean
  onSelectStep: (step: ProjectStepKey) => void
}

/** 旧功能页时用的哨兵 key：不匹配任何步骤，避免 antd Tabs 退化成受控以外的默认高亮。 */
const NO_ACTIVE_STEP = '__workspace_other__'

/**
 * 项目级六步导航：外观沿用原来的 antd `Tabs`，只把 10 个平级 Tab 换成 6 步流程。
 * 第 4-6 步属于「章节工作室」内的步骤，点进去会跳到工作室路由（本轮不重建）。
 */
export function ProjectStepNav({ activeStep, resolvedStep, startMode = 'script', loading = false, onSelectStep }: ProjectStepNavProps) {
  const resolvedIndex = getDisplayStepIndex(resolvedStep)
  const activeDisplayKey = activeStep ? DISPLAY_STEPS[getDisplayStepIndex(activeStep)].key : null
  const promptStart = startMode === 'prompts'

  return (
    <Tabs
      activeKey={activeStep ?? NO_ACTIVE_STEP}
      onChange={(key) => {
        // 步骤条按五步展示；点击第 2 步落到 `extract_assets`（资产准备的入口内部 key）。
        const display = DISPLAY_STEPS.find((step) => step.key === key)
        if (display) onSelectStep(getDisplayStepEntryKey(display))
      }}
      size="middle"
      className="project-workbench-tabs flex-1 min-w-0"
      items={DISPLAY_STEPS.map((step, index) => {
        const done = !loading && index < resolvedIndex
        const entryKey = getDisplayStepEntryKey(step)
        const inStudio = isStudioProjectStep(entryKey)
        // 「从视频提示词开始」的项目：第 1 步显示「已跳过：提示词起步」，不报缺剧本
        const skipped = promptStart && step.key === 'script_shots'
        return {
          key: step.key,
          label: (
            <Tooltip
              title={skipped ? '从视频提示词开始的项目：整集提示词已承担第一步的输入' : `${step.description}${inStudio ? '（进入章节工作室完成）' : ''}`}
            >
              <span className="flex items-center gap-1.5">
                {done ? (
                  <CheckCircleFilled className="text-emerald-500" />
                ) : skipped ? (
                  <StopOutlined className="text-gray-400" />
                ) : (
                  DISPLAY_STEP_ICONS[step.key]
                )}
                <span className={skipped ? 'text-gray-400' : undefined}>
                  {index + 1}. {step.label}
                  {skipped ? '（已跳过：提示词起步）' : ''}
                </span>
                {inStudio ? <ExportOutlined className="text-[10px] text-gray-400" /> : null}
                {!loading && step.key === activeDisplayKey ? (
                  <Tag bordered={false} color="blue" className="mr-0 ml-0.5 text-[10px] leading-4">
                    当前
                  </Tag>
                ) : null}
              </span>
            </Tooltip>
          ),
          onClick: undefined,
        }
      })}
      tabBarExtraContent={{
        right: (
          <Space size={4} className="hidden lg:flex text-[11px] text-gray-400 pr-1">
            <span>前 3 步在工作台完成，第 4-5 步在章节工作室完成</span>
          </Space>
        ),
      }}
    />
  )
}
