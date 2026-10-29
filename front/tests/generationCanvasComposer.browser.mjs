import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-graph-')
const api = 'http://127.0.0.1:8275'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_composer_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8275' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4275, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '类型化画布' }) })).json()).data
  const form = new FormData()
  form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'reference.png')
  form.append('project_id', 'canvas-project'); form.append('usage_kind', 'generation_upload')
  const file = (await (await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })).json()).data
  assert.ok(file?.id)
  const sources = Array.from({ length: 10 }, (_, index) => ({ id: `s${index + 1}`, type: 'content.image', file_id: file.id }))
  const edges = sources.map(source => ({ id: `e-${source.id}`, source_card: source.id, source_port: 'image', target_card: 'm', target_port: 'image' }))
  const doc = { ...canvas.document, cards: [{ id: 'm', type: 'model.image', model_id: 'graph-image', prompt: { segments: [] }, config: {} }, ...sources,
    { id: 'other', type: 'model.image', model_id: 'graph-image', prompt: { segments: [] }, config: {} }, { id: 'empty', type: 'content.image' }], edges, input_order: { m: { image: edges.map(edge => edge.id) } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: doc }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4275/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const detail = () => page.locator('.wb-details:not([hidden])')
  const open = async id => { const summary = page.locator(`[data-card-id="${id}"]`); await summary.focus(); await summary.press('Enter'); await detail().waitFor(); await openModelInspection(page) }
  await open('m')
  const editor = detail().getByRole('textbox', { name: '模型正文', exact: true })
  await editor.waitFor()
  assert.equal(await editor.evaluate(element => {
    for (let current = element; current; current = current.parentElement) {
      const color = getComputedStyle(current).backgroundColor
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color
    }
  }), 'rgb(27, 27, 27)', 'model composer inherits workbench surface instead of the default white experiment frame')
  await editor.fill('@图片10')
  await detail().getByRole('button', { name: '@图片10', exact: true }).waitFor()
  assert.equal(await editor.locator('[data-segment]').count(), 0, 'no prefix binding while typing')
  await editor.press('Tab')
  await editor.locator('[data-segment]').first().waitFor()
  assert.equal(await editor.locator('[data-segment]').count(), 1)
  assert.equal(JSON.parse(await editor.locator('[data-segment]').getAttribute('data-segment')).source.card_id, 's10')
  // Composition never converts/intercepts, then a real boundary confirms the exact complete token.
  await editor.fill('')
  await editor.dispatchEvent('compositionstart')
  await editor.fill('@图片10')
  await editor.press('Enter')
  assert.equal(await editor.locator('[data-segment]').count(), 0)
  await editor.dispatchEvent('compositionend')
  await editor.press('Tab')
  await editor.locator('[data-segment]').first().waitFor()
  assert.equal(await editor.locator('[data-segment]').count(), 1)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const savedReference = saved.document.cards[0].prompt.segments.find(segment => segment.kind === 'reference')
  assert.equal(saved.document.cards[0].input_bindings.find(binding => binding.id === savedReference.binding_id).source.card_id, 's10')
  assert.equal(savedReference.source, undefined, 'source has one persisted authority in input bindings')
  // Reordering changes display only; the bound source stays s10.
  await detail().getByRole('button', { name: '前移输入 e-s10', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-segment]')].some(node => node.textContent === '@图片9'))
  assert.equal((await editor.locator('[data-segment]').textContent()).trim(), '@图片9')
  assert.equal(JSON.parse(await editor.locator('[data-segment]').getAttribute('data-segment')).source.card_id, 's10')
  await detail().getByRole('button', { name: '前移输入 e-s9', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-segment]')].some(node => node.textContent === '@图片10'))
  assert.equal((await editor.locator('[data-segment]').textContent()).trim(), '@图片10')
  const countBeforeAdding = await page.locator('[data-card-id]').count()
  await detail().getByRole('button', { name: '添加文本参考', exact: true }).click()
  assert.equal(await page.locator('[data-card-id]').count(), countBeforeAdding + 1, 'add creates a visible connected content card')
  const existing = detail().getByRole('combobox', { name: '连接已有卡', exact: true })
  await existing.press('ArrowDown')
  let selectedExisting = false
  for (let index = 0; index < 40; index++) {
    const active = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-active')
    if (await active.count() && (await active.innerText()).trim() === '图片内容卡 · empty → 参考图片') {
      await existing.press('Enter'); selectedExisting = true; break
    }
    await existing.press('ArrowDown')
  }
  assert.ok(selectedExisting, 'existing empty image is keyboard reachable')
  assert.equal(await page.locator('[data-card-id]').count(), countBeforeAdding + 1, 'choose existing only adds connection')
  assert.equal(await detail().getByRole('button', { name: '@图片11', exact: true }).count(), 0, 'empty connected output cannot be referenced')
  // Copy carries stable source separately from the human token label.
  const copied = await editor.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
    const clipboardData = new DataTransfer(); element.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, clipboardData })); return { structured: clipboardData.getData('application/x-jellyfish-prompt+json'), plain: clipboardData.getData('text/plain') }
  })
  assert.equal(copied.plain.trim(), '@图片10')
  await open('other')
  const other = detail().getByRole('textbox', { name: '模型正文', exact: true })
  await other.evaluate((element, payload) => {
    element.focus(); const range = document.createRange(); range.selectNodeContents(element); range.collapse(false); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
    const clipboardData = new DataTransfer(); clipboardData.setData('application/x-jellyfish-prompt+json', payload); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  }, copied.structured)
  await detail().getByRole('alert').filter({ hasText: '来源未连接' }).waitFor()
  assert.equal(JSON.parse(await other.locator('[data-segment]').getAttribute('data-segment')).source.card_id, 's10')
  await open('m')
  // Foreign structured payload remains foreign even when the target has a local token of that name.
  await editor.fill('')
  const foreign = JSON.parse(copied.structured); foreign.segments[0].source.canvas_id = 'foreign'
  await editor.evaluate((element, payload) => {
    element.focus(); const clipboardData = new DataTransfer(); clipboardData.setData('application/x-jellyfish-prompt+json', payload); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  }, JSON.stringify(foreign))
  await detail().getByRole('alert').filter({ hasText: '来源属于其他画布' }).waitFor()
  // Plain external text is confirmed against current target candidates; escapes stay literal.
  await editor.fill('')
  await editor.evaluate(element => {
    element.focus(); const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '@图片10 '); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  })
  assert.equal(JSON.parse(await editor.locator('[data-segment]').getAttribute('data-segment')).source.card_id, 's10')
  // Insert/paste inside existing text must preserve both surrounding text and stable reference.
  await editor.fill('前缀 后缀')
  await editor.evaluate(element => {
    const range = document.createRange(); range.setStart(document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode(), 3); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range)
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', '@图片10 '); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  })
  assert.equal(await editor.textContent(), '前缀 @图片10 后缀')
  assert.equal(JSON.parse(await editor.locator('[data-segment]').getAttribute('data-segment')).source.card_id, 's10')
  // Inline chooser is opened by @ and confirms a selected real output.
  await detail().getByRole('combobox', { name: '引用分类', exact: true }).locator('..').locator('..').click()
  const categoryDropdown = await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').elementHandle()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('图片', { exact: true }).click()
  // rc-select restores focus after an option click; finish closing that popup
  // before typing, so its delayed focus does not blur the new @ chooser.
  await categoryDropdown.waitForElementState('hidden')
  await editor.fill('@')
  await detail().getByRole('listbox', { name: '引用候选' }).waitFor()
  await editor.press('Enter')
  await editor.locator('[data-segment]').first().waitFor()
  assert.equal(await editor.locator('[data-segment]').count(), 1)
  await editor.fill('前缀 ')
  await editor.pressSequentially('@图片')
  await detail().getByRole('listbox', { name: '引用候选' }).getByRole('option', { name: '@图片10', exact: true }).click()
  assert.equal(await editor.textContent(), '前缀 @图片10', 'picker replaces the complete typed query without a dangling @')
  await editor.locator('[data-segment]').first().waitFor()
  assert.equal(await editor.locator('[data-segment]').count(), 1)
  assert.equal(JSON.parse(await editor.locator('[data-segment]').getAttribute('data-segment')).source.card_id, 's10')
  // Canonical instruction fragments retain their nested source identities on paste.
  const instruction = { canvas_id: canvas.id, segments: [{ id: 'instruction', kind: 'instruction', command: '首帧参考', parameters: {}, references: [{ id: 'inside', kind: 'reference', source: { canvas_id: 'foreign-instruction', card_id: 'same-name', port_id: 'image', position: 0 } }] }] }
  await editor.fill('')
  await editor.evaluate((element, payload) => {
    element.focus(); const clipboardData = new DataTransfer(); clipboardData.setData('application/x-jellyfish-prompt+json', payload); element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }))
  }, JSON.stringify(instruction))
  assert.equal(JSON.parse(await editor.locator('[data-segment]').getAttribute('data-segment')).references[0].source.canvas_id, 'foreign-instruction')
  // Native multiline editing persists exact line boundaries through save/reopen.
  await editor.fill('第一行')
  await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('second line')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.cards[0].prompt.segments.map(segment => segment.text || '').join(''), '第一行\nsecond line')
  await page.reload(); await open('m'); await editor.waitFor()
  assert.equal(await editor.textContent(), '第一行\nsecond line')
  await editor.fill(String.raw`\@图片10 \/首帧参考`)
  await editor.press('Tab')
  assert.equal(await editor.locator('[data-segment]').count(), 0, 'escaped reserved words stay literal')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const escaped = (await (await fetch(`${base}/${canvas.id}/cards/m/compile`)).json()).data
  assert.equal(escaped.text, '@图片10 /首帧参考')
  // Re-establish a reference for the final guarded disconnect check.
  await editor.fill('@图片10 '); await editor.press('Tab')
  await detail().getByRole('button', { name: '断开连接 e-s10', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '请先取消引用' }).waitFor()
  await editor.fill('清理后只保留普通文字')
  await detail().getByRole('button', { name: '断开连接 e-s10', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.ok(!saved.document.edges.some(edge => edge.id === 'e-s10'))
  assert.equal(saved.document.cards[0].prompt.segments[0].text, '清理后只保留普通文字')
  // New protocol tracer: explicitly import creative basis, save, adopt and reopen.
  const basisDocument = { ...saved.document, cards: [
    { id: 'basis', type: 'content.basis', text: '' },
    { id: 'text-model', type: 'model.text', model_id: 'graph-text', prompt: { segments: [] } },
  ], groups: [], edges: [{ id: 'basis-edge', source_card: 'basis', source_port: 'text', target_card: 'text-model', target_port: 'text' }],
  input_order: { 'text-model': { text: ['basis-edge'] } } }
  const basisSaved = await fetch(base + '/' + canvas.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'basis-tracer', expected_revision: saved.revision, document: basisDocument }) })
  assert.ok(basisSaved.ok, await basisSaved.text())
  await page.reload()
  await open('basis')
  const basis = detail()
  await basis.getByLabel('导入文本文件', { exact: true }).setInputFiles({ name: '剧本.txt', mimeType: 'text/plain', buffer: Buffer.from('张三望向门口。') })
  await page.waitForFunction(() => document.querySelector('[aria-label="创作依据正文"]')?.value === '张三望向门口。')
  assert.equal(await basis.getByRole('textbox', { name: '依据来源定位', exact: true }).inputValue(), '剧本.txt')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await open('text-model')
  const textModel = detail()
  await textModel.getByRole('button', { name: '@文本1', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const basisCompiled = (await (await fetch(base + '/' + canvas.id + '/cards/text-model/compile')).json()).data
  assert.equal(basisCompiled.text, '张三望向门口。 ')
  await page.reload()
  await open('basis')
  await detail().getByRole('textbox', { name: '创作依据正文', exact: true }).waitFor()
  assert.equal(await detail().getByRole('textbox', { name: '创作依据正文', exact: true }).inputValue(), '张三望向门口。')
  await open('text-model')
  await detail().getByRole('button', { name: '@文本1', exact: true }).waitFor()
  assert.equal(await detail().getByRole('textbox', { name: '模型正文', exact: true }).textContent(), '@文本1 ')
  await page.screenshot({ path: join(output, 'composer.png'), fullPage: true })
  console.log(`composer passed: ${output}`)
} finally { await cleanup() }
