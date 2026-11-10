import { useTranslation } from 'react-i18next'
import type { Appearance } from '../store/useAppStore'

export function AppearancePreview({ appearance }: { appearance: Appearance }) {
  const { t } = useTranslation('layout')
  return <span className="app-appearance-preview">
    <span className="app-appearance-swatch" data-appearance={appearance} aria-hidden />
    {t(`appearance.${appearance}`)}
  </span>
}
