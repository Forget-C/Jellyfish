import { currentLanguage } from '../../../i18n'
import { uiText } from '../../../uiText'

export function formatElapsedMs(elapsedMs?: number | null): string | null {
  if (typeof elapsedMs !== 'number' || elapsedMs < 0) return null
  const totalSeconds = Math.floor(elapsedMs / 1000)
  if (totalSeconds < 60) return uiText("{{value}} 秒", { value: totalSeconds })
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${uiText("{{value}} 分", { value: minutes })} ${uiText("{{value}} 秒", { value: seconds })}` : uiText("{{value}} 分", { value: minutes })
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${uiText("{{value}} 小时", { value: hours })} ${uiText("{{value}} 分", { value: remainMinutes })}` : uiText("{{value}} 小时", { value: hours })
}

export function formatStartedAt(startedAtTs?: number | null, locale = currentLanguage()): string | null {
  if (!startedAtTs) return null
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(startedAtTs * 1000))
}
