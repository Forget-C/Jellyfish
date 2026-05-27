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

/**
 * Uses English by default while honoring an explicit Simplified Chinese choice.
 */
const getInitialLanguage = (): SupportedLanguage => {
  if (typeof window === 'undefined') return 'en-US'
  return window.localStorage.getItem('jellyfish_language') === 'zh-CN' ? 'zh-CN' : 'en-US'
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
    lng: getInitialLanguage(),
    fallbackLng: 'en-US',
    supportedLngs: ['zh-CN', 'en-US'],
    ns: ['common', 'layout', 'settings', 'notFound'],
    defaultNS: 'layout',
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'jellyfish_language',
    },
  })

export default i18n

