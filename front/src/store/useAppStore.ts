import { create } from 'zustand'
import type { SupportedLanguage } from '../i18n'

/**
 * Keeps English as the default while honoring an explicit Simplified Chinese choice.
 */
const getInitialLanguage = (): SupportedLanguage => {
  if (typeof window === 'undefined') return 'en-US'
  return window.localStorage.getItem('jellyfish_language') === 'zh-CN' ? 'zh-CN' : 'en-US'
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
    role: 'System administrator',
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


