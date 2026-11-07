import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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
    await page.waitForFunction(() => ![...document.querySelectorAll('.wb-details')].find(node => node.getClientRects().length)?.inert)
    for (let attempt = 0; attempt < 4 && await details.isVisible(); attempt++) {
      const expanded = { modal: await details.getAttribute('data-expanded'), collapsible: await details.getByRole('button', {name:'收起详情',exact:true}).count() > 0 }
      const candidates = details.locator('.generation-material-candidates[open] > summary')
      const close = details.getByRole('button', { name: '关闭详情', exact: true })
      if (await candidates.count()) {
        await candidates.press('Escape')
        await details.locator('.generation-material-candidates[open]').waitFor({ state: 'hidden' })
      } else {
        if (await close.count()) await close.click()
        else await page.keyboard.press('Escape')
        await page.waitForFunction(before => {
          const node = [...document.querySelectorAll('.wb-details')].find(element => element.getClientRects().length)
          return !node || node.getAttribute('data-expanded') !== before.modal || !!node.querySelector('[aria-label="收起详情"]') !== before.collapsible
        }, expanded)
      }
    }
    await details.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.inert)
  }
}

/** 窄屏自动全屏提供关闭，桌面保留展开／收起。 */
export const canvasDetailsToggle = editor => editor.locator(':scope[data-narrow="true"] > header button[aria-label="关闭详情"], :scope:not([data-narrow="true"]) > header button:is([aria-label="展开详情"], [aria-label="收起详情"])')
export async function expandCanvasDetails(page) {
  const panel = page.locator('.generation-card-editor:visible')
  if (await panel.getAttribute('data-narrow') === 'true') {
    assert.equal(await panel.getAttribute('aria-modal'), 'true', 'narrow editor is already modal')
    assert.equal(await panel.getAttribute('data-expanded'), 'true')
    await panel.getByRole('button', { name: '关闭详情', exact: true }).waitFor()
    return
  }
  const expand = page.locator('.generation-card-editor:visible').getByRole('button', { name: '展开详情', exact: true })
  if (await expand.count()) await expand.click()
  const editor = page.locator('.generation-card-editor:visible')
  await editor.getByRole('button', { name: '收起详情', exact: true }).waitFor()
  assert.equal(await editor.getAttribute('data-expanded'), 'true', 'editor really entered expanded mode')
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

/** Check the current center hit before any focus or scroll; phase names keep initial and user-scrolled evidence distinct. */
export async function assertControlReachable(control, phase = 'initial') {
  const hit = await control.evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    const target = document.elementFromPoint(x, y)
    return { reachable: rect.width > 0 && rect.height > 0 && !element.closest('[inert]') && !!target && element.contains(target),
      rect: rect.toJSON(), target: target?.outerHTML.slice(0, 500), scroll: { x: scrollX, y: scrollY } }
  })
  assert.ok(hit.reachable, `control not reachable (${phase}): ${JSON.stringify(hit)}`)
  return { phase, ...hit }
}

/** Best-effort evidence must never replace the assertion or browser error that caused the failure. */
export async function captureCanvasFailure(page, output, error, prefix = 'failure') {
  const report = { error: { name: error.name, message: error.message, stack: error.stack }, diagnosticErrors: [] }
  const attempt = async (name, action) => {
    try { return await action() }
    catch (failure) { report.diagnosticErrors.push({ name, message: failure.message }) }
  }
  report.geometry = await attempt('geometry', () => page.evaluate(() => {
    const describe = element => {
      const box = element.getBoundingClientRect(), target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return { tag: element.tagName, label: element.getAttribute('aria-label'), rect: box.toJSON(),
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        scrollTop: element.scrollTop, scrollLeft: element.scrollLeft, inert: !!element.closest('[inert]'), focused: element === document.activeElement,
        hit: target?.outerHTML.slice(0, 500), centerHit: !!target && element.contains(target) }
    }
    const selectors = ['.generation-card-editor:not([hidden])', '.wb-details-body', '.wb-details-header', '.generation-editor-actions', '.generation-workbench-header', '.generation-browse', '.canvas-filters', '.generation-card-categories', '.generation-view-tools', '[data-card-id]', '.generation-card-editor:not([hidden]) button']
    return { viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, scroll: { x: scrollX, y: scrollY },
      zoom: getComputedStyle(document.querySelector('.generation-world') || document.body).transform,
      focus: document.activeElement?.outerHTML.slice(0, 500),
      elements: selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(element => element.getClientRects().length).map(element => ({ selector, ...describe(element) }))) }
  }))
  await attempt('page screenshot', () => page.screenshot({ path: join(output, `${prefix}-page.png`), fullPage: true, timeout: 2000 }))
  await attempt('editor screenshot', async () => {
    const box = await page.locator('.generation-card-editor:visible').boundingBox({ timeout: 1500 })
    if (!box) throw new Error('no visible editor')
    await page.screenshot({ path: join(output, `${prefix}-editor.png`), clip: box, timeout: 2000 })
  })
  await attempt('write diagnostics', () => writeFile(join(output, `${prefix}-diagnostics.json`), JSON.stringify(report, null, 2) + '\n'))
  if (report.diagnosticErrors.length) console.error('Diagnostic gaps:', JSON.stringify(report.diagnosticErrors))
  return report
}

