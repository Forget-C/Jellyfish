import type { ExperimentMessageRead } from '../../../services/generated'

export type ExperimentInputSnapshot = {
  version: 1
  model_id?: string
  prompt: string
  image?: { reference_file_ids?: string[]; target_ratio?: string | null; resolution_profile?: string | null }
  video?: {
    ratio?: string
    frame_references?: { first_frame_file_id?: string | null; last_frame_file_id?: string | null; key_frame_file_ids?: string[] }
    subject_references?: Array<{ name?: string; image_file_ids?: string[]; video_file_ids?: string[] }>
  }
}

/** Reads the current snapshot first and falls back to legacy message payloads. */
export function readExperimentInputSnapshot(message: ExperimentMessageRead): ExperimentInputSnapshot {
  const payload = message.payload ?? {}
  const snapshot = payload.input_snapshot
  if (snapshot && typeof snapshot === 'object') {
    const value = snapshot as Record<string, unknown>
    if (value.version === 1 && typeof value.prompt === 'string') return value as ExperimentInputSnapshot
  }
  return {
    version: 1,
    model_id: typeof payload.model_id === 'string' ? payload.model_id : undefined,
    prompt: message.content ?? '',
    image: Array.isArray(payload.reference_file_ids)
      ? { reference_file_ids: payload.reference_file_ids.filter((id): id is string => typeof id === 'string') }
      : undefined,
    video: {
      ratio: typeof payload.ratio === 'string' ? payload.ratio : undefined,
      frame_references: payload.frame_references as ExperimentInputSnapshot['video']['frame_references'],
      subject_references: payload.subject_references as ExperimentInputSnapshot['video']['subject_references'],
    },
  }
}

/** Moves focus to the shared free-text editor after a history input is restored. */
export function focusExperimentPromptEditor(): void {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>('#experiment-prompt-editor textarea')?.focus()
  })
}
