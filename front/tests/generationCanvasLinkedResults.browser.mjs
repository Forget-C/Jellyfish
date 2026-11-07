import { closeCanvasDetails, openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-result-cards-')
const api = 'http://127.0.0.1:8302', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8302', CANVAS_BROWSER_VARIABLE_IMAGE_COUNT: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4302, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '显示正式结果卡' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'p', kind: 'text', text: '三张完整图片' }] }, config: { count: 3, target_ratio: '1:1', resolution_profile: 'standard' } },
    { id: 'text', type: 'content.text', text: 'Literal 图片3 [media:1]' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: { count: 3 } },
    { id: 'single', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: { count: 3 } }],
    edges: [{ id: 'downstream', source_card: 'm', source_port: 'image', target_card: 'consumer', target_port: 'image' }, { id: 'text-edge', source_card: 'text', source_port: 'text', target_card: 'consumer', target_port: 'text' }], input_order: { consumer: { image: ['downstream'], text: ['text-edge'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4302/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await page.locator('.wb-details:not([hidden])').waitFor(); await openModelInspection(page) }
  await open('m')
  const card = page.locator('.wb-details:not([hidden])')
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const control = async body => (await fetch(`${api}/test/image-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const runtime = async () => (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  const start = async () => {
    await card.getByRole('button', { name: '预检运行', exact: true }).click()
    const received = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
    await preview.getByRole('button', { name: '确认执行', exact: true }).click()
    return (await (await received).json()).data
  }

  const model = page.locator('[data-card-id="m"]')
  const box = element => element.evaluate(node => ({ left: node.style.left, top: node.style.top, width: node.offsetWidth, height: node.offsetHeight }))
  const originalModelBox = await box(model)
  const showResults = card.getByRole('switch', { name: '显示结果卡', exact: true })
  const resultCards = page.getByRole('article', { name: /生成结果/ })
  assert.equal(await showResults.getAttribute('aria-checked'), 'false')
  await showResults.press('Space')
  assert.equal(await showResults.getAttribute('aria-checked'), 'true')
  assert.equal(await resultCards.count(), 0, 'no cards for unpublished results')
  assert.equal((await control()).calls.length, 0)

  await start()
  await resultCards.nth(2).waitFor()
  assert.equal(await resultCards.count(), 3)
  assert.equal(await page.getByRole('button', { name: /^随生成更新 · / }).count(), 3)
  assert.equal(await page.getByRole('button', { name: /^结果候选连接/ }).count(), 3)
  assert.equal(await page.locator('[data-generation-edge-id="downstream"]:not([data-generation-result-position])').count(), 0)
  assert.deepEqual(await box(model), originalModelBox)

  const result = page.getByRole('article', { name: '图片生成结果 1', exact: true })
  const resultImage = result.getByRole('img', { name: '图片预览', exact: true })
  const previousFile = await resultImage.getAttribute('src')
  const originalResultBox = await box(result)
  await closeCanvasDetails(page)
  await result.getByRole('button', { name: '移动布局：图片生成结果 1' }).press('ArrowDown')
  const moved = await box(result)
  assert.equal(parseFloat(moved.top), parseFloat(originalResultBox.top) + 10)

  await open('consumer')
  assert.equal(await showResults.getAttribute('aria-checked'), 'false', 'visibility preference is per model')
  const inputs = page.getByRole('region', { name: '已保存直接输入' })
  await inputs.getByRole('button', { name: '采用 @图片1', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const readInputs = async () => {
    const { data: outputs } = await (await fetch(`${base}/${canvas.id}/cards/consumer/outputs`)).json()
    const { data: compiled } = await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()
    return { candidates: outputs.candidates, used: compiled.used, media: compiled.media, text: compiled.text }
  }
  const visibleInputs = await readInputs()
  assert.equal(visibleInputs.used.length, 1)
  await open('m')
  await showResults.click()
  await result.waitFor({ state: 'detached' })
  await page.locator('[data-generation-edge-id="downstream"]:not([data-generation-result-position])').waitFor()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual(await readInputs(), visibleInputs, 'display does not affect candidates or compiled inputs')
  await showResults.click()
  await result.waitFor()
  assert.deepEqual(await box(result), moved)
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.equal((await runtime()).current_outputs.m[0].basis_current, true)
  assert.equal((await control()).calls.length, 1)

  await control({ fail_next: true })
  await start()
  await card.getByRole('alert').filter({ hasText: 'submission_failed' }).waitFor()
  assert.equal(await resultImage.getAttribute('src'), previousFile, 'a failed generation keeps the last formal result')
  assert.deepEqual(await box(result), moved)
  await start()
  await page.waitForFunction(previous => {
    const node = document.querySelector('[aria-label="图片生成结果 1"] img')
    return node?.getAttribute('src') !== previous
  }, previousFile)
  assert.equal(await resultCards.count(), 3)
  assert.deepEqual(await box(result), moved)

  await page.reload()
  await result.waitFor()
  await open('m')
  assert.equal(await showResults.getAttribute('aria-checked'), 'true')
  assert.deepEqual(await box(result), moved)
  const observer = await context.newPage()
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  await observer.locator('[data-card-id="m"]').press('Enter')
  assert.equal(await observer.getByRole('switch', { name: '显示结果卡', exact: true }).isDisabled(), true)
  await observer.close()

  await closeCanvasDetails(page)
  const resultTwo = page.getByRole('article', { name: '图片生成结果 2', exact: true })
  await resultTwo.getByRole('button', { name: '右侧连接点' }).press('Enter')
  await page.locator('[data-card-id="single"]').getByRole('button', { name: '左侧连接点' }).press('Enter')
  const saved = page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' })
  await saved.waitFor()
  const positions = async id => {
    const { data } = await (await fetch(`${base}/${canvas.id}/cards/${id}/outputs`)).json()
    return data.candidates.filter(item => item.source.card_id === 'm').map(item => [item.source.position, item.available])
  }
  assert.deepEqual(await positions('single'), [[1, true]])

  const chooseResultPath = async position => {
    const path = page.locator(`[data-generation-edge-id="downstream"][data-generation-result-position="${position}"]`)
    await path.getByRole('button').press('Enter')
    await page.getByRole('button', { name: '断开此连接', exact: true }).click()
  }
  await chooseResultPath(0)
  await page.getByText(/此连线仍有输入被引用/).waitFor()
  assert.deepEqual(await positions('consumer'), [[0, true], [1, true], [2, true]])
  await chooseResultPath(1)
  await saved.waitFor()
  assert.deepEqual(await positions('consumer'), [[0, true], [2, true]])
  assert.deepEqual(await positions('single'), [[1, true]])

  await open('m')
  await showResults.click()
  await saved.waitFor()
  assert.deepEqual(await positions('consumer'), [[0, true], [2, true]])
  await showResults.click()
  await saved.waitFor()
  const changeCount = async count => {
    const { data } = await (await fetch(`${base}/${canvas.id}`)).json()
    data.document.cards[0].config.count = count
    const updated = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: 'count-' + count, expected_revision: data.revision, document: data.document }) })
    assert.ok(updated.ok, await updated.text())
    // The settings are changed through public save, then loaded by the normal editor route.
    await page.reload()
    await open('m')
    await start()
    for (let attempt = 0; attempt < 60; attempt++) {
      if ((await runtime()).current_outputs.m?.length === count) break
      await delay(100)
    }
    assert.equal((await runtime()).current_outputs.m?.length, count)
  }
  await changeCount(2)
  await page.getByRole('article', { name: '图片生成结果 3' }).getByText('当前输出缺失').waitFor()
  assert.deepEqual(await positions('consumer'), [[0, true], [2, false]])
  await changeCount(4)
  await page.getByRole('article', { name: '图片生成结果 4' }).waitFor()
  assert.deepEqual(await positions('consumer'), [[0, true], [2, true], [3, true]])
  assert.deepEqual(await positions('single'), [[1, true]])
  assert.equal((await readInputs()).used[0].source.position, 0)

  await open('consumer')
  await inputs.getByRole('button', { name: '取消采用 @图片1', exact: true }).click()
  await saved.waitFor()
  await closeCanvasDetails(page)
  for (const position of [0, 2, 3]) {
    await chooseResultPath(position)
    await saved.waitFor()
  }
  assert.deepEqual(await positions('consumer'), [])
  await open('m')
  await showResults.click()
  await saved.waitFor()
  assert.equal(await page.locator('[data-generation-edge-id="downstream"]').count(), 0,
    'collapsing cannot restore the last explicitly disconnected result')
  assert.deepEqual(await positions('single'), [[1, true]])
  await showResults.click()
  await saved.waitFor()

  await closeCanvasDetails(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await open('m')
  await showResults.scrollIntoViewIfNeeded()
  const toggleBox = await showResults.boundingBox()
  const runBox = await card.getByRole('button', { name: '预检运行', exact: true }).boundingBox()
  assert.ok(toggleBox.x >= 0 && toggleBox.x + toggleBox.width <= 391)
  assert.ok(runBox.x >= 0 && runBox.x + runBox.width <= 391)
  assert.equal((await control()).calls.length, 5)
  await page.screenshot({ path: join(output, 'result-display-mobile.png'), fullPage: true })
  await closeCanvasDetails(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  const readDocument = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const setup = await readDocument()
  const identity = { canvas_id: canvas.id, card_id: 'm', port_id: 'image', position: 0 }
  for (const [id, scope] of [['consumer', { mode: 'except', positions: [1] }], ['single', { mode: 'only', positions: [0, 1] }]]) {
    setup.document.edges.find(edge => edge.source_card === 'm' && edge.target_card === id).result_scope = scope
    setup.document.cards.find(card => card.id === id).input_bindings = [{ id: 'keep-result', input_port: 'image', source: identity }]
  }
  const wired = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'wire-before-detach', expected_revision: setup.revision, document: setup.document }) })
  assert.ok(wired.ok, await wired.text())
  await page.reload()
  await result.waitFor()
  const fixedBox = await box(result)
  const previous = (await runtime()).current_outputs.m[0]
  const updateLine = page.getByRole('button', { name: '随生成更新 · 图片生成结果 1', exact: true })
  await updateLine.press('Enter')
  await page.getByRole('button', { name: '断开此连接', exact: true }).click()
  await result.waitFor({ state: 'detached' })
  await saved.waitFor()
  const fixed = (await readDocument()).document.cards.find(card => card.type === 'content.image' && card.origin)
  assert.equal(fixed.file_id, previous.file_id)
  const independent = page.locator(`[data-card-id="${fixed.id}"]`)
  await independent.waitFor()
  assert.equal((await box(independent)).left, fixedBox.left)
  assert.equal((await box(independent)).top, fixedBox.top)
  for (const id of ['consumer', 'single']) {
    const { data } = await (await fetch(`${base}/${canvas.id}/cards/${id}/compile`)).json()
    assert.deepEqual(data.media.map(item => [item.source.card_id, item.file_id]), [[fixed.id, fixed.file_id]])
  }

  await open('m')
  await start()
  await result.waitFor()
  assert.notEqual((await box(result)).top, (await box(independent)).top, 'new linked result must not overlap fixed content')
  assert.notEqual((await runtime()).current_outputs.m[0].result_set_id, previous.result_set_id)
  assert.deepEqual(await positions('consumer'), [[2, true], [3, true]])
  assert.deepEqual(await positions('single'), [[1, true]])
  await closeCanvasDetails(page)
  await model.focus()
  await page.keyboard.press('ControlOrMeta+z')
  await independent.waitFor({ state: 'detached' })
  await saved.waitFor()
  assert.equal((await readInputs()).media[0].file_id, (await runtime()).current_outputs.m[0].file_id)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await independent.waitFor()
  await saved.waitFor()
  assert.equal((await readInputs()).media[0].file_id, fixed.file_id, 'redo restores the original fixed result')
  assert.equal((await box(independent)).top, fixedBox.top)
  await page.reload()
  await independent.waitFor()
  await result.waitFor()
  assert.equal((await readInputs()).media[0].file_id, fixed.file_id)
  const delayedOutput = (await runtime()).current_outputs.m[1]
  const delayedImage = resultTwo.getByRole('img', { name: '图片预览', exact: true })
  const delayedSrc = await delayedImage.getAttribute('src')
  const historyUrl = /\/runs\/[^/]+\/nodes\/[^/]+\/outputs\/1\/content$/
  let releaseHistory, requestHistory
  const historyGate = new Promise(resolve => { releaseHistory = resolve })
  const historyRequested = new Promise(resolve => { requestHistory = resolve })
  await page.route(historyUrl, async route => {
    const response = await route.fetch()
    requestHistory()
    await historyGate
    await route.fulfill({ response })
  })
  try {
    await page.getByRole('button', { name: '随生成更新 · 图片生成结果 2', exact: true }).press('Enter')
    await page.getByRole('button', { name: '断开此连接', exact: true }).click()
    await historyRequested
    await open('m')
    await start()
    await page.waitForFunction(previous => {
      const node = document.querySelector('[aria-label="图片生成结果 2"] img')
      return node?.getAttribute('src') !== previous
    }, delayedSrc)
    releaseHistory()
    await page.getByText('已固定此结果，原下游连接及引用已保留').waitFor()
    await saved.waitFor()
    const delayedFixed = (await readDocument()).document.cards.find(card => card.type === 'content.image' && card.origin?.position === 1)
    assert.equal(delayedFixed.file_id, delayedOutput.file_id, 'later generation cannot replace the captured content')
    assert.notEqual((await runtime()).current_outputs.m[1].result_set_id, delayedOutput.result_set_id)
    assert.deepEqual(await positions('single'), [], 'detached scope does not reconnect when publication races preparation')
  } finally {
    releaseHistory()
    await page.unroute(historyUrl)
  }
  console.log('PASS formal result display, layout, candidate parity, regeneration and readonly', output)
} finally { await cleanup() }
