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
const output = await browserOutput('jellyfish-generation-canvas-sound-')
const api = 'http://127.0.0.1:8291', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8291' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4291, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const wav = Buffer.alloc(16044)
  wav.write('RIFF', 0); wav.writeUInt32LE(16036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)
  const upload = new FormData(); upload.append('project_id', 'canvas-project'); upload.append('usage_kind', 'generation_upload'); upload.append('file', new Blob([wav], { type: 'audio/wav' }), 'rain.wav')
  const audio = (await (await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: upload })).json()).data
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '对白声音' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'person', type: 'reference.character', objects: [{ object_id: 'alice', name: '小雪', category: 'character' }] },
    { id: 'line', type: 'direction.dialogue', dialogue_id: 'line-1', version: 1 },
    { id: 'sound', type: 'direction.sound' },
    { id: 'audio', type: 'content.audio', file_id: audio.id },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } },
    { id: 'act', type: 'direction.performance', physical_action: { text: '转头', state: 'proposal' } }],
    edges: [{ id: 'audio', source_card: 'audio', source_port: 'audio', target_card: 'sound', target_port: 'audio_example' },
      { id: 'design', source_card: 'sound', source_port: 'text', target_card: 'consumer', target_port: 'text' }, { id: 'speaker', source_card: 'person', source_port: 'object', target_card: 'line', target_port: 'speaker' },
      { id: 'basis', source_card: 'line', source_port: 'dialogue', target_card: 'act', target_port: 'dialogue_basis' }],
    input_order: { sound: { audio_example: ['audio'] }, consumer: { text: ['design'] }, line: { speaker: ['speaker'] }, act: { dialogue_basis: ['basis'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4291/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => {
    const active = page.locator('.wb-details:visible')
    if (await active.count() && await active.getAttribute('aria-modal') === 'true') {
      await active.getByRole('button', { name: '关闭详情', exact: true }).click()
      await active.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.inert)
    }
    const summary = page.locator(`[data-card-id="${id}"]`)
    await summary.press('Enter')
    await page.waitForFunction(id => document.querySelector(`[data-card-id="${id}"]`)?.getAttribute('data-selected') === 'true', id)
    const edit = summary.locator('button[aria-label="编辑卡片"]')
    if (await edit.count()) { await edit.waitFor({ state: 'visible' }); await edit.press('Enter') }
    await page.locator(`.wb-details:visible [data-card-details="${id}"]`).waitFor()
  }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('line')
  await card.getByRole('textbox', { name: '对白正文内容', exact: true }).fill('请等一等')
  await card.getByRole('button', { name: '选择说话对象 小雪', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'line').input_bindings?.length === 1)
  await open('sound')
  await card.getByRole('textbox', { name: '环境声内容', exact: true }).fill('窗外雨声')
  await card.getByRole('combobox', { name: '声音制作安排', exact: true }).locator('xpath=ancestor::div[contains(@class, "ant-select-selector")]').click()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('待后期', { exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'sound').production === 'postproduction')
  await card.getByText('直接素材参考', { exact: true }).click()
  await card.getByRole('button', { name: '关联参考 @音频1', exact: true }).click()
  await card.locator('audio').waitFor()
  await card.getByRole('spinbutton', { name: '参考起点毫秒', exact: true }).fill('100')
  await card.getByRole('spinbutton', { name: '参考终点毫秒', exact: true }).fill('900')
  await poll(state => state.document.cards.find(item => item.id === 'sound').examples?.[0]?.end_ms === 900)
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.waitFor()
  assert.match(await preview.textContent(), /图片不包含声音/)
  assert.match(await preview.textContent(), /待后期/)
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  const calls = (await (await fetch(`${api}/test/image-controls`)).json()).calls
  assert.equal(calls.length, 1)
  assert.ok(!JSON.stringify(calls).includes(audio.id), 'audio example never becomes a model input')
  await open('act')
  await card.getByRole('button', { name: '采用对白 line-1 · 版本 1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'act').input_bindings?.length === 1)
  const outputs = (await (await fetch(`${base}/${canvas.id}/cards/act/outputs`)).json()).data.outputs
  assert.doesNotMatch(outputs[0].text, /请等一等/)
  assert.match(outputs[0].text, /line-1.*版本 1.*小雪/)
  assert.ok(!('content' in outputs[0].payload.dialogue_basis[0]))
  assert.equal(outputs[0].payload.dialogue_basis[0].speaker.object_id, 'alice')
  await page.reload()
  await open('line')
  assert.equal(await card.getByRole('textbox', { name: '对白正文内容', exact: true }).inputValue(), '请等一等')
  await page.screenshot({ path: join(output, 'dialogue-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'dialogue-mobile.png'), fullPage: true })
  console.log('Dialogue sound browser passed; evidence:', output)
} finally { await cleanup() }
