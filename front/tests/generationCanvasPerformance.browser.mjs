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
const output = await browserOutput('jellyfish-generation-canvas-performance-')
const api = 'http://127.0.0.1:8285', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8285' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4285, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data
  const extractionLocator = '第三章第2段'.repeat(20)
  const document = { ...canvas.document, cards: [
    { id: 'ref', type: 'reference.character', objects: [{ object_id: 'alice', name: '小雪', category: 'character' }] },
    { id: 'act', type: 'direction.performance', source_locator: '原文第三章', physical_action: { text: '旧动作', state: 'not_applicable', purpose: 'background', source_locator: extractionLocator, authorship: 'model' }, voice: { state: 'absent', authorship: 'model' }, hands: { authorship: 'model' }, breath: { text: '历史呼吸', state: 'proposal', source_locator: '旧记录' } },
    { id: 'situation', type: 'direction.situation', input_bindings: [{ id: 'old-object', input_port: 'effect_object', source: { canvas_id: canvas.id, card_id: 'ref', port_id: 'object', position: 0, object_id: 'alice' } }] },
    { id: 'rule', type: 'direction.performance_rule' },
    { id: 'activity', type: 'direction.activity', task: { text: '持续整理' } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } }],
    edges: [
      { id: 'old-object', source_card: 'ref', source_port: 'object', target_card: 'situation', target_port: 'effect_object' },
      { id: 'person', source_card: 'ref', source_port: 'object', target_card: 'act', target_port: 'participant' },
      { id: 'design', source_card: 'act', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { act: { participant: ['person'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4285/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async (id, advanced = true) => {
    await openCanvasCard(page, id)
    if (advanced && await card.getByRole('button', { name: '高级设置', exact: true }).count()) await card.getByRole('button', { name: '高级设置', exact: true }).click()
  }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('situation', false)
  assert.equal(await card.getByRole('button', { name: /作用对象/ }).count(), 0)
  assert.equal((await read()).document.cards.find(item => item.id === 'situation').input_bindings.length, 0)
  assert.equal(await card.getByRole('switch', { name: '显示状态与来源', exact: true, includeHidden: true }).count(), 0)
  assert.equal(await card.getByRole('button', { name: '应用', exact: true }).isDisabled(), true)
  await card.getByRole('button', { name: '预览 等待回应', exact: true }).click()
  assert.equal((await read()).document.cards.find(item => item.id === 'situation').situation.text, '')
  await card.getByRole('button', { name: '应用', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'situation').situation.text.includes('等待对方回应'))
  assert.equal((await read()).document.cards.find(item => item.id === 'situation').situation.authorship, 'user')
  await card.getByRole('button', { name: '关闭详情', exact: true }).click()
  await open('situation', false)
  assert.equal(await card.getByRole('button', { name: '预览 等待回应', exact: true }).getAttribute('aria-pressed'), 'true')
  await card.getByRole('button', { name: '高级设置', exact: true }).click()
  await card.getByRole('textbox', { name: '当前处境内容', exact: true }).fill('门前等候')
  await poll(state => state.document.cards.find(item => item.id === 'situation').situation?.text === '门前等候')
  await open('rule')
  await card.getByRole('textbox', { name: '表演适用说明内容', exact: true }).fill('克制表达')
  await poll(state => state.document.cards.find(item => item.id === 'rule').applicability?.text === '克制表达')
  await card.getByRole('textbox', { name: '表演适用说明内容', exact: true }).fill('')
  await poll(state => state.document.cards.find(item => item.id === 'rule').applicability?.state === 'empty')
  await open('act')
  assert.equal(await card.getByRole('button', { name: /作用对象/ }).count(), 0)
  assert.equal(await card.getByRole('switch', { name: '显示状态与来源', exact: true }).count(), 0)
  await card.getByText(`不适用 · 不参与生成 · 背景 · 来源：${extractionLocator}`, { exact: true }).waitFor()
  assert.equal(await card.getByRole('region', { name: '手部', exact: true }).locator('.design-field-metadata').count(), 0)
  await card.getByRole('region', { name: '声音表现', exact: true }).getByText('明确没有', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'extracted-metadata-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const metadata = card.getByRole('region', { name: '身体动作', exact: true }).locator('.design-field-metadata')
  await metadata.scrollIntoViewIfNeeded()
  assert.equal(await metadata.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'long source wraps inside a narrow field')
  await page.screenshot({ path: join(output, 'extracted-metadata-mobile.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await card.getByText('卡片原始来源：原文第三章', { exact: true }).waitFor()
  assert.equal(await card.getByRole('textbox', { name: '设计来源', exact: true }).count(), 0)
  const original = await read()
  await card.getByRole('textbox', { name: '身体动作内容', exact: true }).focus()
  await card.getByRole('textbox', { name: '身体动作内容', exact: true }).blur()
  assert.equal((await read()).revision, original.revision, 'focus does not replace extraction metadata')
  assert.equal((await read()).document.cards.find(item => item.id === 'act').physical_action.authorship, 'model')
  await card.getByRole('button', { name: '选择参与对象 小雪', exact: true }).click()
  await card.getByRole('textbox', { name: '身体动作内容', exact: true }).fill('缓慢伸手')
  await poll(state => state.document.cards.find(item => item.id === 'act').physical_action?.authorship === 'user')
  assert.equal(await card.getByText(/第三章第2段/).count(), 0)
  await card.getByText('提议 · 来源：旧记录', { exact: true }).waitFor()
  const outputData = (await (await fetch(`${base}/${canvas.id}/cards/act/outputs`)).json()).data
  assert.equal(outputData.outputs[0].payload.adoption, 'whole_card')
  await card.getByRole('textbox', { name: '结束状态内容', exact: true }).fill('掌心朝上')
  await poll(state => state.document.cards.find(item => item.id === 'act').exit_state?.text === '掌心朝上')
  assert.equal(await card.getByRole('switch', { name: '显示状态与来源', exact: true }).count(), 0)
  assert.equal(await card.getByRole('combobox', { name: '声音表现状态', exact: true }).count(), 0)
  await card.getByRole('textbox', { name: '声音表现内容', exact: true }).fill('明确没有声音表现')
  await poll(state => state.document.cards.find(item => item.id === 'act').voice?.authorship === 'user')
  const authored = (await read()).document.cards.find(item => item.id === 'act').voice
  assert.equal(authored.state, 'fact')
  assert.equal(authored.purpose, 'design')
  assert.equal(authored.source_locator, '')

  await page.screenshot({ path: join(output, 'performance-desktop.png'), fullPage: true })
  await open('consumer')
  await card.getByRole('button', { name: '解除关联 @文本1', exact: true }).waitFor()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.waitFor()
  assert.match(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), /缓慢伸手/)
  assert.match(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), /掌心朝上/)
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  await page.reload()
  await open('act')
  assert.equal(await card.getByRole('textbox', { name: '身体动作内容', exact: true }).innerText(), '缓慢伸手')
  assert.equal(await card.getByRole('button', { name: /^取消关系 [0-9a-f]/ }).count(), 0, 'valid relationship has one named cancel action')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'narrow editor has no horizontal overflow')
  await page.screenshot({ path: join(output, 'performance-mobile.png'), fullPage: true })
  await open('activity')
  assert.equal(await card.getByRole('button', { name: /作用对象/ }).count(), 0)
  await card.getByRole('textbox', { name: '持续任务内容', exact: true }).fill('持续整理并看向门口')
  await poll(state => state.document.cards.find(item => item.id === 'activity').task?.text === '持续整理并看向门口')
  await card.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'activity').task?.text === '持续整理')
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'activity').task?.text === '持续整理并看向门口')
  assert.equal((await read()).document.cards.some(item => item.input_bindings?.some(binding => binding.input_port === 'effect_object' && ['direction.situation', 'direction.performance', 'direction.activity'].includes(item.type))), false)
  await page.reload()
  await open('activity')
  assert.equal(await card.getByRole('textbox', { name: '持续任务内容', exact: true }).innerText(), '持续整理并看向门口')
  console.log('Performance browser passed; evidence:', output)
} finally { await cleanup() }
