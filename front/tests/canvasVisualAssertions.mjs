import assert from 'node:assert/strict'

/** Inspect rendered nodes in each real workspace view against the shared visual contract. */
export async function assertCanvasVisuals(root) {
  const nodes = await root.locator('[data-canvas-node]:not([data-node-action])').evaluateAll(elements => elements.map(element => {
    const css = getComputedStyle(element), title = element.querySelector('strong'), badge = element.querySelector('.canvas-node-type')
    return { type: element.dataset.canvasType, tone: element.dataset.canvasTone, selected: element.classList.contains('is-selected'), missing: element.classList.contains('is-missing'), stale: element.classList.contains('is-stale'), radius: css.borderRadius, padding: css.padding, border: css.borderTopColor, style: css.borderTopStyle, background: css.backgroundColor, outline: css.outlineWidth, outlineColor: css.outlineColor, titleSize: title && getComputedStyle(title).fontSize, titleLine: title && getComputedStyle(title).lineHeight, badge: badge?.textContent, badgeSize: badge && getComputedStyle(badge).fontSize }
  }))
  assert.ok(nodes.length, 'real graph has nodes')
  const colors = { neutral: ['rgb(220, 228, 238)', 'rgb(248, 250, 255)'], blue: ['rgb(143, 195, 255)', 'rgb(238, 246, 255)'], green: ['rgb(114, 199, 180)', 'rgb(241, 250, 246)'], rose: ['rgb(237, 156, 187)', 'rgb(255, 244, 247)'], violet: ['rgb(183, 156, 232)', 'rgb(248, 244, 255)'], amber: ['rgb(224, 180, 95)', 'rgb(255, 249, 238)'] }
  for (const node of nodes) {
    assert.equal(node.radius, '8px', node.type)
    assert.equal(node.padding, '8px', node.type)
    assert.equal(node.titleSize, '14px', node.type)
    assert.equal(node.titleLine, '20px', node.type)
    assert.equal(node.badgeSize, '12px', node.type)
    assert.ok(node.badge?.trim(), node.type)
    if (node.missing) { assert.equal(node.style, 'dashed'); assert.equal(node.background, 'rgb(255, 247, 230)') }
    else if (node.stale) assert.deepEqual([node.border, node.background], ['rgb(213, 217, 223)', 'rgb(243, 244, 246)'], 'stale state stays distinct from object type')
    else assert.deepEqual([node.border, node.background], colors[node.tone], node.type)
    if (node.selected) { assert.equal(node.outline, '2px'); assert.equal(node.outlineColor, 'rgb(22, 119, 255)') }
  }
  const edges = await root.locator('.canvas-edge').evaluateAll(elements => elements.map(element => ({ selected: element.dataset.selected, stroke: getComputedStyle(element.querySelector('.canvas-edge-line')).stroke, width: getComputedStyle(element.querySelector('.canvas-edge-line')).strokeWidth, arrow: getComputedStyle(element.querySelector('marker path')).fill })))
  for (const edge of edges) {
    assert.equal(edge.stroke, edge.arrow, 'line and direction arrow have identical colors')
    if (edge.selected === 'true') { assert.equal(edge.stroke, 'rgb(22, 119, 255)'); assert.equal(edge.width, '2.5px') }
  }
  return { nodes, edges }
}
