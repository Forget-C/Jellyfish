import type { ReactNode } from 'react'
import {
  HomeOutlined,
  UnorderedListOutlined,
  UserOutlined,
  PictureOutlined,
  ScissorOutlined,
  FileImageOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { Chapter } from '../../../../mocks/data'
import { generationCanvasLocation } from '../../generationCanvas/navigation'

export type TabKey =
  | 'generation'
  | 'dashboard'
  | 'chapters'
  | 'actors'
  | 'roles'
  | 'scenes'
  | 'props'
  | 'costumes'
  | 'files'
  | 'settings'

export const DEFAULT_TAB: TabKey = 'dashboard'

type ProjectNavigationItem = { key: TabKey; label: string; icon: ReactNode }

export const projectNavigationGroups: { label: string; items: ProjectNavigationItem[] }[] = [
  { label: '创作', items: [
    { key: 'dashboard', label: '项目概览', icon: <HomeOutlined /> },
    { key: 'generation', label: '画布生成', icon: <PictureOutlined /> },
    { key: 'chapters', label: '章节', icon: <UnorderedListOutlined /> },
  ] },
  { label: '项目资源', items: [
    { key: 'actors', label: '演员', icon: <UserOutlined /> },
    { key: 'roles', label: '角色', icon: <UserOutlined /> },
    { key: 'scenes', label: '场景', icon: <PictureOutlined /> },
    { key: 'props', label: '道具', icon: <ScissorOutlined /> },
    { key: 'costumes', label: '服装', icon: <ScissorOutlined /> },
  ] },
  { label: '项目管理', items: [
    { key: 'files', label: '文件', icon: <FileImageOutlined /> },
    { key: 'settings', label: '项目设置', icon: <SettingOutlined /> },
  ] },
]

const projectNavigationItems = projectNavigationGroups.flatMap(group => group.items)

export function resolveProjectTab(tab: string | null): TabKey {
  return projectNavigationItems.find(item => item.key === tab)?.key ?? DEFAULT_TAB
}

export function projectTabLabel(tab: TabKey) {
  return projectNavigationItems.find(item => item.key === tab)?.label
}

/** 切换分区时使用稳定地址，章节定位参数仍由章节入口和浏览器历史保存。 */
export function projectTabLocation(projectId: string, tab: TabKey) {
  return tab === 'generation'
    ? generationCanvasLocation(projectId)
    : `/projects/${encodeURIComponent(projectId)}?tab=${tab}`
}

export const chapterStatusMap: Record<Chapter['status'], { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  shooting: { color: 'processing', text: '拍摄中' },
  done: { color: 'success', text: '完成' },
}
