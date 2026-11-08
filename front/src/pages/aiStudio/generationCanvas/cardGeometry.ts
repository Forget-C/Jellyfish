const compactMediaSize = { width: 300, height: 251 }
const compactAudioSize = { width: 300, height: 172 }
const compactTextSize = { width: 400, height: 172 }
const compactDesignSize = { width: 360, height: 240 }
const compactDesignTypes = new Set(['direction.criterion', 'direction.fact', 'direction.dialogue', 'direction.event', 'direction.performance_rule'])
const designSize = { width: 360, height: 368 }
const modelSize = { width: 360, height: 424 }

export const isCompactDesignCard = (type?: string) => !!type && compactDesignTypes.has(type)

/** 100% 缩放时包含标题的卡片外框，结果与同模态内容卡共用档位。 */
export function generationCardSize(type?: string) {
  if (type === 'review.check') return { width: 400, height: 424 }
  if (type === 'content.audio' || type === 'result.audio') return compactAudioSize
  if (type?.startsWith('model.')) return modelSize
  if (isCompactDesignCard(type)) return compactDesignSize
  if (type?.startsWith('direction.')) return designSize
  if (type && ['content.text', 'result.text', 'content.basis', 'content.character', 'content.place', 'content.prop', 'content.costume'].includes(type)) return compactTextSize
  return compactMediaSize
}
