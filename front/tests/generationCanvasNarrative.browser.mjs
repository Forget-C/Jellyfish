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
const output = await browserOutput('jellyfish-generation-canvas-narrative-')
const api = 'http://127.0.0.1:8293', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8293' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4293, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data

  const document = { ...canvas.document, cards: [
    { id: 'brief', type: 'content.text', text: '引用文本依据' },
    { id: 'event', type: 'direction.event', event_id: 'bell', name: '钟响', action_change: { state: 'fact', text: '秘密事件正文' } },
    { id: 'beat', type: 'direction.beat', beat_id: 'decision', name: '决定' },
    { id: 'beat2', type: 'direction.beat', beat_id: 'escape', name: '逃离' },
    { id: 'overview', type: 'direction.narrative', name: '概览' },
    { id: 'shot', type: 'direction.shot', shot_id: 'reaction', name: '反应镜头' },
    { id: 'performance', type: 'direction.performance' },
    { id: 'photo', type: 'direction.camera', fields: { viewpoint: { state: 'proposal', text: '人物居右' } } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model' }],
    edges: [
      ...['overview', 'beat', 'event', 'shot'].map(id => ({ id: 'brief-' + id, source_card: 'brief', source_port: 'text', target_card: id, target_port: 'text' })),
      { id: 'event', source_card: 'event', source_port: 'event', target_card: 'shot', target_port: 'related_event' },
      { id: 'beat', source_card: 'beat', source_port: 'beat', target_card: 'shot', target_port: 'covered_beat' },
      { id: 'beat2', source_card: 'beat2', source_port: 'beat', target_card: 'shot', target_port: 'covered_beat' },
      { id: 'received', source_card: 'event', source_port: 'event', target_card: 'performance', target_port: 'received_event' },
      { id: 'photo', source_card: 'shot', source_port: 'shot', target_card: 'photo', target_port: 'shot' },
      { id: 'design', source_card: 'shot', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { overview: { text: ['brief-overview'] }, beat: { text: ['brief-beat'] }, event: { text: ['brief-event'] }, photo: { shot: ['photo'] }, shot: { text: ['brief-shot'], related_event: ['event'], covered_beat: ['beat', 'beat2'] }, performance: { received_event: ['received'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4293/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => { await openCanvasCard(page, id); const advanced = card.getByRole('button', { name: '高级设置', exact: true }); if (await advanced.count()) await advanced.click(); const relations = card.locator('summary').filter({ hasText: /^叙事关系/ }); if (await relations.count()) await relations.click() }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  for (const [id, preset, label, key] of [['overview', '信息逐步揭示', '观察视点', 'viewpoint'], ['beat', '目标受阻', '行动目标', 'objective'], ['event', '外部刺激', '动作或变化说明', 'action_change'], ['shot', '反应揭示', '可见结果', 'visible_result']]) {
    await open(id)
    await card.getByRole('button', { name: '返回预设', exact: true }).click()
    await card.getByRole('button', { name: '预览 ' + preset, exact: true }).click()
    await card.getByRole('button', { name: '应用', exact: true }).click()
    await poll(state => state.document.cards.find(item => item.id === id)[key]?.text)
    await page.keyboard.press('Escape')
    await open(id)
    await card.getByRole('button', { name: '返回预设', exact: true }).click()
    assert.equal(await card.getByRole('button', { name: '预览 ' + preset, exact: true }).getAttribute('aria-pressed'), 'true')
    await card.getByRole('button', { name: '高级设置', exact: true }).click()
    const field = card.getByRole('textbox', { name: label + '内容', exact: true })
    await field.fill(''); await field.press('@')
    await page.getByRole('option', { name: '@文本1', exact: true }).click()
    await poll(state => state.document.cards.find(item => item.id === id)[key]?.document?.segments?.some(segment => segment.kind === 'reference'))
  }
  await open('overview')
  await card.getByRole('textbox', { name: '观察视点内容', exact: true }).fill('小雪观察')
  await card.getByRole('textbox', { name: '待确定问题内容', exact: true }).fill('是否离开')
  await poll(state => state.document.cards.find(item => item.id === 'overview').open_questions?.text === '是否离开')
  await open('beat')
  await card.getByRole('textbox', { name: '行动目标内容', exact: true }).fill('拿到钥匙')
  await card.getByRole('textbox', { name: '预期变化内容', exact: true }).fill('获得主动')
  await poll(state => state.document.cards.find(item => item.id === 'beat').expected_change?.text === '获得主动')
  await open('shot')
  await card.getByRole('button', { name: '选择覆盖节拍 决定', exact: true }).click()
  await card.getByRole('button', { name: '选择覆盖节拍 逃离', exact: true }).click()
  await card.getByRole('button', { name: '上移覆盖节拍 逃离', exact: true }).click()
  await card.getByLabel('覆盖节拍 逃离',{exact:true}).press('Control+Shift+ArrowDown')
  await poll(state => state.document.cards.find(item => item.id === 'shot').input_bindings?.filter(binding => binding.input_port === 'covered_beat')[0]?.source.object_id === 'decision')
  await card.getByLabel('覆盖节拍 逃离',{exact:true}).press('Control+Shift+ArrowUp')
  await poll(state => state.document.cards.find(item => item.id === 'shot').input_bindings?.filter(binding => binding.input_port === 'covered_beat')[0]?.source.object_id === 'escape')
  await card.getByRole('button', { name: '选择关联事件 钟响', exact: true }).click()
  await card.getByRole('textbox', { name: '可见结果内容', exact: true }).fill('看向门口')
  await card.getByRole('textbox', { name: '预计时长内容', exact: true }).fill('约五秒，尚未拍摄')
  await poll(state => state.document.cards.find(item => item.id === 'shot').estimated_duration?.text === '约五秒，尚未拍摄')
  await page.screenshot({ path: join(output, 'narrative-desktop.png'), fullPage: true })
  await open('performance')
  await card.getByRole('button', { name: '选择接收事件 钟响', exact: true }).click()
  await card.getByRole('textbox', { name: '身体动作内容', exact: true }).fill('抬头')
  await poll(state => state.document.cards.find(item => item.id === 'performance').input_bindings?.length === 1)
  await open('photo')
  await card.getByRole('button', { name: '选择所属镜头 反应镜头', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'photo').input_bindings?.length === 1)
  const photoOutput = (await (await fetch(`${base}/${canvas.id}/cards/photo/outputs`)).json()).data.outputs[0]
  assert.match(photoOutput.text, /所属镜头：反应镜头/)
  assert.doesNotMatch(photoOutput.text, /看向门口|约五秒|秘密事件正文/)
  await open('consumer')
  await card.getByRole('button', { name: '解除关联 @文本1', exact: true }).waitFor()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  await card.getByRole('combobox', { name: '画面目标 @文本1', exact: true }).click()
  await card.getByRole('combobox', { name: '画面目标 @文本1', exact: true }).press('ArrowDown')
  await card.getByRole('combobox', { name: '画面目标 @文本1', exact: true }).press('Enter')
  await poll(state => state.document.cards.find(item => item.id === 'consumer').frame_targets?.[0]?.state_id === 'field:visible_result')
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.match(compiled.text, /看向门口/)
  assert.match(compiled.text, /约五秒，尚未拍摄/)
  assert.doesNotMatch(compiled.text, /秘密事件正文/)
  assert.match(compiled.text, /设计卡：event/)
  assert.equal(compiled.text.match(/引用文本依据/g)?.length, 1)
  assert.match(compiled.text, /拿到钥匙/)
  assert.match(compiled.text, /获得主动/)
  await page.reload()
  await open('shot')
  assert.equal(await card.getByRole('textbox', { name: '可见结果内容', exact: true }).innerText(), '看向门口')
  await card.getByRole('button', { name: '取消覆盖节拍 决定', exact: true }).waitFor()
  const reopened = await read()
  assert.deepEqual(reopened.document.cards.find(item => item.id === 'shot').input_bindings.filter(binding => binding.input_port === 'covered_beat').map(binding => binding.source.object_id), ['escape', 'decision'])
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'narrative-mobile.png'), fullPage: true })
  await card.getByRole('button', { name: '关闭详情', exact: true }).click()
  const observer = await page.context().newPage()
  await observer.setViewportSize({ width: 1440, height: 960 })
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  const revision = (await read()).revision
  for (const [id, label] of [['overview', '观察视点'], ['beat', '行动目标'], ['event', '动作或变化说明'], ['shot', '可见结果']]) {
    await observer.locator(`[data-card-id="${id}"]`).press('Enter')
    const readonly = observer.locator('.wb-details:not([hidden])')
    await readonly.getByRole('button', { name: '高级设置', exact: true }).click()
    assert.equal(await readonly.getByRole('textbox', { name: label + '内容', exact: true }).isDisabled(), true)
    assert.equal(await readonly.getByRole('button', { name: '编辑' + { overview: '叙事名称', beat: '节拍名称', event: '事件名称', shot: '镜头名称' }[id], exact: true }).count(), 0)
    await readonly.getByRole('button', { name: '关闭详情', exact: true }).click()
  }
  assert.equal((await read()).revision, revision)
  await observer.close()
  console.log('Narrative browser passed; evidence:', output)
} finally { await cleanup() }
