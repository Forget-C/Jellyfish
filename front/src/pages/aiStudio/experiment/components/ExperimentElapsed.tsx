import { useUiText } from '../../../../uiText'

export function elapsedBetween(accepted: unknown, finished: unknown) {
  return typeof accepted === 'number' && typeof finished === 'number' &&
    Number.isFinite(accepted) && Number.isFinite(finished) && finished >= accepted
    ? finished - accepted : undefined
}

export function useElapsedLabel(milliseconds?: number) {
  const uiText = useUiText()
  if (milliseconds === undefined) return undefined
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds === 0) return uiText('用时不足 1 秒')
  if (seconds < 60) return uiText('用时 {{seconds}} 秒', { seconds })
  return uiText('用时 {{minutes}} 分 {{seconds}} 秒', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
}

export function ExperimentElapsed({ milliseconds }: { milliseconds?: number }) {
  const label = useElapsedLabel(milliseconds)
  return label ? <span className="experiment-elapsed">{label}</span> : null
}
