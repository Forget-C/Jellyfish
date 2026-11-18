import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { GraphSize } from './graphLayout'
import { compactDesignFields, structuredDesignFields } from './designSummaryFields'
import { visualDesignTypes } from './designFieldReferences'

const compactMediaSize = { width: 300, height: 251 }
const compactAudioSize = { width: 300, height: 172 }
const compactTextSize = { width: 400, height: 172 }
const designSize = { width: 360, height: 368 }
const textModelSize = { width: 360, height: 304 }
const modelSize = { width: 360, height: 424 }

/** 100% 缩放时包含标题的卡片外框，结果与同模态内容卡共用档位。 */
export function generationCardSize(type?: string) {
  if (type === 'review.check') return { width: 400, height: 424 }
  if (type === 'content.audio' || type === 'result.audio') return compactAudioSize
  if (type === 'model.text') return textModelSize
  if (type?.startsWith('model.')) return modelSize
  if (type?.startsWith('direction.')) return designSize
  if (type && ['content.text', 'result.text', 'content.basis', 'content.character', 'content.place', 'content.prop', 'content.costume'].includes(type)) return compactTextSize
  return compactMediaSize
}

const compactHeights = [128, 160, 192]
const structuredHeights = [128, 160, 192, 224]
const visualHeights = [240, 272, 304]

/** 启用按可见摘要测量的卡型，其他卡继续使用固定外框。 */
export function designHeightBands(type?: string) {
  if (!type) return undefined
  if (compactDesignFields[type]) return compactHeights
  if (structuredDesignFields[type]) return structuredHeights
  return visualDesignTypes.includes(type) ? visualHeights : undefined
}

export type DesignCardSizing = {
  cardId: string
  locked: boolean
  onMeasure: (cardId: string, requiredHeight: number) => void
}

/** 摘要可持续更新所需空间。锁定期间，所有几何消费者继续使用上一次显示高度。 */
export function useDesignCardSizes(cards: readonly { id: string; type?: string }[], lockedIds: readonly string[]) {
  const [requiredHeights, setRequiredHeights] = useState<Record<string, number>>({})
  const committed = useRef<Record<string, GraphSize>>({})
  const onMeasure = useCallback((id: string, requiredHeight: number) => {
    setRequiredHeights(previous => previous[id] === requiredHeight ? previous : { ...previous, [id]: requiredHeight })
  }, [])
  const sizes = Object.fromEntries(cards.map(card => {
    const bands = designHeightBands(card.type)
    const base = generationCardSize(card.type)
    if (!bands) return [card.id, base]
    const required = requiredHeights[card.id] ?? Infinity
    const height = bands.find(band => band >= required) ?? bands[bands.length - 1]
    return [card.id, lockedIds.includes(card.id) && committed.current[card.id] || { ...base, height }]
  }))
  useLayoutEffect(() => { committed.current = sizes })
  useLayoutEffect(() => {
    const liveIds = new Set(cards.map(card => card.id))
    setRequiredHeights(previous => {
      const live = Object.entries(previous).filter(([id]) => liveIds.has(id))
      return live.length === Object.keys(previous).length ? previous : Object.fromEntries(live)
    })
  }, [cards])
  return {
    sizes,
    measured: (id: string) => requiredHeights[id] !== undefined,
    sizing: (id: string): DesignCardSizing => ({ cardId: id, locked: lockedIds.includes(id), onMeasure }),
  }
}
