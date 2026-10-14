/** 工作台菜单收纳后的真实入口；保持业务回归沿用户路径操作。 */
export async function workbenchControl(page, menu, role, name) {
  const control = page.getByRole(role, { name, exact: true })
  if (!await control.isVisible()) await page.getByRole('button', { name: menu, exact: true }).click()
  return control
}

export async function workbenchShot(page, name) {
  const picker = page.locator('.canvas-shot-picker')
  if (await picker.getAttribute('open') === null) await picker.locator('summary').click()
  return page.getByRole('button', { name, exact: true })
}
