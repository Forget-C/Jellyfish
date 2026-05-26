import { create } from 'zustand'
import type { SupportedLanguage } from '../i18n'

/**
 * Keeps Simplified Chinese as the default while honoring an explicit English choice.
 */
const getInitialLanguage = (): SupportedLanguage => {
  if (typeof window === 'undefined') return 'zh-CN'
  return window.localStorage.getItem('jellyfish_language') === 'en-US' ? 'en-US' : 'zh-CN'
}

interface UserInfo {
  name: string
  role: string
}

interface AppState {
  siderCollapsed: boolean
  user: UserInfo
  language: SupportedLanguage
  setUser: (user: Partial<UserInfo>) => void
  setLanguage: (lang: SupportedLanguage) => void
  toggleSider: () => void
}

export const useAppStore = create<AppState>((set) => ({
  siderCollapsed: false,
  user: {
    name: 'Admin',
    role: '系统管理员',
  },
  language: getInitialLanguage(),
  setUser: (user) =>
    set((state) => ({
      user: {
        ...state.user,
        ...user,
      },
    })),
  setLanguage: (lang) => set(() => ({ language: lang })),
  toggleSider: () =>
    set((state) => ({
      siderCollapsed: !state.siderCollapsed,
    })),
}))


