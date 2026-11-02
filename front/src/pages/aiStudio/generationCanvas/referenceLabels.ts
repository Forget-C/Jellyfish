import type { CanvasDocument, CanvasResolvedOutput, NamedImageReferenceCard, OutputIdentity } from '../../../services/generated'
import { sourceKey } from './promptRules'

const referenceTypes: Record<string, string> = { 'reference.character': '人物', 'reference.place': '场所', 'reference.prop': '道具', 'reference.costume': '服装' }

/** 显示名只修饰当前模型的引用，编号、输出身份及持久绑定保持原值。 */
export function referenceLabels(document: CanvasDocument, sources: Pick<CanvasResolvedOutput, 'source' | 'token'>[], receiverId: string) {
  const cards = new Map((document.cards || []).map(card => [card.id, card]))
  const labels = new Map(sources.map(output => [sourceKey(output.source), output.token || `@缺失(${output.source.card_id}:${output.source.position + 1})`]))
  const groups = new Map<string, { key: string; type: string; angle: string; token: string }[]>()
  // 尚未产出或暂不可用的关联参考同样占据名称；不为它们伪造媒体编号。
  const associated = sources.filter(output => output.source.canvas_id === document.id)
  for (const edge of document.edges || []) {
    if (edge.target_card !== receiverId || associated.some(output => output.source.card_id === edge.source_card)) continue
    const source: OutputIdentity = { canvas_id: document.id, card_id: edge.source_card, port_id: edge.source_port, position: 0 }
    associated.push({ source })
  }
  for (const output of associated) {
    const card = cards.get(output.source.card_id)
    if (!card || !referenceTypes[card.type || '']) continue
    const reference = card as NamedImageReferenceCard
    const linked = reference.name_binding?.canvas_id === document.id ? cards.get(reference.name_binding.card_id) : undefined
    const name = ((linked && 'name' in linked ? linked.name : reference.name) || '').trim()
    if (!name) continue
    const key = sourceKey(output.source), group = groups.get(name) || []
    if (!group.some(item => item.key === key)) group.push({ key, type: referenceTypes[reference.type], angle: reference.angle?.trim() || '正面', token: output.token || `@缺失(${output.source.card_id}:${output.source.position + 1})` })
    groups.set(name, group)
  }
  const levels = new Map<string, number>()
  for (const [name, group] of groups) {
    const angles = new Set(group.map(item => item.angle)), types = new Set(group.map(item => `${item.type}·${item.angle}`))
    levels.set(name, group.length === 1 ? /^(文本|图片|视频|音频)\d+$/.test(name) ? 2 : 0 : angles.size === group.length ? 1 : types.size === group.length ? 2 : 3)
  }
  // 用户名称也可能恰好包含“（正面）”；只提升产生冲突的消歧组，整组使用相同层级。
  let changed = true
  while (changed) {
    changed = false
    const owners = new Map<string, string[]>()
    for (const [name, group] of groups) for (const item of group) {
      const level = levels.get(name)!
      const detail = level === 0 ? '' : level === 1 ? item.angle : level === 2 ? `${item.type}·${item.angle}` : `${item.type}·${item.angle}·${item.token.replace(/^@/, '')}`
      const label = `@${name}${detail ? `（${detail}）` : ''}`
      labels.set(item.key, label)
      owners.set(label, [...(owners.get(label) || []), name])
    }
    for (const names of owners.values()) if (names.length > 1) {
      const qualified = names.filter(name => levels.get(name)! > 0 && levels.get(name)! < 3)
      for (const name of new Set(qualified.length ? qualified : names)) {
        const level = levels.get(name)!
        if (level < 3) { levels.set(name, level + 1); changed = true }
      }
    }
  }
  return labels
}
