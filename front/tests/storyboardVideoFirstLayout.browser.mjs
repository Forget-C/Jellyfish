import { enterStoryboardCanvas, openStoryboardReview } from './generationCanvasWorkbench.browser-helpers.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-video-layout-')
const api = 'http://127.0.0.1:8724/api/v1/studio', origin = 'http://127.0.0.1:4724'
const project = 'canvas-project', chapter = 'video-layout-chapter'
const raw = '前门的阿同拿着信封。后门的阿同等待。他绕过门廊。阿同回头。'
const canvases = api + '/generation-canvases/' + project
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_REFERENCES: '1', CANVAS_BROWSER_STORYBOARD_DESIGN_STACKS: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8724' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
async function poll(read, done) {
  for (let index = 0; index < 100; index++) {
    const result = await read()
    if (done(result)) return result
    await delay(160)
  }
  assert.fail('Expected storyboard or canvas position was not ready')
}
const cards = (page, ids) => Promise.all(ids.map(id => page.locator(`[data-card-id="${id}"]`).boundingBox()))
const moveCard = (page, id) => page.locator(`[data-card-id="${id}"]`).getByRole('button', { name: /^移动布局：/ })
const cardPoint = (page, id) => page.locator(`[data-card-id="${id}"]`).evaluate(card => [parseFloat(card.style.left), parseFloat(card.style.top)])
const fullyVisible = (box, viewport) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height

