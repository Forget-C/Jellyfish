import { closeCardList, openCardMenu, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-graph-')
const api = 'http://127.0.0.1:8458'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8458' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4458, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true }) })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '类型化画布' }) })).json()).data
  const doc = { ...canvas.document, cards: [
    { id: 'a', type: 'content.text', text: '第一份来源' },
    { id: 'b', type: 'content.text', text: '第二份来源' },
    { id: 'm', type: 'model.text', model_id: 'graph-text', prompt: { segments: [] }, config: {} },
  ] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: doc }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4458/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = id => page.locator(`[data-card-id="${id}"]`)
  const selected = () => page.locator('[data-card-id][data-selected="true"]')
  await card('a').waitFor()
  await closeCardList(page)
  await card('a').click({ modifiers: ['Control'] })
  await card('b').click({ modifiers: ['Control'] })
  assert.equal(await selected().count(), 2)
  const menu = page.getByRole('toolbar', { name: '所选卡片操作', exact: true })
  await menu.waitFor()
  const menuBox = await menu.boundingBox(), aBox = await card('a').boundingBox()
  assert.ok(menuBox.y + menuBox.height <= aBox.y + 1, 'organization toolbar above selection')
  await menu.getByRole('button', { name: '编组', exact: true }).click()
  const group = page.locator('[data-group-id]')
  await group.waitFor()
  assert.equal(await group.getByRole('button', { name: '折叠组', exact: true }).count(), 0, 'visual group is not an editable collapse container')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.deepEqual(saved.document.groups[0].card_ids, ['a', 'b'])
  const members = group.getByRole('combobox', { name: '分组成员 新编组', exact: true })
  await members.click()
  await page.locator('.ant-select-item-option').filter({ hasText: '文本模型卡 m' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const added = (await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  assert.deepEqual(added.groups[0].card_ids, ['a', 'b', 'm'], 'membership is explicitly saved')
  await members.press('Backspace')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const removed = (await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  assert.deepEqual(removed.groups[0].card_ids, ['a', 'b'], 'explicit member removal preserves other owners')
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const beforeA = await card('a').boundingBox(), beforeB = await card('b').boundingBox(), groupBox = await group.boundingBox()
  await page.mouse.move(groupBox.x + 7, groupBox.y + groupBox.height - 7)
  await page.mouse.down()
  await page.mouse.move(groupBox.x + 47, groupBox.y + groupBox.height + 23, { steps: 5 })
  await page.mouse.up()
  const movedA = await card('a').boundingBox(), movedB = await card('b').boundingBox()
  assert.ok(Math.abs(movedA.x - beforeA.x - 40) < 2 && Math.abs(movedA.y - beforeA.y - 30) < 2, 'group blank area moves members')
  assert.ok(Math.abs(movedB.x - beforeB.x - 40) < 2 && Math.abs(movedB.y - beforeB.y - 30) < 2, 'whole group shares translation')
  await page.screenshot({ path: join(output, 'multi-group-desktop.png'), fullPage: true })
  // A member remains individually movable; crossing the frame cannot change its owner.
  await card('a').getByRole('button', { name: '移动布局：文本内容卡', exact: true }).press('ArrowDown')
  const independentA = await card('a').boundingBox(), independentB = await card('b').boundingBox()
  assert.ok(independentA.y > movedA.y)
  assert.ok(Math.abs(independentB.y - movedB.y) < 2)
  await group.getByRole('textbox', { name: '分组名称', exact: true }).fill('视觉编组')
  const relative = { x: independentB.x - independentA.x, y: independentB.y - independentA.y }
  await page.getByRole('button', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: '整理布局', exact: true }).click()
  const arrangedA = await card('a').boundingBox(), arrangedB = await card('b').boundingBox()
  assert.ok(Math.abs(arrangedB.x - arrangedA.x - relative.x) < 2 && Math.abs(arrangedB.y - arrangedA.y - relative.y) < 2, 'arranging preserves member relative positions')
  await page.getByRole('button', { name: '撤销布局整理', exact: true }).click()
  const undone = await card('a').boundingBox()
  assert.ok(Math.abs(undone.x - independentA.x) < 2 && Math.abs(undone.y - independentA.y) < 2, 'undo restores member geometry')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  // A plain canvas drag selects a new collection, without the former Shift shortcut.
  const boundsA = await card('a').boundingBox(), boundsB = await card('b').boundingBox()
  const frame = await group.boundingBox()
  await page.keyboard.down('Control')
  await page.mouse.move(frame.x + 6, frame.y + frame.height - 6)
  await page.mouse.down()
  await page.mouse.move(Math.max(boundsA.x + boundsA.width, boundsB.x + boundsB.width) - 6, Math.min(boundsA.y, boundsB.y) + 6, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  assert.equal(await selected().count(), 2, 'modifier inside group starts marquee rather than group move')
  await page.keyboard.press('Escape')
  assert.equal(await selected().count(), 0)
  const panBefore = await page.locator('.generation-world').getAttribute('style')
  const nodeBefore = await card('a').getAttribute('style')
  const panBox = await group.boundingBox()
  await page.mouse.move(panBox.x + 6, panBox.y + panBox.height - 6)
  await page.locator('.generation-surface').focus()
  await page.keyboard.down('Space')
  await page.mouse.down()
  await page.mouse.move(panBox.x + 26, panBox.y + panBox.height + 4)
  await page.keyboard.up('Space')
  await page.mouse.move(panBox.x + 46, panBox.y + panBox.height + 14)
  await page.mouse.up()
  assert.notEqual(await page.locator('.generation-world').getAttribute('style'), panBefore, 'Space in group blank area pans viewport')
  assert.equal(await card('a').getAttribute('style'), nodeBefore, 'group members do not move during pan')
  const cancelStart = await card('a').boundingBox(), cancelGroup = await group.boundingBox()
  await page.mouse.move(cancelGroup.x + 6, cancelGroup.y + cancelGroup.height - 6)
  await page.mouse.down()
  await page.mouse.move(cancelGroup.x + 36, cancelGroup.y + cancelGroup.height + 14)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  const cancelled = await card('a').boundingBox()
  assert.ok(Math.abs(cancelled.x - cancelStart.x) < 2 && Math.abs(cancelled.y - cancelStart.y) < 2, 'group movement cancellation restores all member positions')
  // Mac uses Command, while Control is the non-Mac modifier.
  await page.evaluate(() => Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }))
  await card('a').click({ modifiers: ['Meta'] })
  await card('b').click({ modifiers: ['Meta'] })
  assert.equal(await selected().count(), 2)
  await menu.getByRole('button', { name: '编组', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '请先解除已有编组' }).waitFor()
  assert.equal(await group.count(), 1, 'existing owners never silently create partial groups')
  await page.keyboard.press('Escape')
  await group.getByRole('button', { name: '解散组', exact: true }).click()
  assert.equal(await group.count(), 0)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const fullA = await card('a').boundingBox(), fullB = await card('b').boundingBox()
  await page.mouse.move(Math.min(fullA.x, fullB.x) - 8, Math.min(fullA.y, fullB.y) - 8)
  await page.mouse.down()
  await page.mouse.move(Math.max(fullA.x, fullB.x) + 20, Math.max(fullA.y, fullB.y) + 20, { steps: 6 })
  await page.mouse.up()
  assert.equal(await selected().count(), 2, 'plain empty-canvas marquee selects cards')
  await page.keyboard.press('Escape')
  await openCardMenu(page, 'a')
  await card('a').getByRole('button', { name: '选择多个', exact: true }).click()
  await card('b').click()
  assert.equal(await selected().count(), 2, 'menu selection mode toggles members without editing')
  assert.equal(await page.locator('.wb-details:visible').count(), 0)
  await menu.getByRole('button', { name: '完成选择', exact: true }).click()
  await menu.getByRole('button', { name: '编组', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const finalDoc = (await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  assert.deepEqual(finalDoc.groups[0].card_ids, ['a', 'b'])
  assert.equal(finalDoc.edges.length, 0)
  assert.deepEqual(finalDoc.cards.map(item => item.id), ['a', 'b', 'm'])
  await page.reload()
  await group.waitFor()
  assert.equal(await card('a').count(), 1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCardMenu(page, 'a')
  await card('a').getByRole('button', { name: '选择多个', exact: true }).click()
  await card('b').tap()
  const mobileMenu = await menu.boundingBox()
  assert.ok(mobileMenu.y + mobileMenu.height <= Math.min((await card('a').boundingBox()).y, (await card('b').boundingBox()).y), 'mobile wrapped menu stays above selection')
  assert.ok(mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 390)
  await page.screenshot({ path: join(output, 'multi-group-mobile.png'), fullPage: true })
  console.log('PASS explicit multiselection and visual group saved through HTTP')
} finally { await cleanup() }