/** Keep native page scroll fixed while sending real keys, including to cards outside the current viewport. */
export async function pressCanvasControl(page, control, key) {
  await control.evaluate(element => element.focus({ preventScroll: true }))
  await page.keyboard.press(key)
}

/** Explicit coordinates are for scenario setup (including edge regressions), never silently made safe. */
export async function moveCanvasCard(page, id, x, y) {
  const card = page.locator(`[data-card-id="${id}"]`), mover = card.getByRole('button', { name: /^移动布局：/ })
  await mover.evaluate(element => element.focus({ preventScroll: true }))
  for (let step = 0; step < 250; step++) {
    const box = await card.boundingBox()
    if (Math.abs(box.x - x) <= 10 && Math.abs(box.y - y) <= 10) return
    const key = Math.abs(box.x - x) > 10 ? box.x < x ? 'ArrowRight' : 'ArrowLeft' : box.y < y ? 'ArrowDown' : 'ArrowUp'
    await page.keyboard.press(`${(Math.abs(box.x-x)>10?Math.abs(box.x-x):Math.abs(box.y-y))>100?'Shift+':''}${key}`)
  }
  throw new Error(`cannot move canvas card ${id} to ${x},${y}`)
}

/** Separate neighbors from the target and already placed cards through public layout controls. */
export async function clearCanvasNeighbors(page, id) {
  const placed = [page.locator(`[data-card-id="${id}"]`)]
  for (const card of await page.locator('[data-card-id]').all()) {
    if (await card.getAttribute('data-card-id') === id) continue
    const mover = card.getByRole('button', { name: /^移动布局：/ })
    await mover.evaluate(element => element.focus({ preventScroll: true }))
    for (let step = 0; step < 250; step++) {
      const b = await card.boundingBox(), occupied = await Promise.all(placed.map(item => item.boundingBox()))
      if (occupied.every(a => b.x >= a.x + a.width + 20 || b.x + b.width <= a.x - 20 || b.y >= a.y + a.height + 20 || b.y + b.height <= a.y - 20)) break
      assert.ok(step < 249, `cannot clear neighbor ${await card.getAttribute('data-card-id')}`)
      await page.keyboard.press('Shift+ArrowRight')
    }
    placed.push(card)
  }
}

/** Ordinary evidence setup uses measured chrome bounds. Edge tests must use moveCanvasCard instead. */
export async function prepareCanvasCard(page, id) {
  await page.locator('.generation-browse').waitFor()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const bounds = await page.evaluate(() => {
    const surface = document.querySelector('.generation-surface').getBoundingClientRect()
    let left = Math.max(0, surface.left), top = Math.max(0, surface.top)
    for (const element of document.querySelectorAll('.generation-card-categories, .generation-workbench-header, .generation-browse, .canvas-filters, .canvas-breadcrumb')) {
      if (!element.getClientRects().length) continue
      const box = element.getBoundingClientRect()
      if (element.matches('.generation-card-categories')) left = Math.max(left, box.right)
      else top = Math.max(top, box.bottom)
    }
    return { x: left + 16, y: top + 24 }
  })
  for(let attempt=0;attempt<16;attempt++){
    const box=await page.locator(`[data-card-id="${id}"]`).boundingBox()
    if(box.width <= page.viewportSize().width-bounds.x-24)break
    await page.getByRole('button',{name:'缩小',exact:true}).click()
  }
  await moveCanvasCard(page, id, bounds.x, bounds.y)
  await clearCanvasNeighbors(page, id)
  await assertControlReachable(page.locator(`[data-card-id="${id}"]`).getByRole('button', { name: /^移动布局：/ }), 'prepared')
}

