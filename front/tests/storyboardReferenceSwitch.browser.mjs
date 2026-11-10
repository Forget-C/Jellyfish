import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closePrecheck } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-reference-switch-')
const fixture = join(output, 'clip.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1',
  '-c:v', 'libx264', '-y', fixture])
const api = 'http://127.0.0.1:8733', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'storyboard-reference-switch-chapter', text = '前门的阿同拿着信封。后门的阿同等待。'
const base = studio + '/generation-canvases/' + project
const controls = api + '/test/runtime-controls'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE: fixture,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8733' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  const result = await response.json()
  return result.data ?? result
}

async function poll(read, predicate, description) {
  let current
  for (let attempt = 0; attempt < 160; attempt++) {
    current = await read()
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error(description + ' ' + JSON.stringify(current).slice(0, 1200))
}

try {
  await poll(async () => {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    return fetch(base).then(response => response.ok, () => false)
  }, Boolean, 'isolated backend did not start')
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: text })
  const chapterApi = `${studio}/projects/${project}/directing/chapters/${chapter}`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4733, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const projectUrl = `http://127.0.0.1:4733/projects/${project}`

  const sequence = await request(chapterApi + '/sequences', 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(text).digest('hex'), span: { start: 0, end: text.length } })
  const scene = `${chapterApi}/sequences/${sequence.id}`
  await page.goto(`${projectUrl}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`)
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true }).waitFor()
  const task = await request(scene + '/storyboards', 'POST', { request_id: randomUUID(), name: '视觉承接',
    mode: 'faithful', production_model_id: 'story-video-model', pending_modality: 'video' })
  const ready = await poll(() => request(scene + '/storyboards/' + task.task_id),
    item => ['succeeded', 'failed'].includes(item.status), 'storyboard did not finish')
  assert.equal(ready.status, 'succeeded', JSON.stringify(ready))
  const canvas = base + '/' + task.canvas_id
  await page.goto(`${projectUrl}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${task.canvas_id}&storyboardTask=${task.task_id}`)
  const state = await poll(() => request(canvas), item => item.document.storyboard, 'storyboard was not saved')
  const [first, later] = state.document.storyboard.shots.map(item => item.model_card_ids[0])
  assert.ok(first && later)
  const model = page.locator(`[data-card-id="${later}"]`)
  const open = async () => {
    await model.getByRole('button', { name: '卡片操作' }).click()
    await model.getByRole('button', { name: '视觉承接', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: '视觉承接', exact: true })
  await open()
  await dialog.getByText('前镜尚无成功视频，可先生成当前镜头。').waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await model.getByRole('button', { name: '生成视频', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  assert.equal(await preview.getByRole('button', { name: '确认执行' }).isEnabled(), true)
  await closePrecheck(page)
  const run = async (id) => {
    const checked = await request(canvas + '/precheck', 'POST', { card_id: id })
    assert.ok(checked.can_run, JSON.stringify(checked.diagnostics))
    const result = await request(canvas + '/runs', 'POST', { request_id: randomUUID(), preview_token: checked.preview_token })
    const runtime = await poll(() => request(canvas + '/runtime'), item => item.runs.find(r => r.id === result.run_id)?.lifecycle === 'finished', 'video did not finish')
    const node = runtime.runs.find(r => r.id === result.run_id).nodes[0]
    assert.equal(node.status, 'succeeded')
    return node
  }
  const predecessor = await run(first)

  const image = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', fixture, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'])
  const form = new FormData()
  form.set('project_id', project); form.set('usage_kind', 'generation_upload')
  form.set('file', new Blob([image], { type: 'image/png' }), 'subject.png')
  const uploaded = await fetch(studio + '/files/upload', { method: 'POST', body: form })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const subjectFile = (await uploaded.json()).data.id
  const seed = await request(canvas)
  const doc = seed.document
  const target = doc.cards.find(card => card.id === later)
  const subjectSource = { canvas_id: doc.id, card_id: 'existing-subject', port_id: 'image', position: 0 }
  doc.cards.push({ id: 'existing-subject', type: 'content.image', file_id: subjectFile })
  const subjectBinding = { id: 'existing-subject-binding', source: subjectSource,
    input_port: 'subject_image', subject_name: '阿同', prompt_owned: true }
  target.input_bindings.push(subjectBinding)
  target.prompt.segments.push({ id: 'free-body', kind: 'text', text: '保留原正文。' },
    { id: 'subject-command', kind: 'instruction', command: '主体参考', parameters: { name: '阿同' },
      references: [{ id: 'subject-command-reference', kind: 'reference', binding_id: subjectBinding.id }] })
  doc.edges.push({ id: 'existing-subject-edge', source_card: subjectSource.card_id, source_port: 'image',
    target_card: later, target_port: 'subject_image' })
  doc.input_order[later] = { ...doc.input_order[later], subject_image: ['existing-subject-edge'] }
  const carriedSource = { ...subjectSource, card_id: 'carried-source' }
  doc.cards.push({ id: 'carried-source', type: 'content.image', file_id: subjectFile },
    { id: 'shared-style', type: 'direction.style', fields: { direction: { state: 'proposal', document: { segments: [
      { id: 'style-text', kind: 'text', text: '保留共享风格。' }, { id: 'style-image', kind: 'reference', source: carriedSource },
    ] } } } },
    { id: 'other-model', type: 'model.video', model_id: target.model_id, config: target.config, prompt: { segments: [] },
      input_bindings: [{ id: 'other-style-binding', source: { ...subjectSource, card_id: 'shared-style', port_id: 'text' }, input_port: 'text' }] })
  target.input_bindings.push({ id: 'target-style-binding', source: { ...subjectSource, card_id: 'shared-style', port_id: 'text' }, input_port: 'text' })
  target.design_media_uses = [{ id: 'carried-subject-use', source: carriedSource, input_port: 'subject_image', subject_name: '阿同造型' }]
  doc.edges.push({ id: 'style-carried-edge', source_card: 'carried-source', source_port: 'image', target_card: 'shared-style', target_port: 'image' },
    { id: 'target-style-edge', source_card: 'shared-style', source_port: 'text', target_card: later, target_port: 'text' },
    { id: 'other-style-edge', source_card: 'shared-style', source_port: 'text', target_card: 'other-model', target_port: 'text' })
  doc.input_order[later].text = [...(doc.input_order[later].text || []), 'target-style-edge']
  doc.input_order['shared-style'] = { image: ['style-carried-edge'] }
  doc.input_order['other-model'] = { text: ['other-style-edge'] }
  await request(canvas, 'PUT', { request_id: randomUUID(), expected_revision: seed.revision, document: doc })
  const original = await request(canvas)
  assert.equal((await request(canvas + '/cards/' + later + '/compile')).video_media.subjects[0].name, '阿同')
  const choose = async () => {
    await open()
    await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
    await dialog.getByRole('slider', { name: '视频时间位置' }).fill('500')
    await dialog.getByRole('combobox', { name: '参考用途' }).selectOption('first_frame')
    await dialog.getByRole('button', { name: '确认采用', exact: true }).click()
    await dialog.getByRole('region', { name: '参考组合冲突', exact: true }).waitFor()
    await dialog.getByText(/阿同.*主体参考指令引用/).waitFor()
    await dialog.getByText(/阿同造型.*主体图片/).waitFor()
  }
  await page.reload()
  await choose()
  assert.deepEqual(await request(canvas), original, 'opening the conflict choice does not save or extract')
  await dialog.getByRole('button', { name: '保留主体参考并取消采用', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(await request(canvas), original)
  await choose()
  await request(api + '/api/v1/llm/models', 'POST', { id: 'alternate-vidu', name: 'viduq2-pro', category: 'video', provider_id: 'story-video-provider' })
  const concurrent = await request(canvas)
  concurrent.document.cards.find(card => card.id === later).model_id = 'alternate-vidu'
  await request(canvas, 'PUT', { request_id: randomUUID(), expected_revision: concurrent.revision, document: concurrent.document })
  const changed = await request(canvas)
  const switchButton = dialog.getByRole('button', { name: '切换为首帧并停用主体参考', exact: true })
  await switchButton.click()
  await dialog.getByText('画布已有新修订，请重新打开后采用').waitFor()
  assert.deepEqual(await request(canvas), changed)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.reload()
  await choose()
  const matchSave = url => url.pathname === new URL(canvas).pathname
  let corrupted = false
  const tamper = async route => {
    if (corrupted || route.request().method() !== 'PUT') return route.continue()
    corrupted = true
    const body = route.request().postDataJSON()
    body.document.storyboard.visual_continuity[later].suspended.prompt_order = []
    return route.continue({ postData: JSON.stringify(body) })
  }
  await page.route(matchSave, tamper)
  await switchButton.click()
  await dialog.getByText(/承接尚未确认/).waitFor()
  assert.deepEqual(await request(canvas), changed, 'invalid suspension does not leave a partial switch')
  await page.unroute(matchSave, tamper)
  await switchButton.click()
  await dialog.waitFor({ state: 'hidden' })
  const switched = await request(canvas)
  assert.equal(switched.revision, changed.revision + 1)
  const after = switched.document.cards.find(card => card.id === later)
  const frame = switched.document.cards.find(card => card.frame_origin?.source_file_id === predecessor.outputs[0].file_id)
  assert.ok(frame)
  assert.ok(switched.document.cards.some(card => card.id === 'existing-subject' && card.file_id === subjectFile))
  assert.ok(switched.document.edges.some(edge => edge.id === 'existing-subject-edge'), 'existing candidate stays connected')
  assert.equal(after.input_bindings.some(binding => binding.id === subjectBinding.id), false)
  assert.equal(after.prompt.segments.some(segment => segment.id === 'subject-command'), false)
  assert.equal(after.prompt.segments.find(segment => segment.id === 'free-body').text, '保留原正文。')
  const relation = switched.document.storyboard.visual_continuity[later]
  assert.equal(Object.values(relation.suspended.input_bindings)[0].id, subjectBinding.id)
  assert.equal(Object.values(relation.suspended.prompt_segments)[0].id, 'subject-command')
  assert.equal(Object.values(relation.suspended.design_media_uses)[0].id, 'carried-subject-use')
  assert.equal(after.design_media_uses.length, 0)
  assert.deepEqual(switched.document.cards.find(card => card.id === 'shared-style'), original.document.cards.find(card => card.id === 'shared-style'))
  assert.ok((await request(canvas + '/cards/other-model/compile')).diagnostics.some(item => item.code === 'DESIGN_MEDIA_PURPOSE_REQUIRED'))
  const compiled = await request(canvas + '/cards/' + later + '/compile')
  assert.equal(compiled.video_media.frames.first.file_id, frame.file_id)
  assert.equal(compiled.video_media.subjects.length, 0)
  assert.equal(compiled.diagnostics.some(item => item.code === 'DESIGN_MEDIA_PURPOSE_REQUIRED'), false)
  assert.match(compiled.text, /保留共享风格/)
  assert.equal(relation.suspended.model_id, 'alternate-vidu')
  await run(later)
  assert.equal((await request(controls)).media_calls.at(-1).path, '/ent/v2/img2video')
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  const undone = await poll(() => request(canvas), item => !item.document.cards.some(card => card.id === frame.id), 'undo did not save')
  assert.deepEqual(undone.document.cards.find(card => card.id === later).prompt, original.document.cards.find(card => card.id === later).prompt)
  assert.deepEqual(undone.document.cards.find(card => card.id === later).input_bindings, original.document.cards.find(card => card.id === later).input_bindings)
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(() => request(canvas), item => item.document.storyboard.visual_continuity?.[later]?.suspended, 'redo did not save')
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => request(canvas), item => !item.document.storyboard.visual_continuity?.[later], 'second undo did not save')
  await page.reload()
  const restored = await request(canvas + '/cards/' + later + '/compile')
  assert.equal(restored.video_media.subjects[0].name, '阿同')
  assert.equal(restored.video_media.frames.first, null)
  console.log('Storyboard reference switch: explicit cancellation, suspension, preserved candidate, compiled first frame, and undo')
} finally {
  await cleanup()
}
