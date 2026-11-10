import { openStoryboardDefaultModels, openReadyStoryboard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-storyboard-reextract-')
const api = 'http://127.0.0.1:8329', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'storyboard-reextract-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_REEXTRACT: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8329' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4329, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const prep = `http://127.0.0.1:4329/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  await page.goto(prep.replace('step=storyboard', 'step=objects'))
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await front.getByRole('button', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  // 通过公开接口建立旧图片分镜，验证现有画布的编辑与引用契约。
  const storyboardName = '已有图片分镜'
  await request(`${scenes}/${sequence.id}/storyboards`, 'POST', {
    request_id: 'existing-image-storyboard', name: storyboardName, mode: 'faithful', pending_modality: 'image',
  })
  const videoName = '自动设计堆叠分镜'
  await request(`${scenes}/${sequence.id}/storyboards`, 'POST', {
    request_id: 'automatic-stack-storyboard', name: videoName, mode: 'faithful', pending_modality: 'video',
  })
  await page.goto(prep)
  await openReadyStoryboard(page, videoName)
  const videoLocation = page.url()
  const videoId = new URL(videoLocation).searchParams.get('canvas')
  const videoCanvas = `${studio}/generation-canvases/${project}/${videoId}`
  const readVideo = () => request(videoCanvas)
  await page.waitForFunction(() => document.querySelectorAll('[data-stack-id]').length === 2)
  await page.goto(prep)
  await openReadyStoryboard(page, storyboardName)
  const id = new URL(page.url()).searchParams.get('canvas')
  const canvas = `${studio}/generation-canvases/${project}/${id}`
  const read = () => request(canvas)
  const poll = async (predicate, readState = read) => {
    for (let attempt = 0; attempt < 130; attempt++) {
      const state = await readState()
      if (predicate(state)) return state
      await delay(100)
    }
    throw new Error('canvas state not saved')
  }
  const pending = await poll(state => !!state.document.storyboard)
  const modelCards = pending.document.storyboard.shots.flatMap(shot => shot.model_card_ids)
  await openStoryboardDefaultModels(page, modelCards, '分镜测试图片模型')
  const applied = await poll(state => modelCards.every(id =>
    state.document.cards.find(card => card.id === id)?.model_id === 'story-image-model'))
  await page.getByRole('button', { name: '对象参考', exact: true }).click()
  const referenceSettings = page.getByRole('dialog', { name: '对象参考', exact: true })
  await referenceSettings.getByRole('region', { name: '镜头 01：阿同', exact: true })
    .getByRole('combobox', { name: '指定镜头参考图', exact: true }).press('ArrowDown')
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('图片内容卡 1', { exact: true }).click()
  await referenceSettings.getByRole('button', { name: '完成', exact: true }).click()
  const overridden = await poll(state => Object.keys(state.document.storyboard.shots[0].reference_overrides || {}).length > 0)
  const alias = Object.values(overridden.document.storyboard.shots[0].reference_overrides)[0]
  const before = structuredClone(overridden.document)
  const shot = before.cards.find(card => card.id === before.storyboard.shots[0].card_id)
  before.groups = before.groups.filter(group => group.kind !== 'stack' || !group.card_ids.includes(shot.id))
  shot.name = '人工镜头名'
  const removed = before.cards.find(card => card.type === 'content.prop')
  const noteId = 'manual-note'
  before.cards.push({ id: noteId, type: 'content.text', text: '人工新增' })
  before.cards.push({ id: 'manual-model', type: 'model.image', model_id: 'story-image-model',
    input_bindings: [{ id: 'manual-prop-use', input_port: 'text', source: { canvas_id: id, card_id: removed.id, port_id: 'text', position: 0 } }],
    prompt: { segments: [{ id: 'manual-ref', kind: 'reference', binding_id: 'manual-prop-use' }] } })
  before.edges.push({ id: 'manual-prop-link', source_card: removed.id, source_port: 'text', target_card: 'manual-model', target_port: 'text' })
  before.input_order['manual-model'] = { text: ['manual-prop-link'] }
  const movement = before.cards.find(card => card.type === 'direction.movement')
  const sourceImage = before.cards.find(card => card.type === 'content.image' && card.file_id)
  const outputIdentity = (card, port_id) => ({ canvas_id: id, card_id: card.id, port_id, position: 0 })
  const connect = (edgeId, from, sourcePort, to, targetPort) => {
    before.edges.push({ id: edgeId, source_card: from.id, source_port: sourcePort, target_card: to, target_port: targetPort })
    const ports = before.input_order[to] ||= {}
    ;(ports[targetPort] ||= []).push(edgeId)
  }
  before.cards.push(
    { id: 'manual-composition', type: 'direction.composition', frame_target: { card_id: movement.id, state_id: 'field:movement_start' },
      fields: { composition: { state: 'fact', document: { segments: [
        { id: 'place', kind: 'text', text: '居中安排', literal: true },
        { id: 'prop', kind: 'reference', source: outputIdentity(removed, 'text') },
      ] } } } },
    { id: 'manual-named-image', type: 'reference.prop', name: removed.name, angle: '侧面',
      name_binding: { ...outputIdentity(removed, 'object'), object_id: removed.object_id },
      image_binding: { file_id: sourceImage.file_id, source: outputIdentity(sourceImage, 'image') } },
    { id: 'manual-video', type: 'model.video', model_id: 'story-video-model',
      input_bindings: [{ id: 'first-frame', input_port: 'first_frame', source: outputIdentity(sourceImage, 'image') }],
      prompt: { segments: [{ id: 'body', kind: 'text', text: '保持画面稳定' },
        { id: 'instruction', kind: 'instruction', command: '首帧参考', references: [{ id: 'frame', kind: 'reference', binding_id: 'first-frame' }] }] } },
  )
  connect('composition-prop', removed, 'text', 'manual-composition', 'text')
  connect('composition-movement', movement, 'text', 'manual-composition', 'text')
  connect('composition-model', { id: 'manual-composition' }, 'text', 'manual-model', 'text')
  connect('reference-prop', removed, 'object', 'manual-named-image', 'name')
  connect('reference-file', sourceImage, 'image', 'manual-named-image', 'image_source')
  connect('video-image', sourceImage, 'image', 'manual-video', 'first_frame')
  await request(canvas, 'PUT', { request_id: 'manual-before-reextract', expected_revision: overridden.revision, document: before })
  const compile = cardId => request(`${canvas}/cards/${cardId}/compile`)
  const initialCompile = await compile('manual-model')
  assert.ok(initialCompile.text.includes('起始画面'))
  assert.deepEqual((await compile('manual-video')).media.map(item => item.file_id), [sourceImage.file_id])

  const updated = '前缀。前门的阿同放下信封。'
  await request(studio + '/chapters/' + chapter, 'PATCH', { raw_text: updated })
  await page.reload()
  await page.getByText('章节原文已变化，画布仍保留当前固定原文。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '重新提取', exact: true }).click()
  let settings = page.getByRole('dialog', { name: '重新提取', exact: true })
  await settings.getByRole('button', { name: '在章节确认新范围', exact: true }).waitFor()
  assert.equal(await settings.getByText('采用章节最新已确认原文', { exact: true }).count(), 0)
  await settings.getByRole('button', { name: '取消', exact: true }).click()

  await request(scenes + '/' + sequence.id, 'PUT', { title: sequence.title, position: sequence.position,
    source_version: createHash('sha256').update(updated).digest('hex'), expected_version: sequence.version,
    span: { start: 3, end: Array.from(updated).length } })
  await page.reload()
  const keep = page.locator(`[data-card-id="${noteId}"]`)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const location = await keep.boundingBox()
  assert.ok(location)
  await page.mouse.move(location.x + location.width / 2, location.y + 12)
  await page.mouse.down()
  await page.mouse.move(location.x + location.width / 2 + 34, location.y + 42, { steps: 8 })
  await page.mouse.up()
  const positioned = await keep.boundingBox()
  await page.getByRole('button', { name: '重新提取', exact: true }).click()
  settings = page.getByRole('dialog', { name: '重新提取', exact: true })
  await settings.getByText('采用章节最新已确认原文', { exact: true }).click()
  await settings.getByRole('button', { name: '开始提取', exact: true }).click()
  await page.getByRole('button', { name: '核对差异', exact: true }).click()
  const diff = page.getByRole('dialog', { name: '核对分镜差异', exact: true })
  await diff.getByRole('checkbox', { name: '覆盖人工镜头名', exact: true }).waitFor()
  await diff.getByText('失去引用的保留卡片', { exact: true }).waitFor()
  assert.ok(await diff.getByText('信封', { exact: false }).count())
  const waitForDialog = width => page.waitForFunction(viewport => {
    const panel = Array.from(document.querySelectorAll('.ant-modal')).find(node => node.textContent.includes('核对分镜差异'))
    if (!panel || getComputedStyle(panel).opacity !== '1' || [...panel.classList].some(name => name.startsWith('ant-zoom-'))) return false
    const { left, right, width } = panel.getBoundingClientRect()
    return window.innerWidth === viewport && width > 0 && left >= -0.5 && right <= viewport + 0.5
  }, width)
  await waitForDialog(1440)
  await page.screenshot({ path: join(output, 'storyboard-diff.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await waitForDialog(390)
  await page.screenshot({ path: join(output, 'storyboard-diff-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 960 })
  await diff.getByRole('checkbox', { name: '覆盖人工镜头名', exact: true }).check()
  await diff.getByRole('button', { name: '应用分镜', exact: true }).click()
  const adopted = await poll(state => state.document.fixed_source.card_id !== applied.document.fixed_source.card_id)
  assert.equal(adopted.source_changed, false)
  assert.equal(adopted.document.cards.find(card => card.id === shot.id).name, '镜头 01')
  assert.ok(adopted.document.cards.some(card => card.id === noteId))
  const afterComposition = adopted.document.cards.find(card => card.id === 'manual-composition')
  assert.equal(afterComposition.frame_target ?? null, null)
  assert.deepEqual(afterComposition.fields.composition.document.segments.map(segment => segment.text), ['居中安排', '信封'])
  const named = adopted.document.cards.find(card => card.id === 'manual-named-image')
  assert.equal(named.name, '信封')
  assert.equal(named.name_binding ?? null, null)
  assert.equal(named.image_binding ?? null, null)
  assert.equal((await request(studio + '/files/' + sourceImage.file_id)).id, sourceImage.file_id)
  assert.ok(adopted.document.cards.some(card => card.id === alias), 'the manual override card remains independent')
  assert.equal(adopted.document.storyboard.shots[0].reference_overrides, undefined)
  const updatedCompile = await compile('manual-model')
  assert.ok(updatedCompile.text.includes('居中安排信封') && !updatedCompile.text.includes('起始画面'))
  const updatedVideo = await compile('manual-video')
  assert.equal(updatedVideo.text, '保持画面稳定')
  assert.deepEqual(updatedVideo.media, [])
  const stillPositioned = await keep.boundingBox()
  assert.ok(stillPositioned && Math.abs(stillPositioned.x - positioned.x) < 1 && Math.abs(stillPositioned.y - positioned.y) < 1)
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  const undone = await poll(state => state.revision > adopted.revision && state.document.fixed_source.card_id === applied.document.fixed_source.card_id)
  assert.ok(undone.source_changed)
  assert.equal(undone.document.cards.find(card => card.id === shot.id).name, '人工镜头名')
  assert.equal((await compile('manual-model')).text, initialCompile.text)
  assert.deepEqual((await compile('manual-video')).media.map(item => item.file_id), [sourceImage.file_id])
  assert.equal(Object.values(undone.document.storyboard.shots[0].reference_overrides)[0], alias)
  await page.reload()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  assert.deepEqual((await read()).document, undone.document)
  // A video storyboard keeps its old stacks until the user reviews the new source.
  const videoBefore = await readVideo()
  const automatic = videoBefore.document.groups.find(group => group.kind === 'stack' && group.name.includes('镜头 01'))
  const regrouped = videoBefore.document.groups.find(group => group.kind === 'stack' && group.name.includes('镜头 02'))
  const manual = { ...regrouped, id: 'manually-regrouped', name: '手工堆叠' }
  await request(videoCanvas, 'PUT', { request_id: 'manually-regrouped', expected_revision: videoBefore.revision,
    document: { ...videoBefore.document, groups: videoBefore.document.groups.map(group => group.id === regrouped.id ? manual : group) } })
  await page.goto(videoLocation)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const autoStack = page.locator(`[data-stack-id="${automatic.id}"]`)
  const autoBox = await autoStack.boundingBox()
  assert.ok(autoBox)
  await page.mouse.move(autoBox.x + autoBox.width / 2, autoBox.y + autoBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(autoBox.x + autoBox.width / 2 + 27, autoBox.y + autoBox.height / 2 + 19, { steps: 5 })
  await page.mouse.up()
  const moved = await autoStack.boundingBox()
  assert.ok(moved && Math.abs(moved.x - autoBox.x) > 10, 'the automatic stack was moved')
  await page.getByRole('button', { name: '重新提取', exact: true }).click()
  const videoSettings = page.getByRole('dialog', { name: '重新提取', exact: true })
  await videoSettings.getByText('采用章节最新已确认原文', { exact: true }).click()
  await videoSettings.getByRole('button', { name: '开始提取', exact: true }).click()
  await page.getByRole('button', { name: '核对差异', exact: true }).click()
  const videoDiff = page.getByRole('dialog', { name: '核对分镜差异', exact: true })
  await videoDiff.getByText(manual.name, { exact: true }).waitFor()
  await videoDiff.getByText(automatic.name, { exact: true }).waitFor()
  const confirmUnstack = videoDiff.getByRole('button', { name: '应用并解除受影响的堆叠', exact: true })
  assert.ok(await confirmUnstack.isDisabled())
  const pendingVideo = await readVideo()
  await videoDiff.getByRole('button', { name: '暂不应用', exact: true }).click()
  await videoDiff.waitFor({ state: 'hidden' })
  assert.deepEqual(await readVideo(), pendingVideo)
  const manualStack = page.locator(`[data-stack-id="${manual.id}"]`)
  await manualStack.focus()
  await manualStack.getByRole('button', { name: '解除堆叠', exact: true }).click()
  const beforeApplication = await poll(state => !state.document.groups.some(group => group.id === manual.id), readVideo)
  const positionBeforeApplication = await autoStack.boundingBox()
  const removedVideoId = beforeApplication.document.storyboard.shots[1].model_card_ids[0]
  const removedVideo = page.locator(`[data-card-id="${removedVideoId}"]`)
  const removedVideoPosition = await removedVideo.boundingBox()
  assert.ok(removedVideoPosition)
  await page.getByRole('button', { name: '核对差异', exact: true }).click()
  await confirmUnstack.click()
  const videoApplied = await poll(state => state.revision > beforeApplication.revision, readVideo)
  assert.ok(!videoApplied.document.groups.some(group => group.id === automatic.id))
  await autoStack.waitFor({ state: 'hidden' })
  await removedVideo.waitFor({ state: 'hidden' })
  const anchor = page.locator(`[data-card-id="${automatic.card_ids[0]}"]`)
  const freed = await anchor.boundingBox()
  assert.ok(freed && Math.abs(freed.x - positionBeforeApplication.x) < 2 && Math.abs(freed.y - positionBeforeApplication.y) < 2,
    'the surviving stack anchor stays at its moved position')
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  const videoRestored = await poll(state => state.revision > videoApplied.revision, readVideo)
  assert.deepEqual(videoRestored.document, beforeApplication.document)
  await autoStack.waitFor()
  const restored = await autoStack.boundingBox()
  assert.ok(restored && Math.abs(restored.x - positionBeforeApplication.x) < 2 && Math.abs(restored.y - positionBeforeApplication.y) < 2,
    'undo restores the automatic stack at its moved position')
  await removedVideo.waitFor()
  const restoredVideo = await removedVideo.boundingBox()
  assert.ok(restoredVideo && Math.abs(restoredVideo.x - removedVideoPosition.x) < 2 && Math.abs(restoredVideo.y - removedVideoPosition.y) < 2,
    'undo restores a removed video card to its original position')
  console.log(JSON.stringify({ output, passed: true }))
} catch (reason) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw reason
} finally {
  if (backend.exitCode === null) await request(`${api}/test/runtime-controls`, 'POST', { disconnect: true }).catch(() => {})
  await cleanup()
}
