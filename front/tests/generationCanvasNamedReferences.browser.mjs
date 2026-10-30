import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-named-')
const api = 'http://127.0.0.1:8281', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8281' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4281, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'p', kind: 'text', text: '三张角色图片' }] }, config: { count: 3 } },
    { id: 'person', type: 'content.object', object_id: 'alice', name: '小雪', category: 'character', text: '秘密描述不应展示或自动采用' },
    { id: 'coat', type: 'content.object', object_id: 'coat-object', name: '蓝衣', category: 'costume', text: '服装秘密描述' },
    { id: 'ref', type: 'reference.character', title: '', angle: '正面', input_bindings: [], objects: [] },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'literal', kind: 'text', text: '原样保留创作要求' }] }, config: { count: 3 } }],
    edges: [
      { id: 'name', source_card: 'person', source_port: 'object', target_card: 'ref', target_port: 'name' },
      { id: 'costume', source_card: 'coat', source_port: 'object', target_card: 'ref', target_port: 'name' },
      { id: 'main', source_card: 'm', source_port: 'image', target_card: 'ref', target_port: 'image_source' },
      { id: 'adopt', source_card: 'ref', source_port: 'image', target_card: 'consumer', target_port: 'image' }],
    input_order: { ref: { name: ['name', 'costume'], image_source: ['main'] }, consumer: { image: ['adopt'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4281/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = id => openCanvasCard(page, id)
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const start = async () => {
    await card.getByRole('button', { name: '预检运行', exact: true }).click()
    await preview.waitFor()
    await preview.getByRole('button', { name: '确认执行', exact: true }).click()
    await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  }
  await open('ref')
  await card.getByRole('button', { name: '关联名称 小雪', exact: true }).waitFor()
  assert.equal(await card.getByText('秘密描述不应展示或自动采用').count(), 0)
  assert.equal(await card.getByText('服装秘密描述').count(), 0)
  await card.getByRole('button', { name: '关联名称 小雪', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'ref').input_bindings.length === 1)
  await card.getByRole('button', { name: '关联名称 蓝衣', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'ref').input_bindings.length === 2)
  const namesState = await read()
  assert.equal(namesState.document.edges.filter(edge => edge.target_card === 'ref' && edge.target_port === 'name').length, 2, 'both direct names remain candidates')
  assert.equal(namesState.document.cards.find(item => item.id === 'ref').input_bindings.filter(binding => binding.input_port === 'name').length, 2, 'both names were explicitly bound')
  await card.getByRole('textbox', { name: '参考标题', exact: true }).fill('小雪与蓝衣·侧面')
  await card.getByRole('textbox', { name: '参考角度', exact: true }).fill('侧面')
  await card.getByRole('textbox', { name: '图内位置 小雪', exact: true }).fill('左侧')
  await poll(state => state.document.cards.find(item => item.id === 'ref').positions?.alice === '左侧')
  await open('m')
  await start()
  await open('ref')
  await card.getByRole('button', { name: '选为主图 @图片2', exact: true }).click()
  const selectedState = await poll(state => !!state.document.cards.find(item => item.id === 'ref').image_binding)
  const fixed = selectedState.document.cards.find(item => item.id === 'ref').image_binding
  assert.equal(fixed.source.position, 1)
  assert.equal(selectedState.document.edges.filter(edge => edge.target_card === 'ref' && edge.target_port === 'image_source').length, 1, 'one direct image candidate edge')
  assert.equal(fixed.source.card_id, 'm', 'main image remains explicitly bound to the generated source')
  assert.equal(fixed.source.port_id, 'image')
  await page.locator('[data-card-id="ref"] .canvas-card-summary').filter({ hasText: '小雪、蓝衣 · 侧面' }).waitFor()
  assert.equal(await page.locator('[data-card-id="ref"] .generation-card-footer').getByText('尚未绑定名称', { exact: true }).count(), 0, 'card summary reflects explicitly bound names')
  assert.equal(await card.getByRole('img', { name: '图片预览', exact: true }).first().evaluate(img => img.complete && img.naturalWidth === 240), true)
  await page.screenshot({ path: join(output, 'named-reference-desktop.png'), fullPage: true })
  await open('consumer')
  await card.getByRole('button', { name: '采用 @图片1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings.length === 1)
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  await preview.waitFor()
  assert.equal(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), '原样保留创作要求\n小雪 = image 1（侧面，左侧）\n蓝衣 = image 1（侧面）')
  assert.equal(await preview.getByRole('region', { name: '实际参考图片', exact: true }).getByRole('img').count(), 1)
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  const calls = (await (await fetch(`${api}/test/image-controls`)).json()).calls
  assert.equal(calls.length, 2)
  assert.equal(calls[1].images.length, 1)
  assert.equal(calls[1].prompt, '原样保留创作要求\n小雪 = image 1（侧面，左侧）\n蓝衣 = image 1（侧面）')
  await open('m')
  const oldCurrent = (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data.current_outputs.m[1].file_id
  await start()
  for (let i = 0; i < 80; i++) { const current = (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data.current_outputs.m[1].file_id; if (current !== oldCurrent) break; if (i === 79) throw Error('source rerun did not finish'); await delay(150) }
  await open('ref')
  await card.getByText(`固定文件 ${fixed.file_id}`, { exact: false }).waitFor()
  await page.reload(); await open('ref')
  assert.equal((await read()).document.cards.find(item => item.id === 'ref').image_binding.file_id, fixed.file_id)
  await page.setViewportSize({ width: 390, height: 844 })
  await card.getByRole('textbox', { name: '参考角度', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'named-reference-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await card.getByRole('button', { name: '取消主图', exact: true }).click()
  await poll(state => !state.document.cards.find(item => item.id === 'ref').image_binding)
  const outputs = (await (await fetch(`${base}/${canvas.id}/cards/ref/outputs`)).json()).data.outputs
  assert.deepEqual(outputs.map(item => item.source.port_id), ['object', 'object'])
  assert.equal(await card.getByText('换图后请核对角度与图内位置；名称绑定会保留。').count(), 1)
  const bytes = Buffer.from(await (await fetch(`${api}/api/v1/studio/files/${fixed.file_id}/download`)).arrayBuffer())
  for (const [kind, title, objectName] of [['place', '场所', '空屋'], ['prop', '道具', '长剑'], ['costume', '服装', '礼服']]) {
    const shrink = card.getByRole('button', { name: '收起详情', exact: true })
    if (await shrink.count()) await shrink.press('Enter')
    await page.getByRole('button', { name: '关闭详情', exact: true }).press('Enter')
    await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.inert)
    await page.getByRole('button', { name: '参考卡', exact: true }).click()
    await page.getByRole('button', { name: `${title}参考卡`, exact: true }).click()
    await card.getByRole('button', { name: '展开详情', exact: true }).press('Enter')
    await card.getByRole('button', { name: `独立命名${title}`, exact: true }).click()
    await card.getByRole('textbox', { name: '独立对象名称', exact: true }).fill(objectName)
    await card.getByLabel('上传媒体文件', { exact: true }).setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer: bytes })
    const state = await poll(state => state.document.cards.some(item => item.type === `reference.${kind}` && item.image_binding && item.objects?.[0]?.name === objectName))
    const reference = state.document.cards.find(item => item.type === `reference.${kind}`)
    const out = (await (await fetch(`${base}/${canvas.id}/cards/${reference.id}/outputs`)).json()).data.outputs
    assert.equal(out[0].payload.objects[0].category, kind)
    assert.equal(out[0].payload.objects[0].name, objectName)
  }
  writeFileSync(join(output, 'assertions.json'), JSON.stringify({ fixed, mappings: calls[1].prompt, calls: calls.length, viewport: [1440, 390] }, null, 2))
  console.log('Named image references: direct identities, fixed result, mapping, Worker, reload and narrow page passed')
} finally { await cleanup() }
