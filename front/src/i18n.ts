import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhLayout from './locales/zh-CN/layout.json'
import zhCommon from './locales/zh-CN/common.json'
import zhSettings from './locales/zh-CN/settings.json'
import zhNotFound from './locales/zh-CN/notFound.json'
import enLayout from './locales/en-US/layout.json'
import enCommon from './locales/en-US/common.json'
import enSettings from './locales/en-US/settings.json'
import enNotFound from './locales/en-US/notFound.json'
import enUi from './locales/en-US/ui.json'

export type SupportedLanguage = 'zh-CN' | 'en-US'

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
    ui: enUi,
  },
}

function storedLanguage(): SupportedLanguage {
  try {
    return localStorage.getItem('jellyfish_language') === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

i18n.on('languageChanged', language => {
  try { localStorage.setItem('jellyfish_language', language) } catch { /* Storage may be unavailable. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = language
})

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en-US'],
    ns: ['common', 'layout', 'settings', 'notFound', 'ui'],
    defaultNS: 'layout',
    interpolation: {
      escapeValue: false,
    },
    lng: storedLanguage(),
  })

export function currentLanguage(): SupportedLanguage {
  return i18n.resolvedLanguage === 'en-US' ? 'en-US' : 'zh-CN'
}

export default i18n

