import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-design-metadata-audit-')
const api = 'http://127.0.0.1:8691', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8691' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4691, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '全部设计卡元信息验收' }) })).json()).data
  const definitions = (await (await fetch(`${base}/${canvas.id}/catalog`)).json()).data.cards.filter(card => card.type.startsWith('direction.'))
  assert.equal(definitions.length, 25)
  const visual = new Set(['style', 'composition', 'camera', 'movement', 'lighting', 'focus'])
  const document = { ...canvas.document, cards: definitions.map(definition => {
    const id = definition.type.slice('direction.'.length)
    const fields = Object.fromEntries(definition.fields.map((field, index) => [field.id, index === 0 ? { text: '模型提取的设计参数', state: 'proposal', purpose: 'background', source_locator: '模型提取定位', authorship: 'model' } : { text: '自行填写的设计参数', state: 'fact', purpose: 'design', authorship: 'user' }]))
    return { id, type: definition.type, source_locator: '卡片原始定位', ...(id === 'dialogue' ? { dialogue_id: 'audit-dialogue' } : {}), ...(visual.has(id) ? { fields } : fields) }
  }) }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 100; i++) { const state = await read(); if (predicate(state)) return state; await delay(100) } throw Error('design metadata save timeout') }
  await page.goto(`http://127.0.0.1:4691/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const savedCard = async id => (await read()).document.cards.find(card => card.id === id)
  const valueOf = (card, key) => visual.has(card.id) ? card.fields[key] : card[key]
  const assertFields = async (detail, saved) => {
    const definition = definitions.find(item => item.type === saved.type)
    for (const field of definition.fields) {
      const text = await detail.getByRole('textbox', { name: field.label + '内容', exact: true }).innerText()
      assert.equal(text.trim(), valueOf(saved, field.id).text.trim(), `${definition.title}: reopened ${field.label} matches saved content`)
    }
  }
  const reopen = async id => {
    await closeCanvasDetails(page)
    const detail = await openCanvasCard(page, id)
    const advanced = detail.getByRole('button', { name: '高级设置', exact: true })
    if (await advanced.count()) await advanced.click()
    await detail.getByText('卡片原始来源：卡片原始定位', { exact: true }).waitFor()
    await assertFields(detail, await savedCard(id))
    return detail
  }
  const userMetadataHidden = async (detail, title) => assert.equal(await detail.locator('[data-design-field] .design-field-metadata').count(), 0, title)
  for (const definition of definitions) {
    const id = definition.type.slice('direction.'.length)
    const node = page.locator(`[data-card-id="${id}"]`)
    await node.getByRole('button', { name: '编辑设计', exact: true }).waitFor({ state: 'attached' })
    for (const text of await node.locator('dd').allTextContents()) assert.doesNotMatch(text, /^(事实|设计|背景|约束)[：·]/, `${definition.title}: user card summary omits default metadata`)
    const original = await savedCard(id)
    const detail = await reopen(id)
    await detail.getByText('提议 · 背景 · 来源：模型提取定位', { exact: true }).waitFor()
    assert.equal(await detail.getByRole('switch', { name: '显示状态与来源', exact: true, includeHidden: true }).count(), 0, definition.title)
    for (const field of definition.fields) {
      assert.equal(await detail.getByRole('combobox', { name: field.label + '状态', exact: true }).count(), 0)
      assert.equal(await detail.getByRole('combobox', { name: field.label + '用途', exact: true }).count(), 0)
      assert.equal(await detail.getByRole('textbox', { name: field.label + '来源', exact: true }).count(), 0)
    }
    const first = definition.fields[0]
    await detail.getByRole('textbox', { name: first.label + '内容', exact: true }).fill('实际编辑后的设计参数')
    await poll(state => {
      const saved = state.document.cards.find(card => card.id === id)
      const value = visual.has(id) ? saved.fields[first.id] : saved[first.id]
      return value.text === '实际编辑后的设计参数' && value.authorship === 'user'
    })
    const authored = await savedCard(id)
    const field = valueOf(authored, first.id)
    assert.equal(field.state, 'fact')
    assert.equal(field.purpose, 'design')
    assert.equal(field.source_locator, '')
    assert.equal(field.metadata_fields, undefined)
    await reopen(id)
    await userMetadataHidden(detail, `${definition.title}: saved manual content has no default metadata`)
    await detail.getByRole('button', { name: '撤销', exact: true }).click()
    await poll(state => JSON.stringify(state.document.cards.find(card => card.id === id)) === JSON.stringify(original))
    await reopen(id)
    await detail.getByText('提议 · 背景 · 来源：模型提取定位', { exact: true }).waitFor()
    await closeCanvasDetails(page)
    await page.getByRole('button', { name: '重做操作', exact: true }).click()
    await poll(state => JSON.stringify(state.document.cards.find(card => card.id === id)) === JSON.stringify(authored))
    await reopen(id)
    await userMetadataHidden(detail, `${definition.title}: redo preserves user authorship`)
    await detail.getByRole('textbox', { name: first.label + '内容', exact: true }).fill('')
    await poll(state => valueOf(state.document.cards.find(card => card.id === id), first.id).state === 'empty')
    const empty = valueOf(await savedCard(id), first.id)
    assert.equal(empty.source_locator, '')
    assert.equal(empty.metadata_fields, undefined)
    await reopen(id)
    await userMetadataHidden(detail, `${definition.title}: cleared content stays empty after reopening`)
    await detail.getByRole('button', { name: '撤销', exact: true }).click()
    await poll(state => JSON.stringify(state.document.cards.find(card => card.id === id)) === JSON.stringify(authored))
    await assertFields(detail, authored)
    await userMetadataHidden(detail, `${definition.title}: undo clear restores user settings`)
    const back = detail.getByRole('button', { name: '返回预设', exact: true })
    if (await back.count()) {
      await back.click()
      await detail.getByRole('button', { name: /^预览 / }).first().click()
      await detail.getByRole('button', { name: '应用', exact: true }).click()
      await poll(state => {
        const saved = state.document.cards.find(card => card.id === id)
        return definition.fields.some(field => {
          const value = visual.has(id) ? saved.fields[field.id] : saved[field.id]
          return !['实际编辑后的设计参数', '自行填写的设计参数'].includes(value.text) && value.authorship === 'user'
        })
      })
      const presetCard = await savedCard(id)
      await reopen(id)
      await userMetadataHidden(detail, `${definition.title}: saved preset content has no default metadata`)
      for (const entry of definition.fields) {
        const value = valueOf(presetCard, entry.id)
        assert.equal(value.authorship, 'user')
        assert.equal(value.state, 'fact')
        assert.equal(value.purpose, 'design')
        assert.equal(value.source_locator, '')
        assert.equal(value.metadata_fields, undefined)
      }
      await detail.getByRole('button', { name: '撤销', exact: true }).click()
      await poll(state => JSON.stringify(state.document.cards.find(card => card.id === id)) === JSON.stringify(authored))
      await assertFields(detail, authored)
      await userMetadataHidden(detail, `${definition.title}: undo preset restores the complete previous fields`)
    }
    await closeCanvasDetails(page)
    for (const text of await node.locator('dd').allTextContents()) assert.doesNotMatch(text, /^(事实|设计|背景|约束)[：·]/, `${definition.title}: preset and edited summaries omit default metadata`)
    console.log('PASS lifecycle', definition.type)
  }
  const beforeReload = (await read()).document
  await page.reload()
  for (const definition of definitions) {
    const id = definition.type.slice('direction.'.length)
    const detail = await reopen(id)
    await userMetadataHidden(detail, `${definition.title}: reload does not reintroduce default metadata`)
    assert.deepEqual(await savedCard(id), beforeReload.cards.find(card => card.id === id))
    await closeCanvasDetails(page)
    for (const text of await page.locator(`[data-card-id="${id}"] dd`).allTextContents()) assert.doesNotMatch(text, /^(事实|设计|背景|约束)[：·]/)
  }
  await page.screenshot({ path: join(output, 'all-design-metadata-desktop.png'), fullPage: true })
  console.log('PASS all 25 design types: save/reopen, reload, undo/redo, clear, presets and extraction metadata')
} finally { await cleanup() }
