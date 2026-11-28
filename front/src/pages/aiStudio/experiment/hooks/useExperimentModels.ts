import { useUiText } from '../../../../uiText'
import { useRef, useState } from 'react'
import { LlmService, type ModelRead } from '../../../../services/generated'

/** An unsuccessful refresh keeps the last model list and never changes the applied model. */
export function useExperimentModels(category: 'text' | 'image' | 'video', onOnlyModel: (modelId: string) => void) {
  const uiText = useUiText()
  const [models, setModels] = useState<ModelRead[]>()
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsFailed, setModelsFailed] = useState(false)
  const pending = useRef(false)
  const applyOnlyModel = useRef(onOnlyModel)
  applyOnlyModel.current = onOnlyModel

  const loadModels = async (refresh = false) => {
    if (pending.current || (!refresh && models && !modelsFailed)) return
    pending.current = true
    setModelsLoading(true)
    setModelsFailed(false)
    try {
      const items: ModelRead[] = []
      for (let page = 1; ; page++) {
        const {data} = await LlmService.listModelsApiV1LlmModelsGet({
          category, page, pageSize: 100, order: 'updated_at', isDesc: true,
        })
        if (!data || !Array.isArray(data.items)) throw new Error(uiText("未返回模型列表"))
        items.push(...data.items)
        if (page >= (data.pagination?.max_page ?? 1)) break
      }
      setModels(items)
      if (items.length === 1) applyOnlyModel.current(items[0].id)
    } catch {
      setModelsFailed(true)
    } finally {
      pending.current = false
      setModelsLoading(false)
    }
  }

  return { models: models ?? [], modelsLoading, modelsFailed, loadModels }
}
