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
const output = await browserOutput('jellyfish-generation-canvas-photography-')
const api = 'http://127.0.0.1:8289', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8289' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4289, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'photo', type: 'direction.photography' }, { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } }],
    edges: [{ id: 'design', source_card: 'photo', source_port: 'text', target_card: 'consumer', target_port: 'text' }], input_order: { consumer: { text: ['design'] } } }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(100) } throw Error('saved photography state did not arrive') }
  await page.goto(`http://127.0.0.1:4289/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail = page.locator('.wb-details:not([hidden])')
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await detail.waitFor() }
  await open('photo')
  await detail.getByRole('textbox', { name: '构图重心内容', exact: true }).fill('左侧留白')
  await detail.getByRole('button', { name: '编辑机位与视角', exact: true }).click()
  await detail.getByRole('textbox', { name: '机位位置内容', exact: true }).fill('门外低机位')
  await detail.getByRole('button', { name: '编辑运镜', exact: true }).click()
  await detail.getByRole('textbox', { name: '起始画面内容', exact: true }).fill('门外全景')
  await detail.getByRole('textbox', { name: '运动路径内容', exact: true }).fill('沿窗边平移')
  await detail.getByRole('textbox', { name: '结束画面内容', exact: true }).fill('窗边特写')
  await detail.getByRole('button', { name: '编辑光影与色彩', exact: true }).click()
  await detail.getByRole('textbox', { name: '光源内容', exact: true }).fill('红色侧光不可扩入运镜')
  await detail.getByRole('button', { name: '编辑焦点与成像', exact: true }).click()
  await detail.getByRole('textbox', { name: '景深与焦点内容', exact: true }).fill('焦点跟随眼睛')
  await poll(state => state.document.cards.find(card => card.id === 'photo').fields?.depth_focus?.text === '焦点跟随眼睛')
  assert.equal((await read()).document.cards.filter(card => card.type === 'direction.photography').length, 1)
  await open('consumer')
  await detail.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  const select = name => detail.getByRole('combobox', { name, exact: true })
  await select('摄影采用范围 @文本1').click()
  await select('摄影采用范围 @文本1').press('Backspace')
  await select('摄影采用范围 @文本1').fill('运镜')
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('运镜', { exact: true }).click()
  await select('摄影采用范围 @文本1').press('Escape')
  await select('画面目标 @文本1').click()
  await poll(state => state.document.cards.find(card => card.id === 'consumer').input_bindings?.[0]?.photography_scope?.[0] === 'region:movement')
  assert.equal(await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('结束画面', { exact: true }).isVisible(), true, 'autosave refresh retains the open target control')
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('结束画面', { exact: true }).click()
  await poll(state => state.document.cards.find(card => card.id === 'consumer').frame_targets?.[0]?.state_id === 'field:end_frame')
  await detail.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const text = await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent()
  assert.match(text, /门外全景/); assert.match(text, /沿窗边平移/); assert.match(text, /窗边特写/); assert.match(text, /画面目标：结束画面/)
  assert.doesNotMatch(text, /红色侧光|左侧留白|低机位|焦点跟随/)
  writeFileSync(join(output, 'submitted-text.txt'), text)
  await page.screenshot({ path: join(output, 'photography-preview.png'), fullPage: true })
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await detail.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'photography-results.png'), fullPage: true })
  await page.reload(); await open('photo')
  assert.equal(await detail.getByRole('textbox', { name: '构图重心内容', exact: true }).inputValue(), '左侧留白')
  await detail.getByRole('button', { name: '复制为独立摄影方案', exact: true }).click()
  await detail.getByRole('textbox', { name: '构图重心内容', exact: true }).fill('独立方案')
  await poll(state => state.document.cards.filter(card => card.type === 'direction.photography').length === 2 && state.document.cards.some(card => card.type === 'direction.photography' && card.fields?.composition?.text === '独立方案'))
  assert.equal((await read()).document.cards.find(card => card.id === 'photo').fields.composition.text, '左侧留白')
  await page.screenshot({ path: join(output, 'photography-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await detail.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'photography-mobile.png'), fullPage: true })
  console.log('Photography five editors, adoption scope, retained target during autosave, Worker output and independent copy passed; evidence:', output)
} finally { await cleanup() }
