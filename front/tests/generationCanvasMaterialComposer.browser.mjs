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
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8533', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8533' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4533, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const json = async (path, method, body) => {
    const response = await fetch(api + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text()); return (await response.json()).data
  }
  const textModel = await json('/api/v1/llm/models', 'POST', { id: 'canvas-text-model', name: 'text-model', category: 'text', provider_id: 'canvas-image-provider' })
  const videoModel = await json('/api/v1/llm/models', 'POST', { id: 'canvas-video-model', name: 'sora-2', category: 'video', provider_id: 'canvas-image-provider' })
  await json('/api/v1/llm/model-settings', 'PUT', { default_text_model_id: textModel.id, default_image_model_id: 'canvas-image-model', default_video_model_id: videoModel.id })
  const canvas = await json('/api/v1/studio/generation-canvases/canvas-project', 'POST', { name: 'A 紧凑模型编辑卡' })
  const document = { ...canvas.document, cards: [
    { id: 'source', type: 'content.text', text: '雨夜车站，两人重逢。' },
    ...['text','image','video'].map(kind => ({ id: kind, type: `model.${kind}`, prompt: { segments: [] } })),
  ], edges: ['text','image','video'].map(kind => ({ id: `edge-${kind}`, source_card: 'source', source_port: 'text', target_card: kind, target_port: 'text' })), input_order: Object.fromEntries(['text','image','video'].map(kind => [kind, { text: [`edge-${kind}`] }])) }
  await json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`, 'PUT', { request_id: 'seed', expected_revision: 0, document })
  const url = `http://127.0.0.1:4533/projects/canvas-project/generation-canvas?canvas=${canvas.id}`
  const editor = page.locator('.wb-details:not([hidden])')
  const input = editor.getByRole('textbox', { name: '模型正文', exact: true })
  const saved = () => page.getByLabel('画布保存状态').getByText('已保存', { exact: true }).waitFor()
  const read = () => json(`/api/v1/studio/generation-canvases/canvas-project/${canvas.id}`, 'GET')
  const open = async kind => {
    if (await editor.isVisible()) { if (await editor.locator('.generation-material-candidates[open]').count()) await editor.getByLabel('管理候选与采用', { exact: true }).press('Escape'); await editor.press('Escape') }
    // 连续编辑会按需平移画布；先把下一张卡带回视口，再从真实可见入口打开。
    await page.getByRole('button', { name: '适应全部', exact: true }).click()
    await page.locator(`[data-card-id="${kind}"]`).press('Enter'); await input.waitFor()
  }
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => sessionStorage.getItem('test-platform') || 'MacIntel' }))
  await page.goto(url)
  for (const kind of ['text','image','video']) {
    await open(kind)
    await editor.locator('.generation-material-reference').waitFor()
    await saved()
    assert.equal(await editor.getByRole('heading').count(), 0, 'model header has no title')
    assert.equal(await editor.getByRole('button', { name: '关闭详情', exact: true }).count(), 0)
    assert.equal(await editor.getByRole('button', { name: '展开详情', exact: true }).count(), 1)
    assert.equal(await editor.getByRole('region', { name: '关联区', exact: true }).count(), 1)
    const state = await read(), model = state.document.cards.find(card => card.id === kind)
    assert.ok(model.model_id, 'configured default model is selected and saved')
    if (kind === 'video') assert.equal(model.config.ratio, '16:9')
    const regions = await editor.locator('.generation-material-basis,.generation-material-input,.generation-material-footer').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
    assert.ok(regions[0].bottom <= regions[1].top && regions[1].bottom <= regions[2].top, 'three zones are vertical')
    assert.equal(await editor.locator('.generation-material-adopted').count(), 0, 'connection is only a candidate')
    assert.equal(await editor.getByRole('button', { name: '预检运行', exact: true }).isDisabled(), true, 'empty content and candidates cannot submit')
    await editor.locator('.generation-material-reference').click()
    const adopt = editor.getByRole('button', { name: kind === 'video' ? '采用 @文本1 为文本' : '采用 @文本1', exact: true })
    await adopt.click(); await saved()
    await editor.getByLabel('管理候选与采用', { exact: true }).press('Escape')
    assert.equal(await editor.locator('.generation-material-adopted').count(), 1)
    await input.fill(`雨夜车站 · ${kind}`)
    await input.press('End'); await input.press('Meta+Enter'); await input.press('x')
    assert.match(await input.textContent(), /\nx$/)
    assert.equal(await page.getByRole('dialog', { name: '运行预检', exact: true }).isVisible(), false, 'newline does not submit')
    await input.fill(`雨夜车站 · ${kind}`)
    await editor.getByRole('button', { name: '展开详情', exact: true }).click()
    await editor.getByRole('button', { name: '收起详情', exact: true }).click()
    assert.equal(await input.textContent(), `雨夜车站 · ${kind}`, 'expansion keeps prompt')
    await page.screenshot({ path: join(output, `compact-${kind}-1440.png`) })
  }
  await open('image')
  const requests = []
  page.on('request', request => { if (request.url().endsWith('/precheck')) requests.push(request) })
  await input.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 229 }))
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }))
  })
  assert.equal(requests.length, 0, 'IME confirmation never submits')
  await input.fill('保存最新正文后预检')
  const checked = page.waitForResponse(response => response.url().endsWith('/precheck'))
  await input.press('Enter'); assert.ok((await checked).ok())
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor()
  assert.equal((await read()).document.cards.find(card => card.id === 'image').prompt.segments[0].text, '保存最新正文后预检')
  await page.getByRole('dialog', { name: '运行预检', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.generation-card-editor:not([hidden])')?.inert)
  await input.fill('@文'); await input.press('Enter')
  assert.equal(requests.length, 1, 'Enter selects a reference before submitting')
  await editor.getByRole('button', { name: '展开详情', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'compact-mobile.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const submitBox = await editor.getByRole('button', { name: '预检运行', exact: true }).boundingBox()
  assert.ok(submitBox.y > 0 && submitBox.y + submitBox.height <= 844)
  // Reload under Windows to exercise Ctrl rather than Command without changing saved content.
  await saved()
  await page.evaluate(() => sessionStorage.setItem('test-platform', 'Win32'))
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload()
  await page.locator('[data-card-id="image"]').press('Enter'); await input.waitFor()
  await editor.locator('[contenteditable="true"]').waitFor()
  assert.match(await input.getAttribute('aria-placeholder'), /Ctrl/)
  await input.fill('Windows'); await input.press('End'); await input.press('Control+Enter'); await input.press('x')
  assert.equal(await input.textContent(), 'Windows\nx')
  assert.equal(await page.getByRole('dialog', { name: '运行预检', exact: true }).isVisible(), false)
  await page.screenshot({ path: join(output, 'compact-windows.png') })
  await saved()
  const observer = await page.context().newPage()
  await observer.setViewportSize({ width: 390, height: 844 })
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(url); await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  await observer.locator('[data-card-id="image"]').press('Enter')
  const readonly = observer.locator('.wb-details:not([hidden])')
  assert.equal(await readonly.getByRole('textbox', { name: '模型正文', exact: true }).getAttribute('contenteditable'), 'false')
  assert.equal(await readonly.getByRole('button', { name: '预检运行', exact: true }).isDisabled(), true)
  await observer.close()
  console.log('PASS shared three-zone editor, adoption, defaults, OS shortcuts, IME, saved precheck and responsive layout', output)
} catch(error) { if(page) { await page.screenshot({path:join(output,'failure.png')}); writeFileSync(join(output,'failure-geometry.json'),JSON.stringify(await page.locator('.wb-details:not([hidden]),.generation-material-footer').evaluateAll(es=>es.map(e=>({tag:e.className,rect:e.getBoundingClientRect().toJSON()}))))) } throw error } finally { await cleanup() }
