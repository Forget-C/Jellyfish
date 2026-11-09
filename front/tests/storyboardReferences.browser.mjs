import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-references-')
const api = 'http://127.0.0.1:8264', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'reference-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。他绕过门廊。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_REFERENCES: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8264' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
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
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: excerpt })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4264, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const prep = `http://127.0.0.1:4264/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  await page.goto(prep)
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await front.getByRole('combobox', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成分镜', exact: true }).click()
  const config = page.getByRole('dialog', { name: '生成分镜' })
  const faithful = config.getByText('忠实提取', { exact: true })
  if (await faithful.count()) await faithful.click()
  await config.getByRole('textbox', { name: '画布名称' }).fill('忠实分镜验收')
  await config.getByRole('combobox', { name: '生产模型' }).click()
  await page.getByText('分镜测试图片模型', { exact: true }).click()
  await config.getByRole('button', { name: '开始提取', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const id = new URL(page.url()).searchParams.get('canvas')
  const canvas = `${studio}/generation-canvases/${project}/${id}`
  const read = () => request(canvas)
  const poll = async predicate => {
    for (let attempt = 0; attempt < 130; attempt++) {
      const state = await read()
      if (predicate(state)) return state
      await delay(100)
    }
    throw new Error('canvas state not saved')
  }
  const applied = await poll(state => !!state.document.storyboard)
  const references = page.getByRole('button', { name: '对象参考', exact: true })
  await references.waitFor()
  const { shots, objects } = applied.document.storyboard
  assert.equal(shots.length, 3)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')
  const files = {}
  for (const id of ['替代图', '新默认图', '补齐图']) {
    const form = new FormData()
    form.append('file', new File([png, id], id + '.png', { type: 'image/png' }))
    form.append('project_id', project)
    form.append('usage_kind', 'generation_upload')
    const response = await fetch(studio + '/files/upload', { method: 'POST', body: form })
    assert.ok(response.ok, await response.clone().text())
    files[id] = (await response.json()).data.id
  }
  const imageLabels = {}
  const imageStart = applied.document.cards.filter(card => card.type === 'content.image' && card.file_id).length
  const cards = Object.keys(files).map((id, index) => {
    imageLabels[id] = `图片内容卡 ${imageStart + index + 1}`
    return { id: 'fixture-' + files[id], type: 'content.image', file_id: files[id] }
  })
  await request(canvas, 'PUT', { request_id: 'fixture-images', expected_revision: applied.revision,
    document: { ...applied.document, cards: [...applied.document.cards, ...cards] } })
  await page.reload()
  await references.click()
  const dialog = page.getByRole('dialog', { name: '对象参考', exact: true })
  const sceneObject = dialog.getByRole('region', { name: '阿同默认参考', exact: true })
  const shoot = dialog.getByRole('region', { name: '镜头 01：阿同', exact: true })
  const option = async (region, label, text) => {
    await region.getByRole('combobox', { name: label, exact: true }).press('ArrowDown')
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText(imageLabels[text], { exact: true }).click()
  }
  const precheck = index => request(canvas + '/precheck', 'POST', { card_id: shots[index].model_card_ids[0] })
  const media = async index => (await precheck(index)).input.media.map(item => item.file_id)
  assert.deepEqual(await media(0), ['object-browser-image'])
  assert.deepEqual(await media(1), [])
  assert.deepEqual(await media(2), ['object-browser-image'])
  const taskPath = `${scenes}/${sequence.id}/storyboards`
  const otherTask = await request(taskPath, 'POST', { request_id: 'second-reference-canvas', name: '独立方案',
    mode: 'faithful', production_model_id: 'story-image-model' })
  let other
  for (let attempt = 0; attempt < 130; attempt++) {
    other = await request(taskPath + '/' + otherTask.task_id)
    if (other.status === 'succeeded') break
    assert.notEqual(other.status, 'failed', JSON.stringify(other))
    await delay(100)
  }
  assert.ok(other.candidate)
  const otherCanvas = `${studio}/generation-canvases/${project}/${otherTask.canvas_id}`
  await request(otherCanvas, 'PUT', { request_id: 'storyboard:' + otherTask.task_id,
    expected_revision: other.candidate.base_revision, document: other.candidate.document })
  const otherShot = other.candidate.document.storyboard.shots[0]
  const preview = await precheck(2)
  assert.ok(preview.can_run, JSON.stringify(preview.diagnostics))
  const run = await request(canvas + '/runs', 'POST', { request_id: 'frozen-reference', preview_token: preview.preview_token })
  let frozen
  for (let attempt = 0; attempt < 130; attempt++) {
    const runtime = await request(canvas + '/runtime')
    frozen = runtime.runs.find(item => item.id === run.run_id)
    if (frozen?.nodes[0]?.status === 'succeeded') break
    assert.notEqual(frozen?.nodes[0]?.status, 'failed', JSON.stringify(frozen))
    await delay(100)
  }
  assert.equal(frozen?.nodes[0]?.status, 'succeeded')
  assert.ok(frozen.nodes[0].outputs[0]?.file_id)

  await option(shoot, '指定镜头参考图', '替代图')
  await poll(state => !!state.document.storyboard.shots[0].reference_overrides?.[objects[0].object_id])
  assert.deepEqual(await media(0), [files['替代图']])
  assert.ok((await precheck(0)).input.mapping.some(item => item.object_id === objects[0].object_id && item.media_position === 1))
  assert.deepEqual(await media(2), ['object-browser-image'])
  await option(sceneObject, '选择默认参考图', '新默认图')
  await poll(state => state.document.cards.find(card => card.id === objects[0].reference_card_id)?.image_binding?.file_id === files['新默认图'])
  assert.deepEqual(await media(0), [files['替代图']])
  assert.deepEqual(await media(2), [files['新默认图']])
  const unaffected = await request(otherCanvas + '/precheck', 'POST', { card_id: otherShot.model_card_ids[0] })
  assert.deepEqual(unaffected.input.media.map(item => item.file_id), ['object-browser-image'])
  assert.deepEqual(await media(1), [])
  await option(dialog.getByRole('region', { name: '阿同（2）默认参考', exact: true }), '选择默认参考图', '补齐图')
  await poll(state => state.document.cards.find(card => card.id === objects[1].reference_card_id)?.image_binding?.file_id === files['补齐图'])
  assert.deepEqual(await media(1), [files['补齐图']])
  assert.deepEqual((await request(canvas + '/runtime')).runs.find(item => item.id === run.run_id), frozen)

  await shoot.getByRole('button', { name: '恢复继承', exact: true }).click()
  await poll(state => !state.document.storyboard.shots[0].reference_overrides?.[objects[0].object_id])
  assert.deepEqual(await media(0), [files['新默认图']])
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(state => !!state.document.storyboard.shots[0].reference_overrides?.[objects[0].object_id])
  assert.deepEqual(await media(0), [files['替代图']])

  await page.goto(`http://127.0.0.1:4264/projects/${project}/generation-canvas?canvas=${id}`)
  await references.click()
  await shoot.getByText('镜头指定', { exact: true }).waitFor()
  const waitForReferenceDialog = width => page.waitForFunction(viewport => {
    const panel = document.querySelector('.ant-modal [aria-label="阿同默认参考"]')?.closest('.ant-modal')
    if (!panel || window.innerWidth !== viewport || getComputedStyle(panel).opacity !== '1' ||
        [...panel.classList].some(name => name.startsWith('ant-zoom-'))) return false
    const bounds = panel.getBoundingClientRect()
    return bounds.width > 0 && bounds.left >= -0.5 && bounds.right <= viewport + 0.5
  }, width)
  await waitForReferenceDialog(1440)
  await page.screenshot({ path: join(output, 'reference-settings.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await waitForReferenceDialog(390)
  await page.screenshot({ path: join(output, 'reference-settings-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 960 })
  await dialog.getByRole('button', { name: '完成', exact: true }).click()

  const manual = await read()
  const modelId = shots[2].model_card_ids[0]
  const manualCards = manual.document.cards.map(card => card.id === modelId
    ? { ...card, input_bindings: card.input_bindings.filter(binding => binding.source.card_id !== objects[0].reference_card_id) }
    : card)
  await request(canvas, 'PUT', { request_id: 'cancel-inherited-adoption', expected_revision: manual.revision,
    document: { ...manual.document, cards: manualCards } })
  await page.reload()
  await references.click()
  await option(sceneObject, '选择默认参考图', '补齐图')
  await poll(state => state.document.cards.find(card => card.id === objects[0].reference_card_id)?.image_binding?.file_id === files['补齐图'])
  assert.deepEqual(await media(2), [], 'changing default never restores a manual cancellation')
  assert.deepEqual(await media(0), [files['替代图']])

  console.log(JSON.stringify({ output, passed: true }))
} catch (reason) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw reason
} finally { await cleanup() }