/** Wait for fonts, actual media loading and stable geometry, then clip the page without locator auto-scroll. */
export async function captureCanvasRegion(page, region, path) {
  await page.mouse.move(1, 1)
  // 保留的编辑器可能保留旧 hover 状态；真实移入触发器再移出，不隐藏或删除浮层。
  const hovered = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].filter(tooltip => tooltip.getClientRects().length && getComputedStyle(tooltip).visibility !== 'hidden').flatMap(tooltip => {
    const labelled = [...document.querySelectorAll('button[aria-label]')].filter(element => element.getAttribute('aria-label') === tooltip.textContent.trim() && element.getClientRects().length)
    const trigger = tooltip.id && [...document.querySelectorAll('[aria-describedby]')].find(element => element.getAttribute('aria-describedby').split(' ').includes(tooltip.id)) || (labelled.length === 1 ? labelled[0] : undefined)
    if (!trigger) return []
    const box = trigger.getBoundingClientRect()
    return box.width && box.height && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight ? [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] : []
  }))
  for (const point of hovered) { await page.mouse.move(point.x, point.y); await page.mouse.move(1, 1) }
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tooltip"]')].every(element => !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden'), undefined, { timeout: 2000 })
  const handle = await region.elementHandle()
  await page.waitForFunction(element => document.fonts.status === 'loaded' && [...element.querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0), handle, { timeout: 5000 })
  await region.evaluate(element => new Promise((resolve, reject) => {
    let previous, stable = 0
    const deadline = performance.now() + 3000
    const measure = () => {
      const rect = element.getBoundingClientRect(), current = JSON.stringify(rect.toJSON())
      stable = current === previous ? stable + 1 : 0
      previous = current
      if (stable >= 3) resolve()
      else if (performance.now() > deadline) reject(new Error('capture region layout did not settle'))
      else requestAnimationFrame(measure)
    }
    measure()
  }))
  const box = await region.boundingBox(), viewport = page.viewportSize()
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `capture region is outside viewport: ${JSON.stringify(box)}`)
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
  await page.screenshot({ path, clip: box, scale: 'css', animations: 'disabled' })
  assert.deepEqual(await page.evaluate(() => ({ x: scrollX, y: scrollY })), before, 'capture preserves native scroll')
  return { viewport, region: box, scroll: before, zoom: await page.locator('.generation-world').evaluate(element => getComputedStyle(element).transform) }
}

/** 参考名称独立于图片来源，不再建立名称候选边。 */
export async function selectReferenceName(page, name) {
  const field = page.locator('.wb-details:visible').getByRole('combobox', { name: '参考名称', exact: true })
  await field.fill(name); await field.press('Enter')
}
/** 参考卡候选关系通过已有画布连线交互建立。 */
export async function connectCanvasCards(page, source, target) {
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCardMenu(page, source)
  await page.locator(`[data-card-id="${source}"]`).getByRole('button', { name: '连接到…', exact: true }).press('Enter')
  await page.locator(`[data-card-id="${target}"]`).press('Enter')
}
export async function selectCanvasReferenceImage(page, label) {
  const editor = page.locator('.wb-details:visible')
  await editor.getByRole('button', { name: /^(从当前画布选择|更换参考图)$/ }).click()
  const picker = page.getByRole('dialog', { name: '从当前画布选择参考图', exact: true })
  await (typeof label === 'string' ? picker.locator(`[data-reference-source-card=${JSON.stringify(label)}]`) : picker.getByRole('button', { name: label })).click()
  await picker.waitFor({ state: 'hidden' })
}
