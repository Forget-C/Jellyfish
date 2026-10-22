/** 工作台菜单收纳后的真实入口；保持业务回归沿用户路径操作。 */
export async function workbenchControl(page, menu, role, name) {
  const control = page.getByRole(role, { name, exact: true })
  if (!await control.isVisible()) await page.getByRole('button', { name: menu, exact: true }).click()
  return control
}

export async function workbenchShot(page, name) {
  const match = /^镜头 (\d+)：/.exec(name)
  if (!match) throw new Error(`无法识别镜头编号：${name}`)
  await directorOverview(page)
  const panel = await directorInfo(page)
  return panel.getByRole('button', { name: new RegExp(`^镜头 ${match[1].padStart(2, '0')} ·`) })
}

async function directorOverview(page) {
  const overview = page.getByRole('button', { name: '总览', exact: true })
  if (!await overview.isVisible()) await page.getByRole('button', { name: '导演画布', exact: true }).click()
  if (await overview.isEnabled()) await overview.click()
}

async function directorInfo(page) {
  const panel = page.getByRole('complementary', { name: '附加信息', exact: true }).or(page.getByRole('dialog', { name: '附加信息', exact: true }))
  if (!await panel.isVisible()) {
    if (await page.getByRole('group', { name: '版本管理选项' }).isVisible()) await page.getByRole('button', { name: '版本管理', exact: true }).click()
    await page.getByRole('button', { name: '附加信息', exact: true }).click()
  }
  await panel.waitFor()
  return panel
}

export async function directorSelect(page, name, label, search) {
  if (name === '设计域' || name === '设计视图') {
    if (label === '导演画布' || label === '总导演' || label === '场次总览') { await directorOverview(page); return }
    const match = /^镜头 (\d+)/.exec(label)
    if (match) { await (await workbenchShot(page, `镜头 ${match[1]}：`)).click(); return }
    throw new Error(`设计域入口已移除：${label}`)
  }
  if (name === '定位设计对象') await directorInfo(page)
  const combo = page.getByRole('combobox', { name, exact: true })
  await combo.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]').click()
  if (search) await combo.fill(search)
  await page.locator(`[id="${await combo.getAttribute('aria-controls')}"]`).locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")][1]').locator('.ant-select-item-option').filter({ hasText: label }).click()
}

export async function directorObject(page, label, search = typeof label === 'string' ? label : '') {
  const dialog = page.locator('.wb-details:visible').last()
  if (await dialog.count()) { await dialog.getByRole('button', { name: '关闭详情', exact: true }).click({ force: true }); await dialog.waitFor({ state: 'hidden' }) }
  const object = page.locator('.director-canvas-object').filter({ has: page.getByRole('heading', { name: label, exact: typeof label === 'string' }) })
  if (!await object.count()) await directorOverview(page)
  if (!await object.count() && await page.getByRole('switch', { name: '显示未关联设计' }).count()) {
    const unlinked = page.getByRole('switch', { name: '显示未关联设计' })
    if (!await unlinked.isChecked()) await unlinked.click()
  }
  await directorSelect(page, '定位设计对象', label, search)
  await object.getByRole('button', { name: /^查看节点：/ }).click()
  return page.locator('.wb-details:visible').last()
}

/** 从真实摘要入口打开唯一单元编辑器；已打开时保留当前输入会话。 */
export async function unitSettings(page) {
  const panel = page.getByRole('complementary', { name: '单元设置', exact: true }).or(page.getByRole('dialog', { name: '单元设置', exact: true }))
  if (!await panel.isVisible()) await page.getByRole('button', { name: '查看单元设置', exact: true }).click()
  await panel.waitFor()
  return panel
}

export async function closeWorkbenchDetails(page) {
  const close = page.locator('.wb-details:visible').getByRole('button', { name: '关闭详情', exact: true })
  if (await close.isVisible()) await close.click()
}

export async function locateCanvasNode(page, name) {
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

export async function exportControl(page, name) {
  const dialog = page.getByRole('dialog', { name: '整场导出', exact: true })
  if (!await dialog.isVisible()) {
    await closeWorkbenchDetails(page)
    const pending = page.getByRole('button', { name: '查看导出待核实状态', exact: true })
    const label = await pending.count() ? '查看导出待核实状态' : '导出'
    await (await workbenchControl(page, '更多操作', 'button', label)).click()
  }
  return dialog.getByRole('button', { name, exact: true })
}

/** 通过控件关联的弹层选择，避免命中保留在 DOM 的旧菜单。 */
export async function selectWorkbenchOption(page, name, label) {
  const combo = page.getByRole('combobox', { name, exact: true })
  await combo.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]').click()
  const popup = page.locator(`[id="${await combo.getAttribute('aria-controls')}"]`).locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")][1]')
  await popup.locator('.ant-select-item-option').filter({ hasText: label }).click()
}
