import assert from 'node:assert/strict'

/** Check the rendered shared drawer contract, including portaled content. */
export async function assertDetailDrawerLayout(drawer) {
  const layout = await drawer.evaluate(node => {
    const header = node.querySelector('.ant-drawer-header')
    const body = node.querySelector('.ant-drawer-body')
    const title = node.querySelector('.ant-drawer-title')
    return {
      titleSize: getComputedStyle(title).fontSize,
      titleWeight: getComputedStyle(title).fontWeight,
      titleLineHeight: getComputedStyle(title).lineHeight,
      headerHeight: header.getBoundingClientRect().height,
      bodyPadding: getComputedStyle(body).paddingTop,
      narrow: innerWidth <= 767,
    }
  })
  assert.equal(layout.titleSize, '16px')
  assert.equal(layout.titleWeight, '600')
  assert.equal(layout.titleLineHeight, '24px')
  assert.ok(layout.headerHeight >= 56)
  assert.equal(layout.bodyPadding, layout.narrow ? '12px' : '16px')
}
