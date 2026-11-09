import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-scene-canvas-')
const api = 'http://127.0.0.1:8259', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'scene-canvas-chapter', excerpt = '🌱门打开，灯亮了。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8259' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(`${studio}/generation-canvases/${project}`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '庭院', raw_text: excerpt })
  const sequence = await request(`${studio}/projects/${project}/directing/chapters/${chapter}/sequences`, 'POST', {
    title: '推开门', position: 0, source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length },
  })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4259, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(9000)
  const prep = `http://127.0.0.1:4259/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  await page.goto(prep)
  await page.getByRole('heading', { name: '推开门' }).waitFor()
  const create = page.getByRole('button', { name: '新建空白画布', exact: true })
  await create.focus()
  await page.keyboard.press('Enter')
  const modal = page.getByRole('dialog', { name: '新建空白画布' })
  const input = modal.getByRole('textbox', { name: '画布名称' })
  assert.match(await input.inputValue(), /^分镜画布-\d{8}-\d{6}$/)
  await input.fill('第一套方案')
  await modal.getByRole('button', { name: '创建画布', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const id = new URL(page.url()).searchParams.get('canvas')
  assert.ok(id)
  const base = `${studio}/generation-canvases/${project}`, read = () => request(`${base}/${id}`)
  const source = (await read()).document.cards[0]
  assert.equal(source.text, excerpt)
  const card = page.locator(`[data-card-id="${source.id}"]`)
  await card.press('Enter')
  const body = page.getByRole('textbox', { name: '创作依据正文' })
  assert.equal(await body.inputValue(), excerpt)
  assert.equal(await body.getAttribute('aria-readonly'), 'true')
  assert.equal(await page.getByRole('button', { name: '导入文本', exact: true }).count(), 0)
  await closeCanvasDetails(page)
  await page.getByRole('textbox', { name: '画布名称', exact: true }).fill('改名后方案')
  await page.getByRole('button', { name: '返回场次准备', exact: true }).click()
  await page.getByRole('button', { name: '改名后方案', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('selected'), id)
  assert.equal((await read()).document.name, '改名后方案')

  const beforeBatch = await read()
  await request(`${base}/${id}`, 'PUT', { request_id: 'prepare-batch', expected_revision: beforeBatch.revision,
    document: { ...beforeBatch.document, cards: [...beforeBatch.document.cards, { id: 'ordinary-note', type: 'content.text', text: '备注' }] } })
  await page.goto(`http://127.0.0.1:4259/projects/${project}/generation-canvas?canvas=${id}`)
  await card.press('Enter')
  assert.equal(await body.inputValue(), excerpt)
  assert.equal(await body.getAttribute('aria-readonly'), 'true')
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const modifier = await page.evaluate(() => navigator.platform.includes('Mac') ? 'Meta' : 'Control')
  await card.focus()
  await page.keyboard.press('Escape')
  const ordinary = page.locator('[data-card-id="ordinary-note"]')
  for (const item of [card, ordinary]) await item.click({ modifiers: [modifier], position: { x: 50, y: 20 } })
  await card.focus()
  await page.keyboard.press('Delete')
  await page.getByText('固定原文不可删除', { exact: true }).waitFor()
  assert.deepEqual((await read()).document.cards.map(item => item.id), [source.id, 'ordinary-note'])

  await request(`${studio}/chapters/${chapter}`, 'PATCH', { raw_text: '灯没有亮。' })
  await page.reload()
  await page.getByText('章节原文已变化，画布仍保留创建时的原文依据。', { exact: true }).waitFor()
  const canonical = await read()
  await page.evaluate(({ project, id, canonical }) => {
    const draft = structuredClone(canonical.document)
    draft.cards[0].text = '损坏的恢复依据'
    localStorage.setItem(`jellyfish:generation:${project}:${id}:recovery`, JSON.stringify({ schema: 1, baseline: canonical, document: draft }))
  }, { project, id, canonical })
  await page.reload()
  await page.getByRole('button', { name: '恢复本地内容', exact: true }).click()
  await page.getByText('本地内容的固定原文与服务器不同，请先核对后使用服务器内容', { exact: true }).waitFor()
  assert.deepEqual(await read(), canonical)
  await page.getByRole('button', { name: '使用服务器内容', exact: true }).click()
  await page.goto(`${prep}?selected=${id}`)
  await page.getByRole('button', { name: '改名后方案', exact: true }).waitFor()
  assert.equal(await page.locator('.scene-canvas-preparation .app-page-toolbar').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(27, 27, 27)')
  await page.screenshot({ path: join(output, 'prep-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'prep-mobile.png'), animations: 'disabled' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await create.click()
  assert.match(await input.inputValue(), /^分镜画布-\d{8}-\d{6}$/)
  await modal.waitFor()
  await modal.screenshot({ path: join(output, 'create-mobile.png'), animations: 'disabled' })
  await modal.getByRole('button', { name: '创建画布', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const second = new URL(page.url()).searchParams.get('canvas')
  assert.ok(second && second !== id)
  assert.equal((await request(`${base}/${second}`)).document.cards[0].text, excerpt)
  assert.equal((await read()).document.name, '改名后方案')
  process.stdout.write(JSON.stringify({ output, passed: true }) + '\n')
} finally { await cleanup() }
