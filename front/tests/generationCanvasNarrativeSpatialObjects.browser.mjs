import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
import { openDesignAssociation, openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-narrative-spatial-objects-')
const api = 'http://127.0.0.1:8744', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8744' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4744, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = await createStoryboardCanvas(base, '叙事空间旧对象恢复')
  const cases = [['overview', 'direction.narrative', 'viewpoint', '观察视点'], ['event', 'direction.event', 'action_change', '动作或变化说明'], ['rule', 'direction.space_rule', 'spatial_basis', '空间依据'], ['anchor', 'direction.anchor', 'position', '位置']]
  const source = port => ({ canvas_id: canvas.id, card_id: 'place', port_id: port, position: 0, ...(port === 'object' ? { object_id: 'hall' } : {}) })
  const document = { ...canvas.document, cards: [{ id: 'place', type: 'content.place', object_id: 'hall', name: '大厅', text: '完整大厅描述' }, ...cases.map(([id, type, key]) => ({ id, type, ...(id === 'rule' ? {} : { name: id }), ...(id === 'event' ? { event_id: 'stable-event' } : id === 'anchor' ? { anchor_id: 'stable-anchor' } : {}), [key]: { text: '普通文字不产生引用', authorship: 'user' } }))], edges: [], input_order: {} }
  for (const [id] of cases) {
    document.edges.push({ id: id + '-text', source_card: 'place', source_port: 'text', target_card: id, target_port: 'text' })
    document.input_order[id] = { text: [id + '-text'] }
    if (id === 'anchor' || id === 'rule') {
      document.cards.find(card => card.id === id).input_bindings = [{ id: 'space', input_port: 'space', source: source('object') }]
      document.edges.push({ id: id + '-space', source_card: 'place', source_port: 'object', target_card: id, target_port: 'space' })
      document.input_order[id].space = [id + '-space']
    }
  }
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) }) })
  assert.ok(seeded.ok, await seeded.text())
  const read = async () => (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await page.goto(`http://127.0.0.1:4744${storyboardCanvasPath(canvas)}`)
  const baseline = await read(), recovered = structuredClone(baseline.document)
  for (const [id, , key] of cases) {
    const card = recovered.cards.find(item => item.id === id)
    card[key] = { text: '恢复的正文', authorship: 'user' }
    card.input_bindings = [...(card.input_bindings || []), { id: 'old-' + id, input_port: 'effect_object', source: source('object') }]
    recovered.edges.push({ id: 'old-' + id, source_card: 'place', source_port: 'object', target_card: id, target_port: 'effect_object' })
    recovered.input_order[id].effect_object = ['old-' + id]
  }
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `jellyfish:generation:canvas-project:${canvas.id}:recovery`, value: { schema: 1, baseline, document: recovered } })
  await page.reload()
  await page.getByRole('button', { name: '恢复本地内容', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'overview').viewpoint.text === '恢复的正文')
  const assertCleaned = async () => {
    const state = await read()
    for (const [id] of cases) {
      const card = state.document.cards.find(item => item.id === id)
      assert.equal(card.input_bindings?.some(binding => binding.input_port === 'effect_object'), false)
      assert.ok(!state.document.edges.some(edge => edge.target_card === id && edge.target_port === 'effect_object'))
      if (id === 'anchor' || id === 'rule') assert.equal(card.input_bindings[0].source.object_id, 'hall')
    }
  }
  await assertCleaned()
  const detail = page.locator('.wb-details:visible')
  for (const [id, , key, label] of cases) {
    await openCanvasCard(page, id)
    const advanced = detail.getByRole('button', { name: '高级设置', exact: true })
    if (await advanced.count()) await advanced.click()
    assert.equal(await detail.getByRole('button', { name: /(?:选择|取消)作用对象/ }).count(), 0)
    if (id === 'overview' || id === 'event') assert.equal(await detail.locator('summary').filter({ hasText: /^叙事关系/ }).count(), 0)
    else {
      await openDesignAssociation(detail, /候选.*大厅/)
      await page.getByRole('button', { name: '解除所属空间', exact: true }).waitFor()
      await page.keyboard.press('Escape')
    }
    const field = detail.getByRole('textbox', { name: label + '内容', exact: true })
    await field.fill('')
    await field.press('@')
    await page.getByRole('option', { name: '@文本1', exact: true }).click()
    await poll(state => state.document.cards.find(item => item.id === id)[key].document?.segments.some(segment => segment.kind === 'reference'))
    await closeCanvasDetails(page)
    await page.getByRole('button', { name: '撤销操作', exact: true }).click()
    await poll(state => !state.document.cards.find(item => item.id === id)[key].document?.segments.some(segment => segment.kind === 'reference'))
    await assertCleaned()
    await page.getByRole('button', { name: '重做操作', exact: true }).click()
    await poll(state => state.document.cards.find(item => item.id === id)[key].document?.segments.some(segment => segment.kind === 'reference'))
    await assertCleaned()
  }
  await page.reload()
  await assertCleaned()
  await openCanvasCard(page, 'anchor')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await detail.evaluate(element => element.scrollWidth <= element.clientWidth))
  await page.screenshot({ path: join(output, 'retired-objects-mobile.png'), fullPage: true })
  console.log('PASS four narrative/spatial types: old local restore, roles, whole references, undo/redo, reopen and mobile', output)
} finally { await cleanup() }
