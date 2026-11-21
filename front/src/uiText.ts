import { useTranslation } from 'react-i18next'
import i18n from './i18n'

/** Chinese source messages double as keys so the default UI stays readable without a catalog. */
export function uiText(source: string, values?: Record<string, unknown>): string {
  return i18n.t(source, {
    ns: 'ui', keySeparator: false, nsSeparator: false, defaultValue: source,
    replace: values,
  })
}

/** Subscribe the rendering component to language changes, including inside standalone canvases. */
export function useUiText() {
  useTranslation('ui')
  return uiText
}
