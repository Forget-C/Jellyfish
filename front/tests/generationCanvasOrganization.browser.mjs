import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const base = `${api}/api/v1/studio/generation-canvases`
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
  // Navigator overrides cannot change Chrome's native macOS Control-click gesture.
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = await createStoryboardCanvas(base, '类型化画布')
  const doc = { ...canvas.document, cards: [
    { id: 'a', type: 'content.text', text: '第一份来源' },
    { id: 'b', type: 'content.text', text: '第二份来源' },
    { id: 'm', type: 'model.text', model_id: 'graph-text', prompt: { segments: [] }, config: {} },
  ] }
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, doc) }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4458${storyboardCanvasPath(canvas)}`)
  const card = id => page.locator(`[data-card-id="${id}"]`)
  const selected = () => page.locator('[data-card-id][data-selected="true"]')
  await card('a').waitFor()
  await closeCardList(page)
  await card('a').click({ modifiers: [process.platform==='darwin'?'Meta':'Control'] })
  await card('b').click({ modifiers: [process.platform==='darwin'?'Meta':'Control'] })
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
  const saved = (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  assert.deepEqual(saved.document.groups[0].card_ids, ['a', 'b'])
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  assert.equal(await group.getByRole('textbox', { name: '分组名称', exact: true }).count(), 0, 'unselected group has no persistent management fields')
  await page.screenshot({ path: join(output, 'group-default.png'), fullPage: true })
  await group.getByRole('button', { name: '选择编组 新编组', exact: true }).click()
  await page.screenshot({ path: join(output, 'group-selected.png'), fullPage: true })
  await group.getByRole('button', { name: '管理编组', exact: true }).click()
  await page.getByRole('menuitem', { name: '管理成员', exact: true }).click()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  const members = group.getByRole('combobox', { name: '分组成员 新编组', exact: true })
  await page.screenshot({ path: join(output, 'group-member-editor.png'), fullPage: true })
  await members.press('ArrowDown')
  await page.locator('.ant-select-item-option').filter({ hasText: '文本模型卡 m' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const added = (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data.document
  assert.deepEqual(added.groups[0].card_ids, ['a', 'b', 'm'], 'membership is explicitly saved')
  await members.press('Backspace')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const removed = (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data.document
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
  await group.getByRole('button', { name: '选择编组 新编组', exact: true }).click()
  await group.getByRole('button', { name: '管理编组', exact: true }).click()
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await group.getByRole('textbox', { name: '分组名称', exact: true }).fill('视觉编组')
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'group-rename.png'), fullPage: true })
  await group.getByRole('button', { name: '完成编组管理', exact: true }).click()
  const keyboardA = await card('a').boundingBox(), keyboardB = await card('b').boundingBox()
  await group.getByRole('button', { name: '移动布局：分组 视觉编组', exact: true }).press('ArrowRight')
  const movedByKeyboardA = await card('a').boundingBox()
  assert.ok(movedByKeyboardA.x > keyboardA.x && (await card('b').boundingBox()).x > keyboardB.x, 'selected group retains keyboard translation')
  const relative = { x: independentB.x - independentA.x, y: independentB.y - independentA.y }
  await page.getByRole('button', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: '整理布局', exact: true }).click()
  const arrangedA = await card('a').boundingBox(), arrangedB = await card('b').boundingBox()
  assert.ok(Math.abs(arrangedB.x - arrangedA.x - relative.x) < 2 && Math.abs(arrangedB.y - arrangedA.y - relative.y) < 2, 'arranging preserves member relative positions')
  await page.getByRole('button', { name: '撤销布局整理', exact: true }).click()
  const undone = await card('a').boundingBox()
  assert.ok(Math.abs(undone.x - movedByKeyboardA.x) < 2 && Math.abs(undone.y - movedByKeyboardA.y) < 2, 'undo restores member geometry')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  // A plain canvas drag selects a new collection, without the former Shift shortcut.
  const boundsA = await card('a').boundingBox(), boundsB = await card('b').boundingBox()
  const frame = await group.boundingBox()
  await page.keyboard.down(process.platform==='darwin'?'Meta':'Control')
  await page.mouse.move(frame.x + 6, frame.y + frame.height - 6)
  await page.mouse.down()
  await page.mouse.move(Math.max(boundsA.x + boundsA.width / 2, boundsB.x + boundsB.width / 2), Math.min(boundsA.y, boundsB.y) + 6, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up(process.platform==='darwin'?'Meta':'Control')
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
  await group.getByRole('button', { name: '选择编组 视觉编组', exact: true }).click()
  await group.getByRole('button', { name: '管理编组', exact: true }).click()
  await page.getByRole('menuitem', { name: '解散组', exact: true }).click()
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
  const finalDoc = (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data.document
  assert.deepEqual(finalDoc.groups[0].card_ids, ['a', 'b'])
  assert.equal(finalDoc.edges.length, 0)
  assert.deepEqual(finalDoc.cards.map(item => item.id), ['a', 'b', 'm', canvas.document.fixed_source.card_id])
  await page.reload()
  await group.waitFor()
  assert.equal(await card('a').count(), 1)
  await page.setViewportSize({ width: 3830, height: 1688 })
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await page.screenshot({ path: join(output, 'group-wide.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await page.screenshot({ path: join(output, 'group-mobile-default.png'), fullPage: true })
  await group.getByRole('button', { name: '选择编组 新编组', exact: true }).tap()
  await group.getByRole('button', { name: '管理编组', exact: true }).tap()
  await page.getByRole('menuitem', { name: '管理成员', exact: true }).tap()
  await page.getByRole('menu').waitFor({ state: 'hidden' })
  const touchMove = await group.getByRole('button', { name: '移动布局：分组 新编组', exact: true }).boundingBox()
  assert.ok(touchMove.width >= 31.5 && touchMove.height >= 31.5, `group controls retain 32px touch size within subpixel rounding: ${JSON.stringify(touchMove)}`)
  await page.screenshot({ path: join(output, 'group-mobile-management.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await openCardMenu(page, 'a')
  await card('a').getByRole('button', { name: '选择多个', exact: true }).click()
  await card('b').tap()
  const mobileMenu = await menu.boundingBox()
  assert.ok(mobileMenu.y + mobileMenu.height <= Math.min((await card('a').boundingBox()).y, (await card('b').boundingBox()).y), 'mobile wrapped menu stays above selection')
  assert.ok(mobileMenu.x >= 0 && mobileMenu.x + mobileMenu.width <= 390)
  await page.screenshot({ path: join(output, 'multi-group-mobile.png'), fullPage: true })
  const openLayoutFixture = async (name, cards, positions, groups = [], outputs) => {
    const fixture = await createStoryboardCanvas(base, name)
    const seeded = await fetch(storyboardCanvasApi(base, fixture.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: { ...fixture.document, cards: [...cards, ...fixture.document.cards], groups } }) })
    assert.ok(seeded.ok, await seeded.text())
    if (outputs) await page.route(`**/${fixture.id}/runtime?project_id=canvas-project`, route => route.fulfill({
      json: { code: 200, data: { cursor: 0, runs: [], current_outputs: outputs(fixture.id) } },
    }))
    await page.addInitScript(({ key, positions }) => {
      localStorage.setItem(key, JSON.stringify({ schema: 1, positions, sizes: {}, transform: { x: 18, y: 12, scale: .8 } }))
    }, { key: `jellyfish:generation-layout:canvas-project:${fixture.id}:view:canvas`, positions })
    await page.goto(`http://127.0.0.1:4458${storyboardCanvasPath(fixture)}`)
    await page.getByRole('button', { name: '布局', exact: true }).waitFor()
  }
  const arrangeFrame = node => node.evaluate(element => ({
    x: Number.parseFloat(element.style.left), y: Number.parseFloat(element.style.top),
    width: element.offsetWidth, height: element.offsetHeight,
  }))
  const arrange = async () => {
    await page.getByRole('button', { name: '布局', exact: true }).click()
    await page.getByRole('button', { name: '整理布局', exact: true }).click()
    await page.keyboard.press('Escape')
  }
  const undoArrange = async () => {
    await page.getByRole('button', { name: '布局', exact: true }).click()
    await page.getByRole('button', { name: '撤销布局整理', exact: true }).click()
    await page.keyboard.press('Escape')
  }
  const view = () => page.locator('.generation-world').getAttribute('style')
  await page.setViewportSize({ width: 1440, height: 960 })
  const ordinary = [
    { id: 'lock', type: 'direction.criterion', criterion_id: 'layout-rule', name: '当前帧', standard: { text: '钥匙可见', authorship: 'user' }, scope: { description: '片段结尾' } },
    { id: 'audio', type: 'content.audio' },
    { id: 'fact', type: 'direction.fact', fact: { text: '钥匙在左手', authorship: 'user' } },
    { id: 'text', type: 'content.text', text: '使用画布整理' },
    { id: 'video-model', type: 'model.video' },
  ]
  await openLayoutFixture('按实际宽高整理', ordinary, {
    lock: { x: 300, y: 270 }, audio: { x: 770, y: 250 }, fact: { x: 1200, y: 250 },
    text: { x: 360, y: 590 }, 'video-model': { x: 850, y: 565 },
  })
  const frames = () => Promise.all(ordinary.map(item => arrangeFrame(card(item.id))))
  const originalFrames = await frames(), originalView = await view()
  await page.screenshot({ path: join(output, 'arrangement-before.png') })
  await arrange()
  const [first, second, third, fourth, fifth] = await frames()
  assert.equal(second.x - fourth.x - fourth.width, 64, 'first column uses its wider second-row card')
  assert.equal(third.x - second.x - Math.max(second.width, fifth.width), 64, 'second column uses its widest card')
  assert.equal(fourth.y - first.y - Math.max(first.height, second.height, third.height), 64, 'second row follows first row actual height')
  assert.deepEqual([second.y, third.y], [first.y, first.y])
  assert.deepEqual([fourth.x, fifth.x, fifth.y], [first.x, second.x, fourth.y])
  await page.screenshot({ path: join(output, 'arrangement-actual-sizes.png') })
  await undoArrange()
  assert.deepEqual(await frames(), originalFrames)
  assert.equal(await view(), originalView)
  const positions = boxes => boxes.map(({ x, y }) => ({ x, y }))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await openCanvasCard(page, 'lock')
    const detail = page.locator('.generation-card-editor:visible')
    assert.equal(await detail.getAttribute('aria-modal'), 'true')
    const beforeLayout = positions(await frames()), beforeView = await view()
    const locked = await arrangeFrame(card('lock'))
    const edit = detail.getByRole('textbox', { name: '可观察判断标准内容', exact: true })
    const next = width === 1440 ? '钥匙仍在人物的左手，拍到完整的动作并保持画面边缘干净。'.repeat(10) : '钥匙可见'
    await edit.fill(next)
    assert.equal((await arrangeFrame(card('lock'))).height, locked.height)
    const action = detail.getByRole('button', { name: '整理布局', exact: true })
    assert.equal(await action.count(), 1, 'locked detail has its own arrange action')
    await action.click()
    assert.equal(await detail.isVisible(), true, 'organizing keeps the detail session open')
    assert.equal(await edit.innerText(), next)
    const arranged = await frames()
    assert.equal(arranged[0].height, locked.height)
    assert.equal(arranged[3].y - arranged[0].y - Math.max(...arranged.slice(0, 3).map(item => item.height)), 64)
    await page.screenshot({ path: join(output, `arrangement-detail-${width}.png`) })
    const arrangedView = await view()
    await detail.getByRole('button', { name: '关闭详情', exact: true }).click()
    const releasedHeight = width === 1440 ? 192 : 128
    await page.waitForFunction(height => document.querySelector('[data-card-id="lock"]').offsetHeight === height, releasedHeight)
    assert.deepEqual(positions(await frames()), positions(arranged), 'unlock does not arrange again')
    assert.equal(await view(), arrangedView)
    await undoArrange()
    assert.deepEqual(positions(await frames()), beforeLayout)
    assert.equal(await view(), beforeView)
    assert.equal((await arrangeFrame(card('lock'))).height, releasedHeight, 'undo restores geometry from current content')
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  const mixedCards = [
    { id: 'member-a', type: 'content.text', text: '开放编组成员' },
    { id: 'member-b', type: 'direction.fact', fact: { text: '保留相对位置', authorship: 'user' } },
    { id: 'collapsed-a', type: 'model.video' }, { id: 'collapsed-b', type: 'content.text' },
    { id: 'hidden-check', type: 'review.check' },
    { id: 'stack-a', type: 'content.text' }, { id: 'stack-b', type: 'model.video' },
    { id: 'result-model', type: 'model.text', show_result_cards: true },
    { id: 'ordinary-b', type: 'content.text' }, { id: 'ordinary-c', type: 'content.audio' },
  ]
  await openLayoutFixture('组与收纳封面参与整理', mixedCards, {
    'member-a': { x: 250, y: 210 }, 'member-b': { x: 320, y: 266 },
    'collapsed-a': { x: 790, y: 110 }, 'collapsed-b': { x: 900, y: 840 },
    'hidden-check': { x: 800, y: 180 },
    'stack-a': { x: 400, y: 140 }, 'stack-b': { x: 450, y: 480 },
    'result-model': { x: 50, y: 360 }, 'ordinary-b': { x: 1250, y: 700 }, 'ordinary-c': { x: 820, y: 800 },
  }, [
    { id: 'open', name: '开放编组', card_ids: ['member-a', 'member-b'] },
    { id: 'closed', name: '收起编组', collapsed: true, card_ids: ['collapsed-a', 'collapsed-b', 'hidden-check'] },
    { id: 'stack', name: '堆叠', kind: 'stack', card_ids: ['stack-a', 'stack-b'] },
  ], id => ({ 'result-model': [{ source: { canvas_id: id, card_id: 'result-model', port_id: 'text', position: 0 }, modality: 'text', available: true, basis_current: true, text: '正式输出' }] }))
  const resultCard = page.locator('[data-card-id^="linked-result:result-model:"]')
  await resultCard.waitFor({ state: 'attached' })
  const initialStack = await arrangeFrame(page.locator('[data-stack-id="stack"]'))
  assert.equal((await arrangeFrame(resultCard)).y, initialStack.y + initialStack.height + 24, 'result clears visible stack cover without avoiding its hidden members')
  assert.equal(await card('hidden-check').count(), 0, 'collapsed check card does not expose a card face')
  await page.getByRole('button', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: '展开小地图', exact: true }).click()
  assert.equal(await page.locator('[data-minimap-node="hidden-check"]').count(), 0, 'collapsed check card has no visible geometry')
  await page.keyboard.press('Escape')
  await arrange()
  const openBox = await arrangeFrame(page.locator('[data-group-id="open"]'))
  const closedBox = await arrangeFrame(page.locator('[data-group-id="closed"]'))
  const stackBox = await arrangeFrame(page.locator('[data-stack-id="stack"]'))
  assert.equal(closedBox.y - openBox.y - openBox.height, 64)
  assert.equal(stackBox.y - closedBox.y - closedBox.height, 64)
  assert.deepEqual([closedBox.width, closedBox.height, stackBox.width, stackBox.height], [300, 110, 400, 300])
  const memberABox = await arrangeFrame(card('member-a')), memberBBox = await arrangeFrame(card('member-b'))
  assert.deepEqual([memberBBox.x - memberABox.x, memberBBox.y - memberABox.y], [70, 56], 'overlapping group members keep their relative positions')
  const model = await arrangeFrame(card('result-model')), neighbor = await arrangeFrame(card('ordinary-b')), audio = await arrangeFrame(card('ordinary-c'))
  assert.equal(model.y - stackBox.y - stackBox.height, 64)
  assert.deepEqual([neighbor.y, audio.y], [model.y, model.y], 'ordinary cards retain three columns below group units')
  const projected = await arrangeFrame(resultCard)
  assert.equal(projected.x - model.x - model.width, 64, 'result still follows the model')
  assert.equal(projected.y, neighbor.y + neighbor.height + 24, 'result clears only visible obstacles at its dedicated spacing')
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await page.screenshot({ path: join(output, 'arrangement-groups-and-results.png') })
  const fixedDetail = page.locator('.generation-card-editor:visible')
  await openCanvasCard(page, 'ordinary-b')
  assert.equal(await fixedDetail.getByRole('button', { name: '整理布局', exact: true }).count(), 0, 'floating detail uses the canvas toolbar')
  await page.keyboard.press('Escape')
  await fixedDetail.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  const resultId = await resultCard.getAttribute('data-card-id')
  for (const id of ['ordinary-b', resultId]) {
    await openCanvasCard(page, id)
    assert.equal(await fixedDetail.getAttribute('aria-modal'), 'true')
    const fixedCard = card(id), height = (await arrangeFrame(fixedCard)).height
    await fixedDetail.getByRole('button', { name: '整理布局', exact: true }).click()
    assert.equal(await fixedDetail.isVisible(), true, 'fixed-height modal stays open while organizing')
    assert.equal((await arrangeFrame(fixedCard)).height, height)
    await page.keyboard.press('Escape')
    await fixedDetail.waitFor({ state: 'hidden' })
  }
  console.log('PASS explicit multiselection and visual group saved through HTTP')
} finally { await cleanup() }
