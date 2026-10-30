import assert from 'node:assert/strict'

/** 摘要只负责定位；所有字段与运行动作都在唯一工作台详情中操作。 */
export async function openCanvasCard(page, id) {
  const details = page.locator('.wb-details:visible')
  if (await details.count() && await details.getAttribute('aria-modal') === 'true') await closeCanvasDetails(page)
  const card = page.locator(`[data-card-id="${id}"]`)
  await card.press('Enter')
  const edit = card.locator('button[aria-label="编辑卡片"]')
  if (await edit.count()) { await edit.waitFor({state:'visible'}); await edit.press('Enter') }
  await page.locator('.wb-details:visible').waitFor()
  await openModelInspection(page)
  return page.locator('.wb-details:visible')
}

export async function closeCanvasDetails(page) {
  const details = page.locator('.wb-details:visible')
  if (await details.count()) {
    await details.getByRole('button', { name: '关闭详情', exact: true }).click()
    await details.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.inert)
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
    const box = element.getBoundingClientRect(), body = element.closest('.generation-material-candidates, .wb-details-body').getBoundingClientRect()
    return box.width > 0 && box.height > 0 && box.left >= Math.max(0, body.left) && box.right <= Math.min(innerWidth, body.right) + 1
      && box.top >= Math.max(0, body.top) - 1 && box.bottom <= Math.min(innerHeight, body.bottom) + 1
  })
  assert.equal(visible, true, 'content is exposed within the floating detail and viewport')
}

/** 使用真实菜单和目录入口，避免依赖旧的常驻控件。 */
export async function openCanvasManagement(page) {
  const trigger = page.getByRole('button', { name: '画布管理', exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.press('Enter')
}
export async function openCardList(page, category = '基础卡') {
  const details = page.locator('.wb-details:visible')
  if (await details.count() && await details.getAttribute('aria-modal') === 'true') await closeCanvasDetails(page)
  const trigger = page.getByRole('toolbar', { name: '卡片分类', exact: true }).getByRole('button', { name: category, exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.press('Enter')
  await page.getByRole('navigation', { name: '添加卡片', exact: true }).waitFor()
}
export async function closeCardList(page) {
  const close = page.getByRole('button', { name: '关闭卡片列表', exact: true })
  if (await close.isVisible()) await close.click()
}
export async function openCardMenu(page, id) {
  const card = page.locator(`[data-card-id="${id}"]`)
  const trigger = card.getByRole('button', { name: '卡片操作', exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.press('Enter')
}

export async function openSummaryMenu(summary) {
  const trigger = summary.getByRole('button', { name: '卡片操作', exact: true })
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.press('Enter')
}

export async function selectCanvasByName(page, name) {
  await openCanvasManagement(page)
  const chooser = page.getByRole('combobox', { name: '选择画布', exact: true })
  await chooser.press('ArrowDown')
  for (let index = 0; index < 30; index++) {
    const active = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active')
    if (await active.count() && (await active.innerText()).trim() === name) { await chooser.press('Enter'); return }
    await chooser.press('ArrowDown')
  }
  throw new Error(`画布选项不可达：${name}`)
}

/** Older behavior journeys explicitly open the now on-demand model management surfaces. */
export async function openModelInspection(page) {
  const editor = page.locator('.wb-details:visible')
  if (await editor.locator('.generation-material-composer').count()) await editor.locator('.generation-editor-actions .generation-material-footer').waitFor()
  const candidates=editor.getByLabel('管理候选与采用',{exact:true})
  if (await candidates.count() && await candidates.locator('..').getAttribute('open') === null) await candidates.click()
  for (const label of ['＠ 引用与指令', '运行状态与正式输出']) {
    const summary = editor.locator('summary').filter({ hasText: label }).first()
    if (await summary.count() && await summary.locator('..').getAttribute('open') === null) await summary.click()
  }
}
