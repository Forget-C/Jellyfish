import React from 'react'
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

const TAB_KEYS: TabKey[] = [
  'generation',
  'dashboard',
  'chapters',
  'actors',
  'roles',
  'scenes',
  'props',
  'costumes',
  'files',
  'settings',
]

export function isTabKey(s: string): s is TabKey {
  return TAB_KEYS.includes(s as TabKey)
}

export const DEFAULT_TAB: TabKey = 'dashboard'

export const TAB_CONFIG: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'generation', label: '画布生成', icon: <PictureOutlined /> },
  { key: 'dashboard', label: '仪表盘', icon: <HomeOutlined /> },
  { key: 'chapters', label: '章节', icon: <UnorderedListOutlined /> },
  { key: 'actors', label: '演员', icon: <UserOutlined /> },
  { key: 'roles', label: '角色', icon: <UserOutlined /> },
  { key: 'scenes', label: '场景', icon: <PictureOutlined /> },
  { key: 'props', label: '道具', icon: <ScissorOutlined /> },
  { key: 'costumes', label: '服装', icon: <ScissorOutlined /> },
  { key: 'files', label: '文件', icon: <FileImageOutlined /> },
  { key: 'settings', label: '设置', icon: <SettingOutlined /> },
]

export const chapterStatusMap: Record<Chapter['status'], { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  shooting: { color: 'processing', text: '拍摄中' },
  done: { color: 'success', text: '完成' },
}
