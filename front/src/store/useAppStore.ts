import { create } from 'zustand'
import type { SupportedLanguage } from '../i18n'

interface UserInfo {
  name: string
  role: string
}

/**
 * 角色的**稳定码 → i18n 键**映射（审计 §4.7-R24 第 3 条）。
 *
 * 为什么 role 存稳定码而不是显示名：显示名会随后端/语言变化。
 * 改前 `Settings.tsx:44` 把翻译后的显示名当 `value` 存进 store，
 * 切一次语言下拉就再也匹配不上（「系统管理员」→「Administrator」）。
 * 现在：**store 存码（`admin` / `operator` / `guest`），显示一律走 `t(键)`**。
 *
 * 键前缀 `settings:` 是显式的，因为消费方（`MainLayout`）的默认命名空间是 `layout`。
 * 中文口径的唯一来源是语言包 `settings.json` 的 `roleOptions`，这里不复制一份。
 */
export const USER_ROLE_LABEL_KEYS: Readonly<Record<string, string>> = {
  admin: 'settings:roleOptions.admin',
  operator: 'settings:roleOptions.operator',
  guest: 'settings:roleOptions.guest',
}

/** 角色码的中文兜底：**未登记一律「未知角色」，绝不回显码本身**（审计 §2.1 判定铁律）。 */
export const UNKNOWN_ROLE_LABEL = '未知角色'

/**
 * 角色码 → 显示名。
 *
 * `translate` 由调用方传入（`MainLayout` 传 `t`），这样本模块不需要 import i18n，
 * 保持「store 只存状态」的职责边界，也方便单测直接传入一个假翻译函数。
 */
export function userRoleLabel(role: string | null | undefined, translate: (key: string) => string): string {
  const key = USER_ROLE_LABEL_KEYS[String(role ?? '').trim()]
  if (!key) return UNKNOWN_ROLE_LABEL
  const label = translate(key)
  /* `t()` 未命中会回显键名（这正是 R24 那个缺陷的形态），这里兜到中文，避免「管理员」位置
     再次出现 `settings:roleOptions.admin` 这种字符串。 */
  return label && label !== key ? label : UNKNOWN_ROLE_LABEL
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
    /* 审计 §4.7：用户名 / 角色直接渲在右上角（`MainLayout.tsx:294-295`），
       改前是英文 `Admin`。role 是稳定码，显示时经 `userRoleLabel` 走 i18n。 */
    name: '管理员',
    role: 'admin',
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
  toggleSider: () =>
    set((state) => ({
      siderCollapsed: !state.siderCollapsed,
    })),
}))
