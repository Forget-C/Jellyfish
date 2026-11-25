import { useEffect, useRef, useState } from 'react'
import { LlmService } from '../../../../services/generated'

type TrialCategory = 'text' | 'image' | 'video'

/** Preserve an explicit model choice per session, including the draft's first submission. */
export function useTrialModelPreference(category: TrialCategory, sessionId?: string) {
  const key = sessionId ? 'jellyfish:trial-model:' + category + ':' + sessionId : undefined
  const [selection, setSelection] = useState<{ key?: string; modelId?: string }>(() => ({
    key, modelId: key ? localStorage.getItem(key) ?? undefined : undefined,
  }))
  const [soleModel, setSoleModel] = useState<string>()
  const [defaultId, setDefaultId] = useState<string>()
  const previousKey = useRef(key)
  const modelId = selection.key === key ? selection.modelId ?? defaultId ?? soleModel
    : (key && localStorage.getItem(key)) || (previousKey.current === undefined ? selection.modelId : undefined) || defaultId

  useEffect(() => {
    let active = true
    LlmService.getModelSettingsApiV1LlmModelSettingsGet().then(({ data }) => {
      if (active) setDefaultId(data?.[`default_${category}_model_id`] ?? undefined)
    }).catch(() => {})
    return () => { active = false }
  }, [category])

  useEffect(() => {
    if (key !== previousKey.current) {
      const stored = key ? localStorage.getItem(key) ?? undefined : undefined
      const adopted = stored ?? (key && previousKey.current === undefined ? selection.modelId : undefined)
      if (key && adopted) localStorage.setItem(key, adopted)
      setSelection({ key, modelId: adopted })
      previousKey.current = key
    }
  }, [key, selection.modelId])

  function select(next?: string) {
    if (key) {
      if (next) localStorage.setItem(key, next)
      else localStorage.removeItem(key)
    }
    setSelection({ key, modelId: next })
  }

  return [modelId, select, setSoleModel] as const
}
