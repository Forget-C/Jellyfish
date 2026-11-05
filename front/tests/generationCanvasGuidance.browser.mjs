import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-guidance-')
const api = 'http://127.0.0.1:8301', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8301' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4301, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data

  const types = ['shot', 'performance', 'camera', 'lighting', 'focus', 'composition', 'movement']
  const document = { ...canvas.document, cards: [
    { id: 'criterion', type: 'direction.criterion', criterion_id: 'hand', name: '手部可见', standard: { text: '五指和钥匙清晰可见', authorship: 'user' } },
    { id: 'second', type: 'direction.criterion', criterion_id: 'space', name: '空间一致', standard: { text: '保持左右关系', state: 'proposal', purpose: 'constraint', source_locator: '原文第三段', authorship: 'model' } },
    { id: 'blank', type: 'direction.criterion', criterion_id: 'blank', name: '' },
    { id: 'empty-movement', type: 'direction.movement' },
    ...types.map(id => ({ id, type: 'direction.' + id }))],
    edges: types.flatMap(id => ['criterion', 'second'].map(source => ({ id: id + source, source_card: source, source_port: 'criterion', target_card: id, target_port: 'acceptance_basis' }))), input_order: {} }
  document.input_order = Object.fromEntries(types.map(id => [id, { acceptance_basis: [id + 'criterion', id + 'second'] }]))
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('save did not arrive') }
  await page.goto(`http://127.0.0.1:4301/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const savedBeforeEmptyConnection = await read()
  const point = (id, side) => page.locator(`[data-card-id="${id}"] [data-connection-side="${side}"]`)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const from = await point('blank', 'right').boundingBox(), to = await point('empty-movement', 'left').boundingBox()
  assert.ok(from && to)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.getByRole('tooltip').filter({ hasText: '请先填写验收要求名称' }).waitFor()
  await page.mouse.up()
  await page.getByRole('status').filter({ hasText: '请先填写验收要求名称' }).waitFor()
  assert.deepEqual(await read(), savedBeforeEmptyConnection)
  // Keyboard connection uses the same preflight as dragging and must name the actual problem.
  await point('blank', 'right').press('Enter')
  await point('empty-movement', 'left').press('Enter')
  await page.getByRole('status').filter({ hasText: '请先填写验收要求名称' }).waitFor()
  await page.keyboard.press('Escape')
  assert.deepEqual(await read(), savedBeforeEmptyConnection, 'rejected empty-card connection must not save')
  assert.equal(await page.locator('[data-generation-edge-id]').count(), savedBeforeEmptyConnection.document.edges.length)
  await openCanvasCard(page, 'blank')
  const blankDetail = page.locator('.wb-details:visible')
  const requirementName = blankDetail.getByRole('textbox', { name: '验收要求名称', exact: true })
  await requirementName.waitFor()
  assert.equal(await requirementName.getAttribute('placeholder'), '例如：手部与钥匙清晰可见')
  assert.equal(await blankDetail.getByText('例如：手部与钥匙清晰可见', { exact: true }).count(), 0)
  assert.equal(await blankDetail.locator('summary').filter({ hasText: '对象与制作关系' }).count(), 0)
  assert.equal(await blankDetail.locator('summary').filter({ hasText: '作用对象' }).count(), 1)
  assert.equal(await requirementName.getAttribute('aria-invalid'), 'true')
  await blankDetail.getByRole('alert').filter({ hasText: '请先填写验收要求名称' }).waitFor()
  await blankDetail.screenshot({ path: join(output, 'requirement-name-error-desktop.png') })
  await requirementName.fill('补充名称后的验收')
  assert.equal(await blankDetail.getByRole('alert').filter({ hasText: '请先填写验收要求名称' }).count(), 0)
  assert.equal(await page.getByRole('status').filter({ hasText: '请先填写验收要求名称' }).count(), 0)
  await blankDetail.getByRole('button', { name: '高级设置', exact: true }).click()
  assert.equal(await requirementName.isVisible(), true)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await blankDetail.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  const nameBox = await requirementName.boundingBox(), panelBox = await blankDetail.boundingBox()
  assert.ok(nameBox.width > panelBox.width - 64, 'name input fills the available narrow editor width')
  const objectBox = await blankDetail.locator('summary').filter({ hasText: '作用对象' }).boundingBox()
  assert.ok(objectBox.y >= nameBox.y + nameBox.height, 'object relations follow the name input')
  await blankDetail.screenshot({ path: join(output, 'requirement-name-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await poll(state => state.document.cards.find(item => item.id === 'blank').name === '补充名称后的验收')
  await closeCanvasDetails(page)
  await point('blank', 'right').press('Enter')
  await point('empty-movement', 'left').press('Enter')
  await poll(state => state.document.cards.find(item => item.id === 'empty-movement').input_bindings?.some(binding => binding.input_port === 'acceptance_basis'))
  await page.reload()
  const card = page.locator('.wb-details:visible')
  const region = () => card.getByRole('region', { name: '关联的验收要求', exact: true })
  const expand = () => region().getByRole('button', { name: '展开验收要求', exact: true }).click()
  for (const id of types) {
    await openCanvasCard(page, id)
    assert.equal(await region().getByRole('button', { name: '展开验收要求' }).getAttribute('aria-expanded'), 'false')
    assert.equal(await card.locator('.design-field-candidates').getByText('手部可见', { exact: true }).count(), 0)
    const before = await read()
    await expand()
    const detail = region().getByRole('region', { name: '验收要求详情' })
    await detail.getByText('五指和钥匙清晰可见', { exact: true }).waitFor()
    assert.equal(await detail.locator('input,textarea,[contenteditable="true"]').count(), 0)
    assert.equal(await detail.locator('.design-field-metadata').count(), 0)
    await region().getByRole('button', { name: /空间一致/ }).click()
    await detail.getByText(/来源：原文第三段/).waitFor()
    await region().getByRole('button', { name: '收起验收要求' }).click()
    await expand()
    assert.equal(await region().getByRole('button', { name: /空间一致/ }).getAttribute('aria-pressed'), 'true')
    const advanced = card.getByRole('button', { name: '高级设置', exact: true })
    if (await advanced.count()) await advanced.click()
    assert.equal(await region().getByRole('button', { name: /空间一致/ }).getAttribute('aria-pressed'), 'true')
    assert.equal((await read()).revision, before.revision, 'browsing must not save')
    await closeCanvasDetails(page)
    await openCanvasCard(page, id)
    await expand()
    assert.equal(await region().getByRole('button', { name: /手部可见/ }).getAttribute('aria-pressed'), 'true')
    if (id === 'shot') {
      await detail.getByRole('button', { name: '解除关联', exact: true }).click()
      await poll(state => !state.document.edges.some(edge => edge.id === id + 'criterion'))
      assert.equal(await region().getByRole('button', { name: /空间一致/ }).getAttribute('aria-pressed'), 'true')
      await closeCanvasDetails(page)
      await page.getByRole('button', { name: '撤销操作', exact: true }).click()
      await poll(state => state.document.edges.some(edge => edge.id === id + 'criterion'))
      await openCanvasCard(page, id)
      await expand()
    }
    await card.screenshot({ path: join(output, id + '-acceptance-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
    await card.screenshot({ path: join(output, id + '-acceptance-mobile.png') })
    await closeCanvasDetails(page)
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await page.reload()
  await openCanvasCard(page, 'shot')
  await expand()
  await region().getByRole('region', { name: '验收要求详情' }).getByText('五指和钥匙清晰可见', { exact: true }).waitFor()
  const observer = await page.context().newPage()
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  await openCanvasCard(observer, 'blank')
  const readonlyName = observer.locator('.wb-details:visible').getByRole('textbox', { name: '验收要求名称', exact: true })
  assert.equal(await readonlyName.isDisabled(), true)
  assert.equal(await readonlyName.inputValue(), '补充名称后的验收')
  await observer.close()
  console.log('PASS seven acceptance editors: readonly detail, selection, collapse, reopen, undo, save/reload, desktop/mobile')
} finally { await cleanup() }
