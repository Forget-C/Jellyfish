import { useUiText } from '../../../../uiText'
import { useRef, useState } from 'react'
import { Modal } from 'antd'
import { StudioPromptsService, type PromptCategory, type PromptTemplateRead } from '../../../../services/generated'
import { createPromptTemplateValues } from '../components/PromptTemplateForm'

/** Template list refreshes are independent from the selected template version and applied variables. */
export function useExperimentTemplates(
  categories: readonly PromptCategory[],
  draft: string,
  setDraft: (draft: string) => void,
) {
  const uiText = useUiText()
  const [templates, setTemplates] = useState<PromptTemplateRead[]>()
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplateRead | null>(null)
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({})
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesFailed, setTemplatesFailed] = useState(false)
  const pending = useRef(false)
  const [replacement, setReplacement] = useState<(() => void) | null>(null)

  const loadTemplates = async (refresh = false) => {
    if (pending.current || (!refresh && templates && !templatesFailed)) return
    pending.current = true
    setTemplatesLoading(true)
    setTemplatesFailed(false)
    try {
      const responses = await Promise.all(categories.map(category =>
        StudioPromptsService.listPromptTemplatesApiV1StudioPromptsGet({
          category, page: 1, pageSize: 100, order: 'updated_at', isDesc: true,
        }),
      ))
      setTemplates(responses.flatMap(response => response.data?.items ?? []))
    } catch {
      setTemplatesFailed(true)
    } finally {
      pending.current = false
      setTemplatesLoading(false)
    }
  }

  /** Confirm an overwrite before discarding a prompt, a configured template, or selected media. */
  const confirmReplacement = (apply: () => void, hasMedia = false) => {
    if (!draft.trim() && !selectedTemplate && !hasMedia) {
      apply()
      return
    }
    setReplacement(() => apply)
  }

  const selectTemplate = (id?: string) => {
    if (id === selectedTemplate?.id) return
    const template = templates?.find(item => item.id === id) ?? null
    if (id && !template) return
    confirmReplacement(() => {
      setSelectedTemplate(template)
      setTemplateValues(template ? createPromptTemplateValues(template) : {})
      setDraft('')
    })
  }

  const applyFreeInput = (prompt: string) => {
    setSelectedTemplate(null)
    setTemplateValues({})
    setDraft(prompt)
  }

  return {
    templates: templates ?? [],
    selectedTemplate,
    templateValues,
    setTemplateValues,
    templatesLoading,
    templatesFailed,
    loadTemplates,
    confirmReplacement,
    selectTemplate,
    applyFreeInput,
    replacementDialog: (
      <Modal
        title={uiText("替换当前输入？")}
        open={Boolean(replacement)}
        okText={uiText("替换")}
        cancelText={uiText("取消")}
        maskClosable={false}
        onCancel={() => setReplacement(null)}
        onOk={() => {
          replacement?.()
          setReplacement(null)
        }}
      >
        <p>{uiText("继续后将替换当前提示词或相关配置。")}</p>
      </Modal>
    ),
  }
}
