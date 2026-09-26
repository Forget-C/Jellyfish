import type { ReactNode } from 'react'
import {
  EditOutlined,
  FileSearchOutlined,
  ScissorOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons'
import type { Chapter } from './hooks/useProjectData'

export type ChapterPreparationState = {
  key: 'edit_raw' | 'extract_shots' | 'prepare_shots' | 'shoot'
  text: string
  color: string
  hint: string
  primaryAction: string
  primaryIcon: ReactNode
}

export function getChapterPreparationState(chapter: Chapter): ChapterPreparationState {
  const hasRawText = !!chapter.rawText?.trim()
  const hasShots = (chapter.storyboardCount ?? 0) > 0
  if (!hasRawText) {
    return {
      key: 'edit_raw',
      text: '待录入原文',
      color: 'default',
      hint: '先补章节原文，再进入分镜流程',
      primaryAction: '编辑原文',
      primaryIcon: <EditOutlined />,
    }
  }
  if (!hasShots) {
    return {
      key: 'extract_shots',
      text: '待提取分镜',
      color: 'gold',
      hint: '已有章节原文，下一步建议先提取分镜',
      primaryAction: '提取分镜',
      primaryIcon: <ScissorOutlined />,
    }
  }
  if (chapter.status === 'shooting' || chapter.status === 'done') {
    return {
      key: 'shoot',
      text: '可进入拍摄',
      color: 'green',
      hint: '当前章节已具备分镜，继续后续步骤',
      primaryAction: '继续后续步骤',
      primaryIcon: <VideoCameraOutlined />,
    }
  }
  // 有分镜之后的「下一步」不再直接进分镜工作室：
  // 六步流程要求先做资产提取 → 图片准备 → 整集视频提示词 → 关联绑定，最后才进工作室。
  // 这里只把用户交回项目工作台，由 `resolveProjectStep`（唯一判定来源）决定落在哪一步；
  // 工作室仍然保留「单镜查看与补漏」的入口（步骤条第 5/6 步、章节列表行内按钮）。
  return {
    key: 'prepare_shots',
    text: '待准备镜头',
    color: 'blue',
    hint: '已有分镜，继续后续步骤（资产准备 → 整集视频提示词）',
    primaryAction: '继续项目流程',
    primaryIcon: <FileSearchOutlined />,
  }
}
