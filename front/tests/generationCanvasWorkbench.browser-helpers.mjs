import assert from 'node:assert/strict'

/** 摘要只负责定位；所有字段与运行动作都在唯一工作台详情中操作。 */
export async function openCanvasCard(page, id) {
  const details = page.locator('.wb-details:visible')
  if (await details.count() && await details.getAttribute('aria-modal') === 'true') await closeCanvasDetails(page)
  await page.locator(`[data-card-id="${id}"]`).press('Enter')
  await page.locator('.wb-details:visible').waitFor()
  return page.locator('.wb-details:visible')
}

export async function closeCanvasDetails(page) {
  const details = page.locator('.wb-details:visible')
  if (await details.count()) {
    await details.getByRole('button', { name: '关闭详情', exact: true }).click()
    await details.waitFor({ state: 'hidden' })
  }
}

export async function closePrecheck(page) {
  const dialog = page.getByRole('dialog', { name: '运行预检', exact: true })
  if (await dialog.isVisible()) {
    try { await dialog.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 1500 }) }
    catch (error) { if (await dialog.isVisible()) throw error } // 提交也可能已自动关闭操作。
    await dialog.waitFor({ state: 'hidden' })
  }
}

/** 长文和媒体必须实际暴露在浮动详情正文及视口中，不能只检查CSS可见。 */
export async function assertVisibleInDetails(locator) {
  await locator.scrollIntoViewIfNeeded()
  const visible = await locator.evaluate(element => {
    const box = element.getBoundingClientRect(), body = element.closest('.wb-details-body').getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.left >= Math.max(0, body.left) && box.right <= Math.min(innerWidth, body.right) + 1
      && box.top >= Math.max(0, body.top) - 1 && box.bottom <= Math.min(innerHeight, body.bottom) + 1
  })
  assert.equal(visible, true, 'content is exposed within the floating detail and viewport')
}
