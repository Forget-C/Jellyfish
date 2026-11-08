import { canvasDetailsToggle, closeCanvasDetails, expandCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-c56-text-')
const api = 'http://127.0.0.1:8456', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8456' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const sample = '清晨，林夏走过安静的街道，回头望向镜头。保持人物身份、自然步态与柔和侧光。'
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) break } catch {}
    await delay(250)
  }
  const request = async (url, init) => { const response = await fetch(url, init); assert.ok(response.ok, await response.clone().text()); return (await response.json()).data }
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4456, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const manifest = []
  for (const [width, height] of [[1440, 960], [390, 844], [3830, 1688]]) {
    const context = await browser.newContext({ viewport: { width, height } })
    await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    const canvas = await request(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '基础文本视觉验证' }) })
    await request(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: { ...canvas.document, cards: [{ id: 'text', type: 'content.text', text: sample }], edges: [] } }) })
    const url = `http://127.0.0.1:4456/projects/canvas-project/generation-canvas?canvas=${canvas.id}`
    await page.goto(url)
    const card = page.locator('[data-card-id="text"]')
    const editor = page.locator('.generation-card-editor:visible')
    const body = editor.getByRole('textbox', { name: '文本内容', exact: true })
    await card.press('Enter')
    const importer = editor.getByRole('button', { name: '导入文本', exact: true })
    await importer.waitFor({ timeout: 2000 })
    assert.equal(await importer.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'text import has no persistent filled background')
    assert.equal(await editor.getByText('支持 TXT、Markdown', { exact: true }).count(), 0, 'format hint is on demand')
    assert.equal(await editor.getByRole('button', { name: '预检运行', exact: true }).count(), 0)
    assert.equal(await body.inputValue(), sample)
    const capture = async (id, state) => {
      await page.getByRole('status', { name: '画布保存状态', exact: true }).filter({ hasText: '已保存' }).waitFor()
      await editor.getByRole('heading').click()
      await page.mouse.move(width - 4, 10)
      await page.getByRole('tooltip').waitFor({ state: 'hidden' })
      await page.screenshot({ path: join(output, `${id}-${width}-${state}-page.png`) })
      await editor.screenshot({ path: join(output, `${id}-${width}-${state}-editor.png`) })
      manifest.push({ id, width, height, state, page: `${id}-${width}-${state}-page.png`, editor: `${id}-${width}-${state}-editor.png`, card: `${id}-${width}-${state}-card.png` })
    }
    await capture('F01', 'default')
    await expandCanvasDetails(page)
    assert.equal(await body.inputValue(), sample)
    await capture('F02', 'expanded')
    await closeCanvasDetails(page)
    await card.screenshot({ path: join(output, `F01-${width}-default-card.png`) })
    await card.screenshot({ path: join(output, `F02-${width}-expanded-card.png`) })
    assert.deepEqual(await card.evaluate(node => [node.offsetWidth, node.offsetHeight]), [400, 172], 'basic text uses the compact text size')
    await card.press('Enter')
    await body.fill('')
    await editor.getByText('0 字', { exact: true }).waitFor()
    assert.ok(await body.getAttribute('placeholder'))
    await capture('F03', 'empty')
    await closeCanvasDetails(page)
    await card.getByText('未填写正文', { exact: true }).waitFor()
    await card.screenshot({ path: join(output, `F03-${width}-empty-card.png`) })
    await card.press('Enter')
    if (width === 1440) {
      await body.fill(Array.from({ length: 60 }, (_, index) => `第${index + 1}行：长正文保持独立滚动与阅读。`).join('\n'))
      await body.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
      assert.ok(await body.evaluate(element => element.scrollHeight > element.clientHeight), 'long text scrolls inside the editor')
      await expandCanvasDetails(page)
      assert.match(await body.inputValue(), /第60行/)
      await editor.screenshot({ path: join(output, 'long-expanded-editor.png') })
      await editor.getByRole('button', { name: '收起详情', exact: true }).click()
    }
    // Use the visible import action, not a hidden input as the user-facing seam.
    const chooser = page.waitForEvent('filechooser')
    await importer.click()
    await (await chooser).setFiles({ name: '创作笔记.md', mimeType: 'text/markdown', buffer: Buffer.from(sample + '\n导入后的正文。') })
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="文本内容"]')?.value === expected, sample + '\n导入后的正文。')
    await body.press('End')
    await body.pressSequentially('继续编辑。')
    const expected = sample + '\n导入后的正文。继续编辑。'
    await page.getByRole('status', { name: '画布保存状态', exact: true }).filter({ hasText: '已保存' }).waitFor()
    assert.equal((await request(`${base}/${canvas.id}`)).document.cards[0].text, expected)
    await page.reload()
    await card.press('Enter')
    assert.equal(await body.inputValue(), expected, 'HTTP saved import and edit survive reopening')
    await body.focus()
    await body.evaluate(element => { element.setSelectionRange(2, 5) })
    await expandCanvasDetails(page)
    assert.equal(await body.inputValue(), expected)
    assert.deepEqual(await body.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 5], 'expand retains selection and editor')
    await canvasDetailsToggle(editor).click()
    const observer = await context.newPage()
    await observer.goto(url)
    await observer.getByText('此画布当前只读', { exact: true }).waitFor()
    await observer.locator('[data-card-id="text"]').press('Enter')
    const readonly = observer.locator('.generation-card-editor:visible')
    assert.ok(await readonly.getByRole('button', { name: '导入文本', exact: true }).isDisabled())
    const readBody = readonly.getByRole('textbox', { name: '文本内容', exact: true })
    assert.equal(await readBody.getAttribute('readonly'), '')
    await readBody.click({ timeout: 1000 })
    await readBody.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    assert.equal(await readBody.inputValue(), expected)
    assert.equal(await readBody.evaluate(element => element.selectionEnd - element.selectionStart), expected.length)
    await readBody.pressSequentially('不能写入')
    assert.equal(await readBody.inputValue(), expected, 'readonly selection does not enable editing')
    await readonly.screenshot({ path: join(output, `readonly-${width}-editor.png`) })
    await context.close()
  }
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log('PASS C56 F01–F03 three viewports, import/edit/save/reopen, session selection and readonly:', output)
} finally { await cleanup() }
