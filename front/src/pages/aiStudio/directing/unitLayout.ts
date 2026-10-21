import type { GraphArrange } from './graphLayout'

/** 同一后端分组占用独立列；保留个人位置，自动补位不穿过其他分组。 */
export const arrangeUnitGraph: GraphArrange = (nodes, sizes, _width, anchor, retained = {}) => {
  const positions = { ...retained }
  const groups = [...new Set(nodes.map(node => node.group || ''))]
  const placed = nodes.filter(node => positions[node.id])
    .map(node => ({ ...positions[node.id], ...(sizes[node.id] || { width: 360, height: 320 }) }))
  let left = 0
  for (const group of groups) {
    const members = nodes.filter(node => (node.group || '') === group)
    const ordered = [...members.filter(node => node.id === anchor), ...members.filter(node => node.id !== anchor)]
    let top = 0
    for (const node of ordered) {
      const size = sizes[node.id] || { width: 360, height: 320 }
      if (positions[node.id]) { top = Math.max(top, positions[node.id].y + size.height + 64); continue }
      while (placed.some(box => left < box.x + box.width + 32 && left + size.width + 32 > box.x && top < box.y + box.height + 32 && top + size.height + 32 > box.y)) top += 64
      positions[node.id] = { x: left, y: top }
      placed.push({ x: left, y: top, ...size })
      top += size.height + 64
    }
    left += Math.max(360, ...members.map(node => sizes[node.id]?.width || 360)) + 64
  }
  return positions
}
