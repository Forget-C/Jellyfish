import { create } from 'zustand'
import type { SupportedLanguage } from '../i18n'

interface UserInfo {
  name: string
  role: string
}

interface AppState {
  user: UserInfo
  language: SupportedLanguage
  setUser: (user: Partial<UserInfo>) => void
  setLanguage: (lang: SupportedLanguage) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: {
    name: 'Admin',
    role: '系统管理员',
  },
  language: 'zh-CN',
  setUser: (user) =>
    set((state) => ({
      user: {
        ...state.user,
        ...user,
      },
    })),
  setLanguage: (lang) => set(() => ({ language: lang })),
}))