try {
  await poll(() => fetch(canvases).then(response => response.ok, () => false), Boolean)
  await request(api + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: raw })
  const scenes = `${api}/projects/${project}/directing/chapters/${chapter}/sequences`
  const scene = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(raw).digest('hex'), span: { start: 0, end: raw.length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4724, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8724' },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const newPage = async viewport => {
    const page = await browser.newPage({ viewport })
    await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
    page.setDefaultTimeout(12000)
    return page
  }
  const projectUrl = `${origin}/projects/${project}`
  const desktop = await newPage({ width: 1080, height: 900 })
  await desktop.goto(`${projectUrl}/chapters/${chapter}/workbench-management?sequence=${scene.id}&step=objects`)
  await desktop.getByRole('button', { name: '提取对象', exact: true }).click()
  await desktop.getByRole('region', { name: '阿同 · 后门的阿同', exact: true }).waitFor()
  const modelSettingsUrl = 'http://127.0.0.1:8724/api/v1/llm/model-settings'
  await request(modelSettingsUrl, 'PUT', { ...await request(modelSettingsUrl), default_video_model_id: 'story-video-model' })
  const generate = async name => {
    const collection = `${scenes}/${scene.id}/storyboards`
    const task = await request(collection, 'POST', { request_id: randomUUID(), name, mode: 'complete', pending_modality: 'video' })
    const finished = await poll(() => request(`${collection}/${task.task_id}`), result => ['succeeded', 'failed'].includes(result.status))
    assert.equal(finished.status, 'succeeded', JSON.stringify(finished))
    return task
  }
  const open = async (page, task) => {
    const url = `${projectUrl}/chapters/${chapter}/sequences/${scene.id}/canvas-workbench?canvas=${task.canvas_id}&storyboardTask=${task.task_id}`
    await page.goto(url)
    await enterStoryboardCanvas(page)
    const { document } = await poll(() => request(`${canvases}/${task.canvas_id}`), row => row.document.storyboard)
    const ids = document.storyboard.shots.flatMap(shot => shot.model_card_ids)
    assert.equal(ids.length, 3)
    await page.locator(`[data-card-id="${ids[0]}"]`).waitFor()
    return { url, ids, original: document.fixed_source.card_id, document }
  }
  const task = await generate('桌面分镜')
  const { url, ids, original, document } = await open(desktop, task)
  const [first, second, third] = await cards(desktop, ids)
  assert.ok(fullyVisible(first, desktop.viewportSize()) && fullyVisible(second, desktop.viewportSize()), JSON.stringify({ first, second }))
  assert.equal(first.y, second.y, 'two shots share the first production row')
  assert.ok(first.x < second.x && third.y > first.y, 'shots advance left to right, then wrap')
  const initialZoom = await desktop.getByLabel('画布缩放比例').textContent()
  await desktop.getByRole('button', { name: '缩小', exact: true }).click()
  const [zoomed] = await cards(desktop, ids)
  const changedZoom = await desktop.getByLabel('画布缩放比例').textContent()
  assert.notEqual(changedZoom, initialZoom)
  await desktop.reload()
  await desktop.locator(`[data-card-id="${ids[0]}"]`).waitFor()
  assert.equal(await desktop.getByLabel('画布缩放比例').textContent(), changedZoom)
  assert.deepEqual((await cards(desktop, ids))[0], zoomed)
  await desktop.setViewportSize({ width: 820, height: 900 })
  assert.deepEqual((await cards(desktop, ids))[0], zoomed, 'resizing does not move an already placed card')

  await desktop.setViewportSize({ width: 1080, height: 900 })
  const current = await request(`${canvases}/${task.canvas_id}`)
  const manualCards = ['arrange-note-1', 'arrange-note-2']
  const manualStack = { id: 'manual-arrange-stack', name: '人工堆叠', kind: 'stack', card_ids: manualCards }
  current.document.cards.push(...manualCards.map(id => ({ id, type: 'content.text', text: id })))
  current.document.groups.push(manualStack)
  await request(`${canvases}/${task.canvas_id}`, 'PUT', {
    request_id: randomUUID(), expected_revision: current.revision, document: current.document,
  })
  const { document: stackedDocument } = await request(`${canvases}/${task.canvas_id}`)
  await desktop.reload()
  const manualStackCard = desktop.getByRole('button', { name: '查看堆叠 人工堆叠', exact: true })
  await manualStackCard.waitFor()
  const beforeArrange = await cards(desktop, ids)
  const beforeStack = await manualStackCard.boundingBox()
  await desktop.getByRole('button', { name: '布局', exact: true }).click()
  await desktop.getByRole('button', { name: '整理布局', exact: true }).click()
  const [arrangedFirst, arrangedSecond] = await cards(desktop, ids)
  assert.ok(fullyVisible(arrangedFirst, desktop.viewportSize()) && fullyVisible(arrangedSecond, desktop.viewportSize()),
    'manual arrange refocuses on both first-row videos')
  assert.equal(arrangedFirst.y, arrangedSecond.y)
  assert.ok(arrangedFirst.x < arrangedSecond.x)
  assert.deepEqual((await request(`${canvases}/${task.canvas_id}`)).document.groups, stackedDocument.groups)
  await desktop.getByRole('button', { name: '撤销布局整理', exact: true }).click()
  await desktop.keyboard.press('Escape')
  assert.deepEqual(await cards(desktop, ids), beforeArrange)
  assert.deepEqual(await manualStackCard.boundingBox(), beforeStack)
  assert.equal(await desktop.getByLabel('画布缩放比例').textContent(), changedZoom)
  await desktop.reload()
  await manualStackCard.waitFor()
  assert.deepEqual(await cards(desktop, ids), beforeArrange)

  // 人工编组中的视频与普通卡在整理时保持相对位置。
  const manualNote = 'manual-mixed-arrange-note'
  const manualVideo = 'manual-unmapped-video'
  const mixedGroup = 'manual-video-mixed-group'
  const sceneCanvas = () => request(`${canvases}/${task.canvas_id}`)
  const saveDocument = row => request(`${canvases}/${task.canvas_id}`, 'PUT', {
    request_id: randomUUID(), expected_revision: row.revision, document: row.document,
  })
  const mixed = await sceneCanvas()
  const originalVideoGroup = mixed.document.groups.find(group => group.card_ids.includes(ids[0]))
  mixed.document.cards.push({ id: manualNote, type: 'content.text', text: '人工编组说明' }, { id: manualVideo, type: 'model.video' })
  mixed.document.groups = mixed.document.groups.filter(group => group.id !== originalVideoGroup.id)
  mixed.document.groups.push({ id: mixedGroup, name: '人工视频编组', card_ids: [ids[0], manualNote] })
  await saveDocument(mixed)
  await desktop.reload()
  const offset = async () => {
    const firstPoint = await cardPoint(desktop, ids[0])
    return (await cardPoint(desktop, manualNote)).map((value, index) => value - firstPoint[index])
  }
  const originalOffset = await offset()
  await desktop.getByRole('button', { name: '布局', exact: true }).click()
  await desktop.getByRole('button', { name: '整理布局', exact: true }).click()
  assert.deepEqual(await offset(), originalOffset, 'arrange translates every member of a manual video group together')
  await desktop.getByRole('button', { name: '撤销布局整理', exact: true }).click()
  await desktop.keyboard.press('Escape')
  const ungrouped = await sceneCanvas()
  ungrouped.document.groups = ungrouped.document.groups.filter(group => group.id !== mixedGroup)
  ungrouped.document.groups.push(originalVideoGroup)
  await saveDocument(ungrouped)
  await desktop.reload()
  const narrow = await newPage({ width: 390, height: 844 })
  const mobile = await open(narrow, await generate('窄屏分镜'))
  const [mobileFirst] = await cards(narrow, mobile.ids)
  assert.ok(fullyVisible(mobileFirst, narrow.viewportSize()), JSON.stringify(mobileFirst))

  const ordinary = await newPage({ width: 1080, height: 900 })
  await ordinary.goto(`${projectUrl}/generation-canvas?canvas=${task.canvas_id}`)
  await ordinary.locator(`[data-card-id="${original}"]`).waitFor()
  const [ordinarySource, ordinaryVideoBefore] = await cards(ordinary, [original, ids[0]])
  assert.ok(ordinarySource.y < ordinaryVideoBefore.y, 'ordinary entry keeps its original layout rules')
  await ordinary.getByRole('button', { name: '布局', exact: true }).click()
  await ordinary.getByRole('button', { name: '整理布局', exact: true }).click()
  const [arrangedSource, ordinaryVideo] = await poll(() => cards(ordinary, [original, ids[0]]), ([source, video]) => source.y < video.y)
  assert.ok(arrangedSource.y < ordinaryVideo.y, 'ordinary explicit arrange keeps the source above the video')
  await ordinary.goto(url)
  await ordinary.locator(`[data-card-id="${ids[0]}"]`).waitFor()
  assert.deepEqual((await cards(ordinary, [ids[0]]))[0], ordinaryVideo, 'opening an existing storyboard does not rearrange its layout')
  // 旧分镜的普通编组在显式整理时收纳设计，分组和视口一起进入历史。
  const legacyPage = await newPage({ width: 1440, height: 960 })
  const legacyTask = await generate('已有分镜完整整理')
  const legacy = await open(legacyPage, legacyTask)
  const readLegacy = () => request(`${canvases}/${legacyTask.canvas_id}`)
  const savedLegacy = await readLegacy()
  const legacyDocument = savedLegacy.document
  const originalStacks = legacyDocument.groups.filter(group => group.kind === 'stack')
  const partial = originalStacks.find(group => group.card_ids.length > 1)
  assert.ok(partial, 'fixture has an automatic stack with multiple design cards')
  const retainedMember = partial.card_ids[0]
  legacyDocument.groups = legacyDocument.groups.filter(group => group.kind !== 'stack')
  for (const originalStack of originalStacks) {
    const owner = legacyDocument.storyboard.shots.find(shot => originalStack.card_ids.includes(shot.card_id))
    const originalGroup = owner ? legacyDocument.groups.find(group => group.id === owner.group_id) : legacyDocument.groups[0]
    originalGroup.card_ids.push(...originalStack.card_ids.filter(id => id !== retainedMember))
  }
  const legacyShot = legacyDocument.storyboard.shots.find(shot => !partial.card_ids.includes(shot.card_id))
  legacyDocument.groups.find(group => group.id === legacyShot.group_id).name = '长'.repeat(255)
  legacyDocument.groups.push({ ...partial, id: partial.id + '-abcd0123', card_ids: [retainedMember] })
  legacyDocument.cards.push(...manualCards.map(id => ({ id, type: 'content.text', text: id })))
  legacyDocument.groups.push(manualStack)
  await request(`${canvases}/${legacyTask.canvas_id}`, 'PUT', {
    request_id: randomUUID(), expected_revision: savedLegacy.revision, document: legacyDocument,
  })
  await legacyPage.reload()
  const exposedId = partial.card_ids[1]
  await legacyPage.locator(`[data-card-id="${exposedId}"]`).waitFor()
  await legacyPage.getByRole('button', { name: '适应全部', exact: true }).click()
  const originalView = await cards(legacyPage, [legacy.ids[0], exposedId])
  const expectGroups = async groups => {
    await poll(readLegacy, row => JSON.stringify(row.document.groups) === JSON.stringify(groups))
  }
  const beforeOrganizing = (await readLegacy()).document.groups
  await legacyPage.getByRole('button', { name: '布局', exact: true }).click()
  await legacyPage.getByRole('button', { name: '整理布局', exact: true }).click()
  const organized = await poll(readLegacy, row => row.document.groups.filter(group => group.kind === 'stack').length === originalStacks.length + 1)
  for (const originalStack of originalStacks) {
    const restoredStack = organized.document.groups.find(group => group.kind === 'stack' && group.card_ids.includes(originalStack.card_ids[0]))
    assert.ok(restoredStack)
    assert.deepEqual(new Set(restoredStack.card_ids), new Set(originalStack.card_ids))
  }
  assert.deepEqual(organized.document.groups.find(group => group.id === manualStack.id),
    beforeOrganizing.find(group => group.id === manualStack.id))
  const organizedVideo = (await cards(legacyPage, [legacy.ids[0]]))[0]
  assert.ok(fullyVisible(organizedVideo, legacyPage.viewportSize()))
  await legacyPage.getByRole('button', { name: '撤销布局整理', exact: true }).click()
  await legacyPage.keyboard.press('Escape')
  await expectGroups(beforeOrganizing)
  assert.deepEqual(await cards(legacyPage, [legacy.ids[0], exposedId]), originalView)
  await legacyPage.getByRole('button', { name: '重做操作', exact: true }).click()
  await expectGroups(organized.document.groups)
  await legacyPage.getByRole('button', { name: '撤销操作', exact: true }).click()
  await expectGroups(beforeOrganizing)
  await legacyPage.getByRole('button', { name: '重做操作', exact: true }).click()
  await expectGroups(organized.document.groups)
  await legacyPage.reload()
  await legacyPage.locator(`[data-card-id="${legacy.ids[0]}"]`).waitFor()
  assert.deepEqual((await cards(legacyPage, [legacy.ids[0]]))[0], organizedVideo)
  // 共同堆叠收纳实际成员，但预检仍使用原设计和引用。
  await desktop.setViewportSize({ width: 1440, height: 960 })
  const savedCanvas = () => request(`${canvases}/${task.canvas_id}`)
  const [shot] = document.storyboard.shots
  const stacks = document.groups.filter(group => group.kind === 'stack')
  assert.equal(stacks.length, 4)
  const own = stacks.find(group => group.card_ids.includes(shot.card_id))
  const shared = stacks.find(group => group.name === '共享设计')
  const sharedDesign = document.cards.find(card => card.type === 'direction.lighting')
  assert.deepEqual(shared.card_ids, [sharedDesign.id])
  assert.ok(!stacks.some(group => group.card_ids.some(id => ids.includes(id))))
  const standalone = document.cards.filter(card => card.type.startsWith('content.') || card.type.startsWith('reference.'))
  assert.ok(standalone.every(card => !stacks.some(group => group.card_ids.includes(card.id))))
  const empty = standalone.find(card => card.type.startsWith('reference.') && !card.image_binding)
  await desktop.locator(`[data-card-id="${empty.id}"]`).waitFor()
  await openCanvasCard(desktop, ids[0])
  await poll(savedCanvas, row => {
    const card = row.document.cards.find(item => item.id === ids[0])
    return card?.model_id === 'story-video-model' && card.config?.ratio
  })
  await closeCanvasDetails(desktop)
  const preview = await request(`${canvases}/${task.canvas_id}/precheck`, 'POST', { card_id: ids[0] })
  assert.ok(preview.can_run, JSON.stringify(preview.diagnostics))
  assert.match(preview.input.text, /保持柔和侧光/)
  assert.match(preview.input.text, /拿着信封/)
  await desktop.getByRole('button', { name: '适应全部', exact: true }).click()
  const stack = desktop.getByRole('button', { name: `查看堆叠 ${own.name}`, exact: true })
  await stack.click()
  const reading = desktop.getByRole('dialog', { name: '堆叠内容（只读）', exact: true })
  await reading.waitFor()
  assert.equal(await reading.getByRole('article', { name: /^只读成员/ }).count(), own.card_ids.length)
  await reading.getByRole('button', { name: 'Close', exact: true }).click()
  const [beforeVideo] = await cards(desktop, [ids[0]])
  await stack.hover()
  await stack.getByRole('button', { name: '解除堆叠', exact: true }).click()
  const [afterVideo, exposedShot] = await cards(desktop, [ids[0], shot.card_id])
  assert.deepEqual(afterVideo, beforeVideo)
  assert.ok(exposedShot.x >= afterVideo.x + afterVideo.width, 'unstacking leaves the production lane clear')
  await openCanvasCard(desktop, shot.card_id)
  await desktop.getByRole('textbox', { name: '可见结果内容', exact: true }).fill('镜头说明仍可编辑')
  await closeCanvasDetails(desktop)
  const edited = await poll(savedCanvas, row => row.document.cards.find(card => card.id === shot.card_id)?.visible_result.text === '镜头说明仍可编辑')
  assert.ok(!edited.document.groups.some(group => group.id === own.id))
  assert.ok(edited.document.edges.some(edge => edge.source_card === sharedDesign.id && edge.target_card === ids[0]))
  for (let i = 0; i < 30; i++) {
    await moveCard(desktop, ids[2]).press('Shift+ArrowRight')
    await moveCard(desktop, manualVideo).press('Shift+ArrowDown')
  }
  const retainedIds = [...ids, shot.card_id, original, manualVideo]
  const positions = () => cards(desktop, retainedIds)
  const previousPositions = await positions()
  const untouched = edited.document.groups.find(group => group.kind === 'stack' && group.card_ids.includes(document.storyboard.shots[1].card_id))
  const untouchedStack = desktop.getByRole('button', { name: `查看堆叠 ${untouched.name}`, exact: true })
  const previousStack = await untouchedStack.boundingBox()
  const storyboards = `${scenes}/${scene.id}/storyboards`
  await fetch('http://127.0.0.1:8724/test/runtime-controls', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add_storyboard_content: true }),
  })
  const rerun = await request(`${scenes}/${scene.id}/canvases/${task.canvas_id}/storyboards`, 'POST', {
    request_id: randomUUID(), mode: 'complete', pending_modality: 'video',
  })
  const rerunUrl = `${storyboards}/${rerun.task_id}`
  const finished = await poll(() => request(rerunUrl), result => ['succeeded', 'failed'].includes(result.status))
  assert.equal(finished.status, 'succeeded', JSON.stringify(finished))
  const diff = await request(rerunUrl + '/diff', 'POST', { expected_revision: edited.revision })
  const newDesigns = diff.added.filter(card => card.type === 'direction.focus')
  assert.equal(newDesigns.length, 2)
  await desktop.goto(url.replace(task.task_id, rerun.task_id))
  await openStoryboardReview(desktop)
  const review = desktop.getByRole('dialog', { name: '处理分镜提取结果', exact: true })
  const applyRequests = []
  await desktop.route('**/apply', async route => {
    applyRequests.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (applyRequests.length === 1) {
      assert.ok(response.ok(), await response.text())
      await route.abort('failed')
    } else await route.fulfill({ response })
  })
  await review.getByRole('button', { name: '应用并进入画布', exact: true }).click()
  await review.getByRole('button', { name: '核对最新画布', exact: true }).click()
  const applied = await poll(savedCanvas, row => row.document.storyboard.task_id === rerun.task_id)
  assert.ok(!applied.document.groups.some(group => group.id === own.id), 'the released design stack stays released')
  assert.deepEqual(applied.document.groups.find(group => group.id === untouched.id).card_ids, untouched.card_ids)
  assert.ok(newDesigns.every(card => !applied.document.groups.some(group => group.card_ids.includes(card.id))))
  const newShot = applied.document.storyboard.shots.at(-1)
  assert.ok(applied.document.groups.some(group => group.kind === 'stack' && group.card_ids.includes(newShot.card_id)))
  assert.equal(applied.document.cards.filter(card => card.id === sharedDesign.id).length, 1)
  await review.waitFor({ state: 'hidden' })
  assert.deepEqual(await positions(), previousPositions)
  assert.deepEqual(await untouchedStack.boundingBox(), previousStack)
  const [newVideo, ...newCards] = await cards(desktop, [...newShot.model_card_ids, ...newDesigns.map(card => card.id)])
  assert.ok(newVideo.y >= Math.max(...previousPositions.slice(0, ids.length).map(box => box.y + box.height)))
  assert.ok(newCards.every(box => box && box.x < previousPositions[2].x), 'new designs stay by their owners when another shot has moved far to the right')
  assert.ok(newVideo.y < previousPositions.at(-1).y, 'unmapped video cards do not set the production lane tail')
  assert.ok(Math.abs(newVideo.x - previousPositions[0].x) < 1, 'a recovered application uses the existing production lane')
  assert.equal(applyRequests.length, 2)
  assert.deepEqual(applyRequests[0], applyRequests[1], 'recovery replays the same saved command')
  await desktop.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(savedCanvas, row => row.document.storyboard.task_id === task.task_id)
  assert.deepEqual(await positions(), previousPositions)
  await desktop.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(savedCanvas, row => row.document.storyboard.task_id === rerun.task_id)
  await desktop.reload()
  await desktop.locator(`[data-card-id="${newShot.model_card_ids[0]}"]`).waitFor()
  assert.deepEqual(await cards(desktop, [...newShot.model_card_ids, ...newDesigns.map(card => card.id)]), [newVideo, ...newCards])
  console.log(output)
} finally {
  await cleanup()
}
