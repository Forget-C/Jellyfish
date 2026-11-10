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
const output = await browserOutput('jellyfish-storyboard-visual-continuity-')
const fixture = join(output, 'clip.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=0.5',
  '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=0.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
  '-c:v', 'libx264', '-y', fixture])
const api = 'http://127.0.0.1:8732', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'storyboard-visual-continuity-chapter', text = '前门的阿同拿着信封。后门的阿同等待。'
const base = studio + '/generation-canvases/' + project
const controls = api + '/test/runtime-controls'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE: fixture,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8732' }, stdio: ['ignore', 'pipe', 'pipe'],
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
    host: '127.0.0.1', port: 4732, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const projectUrl = `http://127.0.0.1:4732/projects/${project}`

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
  const run = async (id, targetCanvas = canvas, expectedStatus = 'succeeded') => {
    const checked = await request(targetCanvas + '/precheck', 'POST', { card_id: id })
    assert.ok(checked.can_run, JSON.stringify(checked.diagnostics))
    const result = await request(targetCanvas + '/runs', 'POST', { request_id: randomUUID(), preview_token: checked.preview_token })
    const runtime = await poll(() => request(targetCanvas + '/runtime'), item => item.runs.find(r => r.id === result.run_id)?.lifecycle === 'finished', 'video did not finish')
    const node = runtime.runs.find(r => r.id === result.run_id).nodes[0]
    assert.equal(node.status, expectedStatus)
    return node
  }
  const predecessor = await run(first)
  await page.reload()
  await open()
  const slider = dialog.getByRole('slider', { name: '视频时间位置' })
  await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
  const purpose = dialog.getByRole('combobox', { name: '参考用途' })
  assert.equal(await purpose.inputValue(), '')
  assert.equal(await dialog.getByRole('button', { name: '定位尾帧并用作首帧' }).count(), 0)
  await dialog.getByRole('checkbox', { name: '同机位接续连续动作' }).check()
  await dialog.getByRole('button', { name: '定位尾帧并用作首帧' }).click()
  assert.equal(await purpose.inputValue(), 'first_frame')
  assert.equal(await slider.inputValue(), await slider.getAttribute('max'))
  await slider.fill('600')
  const adopt = dialog.getByRole('button', { name: '确认采用', exact: true })
  const savePath = new URL(canvas).pathname
  const matchesSave = url => url.pathname === savePath
  let rejected = false
  const rejectFirst = async route => {
    if (rejected || route.request().method() !== 'PUT') return route.continue()
    rejected = true
    const body = route.request().postDataJSON()
    body.document.storyboard.visual_continuity[later].binding_id = 'missing-binding'
    return route.continue({ postData: JSON.stringify(body) })
  }
  await page.route(matchesSave, rejectFirst)
  await adopt.click()
  await dialog.getByText(/承接尚未确认/).waitFor()
  assert.deepEqual(await request(canvas), state, 'rejected adoption leaves the saved graph unchanged')
  await page.unroute(matchesSave, rejectFirst)
  const command = page.waitForRequest(sent => sent.method() === 'PUT' && new URL(sent.url()).pathname === savePath)
  await adopt.click()
  await dialog.waitFor({ state: 'hidden' })
  const adopted = await request(canvas)
  assert.equal(adopted.revision, state.revision + 1, 'one document save includes the still and adoption')
  assert.equal((await request(canvas, 'PUT', (await command).postDataJSON())).revision, adopted.revision,
    'the exact confirmation replays its committed revision')
  const relation = adopted.document.storyboard.visual_continuity[later]
  const binding = adopted.document.cards.find(card => card.id === later).input_bindings.find(item => item.id === relation.binding_id)
  const frame = adopted.document.cards.find(card => card.id === binding.source.card_id)
  assert.equal(binding.input_port, 'first_frame')
  assert.equal(frame.frame_origin.source_file_id, predecessor.outputs[0].file_id)
  assert.equal(frame.frame_origin.at_ms, 600)
  assert.equal(frame.frame_origin.result_set_id, predecessor.result_set_id)
  assert.equal((await request(controls)).media_calls.length, 1, 'adoption does not start a task')
  await run(later)
  assert.equal((await request(controls)).media_calls.at(-1).path, '/ent/v2/img2video')
  const fixedBytes = Buffer.from(await (await fetch(studio + '/files/' + frame.file_id + '/download')).arrayBuffer())
  assert.equal((await request(controls)).media_calls.at(-1).body.images[0], 'data:image/png;base64,' + fixedBytes.toString('base64'))
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => request(canvas), item => !item.document.cards.some(card => card.id === frame.id), 'undo did not save')
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(() => request(canvas), item => item.document.storyboard.visual_continuity?.[later], 'redo did not save')
  await page.reload()
  await model.getByRole('button', { name: '引用', exact: true }).click()
  await page.getByRole('dialog', { name: '卡片引用' }).getByRole('button', { name: /来源视频.*0.600/ }).waitFor()
  const updateNotice = model.getByText('来源镜头有新结果', { exact: true })
  const originalRuntime = await request(canvas + '/runtime')
  const originalVideo = originalRuntime.current_outputs[later][0].file_id
  await request(controls, 'POST', { media_fail_next: true })
  await run(first, canvas, 'failed')
  assert.equal(await updateNotice.count(), 0, 'a failed upstream run is not a new successful result')
  const beforeUpdate = await request(canvas)
  const replacement = await run(first)
  await updateNotice.waitFor()
  assert.deepEqual(await request(canvas), beforeUpdate, 'new source results never change the saved adoption')
  await page.reload()
  await updateNotice.waitFor()
  await open()
  const sourceChoice = dialog.getByRole('combobox', { name: '视频来源' })
  const compare = async (node) => {
    await sourceChoice.selectOption({ value: `${node.id}:0` })
    await dialog.getByLabel('待选帧视频').evaluate((element, file) => {
      if (!element.getAttribute('src')?.includes(file)) throw new Error('wrong comparison video')
    }, node.outputs[0].file_id)
  }
  await compare(predecessor)
  await compare(replacement)
  await dialog.getByRole('button', { name: '保留当前采用', exact: true }).click()
  assert.deepEqual(await request(canvas), beforeUpdate)
  assert.equal((await request(canvas + '/cards/' + later + '/compile')).video_media.frames.first.file_id, frame.file_id)
  await open()
  await compare(replacement)
  await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
  await slider.fill('100')
  const callsBeforeReplacement = (await request(controls)).media_calls.length
  await dialog.getByRole('button', { name: '确认重新采用', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const replaced = await request(canvas)
  const selectedBinding = replaced.document.cards.find(card => card.id === later).input_bindings.find(item => item.id === relation.binding_id)
  const newFrame = replaced.document.cards.find(card => card.id === selectedBinding.source.card_id)
  assert.equal(replaced.revision, beforeUpdate.revision + 1)
  assert.equal(newFrame.frame_origin.result_set_id, replacement.result_set_id)
  assert.equal(newFrame.frame_origin.at_ms, 100)
  assert.ok(replaced.document.cards.some(card => card.id === frame.id), 'the old still remains available')
  assert.equal((await request(controls)).media_calls.length, callsBeforeReplacement, 'replacement starts no runs')
  const stale = (await request(canvas + '/runtime')).current_outputs[later][0]
  assert.equal(stale.file_id, originalVideo)
  assert.equal(stale.basis_current, false)
  await run(later)
  const newBytes = Buffer.from(await (await fetch(studio + '/files/' + newFrame.file_id + '/download')).arrayBuffer())
  assert.notDeepEqual(newBytes, fixedBytes)
  assert.equal((await request(controls)).media_calls.at(-1).body.images[0], 'data:image/png;base64,' + newBytes.toString('base64'))
  await updateNotice.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => request(canvas), item => item.document.cards.find(card => card.id === later)?.input_bindings.some(input =>
    input.id === relation.binding_id && input.source.card_id === frame.id), 'undo did not restore the old fixed frame')
  await page.reload()
  await updateNotice.waitFor()
  const openReextract = async (revision) => {
    await request(controls, 'POST', { visual_continuity_revision: revision })
    await page.getByRole('button', { name: '重新提取', exact: true }).click()
    await page.getByRole('dialog', { name: '重新提取', exact: true })
      .getByRole('button', { name: '开始提取', exact: true }).click()
    await page.getByRole('button', { name: '核对差异', exact: true }).click()
    const diff = page.getByRole('dialog', { name: '核对分镜差异', exact: true })
    await diff.getByText('人工新增的卡片会保留。', { exact: false }).waitFor()
    return diff
  }
  const applyReextract = async (diff, targetCanvas = canvas) => {
    const before = await request(targetCanvas)
    await diff.getByRole('button', { name: /^(应用分镜|应用并解除受影响的堆叠)$/ }).click()
    await diff.waitFor({ state: 'hidden' })
    return poll(() => request(targetCanvas), item => item.revision > before.revision, 're-extraction was not saved')
  }
  const checkAdoption = async () => {
    const current = await request(canvas)
    assert.deepEqual(current.document.storyboard.visual_continuity[later], relation)
    assert.ok(current.document.cards.some(card => card.id === frame.id && card.file_id === frame.file_id))
    await run(later)
    assert.equal((await request(controls)).media_calls.at(-1).body.images[0], 'data:image/png;base64,' + fixedBytes.toString('base64'))
  }
  const changed = await openReextract('design')
  await changed.getByText(/设计变化.*人工承接/).waitFor()
  const unchanged = await request(canvas)
  await changed.getByRole('button', { name: '暂不应用', exact: true }).click()
  await changed.waitFor({ state: 'hidden' })
  assert.deepEqual(await request(canvas), unchanged, 'cancelling the review leaves the saved adoption unchanged')
  await page.getByRole('button', { name: '核对差异', exact: true }).click()
  const redesigned = await applyReextract(changed)
  const usesRearPerformance = ({ document }, target) => document.cards.find(card => card.id === target).input_bindings.some(input =>
    document.cards.some(card => card.id === input.source.card_id && card.type === 'direction.performance' &&
      card.input_bindings.some(item => item.source.object_id === document.storyboard.shots[1].object_ids[0])))
  assert.ok(usesRearPerformance(redesigned, later), 'the target model takes the newly extracted design')
  await checkAdoption()
  const removedSource = await openReextract('source')
  await removedSource.getByText(/来源镜头已移除/).waitFor()
  const withoutSource = await applyReextract(removedSource)
  assert.ok(!withoutSource.document.storyboard.shots.some(shot => shot.model_card_ids.includes(first)))
  await checkAdoption()
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => request(canvas), item => item.document.storyboard.shots.some(shot => shot.model_card_ids.includes(first)), 'source shot undo did not save')
  await checkAdoption()
  const removedTarget = await openReextract('target')
  await removedTarget.getByText(/接收镜头已移除/).waitFor()
  const withoutTarget = await applyReextract(removedTarget)
  assert.ok(!withoutTarget.document.storyboard.visual_continuity?.[later])
  assert.ok(!withoutTarget.document.cards.some(card => card.id === later), 'the adopted binding alone does not pin an obsolete model card')
  assert.ok(withoutTarget.document.cards.some(card => card.id === frame.id))
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => request(canvas), item => item.document.storyboard.visual_continuity?.[later], 'target shot undo did not save')
  await page.reload()
  await checkAdoption()
  await page.goto(`${projectUrl}/generation-canvas?canvas=${task.canvas_id}`)
  await model.getByRole('button', { name: '卡片操作' }).click()
  assert.equal(await model.getByRole('button', { name: '视觉承接' }).count(), 0)
  await request(controls, 'POST', { visual_continuity_revision: null })
  const objects = await request(scene + '/objects')
  const rear = objects.objects.find(item => item.excerpt === '后门的阿同')
  await request(`${scene}/objects/${rear.id}`, 'PUT', { expected_revision: objects.revision,
    asset_id: 'object-browser-character', image_file_id: 'object-browser-image' })
  const second = await request(scene + '/storyboards', 'POST', { request_id: randomUUID(), name: '带主体参考的视觉承接',
    mode: 'faithful', production_model_id: 'story-video-model', pending_modality: 'video' })
  const secondCanvas = base + '/' + second.canvas_id
  await page.goto(`${projectUrl}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${second.canvas_id}&storyboardTask=${second.task_id}`)
  const prepared = await poll(() => request(secondCanvas), item => item.document.storyboard, 'second storyboard was not saved')
  const [beforeId, afterId] = prepared.document.storyboard.shots.map(item => item.model_card_ids[0])
  assert.equal((await request(secondCanvas + '/cards/' + afterId + '/compile')).video_media.subjects.length, 1)
  await run(beforeId, secondCanvas)
  await page.reload()
  const afterCard = page.locator(`[data-card-id="${afterId}"]`)
  await afterCard.getByRole('button', { name: '卡片操作' }).click()
  await afterCard.getByRole('button', { name: '视觉承接', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '同机位接续连续动作' }).check()
  await dialog.getByRole('button', { name: '定位尾帧并用作首帧' }).click()
  await adopt.click()
  await dialog.getByRole('button', { name: '切换为首帧并停用主体参考' }).click()
  await dialog.waitFor({ state: 'hidden' })
  const switched = (await request(secondCanvas)).document.storyboard.visual_continuity[afterId]
  assert.equal(Object.values(switched.suspended.input_bindings).length, 1)
  const freshSource = await run(beforeId, secondCanvas)
  await afterCard.getByText('来源镜头有新结果', { exact: true }).waitFor()
  await afterCard.getByRole('button', { name: '卡片操作' }).click()
  await afterCard.getByRole('button', { name: '视觉承接', exact: true }).click()
  await compare(freshSource)
  await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
  await slider.fill('100')
  await dialog.getByRole('button', { name: '确认重新采用', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const reselected = await request(secondCanvas)
  assert.deepEqual(reselected.document.storyboard.visual_continuity[afterId], switched,
    'reselection keeps the same binding and suspended subject inputs')
  const newAdoption = reselected.document.cards.find(card => card.id === afterId).input_bindings.find(input => input.id === switched.binding_id)
  assert.equal(reselected.document.cards.find(card => card.id === newAdoption.source.card_id).frame_origin.result_set_id, freshSource.result_set_id)

  const updated = await applyReextract(await openReextract('design'), secondCanvas)
  assert.deepEqual(updated.document.storyboard.visual_continuity[afterId], switched)
  const actual = await request(secondCanvas + '/cards/' + afterId + '/compile')
  assert.equal(actual.video_media.subjects.length, 0)
  assert.ok(actual.video_media.frames.first.file_id)
  assert.ok(usesRearPerformance(updated, afterId), 'switching generated subject references does not freeze the extracted design')
  const removal = await openReextract('target')
  await removal.getByText(/接收镜头已移除/).waitFor()
  const noSwitchedTarget = await applyReextract(removal, secondCanvas)
  assert.ok(!noSwitchedTarget.document.storyboard.visual_continuity?.[afterId])
  const tampered = structuredClone(updated.document)
  Object.values(tampered.storyboard.visual_continuity[afterId].suspended.input_bindings)[0].subject_name = '与回执不一致'
  const rejectedRestore = await fetch(`${scene}/storyboards/${noSwitchedTarget.document.storyboard.task_id}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      request_id: randomUUID(), expected_revision: noSwitchedTarget.revision, direction: 'undo', document: tampered,
    }),
  })
  assert.equal(rejectedRestore.status, 422)
  assert.equal((await rejectedRestore.json()).data.code, 'INVALID_STORYBOARD_RESTORE')
  const restoreResponse = page.waitForResponse(response => response.url().endsWith('/restore') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  const response = await restoreResponse
  assert.ok(response.ok(), await response.text())
  const restored = await poll(() => request(secondCanvas), item => item.document.storyboard.visual_continuity?.[afterId],
    'undo did not restore switched continuity')
  assert.deepEqual(restored.document.storyboard.visual_continuity[afterId], switched)

  console.log('Storyboard visual continuity: later-shot adoption, actual provider input, one save, undo, and reopen')
} finally {
  await cleanup()
}
