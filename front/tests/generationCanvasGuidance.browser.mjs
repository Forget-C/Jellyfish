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
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data

  const document = { ...canvas.document, cards: [
    { id: 'criterion', type: 'direction.criterion', criterion_id: 'hand', name: '手部可见' },
    { id: 'control', type: 'direction.creative_control', name: '探索控制' },
    { id: 'guidance', type: 'direction.guidance', name: '生成安排' },
    { id: 'shot', type: 'direction.shot', shot_id: 'reaction', name: '反应镜头' },
    { id: 'performance', type: 'direction.performance' },
    { id: 'photo', type: 'direction.camera', fields: { viewpoint: { state: 'proposal', text: '人物居右' } } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model' }],
    edges: ['performance', 'photo'].map(kind => ({ id: kind, source_card: 'criterion', source_port: 'criterion', target_card: kind, target_port: 'acceptance_basis' })),
    input_order: Object.fromEntries(['performance', 'photo'].map(kind => [kind, { acceptance_basis: [kind] }])) }
  document.edges.push({ id: 'standard', source_card: 'shot', source_port: 'text', target_card: 'consumer', target_port: 'text' })
  document.input_order.consumer = { text: ['standard'] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4301/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => { await openCanvasCard(page, id); const advanced = card.getByRole('button', { name: '高级设置', exact: true }); if (await advanced.count()) await advanced.click(); for (const summary of await card.locator('summary').all()) { if (/对象与制作关系|作用对象/.test(await summary.innerText())) { if (!(await summary.evaluate(el => el.parentElement.open))) await summary.click() } } }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('criterion')
  await card.getByRole('textbox', { name: '可观察判断标准内容', exact: true }).fill('五指和钥匙清晰可见')
  await poll(state => state.document.cards.find(item => item.id === 'criterion').standard?.text === '五指和钥匙清晰可见')
  assert.equal(await card.getByRole('region', { name: '被使用记录', exact: true }).getByText('尚未被采用').count(), 0)
  await page.keyboard.press('Escape')
  await page.locator('[data-card-id="criterion"]').hover()
  const out = await page.locator('[data-card-id="criterion"] [data-connection-side="right"]').boundingBox()
  const input = await page.locator('[data-card-id="shot"] [data-connection-side="left"]').boundingBox()
  assert.ok(out && input)
  await page.mouse.move(out.x + out.width / 2, out.y + out.height / 2)
  await page.mouse.down()
  await page.mouse.move(input.x + input.width / 2, input.y + input.height / 2, { steps: 12 })
  await page.mouse.up()
  const purposes = page.getByRole('menu', { name: '选择连接用途', exact: true })
  if (await purposes.isVisible()) await purposes.getByRole('menuitem', { name: '验收要求 → 关联验收要求', exact: true }).click()
  await poll(state => state.document.edges.some(edge => edge.source_port === 'criterion' && edge.target_card === 'shot'))
  for (const id of ['shot', 'performance', 'photo']) {
    await open(id)
    await card.getByRole('region', { name: '关联的验收要求', exact: true }).getByText('手部可见', { exact: true }).waitFor()
    assert.equal(await card.getByRole('button', { name: '关联验收要求 手部可见', exact: true }).count(), 0)
    await poll(state => state.document.cards.find(item => item.id === id).input_bindings?.some(binding => binding.input_port === 'acceptance_basis'))
    const output = (await (await fetch(`${base}/${canvas.id}/cards/${id}/outputs`)).json()).data.outputs[0]
    assert.match(output.text, /手部可见/)
    assert.doesNotMatch(output.text, /五指和钥匙清晰可见/)
  }
  await open('criterion')
  const uses = card.getByRole('region', { name: '被使用记录', exact: true })
  await uses.getByText('反应镜头', { exact: true }).waitFor()
  assert.equal(await uses.getByRole('button').count(), 0)
  await page.screenshot({ path: join(output, 'guidance-uses-desktop.png'), fullPage: true })
  await open('control')
  await card.getByRole('textbox', { name: '允许发挥范围内容', exact: true }).fill('背景可以自由探索')
  await card.getByRole('textbox', { name: '需要保持内容', exact: true }).fill('保持帽子')
  await poll(state => state.document.cards.find(item => item.id === 'control').keep?.text === '保持帽子')
  await open('guidance')
  await card.getByRole('textbox', { name: '编译优先级内容', exact: true }).fill('先呈现反应')
  await card.getByRole('textbox', { name: '禁止项内容', exact: true }).fill('不可出现字幕')
  await poll(state => state.document.cards.find(item => item.id === 'guidance').prohibitions?.text === '不可出现字幕')
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.match(compiled.text, /五指和钥匙清晰可见/)
  assert.equal(compiled.media.length, 0)
  await card.getByRole('region', { name: '随设计采用的验收要求', exact: true }).waitFor()
  assert.equal((await read()).document.edges.filter(edge => edge.source_card === 'criterion' && edge.target_card === 'consumer').length, 0)
  await page.reload()
  await open('criterion')
  await card.getByRole('textbox', { name: '可观察判断标准内容', exact: true }).waitFor()
  assert.equal(await card.getByRole('textbox', { name: '可观察判断标准内容', exact: true }).innerText(), '五指和钥匙清晰可见')
  await open('shot')
  const standardSummary = card.getByText('展开标准', { exact: true })
  if (!(await standardSummary.evaluate(element => element.parentElement.open))) await standardSummary.click()
  await card.getByText('五指和钥匙清晰可见', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'acceptance-relations-desktop.png'), fullPage: true })
  await closeCanvasDetails(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await open('shot')
  if (!(await standardSummary.evaluate(element => element.parentElement.open))) await standardSummary.click()
  await card.getByText('五指和钥匙清晰可见', { exact: true }).waitFor()
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await card.getByText('五指和钥匙清晰可见', { exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, 'acceptance-relations-narrow.png'), fullPage: true })
  await closeCanvasDetails(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await open('shot')
  await card.getByRole('button', { name: '查看验收要求', exact: true }).click()
  await card.getByRole('textbox', { name: '可观察判断标准内容', exact: true }).waitFor()
  await open('shot')
  const shotEdge = (await read()).document.edges.find(edge => edge.target_card === 'shot' && edge.target_port === 'acceptance_basis')
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await page.locator(`[data-generation-edge-id="${shotEdge.id}"]`).getByRole('button').press('Enter')
  await page.getByRole('button', { name: '删除此候选连接', exact: true }).click()
  await poll(state => !state.document.cards.find(item => item.id === 'shot').input_bindings?.length)
  const afterDisconnect = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.doesNotMatch(afterDisconnect.text, /五指和钥匙清晰可见/)
  await page.setViewportSize({ width: 390, height: 844 })
  await open('criterion')
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'guidance-narrow.png'), fullPage: true })
  console.log('generation canvas guidance browser assertions passed', output)
} finally { await cleanup() }
