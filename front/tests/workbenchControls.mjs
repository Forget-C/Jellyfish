/** 工作台菜单收纳后的真实入口；保持业务回归沿用户路径操作。 */
export async function workbenchControl(page, menu, role, name) {
  const control = page.getByRole(role, { name, exact: true })
  if (!await control.isVisible()) await page.getByRole('button', { name: menu, exact: true }).click()
  return control
}

export async function workbenchShot(page, name) {
  const match = /^镜头 (\d+)：(.*)$/.exec(name)
  const target = page.getByRole('menuitem', { name: match ? `镜头 ${match[1].padStart(2, '0')} · ${match[2]}` : name, exact: true })
  await page.getByRole('button', { name: '选择镜头', exact: true }).click()
  return target
}
