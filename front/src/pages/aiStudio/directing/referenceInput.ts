import type { ReferenceBinding_Input as Reference, VideoReferenceCapabilities } from '../../../services/generated'

export const referenceRoles = { subject: '主体参考', first_frame: '起始画面', last_frame: '结束画面', key_frame: '关键帧' }
export const referencePurposes = { identity: '人物／物件身份', space: '场所空间', composition: '构图', continuity: '连续性', performance: '表演', sound: '声音' }

/** 只合并显式主体组；历史单图身份与帧位置保持独立。 */
export function referenceGroups(references: Reference[]) {
  const groups = new Map<string, Reference[]>()
  for (const reference of [...references].sort((a, b) => a.ordinal - b.ordinal)) {
    const key = (reference.input_role || 'subject') === 'subject' ? reference.subject_group_id || reference.id : reference.id
    groups.set(key, [...(groups.get(key) || []), reference])
  }
  return [...groups.values()]
}

export function referenceSummary(references: Reference[]) {
  const images = references.filter(ref => ref.media_kind === 'image').length
  const videos = references.filter(ref => ref.media_kind === 'video').length
  const audio = references.filter(ref => ref.media_kind === 'audio').length
  const subjects = referenceGroups(references).filter(group => (group[0].input_role || 'subject') === 'subject').length
  return `提示词 + ${images} 张图片${videos ? ` + ${videos} 份视频` : ''}${audio ? ` + ${audio} 份声音（当前不可发送）` : ''}${subjects ? ` · ${subjects} 组主体参考` : ''}`
}

/** 提前显示当前接入限制；服务端提交校验仍是最终依据，空上限不等于无限支持。 */
export function referenceIssues(references: Reference[], capability?: VideoReferenceCapabilities) {
  if (!capability) return []
  const issues: string[] = []
  const frames = references.filter(ref => ref.input_role && ref.input_role !== 'subject')
  const subjects = referenceGroups(references).filter(group => !group[0].input_role || group[0].input_role === 'subject')
  const limit = (count: number, maximum: number | null | undefined, label: string) => {
    if (maximum != null && count > maximum) issues.push(`${label}最多 ${maximum} 份，当前 ${count} 份`)
  }
  if (references.some(ref => ref.media_kind === 'audio')) issues.push('当前执行器不支持声音参考，请移除并安排后期')
  if (frames.some(ref => !capability.frame_roles.includes(ref.input_role as 'first_frame'))) issues.push('当前模型不支持所选帧位置，请替换参考或模型')
  limit(frames.length, capability.max_frames, '帧参考')
  for (const role of ['first_frame', 'last_frame'] as const) limit(frames.filter(ref => ref.input_role === role).length, 1, referenceRoles[role])
  if (frames.length && subjects.length && !capability.combine_subjects_and_frames) issues.push('当前模型不能组合主体参考与帧参考，请明确选择')
  limit(subjects.length, capability.max_subjects, '主体参考')
  limit(references.filter(ref => ref.media_kind === 'video').length, capability.max_total_subject_videos, '主体视频')
  for (const group of subjects) {
    const images = group.filter(ref => ref.media_kind === 'image').length
    const videos = group.filter(ref => ref.media_kind === 'video').length
    if (images && !capability.subject_images) issues.push('当前模型不支持主体图片参考，请替换参考或模型')
    if (videos && !capability.subject_videos) issues.push('当前模型不支持主体视频参考，请替换参考或模型')
    limit(images, capability.max_images_per_subject, '每个主体的图片')
    limit(videos, capability.max_videos_per_subject, '每个主体的视频')
    limit(group.length, capability.max_media_per_subject, '每个主体的素材')
  }
  return [...new Set(issues)]
}
