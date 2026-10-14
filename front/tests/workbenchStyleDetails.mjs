import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'

/** 验证共享控件在工作台暗色和全站浅色环境中的最终样式。 */
export async function checkWorkbenchStyleDetails(page, output) {
  const background = locator => locator.evaluate(node => getComputedStyle(node).backgroundColor)
  const capture = name => page.screenshot({ path: join(output, `${name}.png`), animations: 'disabled' })
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await checkAdditionalControls(page, output)
  await page.getByRole('button', { name: '角色工具', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '全场六岗设计', exact: true })
  const assets = dialog.getByRole('button', { name: '项目资产关联', exact: true })
  assert.equal(await assets.getAttribute('aria-pressed'), 'true')
  assert.equal(await background(assets), 'rgb(56, 56, 56)')
  await dialog.evaluate(async node => { await new Promise(requestAnimationFrame); await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))) })
  await assets.hover()
  await page.waitForFunction(() => {
    const node = document.querySelector('.canvas-workbench-dialog .canvas-choice[aria-pressed="true"]:hover')
    return node && getComputedStyle(node).backgroundColor === 'rgb(64, 64, 64)'
  }, undefined, { polling: 50 })
  assert.equal(await background(assets), 'rgb(64, 64, 64)')
  await capture('details-role-selected')
  await dialog.getByRole('button', { name: '完成编辑', exact: true }).click()
  const version = page.getByRole('button', { name: '版本管理', exact: true })
  await version.click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[aria-label="版本管理"] .canvas-menu-chevron')).transform === 'matrix(-1, 0, 0, -1, 0, 0)')
  const spacing = await version.evaluate(node => {
    const label = node.querySelector('.canvas-version-name').getBoundingClientRect()
    const arrow = node.querySelector('.canvas-menu-chevron').getBoundingClientRect()
    return { gap: arrow.left - label.right, size: getComputedStyle(node.querySelector('.canvas-menu-chevron')).fontSize }
  })
  assert.ok(spacing.gap >= 7, JSON.stringify(spacing))
  assert.equal(spacing.size, '12px')
  await capture('details-version-open')
  await page.keyboard.press('Escape')
  const trigger = page.getByRole('button', { name: '任务中心', exact: true })
  let rows = []
  const taskRoute = route => route.fulfill({ json: { success: true, data: { items: rows, next_cursor: null } } })
  await page.route(/\/api\/v1\/film\/tasks(?:\?.*)?$/, taskRoute)
  async function tasks(count) {
    rows = Array.from({ length: count }, (_, index) => ({ task_id: `style-${index}`, task_kind: 'directing_design', title: `样式验证任务 ${index + 1}`, status: index % 2 ? 'queued' : 'running', progress: 25, cancel_requested: false, project_id: 'canvas-project', created_at_ts: 1789430400, updated_at_ts: 1789430400 }))
    rows.push({ task_id: 'style-finished', task_kind: 'directing_design', title: '已结束任务', status: 'succeeded', progress: 100, cancel_requested: false })
    await page.evaluate(async items => {
      const { useTaskUiStore } = await import('/src/pages/aiStudio/components/taskUiStore.ts')
      useTaskUiStore.setState({ optimisticItems: {} })
      useTaskUiStore.getState().setServerTasks(items)
    }, rows)
  }
  for (const count of [0, 1, 12, 99, 100]) {
    await tasks(count)
    if (!count) await trigger.locator('.app-task-count').waitFor({ state: 'hidden' })
    else {
      const badge = trigger.getByLabel(`排队及运行任务 ${count}`, { exact: true })
      await badge.waitFor()
      assert.equal(await badge.innerText(), count > 99 ? '99+' : String(count))
      assert.equal(await background(badge), 'rgb(45, 45, 45)')
    }
  }
  await trigger.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await trigger.evaluate(node => node.matches(':focus-visible')), true)
  assert.equal(await trigger.evaluate(node => getComputedStyle(node).outlineWidth), '1px')
  await capture('details-task-count-focus')
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await trigger.click()
    const drawer = page.locator('.canvas-task-center .ant-drawer-body')
    await drawer.waitFor()
    await page.waitForFunction(() => document.querySelector('.canvas-task-center .ant-drawer-content-wrapper')?.getBoundingClientRect().right <= innerWidth + 1)
    assert.equal(await background(drawer.locator('.ant-segmented')), 'rgb(20, 20, 20)')
    await drawer.getByText('全部', { exact: true }).click()
    assert.equal(await background(drawer.locator('.ant-segmented-item-selected')), 'rgb(56, 56, 56)')
    assert.equal(await background(drawer.locator('.app-task-card').first()), 'rgb(27, 27, 27)')
    assert.equal(await drawer.locator('.app-task-title').first().evaluate(node => getComputedStyle(node).color), 'rgb(229, 229, 229)')
    const bounds = await drawer.boundingBox()
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1)
    await capture(`details-tasks-${width}`)
    await page.locator('.canvas-task-center').getByRole('button', { name: 'Close', exact: true }).click()
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto('http://127.0.0.1:4193/settings')
  await page.getByLabel('运行中任务 100', { exact: true }).waitFor()
  assert.equal(await background(page.locator('.app-task-count')), 'rgb(234, 243, 255)')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.locator('.app-task-drawer .ant-segmented').waitFor()
  assert.equal(await background(page.locator('.app-task-drawer .ant-segmented')), 'rgb(247, 249, 252)')
  await page.waitForFunction(() => document.querySelector('.ant-drawer-content-wrapper')?.getBoundingClientRect().right <= innerWidth + 1)
  await capture('details-light-task-center')
  await page.unroute(/\/api\/v1\/film\/tasks(?:\?.*)?$/, taskRoute)
}

