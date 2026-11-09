import { compactDesignFields, structuredDesignFields } from './designSummaryFields'

const compactMediaSize = { width: 300, height: 251 }
const compactAudioSize = { width: 300, height: 172 }
const compactTextSize = { width: 400, height: 172 }
const compactDesignSize = { width: 360, height: 240 }
const structuredDesignSize = { width: 360, height: 304 }
const designSize = { width: 360, height: 368 }
const textModelSize = { width: 360, height: 304 }
const modelSize = { width: 360, height: 424 }

/** 100% 缩放时包含标题的卡片外框，结果与同模态内容卡共用档位。 */
export function generationCardSize(type?: string) {
  if (type === 'review.check') return { width: 400, height: 424 }
  if (type === 'content.audio' || type === 'result.audio') return compactAudioSize
  if (type === 'model.text') return textModelSize
  if (type?.startsWith('model.')) return modelSize
  if (type && compactDesignFields[type]) return compactDesignSize
  if (type && structuredDesignFields[type]) return structuredDesignSize
  if (type?.startsWith('direction.')) return designSize
  if (type && ['content.text', 'result.text', 'content.basis', 'content.character', 'content.place', 'content.prop', 'content.costume'].includes(type)) return compactTextSize
  return compactMediaSize
}
