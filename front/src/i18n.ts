import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import zhLayout from './locales/zh-CN/layout.json'
import zhCommon from './locales/zh-CN/common.json'
import zhSettings from './locales/zh-CN/settings.json'
import zhNotFound from './locales/zh-CN/notFound.json'
import enLayout from './locales/en-US/layout.json'
import enCommon from './locales/en-US/common.json'
import enSettings from './locales/en-US/settings.json'
import enNotFound from './locales/en-US/notFound.json'

export type SupportedLanguage = 'zh-CN' | 'en-US'

/** 语言选择的存储键（与 `MainLayout` 的切换下拉写入、`LanguageDetector` 的缓存键同源）。 */
export const LANGUAGE_STORAGE_KEY = 'jellyfish_language'

/**
 * 产品默认语言：**中文**。
 *
 * 审计 §4.7 / §5.5-A2（R24 第 2 条、R27）：`/settings` 显示 `Save`、未知路由整页英文，
 * 根因都不是「词典缺失」，而是 `LanguageDetector` 按 `localStorage → navigator → htmlTag`
 * 在一台 `zh-CN` 之外的机器上解析出 `en-US`。
 */
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN'

const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['zh-CN', 'en-US']

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/**
 * 初始语言 =「**先读用户存过的选择（localStorage `jellyfish_language`），没有就默认 `zh-CN`**」。
 *
 * 为什么不直接写死 `lng: 'zh-CN'`：写死会让「用户主动切到英文」在刷新后失效
 * （切换下拉会写 `jellyfish_language`，但初始化不再读它）。本函数同时满足两条：
 *   ① 默认中文 —— 浏览器语言是 `en-US` 的机器不再把中文产品显示成英文（R24/R27 的根因）；
 *   ② 显式选择优先 —— 用户切过语言就按用户的选择来（`MainLayout` 的切换能力不受影响）。
 *
 * `try/catch`：隐私模式 / 无 `window`（SSR、单测）下读 `localStorage` 会抛，一律回落默认中文。
 */
export function resolveInitialLanguage(): SupportedLanguage {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_LANGUAGE
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isSupportedLanguage(stored) ? stored : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

const resources = {
  'zh-CN': {
    common: zhCommon,
    layout: zhLayout,
    settings: zhSettings,
    notFound: zhNotFound,
  },
  'en-US': {
    common: enCommon,
    layout: enLayout,
    settings: enSettings,
    notFound: enNotFound,
  },
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    /* 审计 §4.7（R24 第 2 条 / R27）：显式初始化语言 —— 默认中文、显式选择优先。
       **不要**改成写死 `'zh-CN'`（那会让语言切换失效），也不要删掉 `fallbackLng`。 */
    lng: resolveInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ['zh-CN', 'en-US'],
    ns: ['common', 'layout', 'settings', 'notFound'],
    defaultNS: 'layout',
    interpolation: {
      escapeValue: false,
    },
    /* detector 保留：它负责把用户之后的选择**缓存**到 `jellyfish_language`。
       初始语言已由上面的 `lng` 显式给定，所以「导航器是 en-US」不再决定首屏语言。 */
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
  })

export default i18n