async function checkAdditionalControls(page, output) {
  const results = []
  async function inspect(name, locator, kind = 'neutral') {
    const style = await locator.evaluate(async node => { await new Promise(requestAnimationFrame); await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); const s = getComputedStyle(node); return { background: s.backgroundColor, color: s.color, border: s.borderColor, outline: s.outlineWidth } })
    const rgb = value => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) || []
    const neutral = value => { const c = rgb(value); return Math.max(...c) - Math.min(...c) < 12 }
    const passes = kind === 'danger' ? rgb(style.color)[0] > rgb(style.color)[1] * 1.4 : kind === 'disabled' ? rgb(style.color).every(value => value < 160) : neutral(style.background) && neutral(style.color)
    results.push({ name, ...style, passes })
    await writeFile(join(output, 'additional-controls.json'), JSON.stringify(results, null, 2))
  }
  await page.getByRole('button', { name: '展开关系树', exact: true }).click()
  await page.getByRole('button', { name: /^定位镜头 1：/ }).click()
  if (await page.getByRole('button', { name: '展开关系树', exact: true }).isVisible()) await page.getByRole('button', { name: '展开关系树', exact: true }).click()
  await inspect('关系树当前对象', page.locator('.scene-relations-tree [aria-current="location"]'))
  await page.getByRole('button', { name: '展开全图', exact: true }).click()
  const overview = page.getByRole('dialog', { name: '全场关系总览', exact: true })
  await overview.waitFor()
  await inspect('总览选中对象', overview.locator('.scene-overview-node[aria-pressed="true"]'))
  await overview.getByRole('button', { name: '返回当前工作', exact: true }).click({ trial: true })
  await page.screenshot({ path: join(output, 'audit-overview.png'), animations: 'disabled' })
  await overview.getByRole('button', { name: '返回当前工作', exact: true }).click()
  await page.getByRole('button', { name: '收起关系树', exact: true }).click()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '全场共享', exact: true }).click()
  await page.getByRole('button', { name: '编辑六岗设计', exact: true }).click()
  const design = page.getByRole('dialog', { name: '全场六岗设计', exact: true })
  await design.getByRole('button', { name: '总导演', exact: true }).click()
  await inspect('设计数组移除按钮', design.locator('.ant-btn-dangerous').first(), 'danger')
  await design.locator('.ant-btn-dangerous').first().click({ trial: true })
  await page.screenshot({ path: join(output, 'audit-danger-actions.png'), animations: 'disabled' })
  await design.getByRole('button', { name: '完成编辑', exact: true }).click()
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  const suggestions = page.getByRole('dialog', { name: 'AI 设计', exact: true })
  await inspect('设计建议范围选中态', suggestions.locator('.scene-ai-scope [aria-pressed="true"]'))
  const generate = suggestions.locator('.scene-ai-footer').getByRole('button', { name: '重新生成整场', exact: true })
  await page.waitForFunction(() => !document.querySelector('.scene-design-generate')?.disabled)
  await inspect('整场设计生成按钮', generate)
  await generate.click({ trial: true })
  await suggestions.evaluate(async node => {
    await new Promise(requestAnimationFrame)
    await Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})))
  })
  assert.equal(await generate.evaluate(node => !!node.closest('.ant-modal-footer')), true)
  await generate.click({ trial: true })
  await inspect('设计生成按钮悬停', generate)
  await page.screenshot({ path: join(output, 'design-generate-neutral.png'), animations: 'disabled' })
  await suggestions.getByText('调整部分设计', { exact: true }).click()
  const submit = suggestions.getByRole('button', { name: '生成调整方案', exact: true })
  await submit.waitFor()
  assert.equal(await submit.isDisabled(), true)
  await inspect('禁用的设计生成按钮', submit, 'disabled')
  await page.screenshot({ path: join(output, 'audit-design-scope.png'), animations: 'disabled' })
  await suggestions.locator('.ant-modal-close').click()
  await writeFile(join(output, 'additional-controls.json'), JSON.stringify(results, null, 2))
  assert.deepEqual(results.filter(row => !row.passes), [], '同类控件审查')
}
