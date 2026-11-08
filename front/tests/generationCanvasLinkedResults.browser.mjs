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
  const readDocument = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
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
  const assertResultDisplayVisible = async () => {
    const bounds = await showResults.evaluate(toggle => {
      const label = toggle.closest('label')
      const { left, right } = label.getBoundingClientRect()
      const scrollArea = label.closest('[aria-label="模型参数"]')
      return { left, right, visibleRight: Math.min(innerWidth, scrollArea?.getBoundingClientRect().right ?? innerWidth) }
    })
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.visibleRight + 1,
      `result switch and its full label are visible without scrolling: ${JSON.stringify(bounds)}`)
  }
  await assertResultDisplayVisible()
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
  assert.deepEqual([originalResultBox.width, originalResultBox.height], [300, 251])
  await closeCanvasDetails(page)
  const beforeReading = await readDocument()
  await result.getByRole('button', { name: '打开完整图片', exact: true }).click()
  const fullPreview = page.getByRole('dialog', { name: '图片预览', exact: true })
  await fullPreview.getByRole('img', { name: '完整图片', exact: true }).waitFor()
  assert.equal(await card.getByRole('region', { name: '图片内容阅读', exact: true }).count(), 0)
  await fullPreview.getByRole('button', { name: 'Close', exact: true }).click()
  await fullPreview.waitFor({ state: 'hidden' })
  await resultImage.click()
  await card.getByRole('region', { name: '图片内容阅读', exact: true }).waitFor()
  await card.getByText('生成结果', { exact: true }).waitFor()
  assert.equal(await card.getByRole('img', { name: '图片预览', exact: true }).getAttribute('src'), previousFile)
  assert.equal(await card.getByRole('button', { name: /替换图片|选择素材|上传图片/ }).count(), 0)
  await closeCanvasDetails(page)
  assert.deepEqual(await readDocument(), beforeReading, 'reading and previewing a result leave the canvas document intact')
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
  await control({ response_delay: 1.6 })
  await start()
  await result.press('Enter')
  const readingImage = card.getByRole('img', { name: '图片预览', exact: true })
  await readingImage.waitFor()
  await page.waitForFunction(previous => {
    const node = document.querySelector('[aria-label="图片生成结果 1"] img')
    return node?.getAttribute('src') !== previous
  }, previousFile)
  assert.equal(await readingImage.getAttribute('src'), await resultImage.getAttribute('src'), 'open reader follows the same output position')
  await control({})
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
  await closeCanvasDetails(observer)
  await observer.setViewportSize({ width: 390, height: 844 })
  await observer.route(/\/api\/v1\/studio\/files\/[^/]+\/download$/, route => route.abort())
  await observer.getByRole('article', { name: '图片生成结果 1', exact: true }).press('Enter')
  const mobileReading = observer.getByRole('dialog', { name: '图片生成结果 1', exact: true })
  await mobileReading.getByText('图片暂不可预览，文件仍保留', { exact: true }).waitFor()
  await mobileReading.getByText('生成结果', { exact: true }).waitFor()
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
  await page.locator('[data-generation-edge-id="downstream"][data-generation-result-position="1"]').getByRole('button').press('Enter')
  const cutResult = page.getByRole('button', { name: '断开此连接', exact: true })
  await cutResult.focus()
  const resultPurpose = page.getByRole('tooltip').filter({ hasText: '参考图片 · 候选' })
  await resultPurpose.waitFor()
  assert.doesNotMatch(await resultPurpose.innerText(), /模型正文引用/)
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
  const missingResult = page.getByRole('article', { name: '图片生成结果 3', exact: true })
  await missingResult.getByText('当前输出缺失').waitFor()
  await missingResult.press('Enter')
  await card.getByText('当前输出缺失', { exact: true }).waitFor()
  assert.equal(await card.getByRole('img', { name: '图片预览', exact: true }).count(), 0)
  await closeCanvasDetails(page)
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
  await assertResultDisplayVisible()
  const runBox = await card.getByRole('button', { name: '预检运行', exact: true }).boundingBox()
  assert.ok(runBox.x >= 0 && runBox.x + runBox.width <= 391)
  assert.equal((await control()).calls.length, 5)
  await page.screenshot({ path: join(output, 'result-display-mobile.png'), fullPage: true })
  await closeCanvasDetails(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
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
  assert.deepEqual(await box(independent), fixedBox, 'detaching preserves the whole card box')
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
  assert.deepEqual(await box(independent), fixedBox, 'redo preserves the whole card box')
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
  const beforeDeletion = await readDocument()
  await closeCanvasDetails(page)
  await result.press('Enter')
  await result.press('Delete')
  await page.getByRole('status').filter({ hasText: '请先断开与生成卡的连线，再删除此结果卡' }).waitFor()
  assert.deepEqual(await readDocument(), beforeDeletion)
  await result.waitFor()

  // Keep an actual reference to the model while retaining an independent consumer.
  const deletionSetup = structuredClone(beforeDeletion.document)
  deletionSetup.cards.find(item => item.id === 'consumer').input_bindings.push({
    id: 'keep-model-result', input_port: 'image', source: { ...identity, position: 2 },
  })
  deletionSetup.groups = [{ id: 'deletion-group', name: '删除测试编组', card_ids: ['m', 'consumer', 'text'] }]
  const saveDeletion = (request_id, expected_revision, document) => fetch(`${base}/${canvas.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id, expected_revision, document }),
  })
  const grouped = await saveDeletion('group-before-deletion', beforeDeletion.revision, deletionSetup)
  assert.ok(grouped.ok, await grouped.text())
  const protectedDocument = await readDocument()
  const bypass = structuredClone(protectedDocument.document)
  bypass.cards = bypass.cards.filter(item => item.id !== 'm')
  bypass.edges = bypass.edges.filter(edge => edge.source_card !== 'm')
  const edgeIds = new Set(bypass.edges.map(edge => edge.id))
  for (const ports of Object.values(bypass.input_order)) {
    for (const port of Object.keys(ports)) ports[port] = ports[port].filter(id => edgeIds.has(id))
  }
  bypass.groups[0].card_ids = ['consumer', 'text']
  const blocked = await saveDeletion('delete-model-with-retained-reference', protectedDocument.revision, bypass)
  assert.equal(blocked.status, 422)
  assert.equal((await blocked.json()).data.code, 'REFERENCE_IN_USE')
  assert.deepEqual(await readDocument(), protectedDocument, 'failed save leaves the entire document intact')

  await page.reload()
  await result.waitFor()
  await independent.press('Enter')
  await independent.press('Delete')
  await page.getByRole('status').filter({ hasText: '实际输入绑定 keep-result' }).waitFor()
  await closeCanvasDetails(page)
  await model.press('Enter')
  await model.press('Delete')
  await page.getByRole('status').filter({ hasText: /keep-model-result.*断开它与生成卡的连线/ }).waitFor()
  assert.deepEqual(await readDocument(), protectedDocument)
  await closeCanvasDetails(page)

  // Removing the referenced consumer in the same action releases its protection.
  const consumer = page.locator('[data-card-id="consumer"]')
  await model.getByRole('button', { name: '卡片操作' }).press('Enter')
  await model.getByRole('button', { name: '选择多个' }).press('Enter')
  await result.press('Enter')
  await consumer.press('Enter')
  await page.getByRole('toolbar', { name: '所选卡片操作' }).getByText('3 张卡片', { exact: true }).waitFor()
  const runsBeforeDeletion = (await runtime()).runs.map(run => run.id)
  await consumer.press('Delete')
  await page.getByRole('dialog', { name: '删除 2 张卡片？' }).getByRole('button', { name: '确认删除' }).click()
  await model.waitFor({ state: 'detached' })
  await resultCards.first().waitFor({ state: 'detached' })
  await saved.waitFor()
  await independent.waitFor()
  const deleted = (await readDocument()).document
  assert.deepEqual(deleted.cards.map(item => item.id).sort(), ['single', 'text', ...beforeDeletion.document.cards
    .filter(item => item.origin).map(item => item.id)].sort())
  assert.deepEqual(deleted.groups[0].card_ids, ['text'])
  assert.ok(deleted.edges.every(edge => edge.source_card !== 'm' && edge.target_card !== 'consumer'))
  assert.equal(deleted.input_order.consumer, undefined)
  assert.deepEqual((await runtime()).runs.map(run => run.id), runsBeforeDeletion, 'deleting cards retains all run history')
  const singleInputs = async () => (await (await fetch(`${base}/${canvas.id}/cards/single/compile`)).json()).data.media
  assert.deepEqual((await singleInputs()).map(item => item.file_id), [fixed.file_id])

  await independent.press('ControlOrMeta+z')
  await model.waitFor()
  await result.waitFor()
  await consumer.waitFor()
  await saved.waitFor()
  assert.deepEqual((await readDocument()).document, protectedDocument.document)
  assert.deepEqual((await runtime()).runs.map(run => run.id), runsBeforeDeletion)
  await independent.press('ControlOrMeta+Shift+z')
  await model.waitFor({ state: 'detached' })
  await saved.waitFor()
  await page.reload()
  await independent.waitFor()
  assert.equal(await resultCards.count(), 0)
  assert.deepEqual((await singleInputs()).map(item => item.file_id), [fixed.file_id])

  // Explicitly connecting the model can expose a formal output whose result card was fixed.
  const reconnectDocument = structuredClone(protectedDocument.document)
  for (const id of ['reconnect', 'all-fixed-target']) {
    reconnectDocument.cards.push({ id, type: 'model.image', model_id: 'canvas-image-model' })
  }
  const restored = await saveDeletion('restore-for-explicit-reconnect', (await readDocument()).revision, reconnectDocument)
  assert.ok(restored.ok, await restored.text())
  await page.reload()
  await page.getByRole('button', { name: '随生成更新 · 图片生成结果 3', exact: true }).press('Enter')
  await page.getByRole('button', { name: '断开此连接', exact: true }).click()
  await page.getByText('已固定此结果，原下游连接及引用已保留').waitFor()
  await saved.waitFor()
  await model.getByRole('button', { name: '右侧连接点' }).press('Enter')
  await page.locator('[data-card-id="reconnect"]').getByRole('button', { name: '左侧连接点' }).press('Enter')
  await saved.waitFor()
  assert.deepEqual((await positions('reconnect')).map(([position]) => position), [0, 1, 2, 3])
  assert.equal(await page.getByRole('article', { name: '图片生成结果 3', exact: true }).count(), 0)
  const reconnected = (await readDocument()).document.edges.find(edge => edge.source_card === 'm' && edge.target_card === 'reconnect')
  const direct = page.locator(`[data-generation-edge-id="${reconnected.id}"][data-generation-result-position="2"]`)
  await direct.getByRole('button').press('Enter')
  await page.getByRole('button', { name: '断开此连接', exact: true }).click()
  await saved.waitFor()
  assert.deepEqual((await positions('reconnect')).map(([position]) => position), [0, 1, 3])

  for (const number of [1, 2, 4]) {
    await page.getByRole('button', { name: '随生成更新 · 图片生成结果 ' + number, exact: true }).press('Enter')
    await page.getByRole('button', { name: '断开此连接', exact: true }).click()
    await page.getByRole('article', { name: '图片生成结果 ' + number, exact: true }).waitFor({ state: 'detached' })
    await saved.waitFor()
  }
  assert.equal(await resultCards.count(), 0)
  await model.getByRole('button', { name: '右侧连接点' }).press('Enter')
  await page.locator('[data-card-id="all-fixed-target"]').getByRole('button', { name: '左侧连接点' }).press('Enter')
  await saved.waitFor()
  const allFixed = (await readDocument()).document.edges.find(edge => edge.source_card === 'm' && edge.target_card === 'all-fixed-target')
  await page.locator(`[data-generation-edge-id="${allFixed.id}"][data-generation-result-position="0"]`).getByRole('button').press('Enter')
  await page.getByRole('button', { name: '断开此连接', exact: true }).click()
  await saved.waitFor()
  assert.deepEqual((await positions('all-fixed-target')).map(([position]) => position), [1, 2, 3])
  console.log('PASS formal result display, linked result lifecycle, deletion and readonly', output)
} finally { await cleanup() }
