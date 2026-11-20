import type {
  ExperimentMessageRead,
  ImageGenerationOperationInput,
  ImageMediaInput,
  MediaReference,
  VideoGenerationOperationInput,
  VideoMediaInput_Output,
} from '../../../services/generated'

export type ExperimentInputSnapshot = {
  version: 1
  model_id?: string | null
  prompt: string
  media?: ImageMediaInput & VideoMediaInput_Output
  operation_input?: ImageGenerationOperationInput | VideoGenerationOperationInput
}

/** 用户提交的可回填输入由服务端单独保存。 */
export function readExperimentInputSnapshot(message: ExperimentMessageRead): ExperimentInputSnapshot | undefined {
  const snapshot = message.payload?.input_snapshot
  if (message.role !== 'user' || !snapshot || typeof snapshot !== 'object') return
  const value = snapshot as Record<string, unknown>
  if (value.version === 1 && typeof value.prompt === 'string'
    && (value.model_id == null || typeof value.model_id === 'string')) return value as ExperimentInputSnapshot
}

/** 同组媒体按提交时的顺序回填。 */
export function orderedMediaReferences(media: MediaReference[] | undefined): MediaReference[] {
  if (!Array.isArray(media)) return []
  return media.filter(item => item && typeof item.file_id === 'string'
      && (item.media_kind === 'image' || item.media_kind === 'video'))
    .sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0))
}

/** 将焦点移回公共提示词编辑器。 */
export function focusExperimentPromptEditor(): void {
  window.requestAnimationFrame(() => {
    document.getElementById('experiment-prompt-editor')?.focus()
  })
}
