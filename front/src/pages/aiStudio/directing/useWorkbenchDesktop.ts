import { useSyncExternalStore } from 'react'

const query = '(min-width: 1280px)'
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', notify)
  return () => media.removeEventListener('change', notify)
}

/** 与工作台样式使用同一断点，避免详情栏和抽屉同时缺失。 */
export function useWorkbenchDesktop() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
