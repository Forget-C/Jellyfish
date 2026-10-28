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
const output = await browserOutput('jellyfish-generation-canvas-continuity-')
const api = 'http://127.0.0.1:8299', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8299' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4299, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data

  const form = new FormData()
  form.set('project_id', 'canvas-project'); form.set('usage_kind', 'generation_upload')
  form.set('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'evidence.png')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const file = (await uploaded.json()).data.id
  const document = { ...canvas.document, cards: [
    { id: 'image', type: 'content.image', file_id: file },
    { id: 'anchor', type: 'direction.anchor', anchor_id: 'door', name: '门边', position: { state: 'fact', text: '不跨级锚点正文' } },
    { id: 'place', type: 'content.place', object_id: 'hall', name: '大厅', text: '不跨级的场所正文' },
    { id: 'event', type: 'direction.event', event_id: 'bell', name: '钟响', action_change: { state: 'fact', text: '不跨级的事件正文' } },
    { id: 'rule', type: 'direction.space_rule' }, { id: 'continuity', type: 'direction.continuity' }, { id: 'fact', type: 'direction.fact' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model' }], edges: [
    { id: 'evidence', source_card: 'image', source_port: 'image', target_card: 'continuity', target_port: 'image_example' },
    { id: 'space', source_card: 'place', source_port: 'object', target_card: 'rule', target_port: 'space' },
    { id: 'event', source_card: 'event', source_port: 'event', target_card: 'continuity', target_port: 'related_event' },
    { id: 'design', source_card: 'continuity', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { rule: { space: ['space'] }, continuity: { related_event: ['event'], image_example: ['evidence'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4299/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.getByRole('heading', { name: '画面设计', exact: true }).locator('..').getByRole('button', { name: '添加画面风格卡', exact: true }).waitFor()
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await card.waitFor() }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  if (await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  const from = await page.locator('[data-card-id="anchor"]').getByRole('button', { name: '输出端口 anchor', exact: true }).boundingBox()
  const to = await page.locator('[data-card-id="fact"]').getByRole('button', { name: '输入端口 effect_object', exact: true }).boundingBox()
  assert.ok(from && to)
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 }); await page.mouse.up()
  await poll(state => state.document.edges.some(edge => edge.source_card === 'anchor' && edge.target_card === 'fact'))
  assert.equal((await read()).document.cards.find(item => item.id === 'fact').input_bindings.length, 0)
  await open('rule')
  await card.getByRole('textbox', { name: '可拍区域内容', exact: true }).fill('仅大厅内部')
  await card.getByRole('button', { name: '选择所属空间 大厅', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'rule').shootable_area?.text === '仅大厅内部')
  await open('continuity')
  await card.getByRole('textbox', { name: '前态内容', exact: true }).fill('空手')
  await card.getByRole('textbox', { name: '变化内容', exact: true }).fill('拿起钥匙')
  await card.getByRole('textbox', { name: '后态内容', exact: true }).fill('握住钥匙')
  await card.getByRole('button', { name: '选择关联事件 钟响', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'continuity').after?.text === '握住钥匙')
  await card.getByText('固定证据与前后态素材', { exact: true }).click()
  await card.getByRole('button', { name: '关联证据 @图片1', exact: true }).click()
  await card.getByRole('combobox', { name: '证据用途', exact: true }).focus()
  await card.getByRole('combobox', { name: '证据用途', exact: true }).press('ArrowDown')
  await page.getByText('前态', { exact: true }).last().click()
  await poll(state => state.document.cards.find(item => item.id === 'continuity').examples?.[0]?.purpose === 'before')
  const evidence = (await read()).document.cards.find(item => item.id === 'continuity').examples[0]
  assert.equal(evidence.file_id, file); assert.equal(evidence.field_id, 'before')
  await page.screenshot({ path: join(output, 'continuity-desktop.png'), fullPage: true })
  await open('fact')
  await card.getByRole('button', { name: '选择作用对象 门边', exact: true }).click()
  await card.getByRole('textbox', { name: '不可改事实内容', exact: true }).fill('左手一直戴表')
  await card.getByRole('textbox', { name: '来源依据内容', exact: true }).fill('原作第三段')
  await poll(state => state.document.cards.find(item => item.id === 'fact').source_basis?.text === '原作第三段')
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  const target = card.getByRole('combobox', { name: '画面目标 @文本1', exact: true })
  await target.click(); await page.getByText('后态', { exact: true }).last().click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').frame_targets?.[0]?.state_id === 'field:after')
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.match(compiled.text, /空手/); assert.match(compiled.text, /拿起钥匙/); assert.match(compiled.text, /握住钥匙/)
  assert.doesNotMatch(compiled.text, /不跨级/); assert.equal(compiled.media.length, 0)
  await page.reload(); await open('continuity')
  assert.equal(await card.getByRole('textbox', { name: '后态内容', exact: true }).inputValue(), '握住钥匙')
  await card.getByRole('button', { name: '取消关联事件 钟响', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'continuity-mobile.png'), fullPage: true })
  console.log('Continuity browser passed; evidence:', output)
} finally { await cleanup() }
