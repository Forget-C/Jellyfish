import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const output = await browserOutput('jellyfish-design-name-fields-')
const api = 'http://127.0.0.1:8692', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8692' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4692, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const labels = { creative_control: '创作控制名称', guidance: '生成指导名称', criterion: '验收要求名称', narrative: '叙事名称', beat: '节拍名称', event: '事件名称', shot: '镜头名称', anchor: '锚点名称', blocking: '调度名称' }
  const canvas = await createStoryboardCanvas(base, '设计名称字段审计')
  const document = { ...canvas.document, cards: [...Object.keys(labels).map(id => ({ id, type: 'direction.' + id, name: '' })), { id: 'other-criterion', type: 'direction.criterion', name: '已占用名称' }] }
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) }) })
  assert.ok(seeded.ok, await seeded.text())
  const read = async () => (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(100) } throw Error('name save timeout') }
  await page.goto(`http://127.0.0.1:4692${storyboardCanvasPath(canvas)}`)
  for (const [id, label] of Object.entries(labels)) {
    const detail = await openCanvasCard(page, id)
    const input = detail.getByRole('textbox', { name: label, exact: true })
    if (id === 'criterion') await detail.screenshot({ path: join(output, 'unnamed-title-desktop.png') })
    await detail.getByRole('button', { name: '编辑' + label, exact: true }).click()
    await input.waitFor()
    assert.equal(await input.evaluate(element => !!element.closest('header')), true, 'name edits in modal heading')
    assert.equal(await input.evaluate(element => !!element.closest('details')), false, 'name is outside relation folds')
    const placeholder = await input.getAttribute('placeholder')
    assert.ok(placeholder?.startsWith('例如：'))
    assert.equal(await detail.getByText(placeholder, { exact: true }).count(), 0)
    await input.fill('已命名-' + id)
    const saved = await poll(state => state.document.cards.find(card => card.id === id).name === '已命名-' + id)
    await detail.getByText(`revision ${saved.revision}`, { exact: true }).waitFor()
    if (id === 'creative_control') {
      await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true })
      assert.equal(await input.isVisible(), true, 'IME confirmation does not exit name editing')
    }
    await input.press('Enter')
    await detail.getByRole('heading', { name: '已命名-' + id, exact: true }).waitFor()
    await page.waitForFunction(name => document.activeElement?.getAttribute('aria-label') === name, '编辑' + label)
    const edit = detail.getByRole('button', { name: '编辑' + label, exact: true })
    const headingBox = await detail.getByRole('heading', { name: '已命名-' + id, exact: true }).boundingBox()
    const typeBox = await detail.locator('.design-title-type').boundingBox()
    assert.ok(typeBox.y >= headingBox.y && typeBox.y < headingBox.y + headingBox.height, 'type and rename accompany the name on one line')
    assert.equal(await edit.innerText(), '重命名')
    if (id === 'criterion') {
      await edit.click()
      await input.fill('啊')
      await input.press('Enter')
      await detail.getByRole('heading', { name: '啊', exact: true }).waitFor()
      await detail.screenshot({ path: join(output, 'named-title-desktop.png') })
      await page.setViewportSize({ width: 390, height: 844 })
      await detail.screenshot({ path: join(output, 'named-title-mobile.png') })
      await edit.click()
      await input.fill('手部与钥匙清晰可见，角色动作与画面保持一致的验收要求'.repeat(3))
      await input.press('Enter')
      await detail.screenshot({ path: join(output, 'long-title-mobile.png') })
      await page.setViewportSize({ width: 320, height: 844 })
      await detail.screenshot({ path: join(output, 'long-title-tiny.png') })
      assert.equal(await detail.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'tiny heading does not overflow')
      await page.setViewportSize({ width: 390, height: 844 })
      await edit.click()
      await input.fill('已命名-' + id)
      await input.press('Enter')
      const saved = await poll(state => state.document.cards.find(card => card.id === id).name === '已命名-' + id)
      await detail.getByText(`revision ${saved.revision}`, { exact: true }).waitFor()
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
    await edit.click()
    await input.press('Escape')
    assert.equal(await detail.isVisible(), true, 'Escape ends name editing before closing modal')
    assert.equal(await input.count(), 0)
    await edit.click()
    const advanced = detail.getByRole('button', { name: '高级设置', exact: true })
    if (await advanced.count()) {
      await advanced.click()
      assert.equal(await input.count(), 0, 'mode button blur ends editing')
      await detail.getByRole('button', { name: '编辑' + label, exact: true }).click()
    }
    assert.equal(await input.isVisible(), true)
    await input.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await detail.getByRole('button', { name: '编辑' + label, exact: true }).click()
    await input.waitFor()
    const { box, panel } = await input.evaluate(node => ({
      box: node.getBoundingClientRect().toJSON(),
      panel: node.closest('.wb-details').getBoundingClientRect().toJSON(),
    }))
    assert.ok(box.width > 100 && box.x >= panel.x && box.x + box.width <= panel.x + panel.width, 'name fits narrow heading')
    await detail.screenshot({ path: join(output, id + '-name-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await closeCanvasDetails(page)
  }
  const criterion = await openCanvasCard(page, 'criterion')
  const nameInput = criterion.getByRole('textbox', { name: labels.criterion, exact: true })
  await criterion.getByRole('button', { name: '编辑' + labels.criterion, exact: true }).click()
  await nameInput.fill('已占用名称')
  await criterion.getByRole('alert').filter({ hasText: '该名称已被同类型卡片使用' }).waitFor()
  await nameInput.press('Enter')
  assert.equal(await nameInput.count(), 0, 'invalid name does not trap editing')
  await criterion.getByRole('button', { name: '编辑' + labels.criterion, exact: true }).click()
  await nameInput.fill('已命名-criterion')
  assert.equal(await criterion.getByRole('alert').count(), 0)
  await nameInput.press('Enter')
  await poll(state => state.document.cards.find(card => card.id === 'criterion').name === '已命名-criterion')
  await closeCanvasDetails(page)
  const reopened = await openCanvasCard(page, 'criterion')
  assert.equal(await reopened.getByRole('textbox', { name: labels.criterion, exact: true }).count(), 0, 'reopen resets edit session')
  await closeCanvasDetails(page)
  await page.reload()
  const observer = await context.newPage()
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  for (const [id, label] of Object.entries(labels)) {
    const detail = await openCanvasCard(observer, id)
    await detail.locator('.design-preset-revision').getByText(`revision ${(await read()).revision}`, { exact: true }).waitFor()
    const input = detail.getByRole('textbox', { name: label, exact: true })
    await detail.getByRole('heading', { name: '已命名-' + id, exact: true }).waitFor()
    assert.equal(await input.count(), 0)
    assert.equal(await detail.getByRole('button', { name: '编辑' + label, exact: true }).count(), 0)
    assert.equal(await detail.locator('.design-title-tools > span').count(), 0, 'readonly hides the action separator')
    const advanced = detail.getByRole('button', {name:'高级设置',exact:true})
    if (await advanced.count()) await advanced.click()
    const fonts = await detail.locator('.design-preset-advanced .generation-prompt-editor, .design-preset-advanced input').evaluateAll(nodes => nodes.map(node => { const style = getComputedStyle(node); return [style.fontSize, style.fontWeight] }))
    assert.ok(fonts.length && fonts.every(([size, weight]) => size === '14px' && weight === '400'), 'readonly input typography matches editable content')
    await closeCanvasDetails(observer)
  }
  await observer.close()
  const failedDetail = await openCanvasCard(page, 'guidance')
  await failedDetail.getByRole('button', { name: '编辑' + labels.guidance, exact: true }).click()
  const failedInput = failedDetail.getByRole('textbox', { name: labels.guidance, exact: true })
  const saveUrl = url => url.pathname.endsWith(`/generation-canvases/${canvas.id}`)
  await page.route(saveUrl, route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    return route.continue()
  })
  const savedRevision = (await read()).revision
  await failedDetail.getByText(`revision ${savedRevision}`, { exact: true }).waitFor()
  const rejected = page.waitForResponse(response => saveUrl(new URL(response.url())) && response.request().method() === 'PUT' && response.status() === 503)
  await failedInput.fill('网络失败保留的名称')
  await rejected
  assert.equal(await failedDetail.getByText(`revision ${savedRevision}`, { exact: true }).count(), 1, 'failed save retains confirmed revision')
  await failedInput.press('Enter')
  await failedDetail.getByRole('heading', { name: '网络失败保留的名称', exact: true }).waitFor()
  assert.equal(await failedDetail.getByRole('alert').count(), 0, 'network failure is not a name validation error')
  await page.unroute(saveUrl)
  console.log('PASS all nine named design types: visible label, persistent name, placeholder only, full width and readonly')
} finally { await cleanup() }
