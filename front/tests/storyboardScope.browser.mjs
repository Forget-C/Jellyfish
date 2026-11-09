import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-scope-')
const api = 'http://127.0.0.1:8319', studio = `${api}/api/v1/studio`, origin = 'http://127.0.0.1:4319'
const project = 'canvas-project', chapter = 'storyboard-scope-chapter'
const excerpt = '林舟在码头打开铜匣。林舟向匣内伸手。巡灯照亮纸面，林舟举起海图。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_SCOPE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'),
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8319' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '码头', raw_text: excerpt })
  const sequences = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(sequences, 'POST', { title: '打开铜匣', position: 0,
    source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4319, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(20000)
  const prep = `${origin}/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  await page.goto(prep)
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  const object = page.getByRole('region', { name: '林舟 · 林舟在码头', exact: true })
  await object.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await object.getByRole('combobox', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await object.getByText('已选参考图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成分镜', exact: true }).click()
  const config = page.getByRole('dialog', { name: '生成分镜' })
  await config.getByRole('combobox', { name: '生产模型' }).click()
  await page.getByText('viduq2', { exact: true }).click()
  await config.getByRole('button', { name: '开始提取', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const id = new URL(page.url()).searchParams.get('canvas')
  const path = `${studio}/generation-canvases/${project}/${id}`
  const poll = async predicate => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const state = await request(path)
      if (predicate(state)) return state.document
      await delay(100)
    }
    throw new Error('canvas state not saved')
  }
  const document = await poll(state => !!state.document.storyboard)
  const story = document.storyboard
  const [first, second] = story.shots
  const { description_card_id: shared } = story.objects.find(row => row.origin === 'prepared')
  assert.equal(document.cards.filter(row => row.id === shared).length, 1)
  assert.equal(first.object_ids[0], second.object_ids[0])
  assert.equal(first.model_card_ids.length, 1)
  assert.deepEqual(second.segments.map(row => row.occurrence_id), ['take-out', 'lift'])
  const names = ['原文与共享对象', '镜头 01', '镜头 02']
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const groupTops = []
  for (const name of names) {
    const title = page.getByRole('button', { name: '选择编组 ' + name, exact: true })
    await title.waitFor()
    groupTops.push(await title.evaluate(element => Number.parseFloat(element.closest('[data-group-id]').style.top)))
  }
  assert.ok(groupTops[0] < groupTops[1] && groupTops[1] < groupTops[2], String(groupTops))
  for (const [index, segment] of second.segments.entries()) {
    const checked = await request(path + '/precheck', 'POST', { card_id: segment.model_card_id })
    const [yes, no] = index ? ['分段动作举高', '分段动作取出'] : ['分段动作取出', '分段动作举高']
    assert.ok(checked.can_run, JSON.stringify(checked.diagnostics))
    assert.ok(checked.input.text.includes(yes) && !checked.input.text.includes(no))
    assert.deepEqual(checked.input.media.map(item => item.file_id), ['object-browser-image'])
  }
  const firstCard = page.locator(`[data-card-id="${first.card_id}"]`)
  const top = () => firstCard.evaluate(element => Number.parseFloat(element.style.top))
  const before = await top()
  await firstCard.getByRole('button', { name: /^移动布局：/ }).press('ArrowDown')
  const moved = await top()
  assert.ok(moved > before)
  const details = await openCanvasCard(page, first.card_id)
  const save = page.waitForResponse(response => response.request().method() === 'PUT' &&
    new URL(response.url()).pathname === new URL(path).pathname)
  await details.getByRole('textbox', { name: '可见结果内容', exact: true }).fill('林舟在码头掀开铜匣。')
  await closeCanvasDetails(page)
  const saved = await save
  assert.ok(saved.ok(), await saved.text())
  await poll(state => state.document.cards.find(card => card.id === first.card_id)?.visible_result.text === '林舟在码头掀开铜匣。')
  await page.reload()
  await firstCard.waitFor()
  assert.equal(await top(), moved, 'ordinary save and reopen retain manual card position')
  await page.screenshot({ path: join(output, 'scoped-storyboard.png'), animations: 'disabled' })
  process.stdout.write(JSON.stringify({ output, passed: true }) + '\n')
} finally { await cleanup() }
