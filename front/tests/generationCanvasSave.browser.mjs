import { closeCanvasDetails, openCanvasManagement, openCardList, openCanvasCard, selectCanvasByName } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8271'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8271' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))

/** 通过实际保存、恢复和历史入口观察卡面，不从尺寸计算器生成期望值。 */
async function verifyDerivedCardHeight() {
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '设计卡高度与恢复' }) })).json()).data
  const endpoint = `${base}/${canvas.id}`
  const read = async () => (await (await fetch(endpoint)).json()).data
  const save = (revision, document) => fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: revision, document }) })
  const short = '确认钥匙在左手'
  const long = '从门口到窗边的连续镜头中，确认钥匙始终留在人物左手。'.repeat(16)
  const document = { ...canvas.document, cards: [
    { id: 'criterion', type: 'direction.criterion', name: '钥匙验收', standard: { state: 'fact', text: short }, scope: { description: '核对镜头末尾' } },
    { id: 'source', type: 'content.text', text: '镜头内有一把钥匙' },
  ], edges: [{ id: 'basis', source_card: 'source', source_port: 'text', target_card: 'criterion', target_port: 'text' }],
  input_order: { criterion: { text: ['basis'] } }, groups: [{ id: 'requirements', name: '验收依据', card_ids: ['source', 'criterion'] }] }
  const seeded = await save(canvas.revision, document)
  assert.ok(seeded.ok, await seeded.text())
  const url = `http://127.0.0.1:4271/projects/canvas-project/generation-canvas?canvas=${canvas.id}`
  const open = async (viewport, legacy) => {
    const page = await browser.newPage({ viewport })
    page.setDefaultTimeout(12000)
    await page.addInitScript(({ key, legacy }) => {
      window.__ENV = { BACKEND_URL: window.location.origin }
      if (legacy && !sessionStorage.getItem('height-restore-seeded')) {
        localStorage.setItem(key, JSON.stringify({ schema: 1, positions: { source: { x: 70, y: 280 }, criterion: { x: 560, y: 280 } },
          sizes: { source: { width: 400, height: 172 }, criterion: { width: 360, height: 368 } },
          transform: { x: 30, y: 80, scale: .8 }, manuallyPlaced: ['source', 'criterion'] }))
        sessionStorage.setItem('height-restore-seeded', 'true')
      }
      const sample = () => {
        const card = window.document.querySelector('[data-card-id="criterion"]')
        if (!card?.checkVisibility()) { requestAnimationFrame(sample); return }
        const body = card.querySelector('.generation-card-body').getBoundingClientRect()
        window.firstCriterionFrame = {
          height: card.offsetHeight,
          x: body.x, y: body.y,
          actionable: card.contains(window.document.elementFromPoint(body.x + body.width / 2, body.y + body.height / 2)),
        }
      }
      requestAnimationFrame(sample)
    }, { key: `jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`, legacy })
    await page.goto(url)
    await page.waitForFunction(() => window.firstCriterionFrame)
    assert.equal(await page.evaluate(() => window.firstCriterionFrame.height), 128, 'first visible frame uses the short summary band')
    assert.equal(await page.evaluate(() => window.firstCriterionFrame.actionable), true, 'the first visible card body accepts interaction')
    return page
  }
  const narrow = await open({ width: 390, height: 844 }, false)
  await narrow.close()
  const page = await open({ width: 1440, height: 960 }, true)
  assert.match(await page.getByLabel('画布缩放比例').innerText(), /^80%$/)
  const initial = await page.evaluate(() => window.firstCriterionFrame)
  assert.ok(Math.abs(initial.x - 478) < 2, 'first visible frame retains the cached manually placed x')
  assert.ok(Math.abs(initial.y - (80 + 280 * .8 + 32 * .8)) < 2, 'first visible frame retains the cached manually placed y')
  const card = page.locator('[data-card-id="criterion"]')
  const summary = card.getByRole('definition')
  const undo = page.getByRole('button', { name: '撤销操作', exact: true })
  const redo = page.getByRole('button', { name: '重做操作', exact: true })
  const saveButton = page.getByRole('button', { name: '保存画布', exact: true })
  const saved = page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' })
  const field = async () => (await openCanvasCard(page, 'criterion')).getByRole('textbox', { name: '可观察判断标准内容', exact: true })
  const size = async height => {
    await page.waitForFunction(height => document.querySelector('[data-card-id="criterion"]').offsetHeight === height, height)
    const edge = await page.locator('[data-generation-edge-id="basis"] .canvas-edge-line').evaluate(path => {
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM())
      const box = document.querySelector('[data-card-id="criterion"]').getBoundingClientRect()
      return Math.abs(end.y - (box.top + box.height / 2))
    })
    assert.ok(edge < 1, 'edge follows the visible current height')
  }
  const placement = () => page.locator('[data-card-id="source"], [data-card-id="criterion"]').evaluateAll(cards =>
    cards.map(card => [card.dataset.cardId, card.style.left, card.style.top]))
  const layout = page.getByRole('button', { name: '布局', exact: true })
  const before = await read()
  const originalPlacement = await placement()
  const originalTransform = await page.locator('.generation-world').evaluate(world => getComputedStyle(world).transform)
  await layout.click()
  await page.getByRole('button', { name: '整理布局', exact: true }).click()
  await layout.click()
  assert.notDeepEqual(await placement(), originalPlacement)
  assert.equal(await undo.isDisabled(), true, 'measurement and explicit layout view do not add a document undo step')
  assert.equal((await read()).revision, before.revision, 'opening and arranging do not save a document revision')

  await (await field()).fill(long)
  await summary.filter({ hasText: long }).waitFor({ state: 'attached' })
  await size(128)
  await page.locator('.wb-details:visible').getByRole('button', { name: '撤销', exact: true }).click()
  await summary.filter({ hasText: short }).waitFor({ state: 'attached' })
  await size(128)
  await closeCanvasDetails(page)
  assert.equal(await undo.isDisabled(), true, 'one undo reverses the content edit')
  await redo.click()
  await size(192)
  await layout.click()
  await page.getByRole('button', { name: '撤销布局整理', exact: true }).click()
  await layout.click()
  assert.deepEqual(await placement(), originalPlacement)
  assert.equal(await page.locator('.generation-world').evaluate(world => getComputedStyle(world).transform), originalTransform)
  await size(192)
  const previousLeft = await card.evaluate(node => node.style.left)
  await card.getByRole('button', { name: '移动布局：钥匙验收', exact: true }).press('ArrowRight')
  assert.notEqual(await card.evaluate(node => node.style.left), previousLeft)
  await undo.click()
  assert.equal(await card.evaluate(node => node.style.left), previousLeft)
  await size(192)
  await redo.click()
  assert.notEqual(await card.evaluate(node => node.style.left), previousLeft)
  await size(192)
  await undo.click()
  assert.deepEqual(await placement(), originalPlacement)

  const routeURL = `**/generation-canvases/canvas-project/${canvas.id}`
  let release, arrived, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const inFlight = new Promise(resolve => { arrived = resolve })
  await page.route(routeURL, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    if (++calls === 1) {
      arrived()
      await gate
      await route.continue()
    } else await route.fulfill({ status: 422, json: { data: { code: 'HEIGHT_SAVE_FAILURE', message: '测试保存失败', target: {}, blocks: ['save'] } } })
  })
  await (await field()).fill(long + '保留末尾近景')
  await closeCanvasDetails(page)
  await saveButton.click()
  await inFlight
  await (await field()).fill(short)
  await size(192)
  await closeCanvasDetails(page)
  await size(128)
  release()
  await page.getByRole('alert').getByText('HEIGHT_SAVE_FAILURE: 测试保存失败', { exact: true }).waitFor()
  assert.equal((await read()).document.cards.find(card => card.id === 'criterion').standard.text, long + '保留末尾近景')
  await summary.filter({ hasText: short }).waitFor({ state: 'attached' })
  await size(128)
  assert.deepEqual(await placement(), originalPlacement)

  const server = await read()
  const external = await save(server.revision, { ...server.document, name: '服务端版本' })
  assert.ok(external.ok, await external.text())
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.waitForFunction(() => window.firstCriterionFrame)
  assert.equal(await page.evaluate(() => window.firstCriterionFrame.height), 192, 'reopen uses the server summary before explicit recovery')
  await page.getByRole('button', { name: '恢复本地内容', exact: true }).click()
  await size(128)
  await summary.filter({ hasText: short }).waitFor({ state: 'attached' })
  await page.getByText('修订冲突，本地内容已保留。核对后选择处理方式', { exact: true }).waitFor()
  await page.getByRole('button', { name: '使用服务器内容', exact: true }).click()
  await page.getByRole('dialog', { name: '核对画布内容', exact: true }).waitFor({ state: 'hidden' })
  await saved.waitFor()
  await size(192)
  await summary.filter({ hasText: long + '保留末尾近景' }).waitFor({ state: 'attached' })
  assert.deepEqual(await placement(), originalPlacement)
  assert.equal(await page.locator('.generation-world').evaluate(world => getComputedStyle(world).transform), originalTransform)
  assert.deepEqual((await read()).document.groups, before.document.groups, 'height recovery preserves group membership')
  const frame = await page.locator('[data-group-id="requirements"]').boundingBox()
  const restored = await card.boundingBox()
  assert.ok(frame.y + frame.height >= restored.y + restored.height, 'the group frame contains the taller restored card')
  await layout.click()
  await page.getByRole('button', { name: '展开小地图', exact: true }).click()
  assert.equal(await page.getByRole('img', { name: '小地图导航', exact: true }).locator('[data-minimap-node="criterion"]').getAttribute('height'), '192')
  await page.getByRole('button', { name: '关闭小地图', exact: true }).click()
  await page.screenshot({ path: join(output, 'design-height-restored.png') })
  await page.close()
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4271, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await page.goto('http://127.0.0.1:4271/projects/canvas-project?tab=generation')
  await openCanvasManagement(page)
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  const name = page.getByRole('textbox', { name: '画布名称' })
  await openCanvasManagement(page)
  await name.fill('第一张独立画布 A')
  await openCardList(page)
  await page.getByRole('button', { name: '文本卡' }).click()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('快照 A')
  // The editor remains usable while snapshot A is in flight; response A cannot erase B.
  let releaseSave
  const saveGate = new Promise(resolve => { releaseSave = resolve })
  await page.route('**/generation-canvases/canvas-project/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await saveGate
    await route.continue()
  })
  await page.getByRole('button', { name: '保存画布' }).click()
  await openCanvasManagement(page)
  await page.getByRole('textbox', { name: '画布名称' }).fill('第一张独立画布 B')
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('保存中继续输入 B')
  releaseSave()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await page.unroute('**/generation-canvases/canvas-project/*')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const firstId = new URL(page.url()).searchParams.get('canvas')
  const first = (await (await fetch(`${base}/${firstId}`)).json()).data
  assert.equal(first.revision, 2)
  assert.equal(first.document.cards[0].text, '保存中继续输入 B')
  await openCanvasManagement(page)
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]')?.value === '未命名画布')
  await openCanvasManagement(page)
  await name.fill('第二张独立画布')
  await openCardList(page)
  await page.getByRole('button', { name: '文本卡' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const secondId = new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(firstId, secondId)
  await openCanvasManagement(page)
  await selectCanvasByName(page, '第一张独立画布 B')
  await openCanvasCard(page, first.document.cards[0].id)
  await page.reload()
  await openCanvasManagement(page)
  await name.waitFor()
  assert.equal(await name.inputValue(), '第一张独立画布 B')
  await name.press('Escape')
  await openCanvasCard(page, first.document.cards[0].id)
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '保存中继续输入 B')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const second = (await (await fetch(`${base}/${secondId}`)).json()).data
  assert.equal(second.document.cards[0].text, '')
  assert.equal(second.document.name, '第二张独立画布')
  // Unknown reply: the server committed A, the client kept B and the original request.
  let unknownRequest
  await page.route(`**/generation-canvases/canvas-project/${firstId}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    unknownRequest = route.request().postDataJSON()
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('回执丢失 A')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('alert').getByText('请求结果未知，请重试核实原请求', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('回执之后输入 B')
  await page.unroute(`**/generation-canvases/canvas-project/${firstId}`)
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复本地内容' }).click()
  await page.getByRole('button', { name: '恢复本地内容' }).waitFor({ state: 'hidden' })
  await openCanvasCard(page, first.document.cards[0].id)
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '回执之后输入 B')
  assert.equal((await (await fetch(`${base}/${firstId}`)).json()).data.document.cards[0].text, '回执丢失 A')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${base}/${firstId}`)).json()).data.revision, 4)
  assert.equal(unknownRequest.expected_revision, 2)

  // External CAS conflict must retain current input until the user explicitly resolves it.
  const external = (await (await fetch(`${base}/${firstId}`)).json()).data
  const externalSave = await fetch(`${base}/${firstId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: external.revision, document: { ...external.document, name: '服务器外部修改' } }) })
  assert.equal(externalSave.status, 200)
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('冲突仍保留')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByText('修订冲突，本地内容已保留。核对后选择处理方式').waitFor()
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '冲突仍保留')
  await page.getByRole('button', { name: '保留本地并以最新修订保存' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()

  // One owner per canvas; a second canvas can be edited in the same browser context.
  const other = await page.context().newPage()
  await other.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await other.goto(page.url())
  await other.getByText('此画布当前只读', { exact: true }).waitFor()
  await openCanvasManagement(other)
  assert.equal(await other.getByRole('textbox', { name: '画布名称' }).isDisabled(), true)
  await other.getByRole('button', { name: '取得编辑权' }).click()
  await openCanvasManagement(other)
  await other.getByRole('textbox', { name: '画布名称' }).waitFor()
  await other.waitForFunction(() => document.querySelector('[aria-label="画布名称"]') && !document.querySelector('[aria-label="画布名称"]').disabled)
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]').disabled)
  await page.goto(`http://127.0.0.1:4271/projects/canvas-project?tab=generation&canvas=${secondId}`)
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]') && !document.querySelector('[aria-label="画布名称"]').disabled)
  await openCanvasCard(page, (await (await fetch(`${base}/${secondId}`)).json()).data.document.cards[0].id)
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('五秒自动保存')
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '待保存' }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${base}/${secondId}`)).json()).data.document.cards[0].text, '五秒自动保存')
  // Storage failures are visible without blocking a server save or claiming recovery protection.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked storage') } })
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('存储不可用')
  await page.getByText('浏览器存储不可用，本地恢复保护失败；请保存后再离开').waitFor()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('离开前保护保存')
  await openCanvasManagement(page)
  await selectCanvasByName(page, '第一张独立画布 B')
  await page.waitForURL(url => url.searchParams.get('canvas') === firstId)
  assert.equal((await (await fetch(`${base}/${secondId}`)).json()).data.document.cards[0].text, '离开前保护保存')
  await page.screenshot({ path: join(output, 'generation-canvas.png'), fullPage: true })
  await verifyDerivedCardHeight()
  console.log('new → edit → save → second canvas → switch → refresh: persistent content and revision verified')
} finally { await cleanup() }
