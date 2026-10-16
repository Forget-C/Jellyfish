/** 工作台菜单收纳后的真实入口；保持业务回归沿用户路径操作。 */
export async function workbenchControl(page, menu, role, name) {
  const control = page.getByRole(role, { name, exact: true })
  if (!await control.isVisible()) await page.getByRole('button', { name: menu, exact: true }).click()
  return control
}

export async function workbenchShot(page, name) {
  const match = /^镜头 (\d+)：(.*)$/.exec(name)
  const combo = page.getByRole('combobox', { name: '选择镜头', exact: true })
  if (!await combo.count() && !await page.getByRole('button', { name: '选择镜头', exact: true }).count() && match && await page.getByRole('combobox', { name: '设计视图', exact: true }).count()) {
    await directorSelect(page, '设计视图', `镜头 ${match[1].padStart(2, '0')} · 设计`)
  }
  await combo.or(page.getByRole('button', { name: '选择镜头', exact: true })).first().waitFor()
  if (await combo.count()) {
    await combo.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]').click()
    await combo.fill(match ? match[2] : name)
    return page.locator(`[id="${await combo.getAttribute('aria-controls')}"]`).locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")][1]').locator('.ant-select-item-option').filter({ hasText: match ? `镜头 ${match[1].padStart(2, '0')} · ${match[2]}` : name })
  }
  const target = page.getByRole('menuitem', { name: match ? `镜头 ${match[1].padStart(2, '0')} · ${match[2]}` : name, exact: true })
  await page.getByRole('button', { name: '选择镜头', exact: true }).click()
  return target
}

export async function directorSelect(page, name, label, search) {
  if (name === '设计域') {
    const view = page.getByRole('combobox', { name: '设计视图', exact: true })
    if (label === '导演画布' || label === '总导演') { await directorSelect(page, '设计视图', '场次总览'); return }
    const shot = page.getByRole('combobox', { name: '选择镜头', exact: true })
    if (await shot.count()) {
      const current = await shot.locator('xpath=ancestor::div[contains(@class,"ant-select")][1]').locator('.ant-select-selection-item').innerText()
      await directorSelect(page, '设计视图', /^镜头 \d+/.exec(current)?.[0] || current)
    } else if (await view.count()) await directorSelect(page, '设计视图', '场次总览')
    return
  }
  const combo = page.getByRole('combobox', { name, exact: true })
  await combo.locator('xpath=ancestor::div[contains(@class,"ant-select-selector")][1]').click()
  if (search) await combo.fill(search)
  await page.locator(`[id="${await combo.getAttribute('aria-controls')}"]`).locator('xpath=ancestor::div[contains(@class,"ant-select-dropdown")][1]').locator('.ant-select-item-option').filter({ hasText: label }).click()
}

export async function directorObject(page, label, search = typeof label === 'string' ? label : '') {
  const close = page.getByRole('button', { name: '关闭编辑区', exact: true })
  if (await close.isVisible()) await close.click()
  await directorSelect(page, '定位设计对象', label, search)
  const object = page.locator('.director-canvas-object').filter({ has: page.getByRole('heading', { name: label, exact: true }) })
  const edit = object.getByRole('button', { name: '编辑此卡', exact: true })
  if (await edit.isDisabled()) await object.getByRole('button', { name: /^查看节点：/ }).click()
  else await edit.click()
  return page.locator('.canvas-quick-editor')
}

export async function directorCreate(page, domain, label) {
  const close = page.getByRole('button', { name: '关闭编辑区', exact: true })
  if (await close.isVisible()) await close.click()
  if (domain === '总导演') await directorSelect(page, '设计视图', '场次总览')
  await page.getByRole('button', { name: '新增工作单', exact: true }).click()
  await page.getByRole('menuitem', { name: `新增${label}`, exact: true }).click()
  return page.locator('.canvas-quick-editor')
}

export async function directorShared(page, label) {
  const close = page.getByRole('button', { name: '关闭编辑区', exact: true })
  if (await close.isVisible()) await close.click()
  await directorSelect(page, '设计域', '导演画布')
  await page.getByRole('button', { name: '新增共享对象', exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
  return page.locator('.canvas-quick-editor')
}
