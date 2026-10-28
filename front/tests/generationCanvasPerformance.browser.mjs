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
const output = await browserOutput('jellyfish-generation-canvas-performance-')
const api = 'http://127.0.0.1:8285', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8285' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4285, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'ref', type: 'reference.character', objects: [{ object_id: 'alice', name: '小雪', category: 'character' }] },
    { id: 'act', type: 'direction.performance' },
    { id: 'situation', type: 'direction.situation' },
    { id: 'rule', type: 'direction.performance_rule' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } }],
    edges: [
      { id: 'person', source_card: 'ref', source_port: 'object', target_card: 'act', target_port: 'participant' },
      { id: 'design', source_card: 'act', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { act: { participant: ['person'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4285/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await page.locator('.wb-details').waitFor() }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('situation')
  await card.getByRole('textbox', { name: '当前处境内容', exact: true }).fill('门前等候')
  await poll(state => state.document.cards.find(item => item.id === 'situation').situation?.text === '门前等候')
  await open('rule')
  await card.getByRole('textbox', { name: '表演适用说明内容', exact: true }).fill('克制表达')
  await poll(state => state.document.cards.find(item => item.id === 'rule').applicability?.text === '克制表达')
  await open('act')
  await card.getByRole('button', { name: '选择参与对象 小雪', exact: true }).click()
  await card.getByRole('textbox', { name: '身体动作内容', exact: true }).fill('缓慢伸手')
  await poll(state => state.document.cards.find(item => item.id === 'act').physical_action?.text === '缓慢伸手')
  const outputData = (await (await fetch(`${base}/${canvas.id}/cards/act/outputs`)).json()).data
  assert.equal(outputData.outputs[0].payload.adoption, 'whole_card')
  await card.getByRole('textbox', { name: '结束状态内容', exact: true }).fill('掌心朝上')
  await poll(state => state.document.cards.find(item => item.id === 'act').exit_state?.text === '掌心朝上')
  await card.getByText('表演细节与约束', { exact: true }).click()
  await card.getByRole('combobox', { name: '声音表现状态', exact: true }).locator('xpath=ancestor::div[contains(@class, "ant-select-selector")]').click()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('明确没有', { exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'act').voice?.state === 'absent')
  await card.getByText('表演细节与约束', { exact: true }).click()
  await page.screenshot({ path: join(output, 'performance-desktop.png'), fullPage: true })
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.waitFor()
  assert.match(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), /缓慢伸手/)
  assert.match(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), /掌心朝上/)
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  await page.reload()
  await open('act')
  assert.equal(await card.getByRole('textbox', { name: '身体动作内容', exact: true }).inputValue(), '缓慢伸手')
  assert.equal(await card.getByRole('button', { name: /^取消关系 [0-9a-f]/ }).count(), 0, 'valid relationship has one named cancel action')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'narrow editor has no horizontal overflow')
  await page.screenshot({ path: join(output, 'performance-mobile.png'), fullPage: true })
  console.log('Performance browser passed; evidence:', output)
} finally { await cleanup() }
