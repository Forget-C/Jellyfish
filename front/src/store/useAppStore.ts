import { create } from 'zustand'
import type { SupportedLanguage } from '../i18n'

export const appearances = ['mist', 'solid'] as const
export type Appearance = typeof appearances[number]
const appearanceStorageKey = 'jellyfish_appearance'

function readAppearance(): Appearance {
  try {
    return localStorage.getItem(appearanceStorageKey) === 'solid' ? 'solid' : 'mist'
  } catch {
    return 'mist'
  }
}

interface UserInfo {
  name: string
  role: string
}

interface AppState {
  user: UserInfo
  language: SupportedLanguage
  appearance: Appearance
  setUser: (user: Partial<UserInfo>) => void
  setLanguage: (lang: SupportedLanguage) => void
  setAppearance: (appearance: Appearance) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: {
    name: 'Admin',
    role: '系统管理员',
  },
  language: 'zh-CN',
  appearance: readAppearance(),
  setUser: (user) =>
    set((state) => ({
      user: {
        ...state.user,
        ...user,
      },
    })),
  setLanguage: (lang) => set(() => ({ language: lang })),
  setAppearance: (appearance) => {
    set({ appearance })
    try {
      localStorage.setItem(appearanceStorageKey, appearance)
    } catch {
      // 浏览器限制存储时，当前应用仍使用内存中的外观偏好。
    }
  },
}))

