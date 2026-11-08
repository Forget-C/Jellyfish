const compactMediaSize = { width: 300, height: 251 }
const compactTextSize = { width: 400, height: 172 }
const designSize = { width: 360, height: 368 }
const modelSize = { width: 360, height: 424 }

/** 100% 缩放时包含标题的卡片外框。文本结果与对应内容卡共用紧凑文本档。 */
export function generationCardSize(type?: string) {
  if (type === 'review.check') return { width: 400, height: 424 }
  if (type?.startsWith('model.')) return modelSize
  if (type?.startsWith('direction.')) return designSize
  if (type && ['content.text', 'result.text', 'content.basis', 'content.character', 'content.place', 'content.prop', 'content.costume'].includes(type)) return compactTextSize
  return compactMediaSize
}
