import { closeCanvasDetails, closePrecheck } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-associations-')
const api = 'http://127.0.0.1:8291', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8291' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, debugPage
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4291, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  debugPage = page
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '统一关联区' }) })
  const canvas = (await response.json()).data
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 100; i++) { const state = await read(); if (predicate(state)) return state; await delay(100) } throw Error('association edit did not save') }
  const document = { ...canvas.document, cards: [
    { id: 'empty', type: 'direction.movement' }, { id: 'movement', type: 'direction.movement' },
    { id: 'stack-source', type: 'content.text', text: '堆叠中的来源' },
    { id: 'stack-mate', type: 'content.text', text: '堆叠中的另一张卡' },
    { id: 'tracked-movement', type: 'direction.movement', fields: { movement_start: { text: '跟随人物入画', state: 'fact' } } },
    { id: 'diagnostic-composition', type: 'direction.composition', frame_target: { card_id: 'tracked-movement', state_id: 'field:movement_start' } },
    { id: 'diagnostic-model', type: 'model.text', prompt: { segments: [{ id: 'prompt', kind: 'text', text: '诊断导航验证' }] } },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `text-${index}`, type: 'content.text', text: `参考文本 ${index}` })),
    { id: 'person', type: 'content.character', object_id: 'actor', name: '林夏', text: '街角停步' },
    ...Array.from({ length: 5 }, (_, index) => ({ id: `design-${index}`, type: 'direction.style', fields: { direction: { text: `风格 ${index}`, state: 'proposal' } } })),
    { id: 'criterion', type: 'direction.criterion', criterion_id: 'clear', name: '主体清晰', standard: { text: '人物表情可辨认' } },
    { id: 'missing', type: 'content.image', file_id: null },
    { id: 'broken-style', type: 'direction.style', fields: { direction: { state: 'proposal', document: { segments: [{ id: 'bad-ref', kind: 'reference', source: { canvas_id: canvas.id, card_id: 'missing', port_id: 'image', position: 0 } }] } } } },
  ], edges: [], input_order: {}, groups: [{ id: 'diagnostic-stack', name: '阅读堆叠', kind: 'stack', card_ids: ['stack-source', 'stack-mate'] }] }
  const link = (source_card, source_port, target_card, target_port) => ({ id: `${source_card}-${target_card}-${source_port}`, source_card, source_port, target_card, target_port })
  document.edges = [
    ...Array.from({ length: 12 }, (_, index) => link(`text-${index}`, 'text', 'movement', 'text')),
    link('person', 'text', 'movement', 'text'), link('person', 'object', 'movement', 'attention_object'),
    link('missing', 'image', 'movement', 'image'),
    link('missing', 'image', 'broken-style', 'image'),
    ...Array.from({ length: 5 }, (_, index) => link(`design-${index}`, 'text', 'movement', 'text')),
    link('criterion', 'criterion', 'movement', 'acceptance_basis'),
    link('broken-style', 'text', 'movement', 'text'),
    link('text-0', 'text', 'diagnostic-model', 'text'),
    link('tracked-movement', 'text', 'diagnostic-composition', 'text'),
  ]
  for (const edge of document.edges) {
    const ports = document.input_order[edge.target_card] ||= {}
    ;(ports[edge.target_port] ||= []).push(edge.id)
  }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:4291/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail = page.locator('.wb-details:visible')
  const strip = detail.getByRole('region', { name: '关联来源', exact: true })
  await page.locator('[data-card-id="empty"]').press('Enter')
  await strip.waitFor()
  await detail.getByRole('button', { name: '高级设置', exact: true }).click()
  const heading = detail.getByText('设计参数', { exact: true })
  await delay(300)
  const before = await heading.boundingBox()
  assert.equal(await strip.locator('.generation-material-reference').count(), 0)
  const add = strip.getByRole('button', { name: '添加设计来源', exact: true })
  assert.equal(Math.round((await add.boundingBox()).width), 64)
  await add.click()
  await page.getByRole('menuitem', { name: '从当前画布选择', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择画布来源', exact: true })
  await picker.getByRole('button', { name: /text-0 · 连接提供候选/ }).click()
  await poll(state => state.document.edges.some(edge => edge.source_card === 'text-0' && edge.target_card === 'empty'))
  await strip.locator('.generation-material-reference').waitFor()
  assert.equal((await heading.boundingBox()).y, before.y)
  await add.click()
  await page.getByRole('menuitem', { name: '从当前画布选择', exact: true }).click()
  await picker.getByRole('button', { name: /主体清晰.*连接即关联验收要求/ }).click()
  await poll(state => state.document.cards.find(card => card.id === 'empty').input_bindings.some(binding => binding.input_port === 'acceptance_basis'))
  await strip.getByRole('button', { name: /主体清晰/ }).click()
  await page.getByRole('region', { name: '验收要求详情', exact: true }).getByText('人物表情可辨认').waitFor()
  await page.keyboard.press('Escape')
  await closeCanvasDetails(page)
  await page.locator('[data-card-id="movement"]').press('Enter')
  await strip.waitFor()
  await delay(300)
  const checks = async () => {
    assert.equal(await strip.evaluate(el => el.scrollWidth > el.clientWidth), false)
    for (const box of await strip.locator('.generation-material-reference').evaluateAll(elements => elements.map(el => [el.offsetWidth, el.offsetHeight]))) assert.deepEqual(box, [64, 64])
    for (const button of await strip.locator('[data-summary="false"]').all()) assert.equal(Math.round((await button.boundingBox()).width), 32)
  }
  await checks()
  const designMore = strip.getByRole('button', { name: /^设计更多.*含异常/ })
  await designMore.waitFor()
  const materialMore = strip.getByRole('button', { name: /^素材更多/ })
  await materialMore.click()
  const list = page.locator('.canvas-association-list:visible')
  assert.equal(await list.getByRole('button', { name: /候选 林夏/ }).count(), 1, 'object identity and text share one source entry')
  await list.getByRole('button', { name: /候选 林夏/ }).click()
  await page.getByRole('button', { name: /选择关注对象 林夏/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-association-more') === 'material')
  assert.equal(await materialMore.evaluate(el => document.activeElement === el), true)
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(350)
  await checks()
  assert.equal(await strip.locator('.canvas-association-group').count(), 2)
  await page.screenshot({ path: join(output, 'associations-390.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 320, height: 780 })
  await delay(350)
  await checks()
  await page.screenshot({ path: join(output, 'associations-320.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await delay(350)
  await page.screenshot({ path: join(output, 'associations-desktop.png'), animations: 'disabled' })
  await closeCanvasDetails(page)
  const revision = (await read()).revision
  await page.route('**/precheck', async route => {
    const response = await route.fetch(), payload = await response.json()
    payload.data.diagnostics = [{
      code: 'EDGE_DIAGNOSTIC', severity: 'warning', message: '请核对明确的候选连接', blocks: [],
      target: { card_id: 'diagnostic-model', path: ['edges', 'text-0-diagnostic-model-text'] },
    }, {
      code: 'RELATION_DIAGNOSTIC', severity: 'warning', message: '请核对构图的画面定位', blocks: [],
      target: { card_id: 'diagnostic-composition', path: ['frame_target'] },
    }, {
      code: 'RELATED_DIAGNOSTIC', severity: 'warning', message: '有多个明确的相关对象', blocks: [],
      target: { card_id: 'diagnostic-model', related_card_ids: ['person', 'stack-source', 'deleted-card'] },
    }, {
      code: 'STALE_EDGE_DIAGNOSTIC', severity: 'warning', message: '历史问题关联的线已删除', blocks: [],
      target: { card_id: 'diagnostic-model', path: ['edges', 'deleted-edge'] },
    }, {
      code: 'TEXT_ONLY_DIAGNOSTIC', severity: 'warning', message: '来源林夏的依据已变', blocks: [],
      target: { card_id: 'diagnostic-model' },
    }]
    await route.fulfill({ response, json: payload })
  })
  await page.locator('[data-card-id="diagnostic-model"]').press('Enter')
  await page.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  await preview.getByText('EDGE_DIAGNOSTIC: 请核对明确的候选连接', { exact: true }).waitFor()
  const previewRelated = preview.getByRole('alert').filter({ hasText: '有多个明确的相关对象' })
  assert.equal(await previewRelated.getByRole('button').count(), 2)
  await previewRelated.getByText('相关卡片 3 已不可用', { exact: true }).waitFor()
  assert.equal(await preview.getByRole('alert').filter({ hasText: '来源林夏的依据已变' }).getByRole('button').count(), 0)
  await closePrecheck(page)
  await closeCanvasDetails(page)
  await page.locator('[data-card-id="diagnostic-model"]').getByRole('button', { name: '查看卡片问题' }).press('Enter')
  const diagnostics = page.getByRole('region', { name: '卡片问题' })
  await diagnostics.getByRole('listitem').filter({ hasText: '请核对明确的候选连接' }).getByRole('button', { name: '定位连线', exact: true }).press('Enter')
  await page.locator('[data-generation-edge-id="text-0-diagnostic-model-text"][data-edge-active="true"]').waitFor()
  assert.equal(await detail.count(), 0)
  await page.locator('[data-card-id="diagnostic-composition"]').getByRole('button', { name: '查看卡片问题' }).press('Enter')
  await page.getByRole('region', { name: '卡片问题' }).getByRole('button', { name: '定位关系', exact: true }).press('Enter')
  await page.getByRole('combobox', { name: '定位到画面', exact: true }).waitFor()
  assert.equal(await detail.getByRole('button', { name: '高级设置', exact: true }).isVisible(), true, '关系定位保留普通预设入口')
  await page.keyboard.press('Escape')
  await closeCanvasDetails(page)
  const modelIssues = page.locator('[data-card-id="diagnostic-model"]').getByRole('button', { name: '查看卡片问题' })
  await modelIssues.press('Enter')
  const related = diagnostics.getByRole('listitem').filter({ hasText: '有多个明确的相关对象' })
  await related.getByText('相关卡片 3 已不可用', { exact: true }).waitFor()
  assert.equal(await diagnostics.getByRole('listitem').filter({ hasText: '来源林夏的依据已变' }).getByRole('button').count(), 0, '文字说明不从名称猜测目标')
  await related.getByRole('button', { name: '定位 林夏', exact: true }).press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-card-id') === 'person')
  assert.equal(await detail.count(), 0, '跨卡导航仅定位画布卡片')
  await modelIssues.press('Enter')
  await related.getByRole('button', { name: /^定位 文本内容卡/ }).press('Enter')
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-stack-id') === 'diagnostic-stack')
  await page.getByText('请先解除堆叠后编辑', { exact: true }).waitFor()
  assert.equal(await detail.count(), 0, '堆叠成员不被强制打开')
  await modelIssues.press('Enter')
  await diagnostics.getByRole('listitem').filter({ hasText: '历史问题关联的线已删除' }).getByRole('button', { name: '定位连线', exact: true }).press('Enter')
  await page.getByText('问题所指的连线已不可用', { exact: true }).waitFor()
  assert.equal(await detail.count(), 0, '失效连线不选择替代位置')
  const other = await context.newPage()
  await other.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await other.goto(page.url())
  await other.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByText('此画布当前只读', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('[data-card-id="diagnostic-composition"]').getByRole('button', { name: '查看卡片问题' }).press('Enter')
  await diagnostics.getByRole('button', { name: '定位关系', exact: true }).press('Enter')
  const readonlyFrame = page.getByRole('combobox', { name: '定位到画面', exact: true })
  await readonlyFrame.waitFor()
  assert.equal(await readonlyFrame.isDisabled(), true, '只读窄屏可定位，但不能改绑')
  assert.equal((await read()).revision, revision, '关系、连线和跨卡导航不修改画布')
  assert.deepEqual(errors, [])
} catch (error) { await debugPage?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }); throw error } finally { await cleanup() }
