import { useEffect, useMemo, useState } from 'react'
import { LlmService, StudioProjectsService } from '../../../services/generated'
import type { ProjectStyleOptionsRead } from '../../../services/generated'
import type { ProjectStyleFieldOptions } from './ProjectVisualStyleAndStyleFields'

const FALLBACK_OPTIONS: ProjectStyleFieldOptions = {
  visualStyles: [
    { value: '现实', label: '现实' },
    { value: '动漫', label: '动漫' },
  ],
  stylesByVisual: {
    现实: [
      { value: '真人都市', label: '真人都市' },
      { value: '真人科幻', label: '真人科幻' },
      { value: '真人古装', label: '真人古装' },
    ],
    动漫: [
      { value: '动漫科幻', label: '动漫科幻' },
      { value: '动漫3D', label: '动漫3D' },
      { value: '国漫', label: '国漫' },
      { value: '水墨画', label: '水墨画' },
    ],
  },
  defaultStyleByVisual: {
    现实: '真人都市',
    动漫: '动漫3D',
  },
}

type OptionItem = { value: string; label: string }
type ProjectStyleOptionsSnapshot = {
  options: ProjectStyleFieldOptions
  videoRatioOptions: OptionItem[]
  defaultVideoRatio: string
}

let cachedSnapshot: ProjectStyleOptionsSnapshot | null = null
let loadingSnapshotPromise: Promise<ProjectStyleOptionsSnapshot> | null = null
const FALLBACK_DEFAULT_VIDEO_RATIO = '16:9'

/**
 * 接口不可用时的兜底比例。宁可给一份常用比例的静态候选，
 * 也不要让下拉是空的——空下拉会让用户以为「这个功能没有 9:16」。
 * 正常路径下仍以接口返回的 allowed_ratios 为准。
 */
const FALLBACK_VIDEO_RATIOS: OptionItem[] = [
  { value: '16:9', label: '16:9（横屏）' },
  { value: '9:16', label: '9:16（竖屏）' },
  { value: '1:1', label: '1:1（方形）' },
  { value: '3:4', label: '3:4（竖版）' },
]

function normalizeOptionItems(items: OptionItem[] | null | undefined): OptionItem[] {
  if (!Array.isArray(items)) return []
  return items.filter((item) => item && typeof item.value === 'string' && typeof item.label === 'string')
}

function normalizeStyleOptions(raw: ProjectStyleOptionsRead | null | undefined): ProjectStyleFieldOptions {
  const visualStyles = normalizeOptionItems(raw?.visual_styles as OptionItem[] | undefined)
  const stylesByVisualRaw = (raw?.styles_by_visual_style ?? {}) as Record<string, OptionItem[]>
  const stylesByVisual: Record<string, OptionItem[]> = Object.fromEntries(
    Object.entries(stylesByVisualRaw).map(([key, list]) => [key, normalizeOptionItems(list)]),
  )
  const defaultStyleByVisual = ((raw?.default_style_by_visual_style ?? {}) as Record<string, string>) || {}
  if (!visualStyles.length || !Object.keys(stylesByVisual).length) {
    return FALLBACK_OPTIONS
  }
  return {
    visualStyles,
    stylesByVisual,
    defaultStyleByVisual,
  }
}

function resolveDefaultStyle(options: ProjectStyleFieldOptions, visual: string): string {
  return (
    options.defaultStyleByVisual?.[visual] ??
    options.stylesByVisual?.[visual]?.[0]?.value ??
    ''
  )
}

/**
 * 加载并缓存项目风格配置，保证多个页面/弹窗共享同一次请求结果。
 */
async function loadProjectStyleOptionsSnapshot(): Promise<ProjectStyleOptionsSnapshot> {
  if (cachedSnapshot) return cachedSnapshot
  if (loadingSnapshotPromise) return loadingSnapshotPromise
  loadingSnapshotPromise = (async () => {
    try {
      const [styleRes, videoRes] = await Promise.all([
        StudioProjectsService.getProjectStyleOptionsApiV1StudioProjectsStyleOptionsGet(),
        LlmService.getVideoGenerationOptionsApiV1LlmVideoGenerationOptionsGet(),
      ])
      const styleData = styleRes.data
      const videoData = videoRes.data
      const snapshot: ProjectStyleOptionsSnapshot = {
        options: normalizeStyleOptions(styleData ?? undefined),
        videoRatioOptions: normalizeOptionItems(
          (videoData?.allowed_ratios ?? []).map((value) => ({ value, label: value })),
        ),
        defaultVideoRatio: videoData?.default_ratio ?? FALLBACK_DEFAULT_VIDEO_RATIO,
      }
      cachedSnapshot = snapshot
      return snapshot
    } catch (error) {
      // 失败时**不能**写 cachedSnapshot：cachedSnapshot 是模块级缓存，
      // 一旦把「比例选项为空」的失败快照缓存下来，整个会话内所有弹窗的比例下拉
      // 都会是空的，用户只有刷新页面才可能恢复。这里只返回本次的降级值，下次重试。
      console.warn('[project-style-options] 风格/比例选项加载失败，本次不缓存，后续会重试', error)
      return {
        options: FALLBACK_OPTIONS,
        videoRatioOptions: FALLBACK_VIDEO_RATIOS,
        defaultVideoRatio: FALLBACK_DEFAULT_VIDEO_RATIO,
      }
    } finally {
      loadingSnapshotPromise = null
    }
  })()
  return loadingSnapshotPromise
}

export function useProjectStyleOptions() {
  const [options, setOptions] = useState<ProjectStyleFieldOptions>(cachedSnapshot?.options ?? FALLBACK_OPTIONS)
  const [videoRatioOptions, setVideoRatioOptions] = useState<OptionItem[]>(cachedSnapshot?.videoRatioOptions ?? [])
  const [defaultVideoRatio, setDefaultVideoRatio] = useState<string>(cachedSnapshot?.defaultVideoRatio ?? FALLBACK_DEFAULT_VIDEO_RATIO)

  useEffect(() => {
    let active = true
    void (async () => {
      const snapshot = await loadProjectStyleOptionsSnapshot()
      if (!active) return
      setOptions(snapshot.options)
      setVideoRatioOptions(snapshot.videoRatioOptions)
      setDefaultVideoRatio(snapshot.defaultVideoRatio)
    })()
    return () => {
      active = false
    }
  }, [])

  const defaultVisualStyle = useMemo(() => options.visualStyles[0]?.value ?? '现实', [options])
  const getDefaultStyle = useMemo(
    () => (visual: string) => resolveDefaultStyle(options, visual),
    [options],
  )

  return {
    options,
    videoRatioOptions,
    defaultVideoRatio,
    defaultVisualStyle,
    getDefaultStyle,
  }
}
