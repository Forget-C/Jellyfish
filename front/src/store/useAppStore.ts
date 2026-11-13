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

export const canvasAppearances = ['follow', 'dark', 'mist', 'solid'] as const
export type CanvasAppearance = typeof canvasAppearances[number]
const canvasAppearanceStorageKey = 'jellyfish_canvas_appearance'
function readCanvasAppearance(): CanvasAppearance {
  try {
    const value = localStorage.getItem(canvasAppearanceStorageKey)
    return canvasAppearances.includes(value as CanvasAppearance) ? value as CanvasAppearance : 'follow'
  } catch { return 'follow' }
}

interface UserInfo {
  name: string
  role: string
}

interface AppState {
  user: UserInfo
  language: SupportedLanguage
  canvasAppearance: CanvasAppearance
  setCanvasAppearance: (value: CanvasAppearance) => void
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
  canvasAppearance: readCanvasAppearance(),
  setCanvasAppearance: (canvasAppearance) => {
    set({ canvasAppearance })
    try { localStorage.setItem(canvasAppearanceStorageKey, canvasAppearance) } catch { /* 当前会话保留内存偏好。 */ }
  },
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

