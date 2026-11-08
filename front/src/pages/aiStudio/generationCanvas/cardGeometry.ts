const compactMediaSize = { width: 300, height: 251 }
const compactTextSize = { width: 400, height: 172 }
const designSize = { width: 360, height: 368 }
const modelSize = { width: 360, height: 424 }

/** 100% 缩放时包含标题的卡片外框。结果与基础内容共用紧凑媒体档。 */
export function generationCardSize(type?: string) {
  if (type === 'review.check') return { width: 400, height: 424 }
  if (type?.startsWith('model.')) return modelSize
  if (type?.startsWith('direction.')) return designSize
  if (type && ['content.basis', 'content.character', 'content.place', 'content.prop', 'content.costume'].includes(type)) return compactTextSize
  return compactMediaSize
}
