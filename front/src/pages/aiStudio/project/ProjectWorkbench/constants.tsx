import React from 'react'
import {
  HomeOutlined,
  UnorderedListOutlined,
  UserOutlined,
  PictureOutlined,
  ScissorOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { Chapter } from '../../../../mocks/data'

/**
 * 旧的 10 个平级 Tab 定义。
 *
 * 六步流程（`projectSteps.ts` + `index.tsx`）上线后，主导航不再使用 `TAB_CONFIG`，
 * 但这些 key 仍然是 URL 里的兼容参数（`?tab=chapters|roles|scenes|props|costumes|actors`
 * 会被映射到对应步骤；`dashboard|files|edit|settings` 收进「其他」下拉）。
 * 保留导出，避免影响仍在用旧链接的页面。
 */
export type TabKey =
  | 'dashboard'
  | 'chapters'
  | 'actors'
  | 'roles'
  | 'scenes'
  | 'props'
  | 'costumes'
  | 'files'
  | 'edit'
  | 'settings'

const TAB_KEYS: TabKey[] = [
  'dashboard',
  'chapters',
  'actors',
  'roles',
  'scenes',
  'props',
  'costumes',
  'files',
  'edit',
  'settings',
]

export function isTabKey(s: string): s is TabKey {
  return TAB_KEYS.includes(s as TabKey)
}

export const DEFAULT_TAB: TabKey = 'dashboard'

export const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'dashboard', label: '仪表盘', icon: <HomeOutlined /> },
  { key: 'chapters', label: '章节', icon: <UnorderedListOutlined /> },
  { key: 'actors', label: '演员', icon: <UserOutlined /> },
  { key: 'roles', label: '角色', icon: <UserOutlined /> },
  { key: 'scenes', label: '场景', icon: <PictureOutlined /> },
  { key: 'props', label: '道具', icon: <ScissorOutlined /> },
  { key: 'costumes', label: '服装', icon: <ScissorOutlined /> },
  { key: 'files', label: '文件', icon: <FileImageOutlined /> },
  { key: 'edit', label: '剪辑', icon: <VideoCameraOutlined /> },
  { key: 'settings', label: '设置', icon: <SettingOutlined /> },
]

export const chapterStatusMap: Record<Chapter['status'], { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  shooting: { color: 'processing', text: '拍摄中' },
  done: { color: 'success', text: '完成' },
}

