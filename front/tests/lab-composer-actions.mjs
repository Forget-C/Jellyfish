/** Follow the public addition menu rather than coupling tests to a popover implementation. */
export async function openLabAddition(page, label) {
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  await page.getByRole('menuitem', { name: label, exact: true }).click()
}
