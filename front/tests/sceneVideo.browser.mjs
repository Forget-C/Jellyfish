import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* The dedicated test server is still starting. */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: {} }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },

  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('button', { name: '镜头 1：读信反应', exact: true }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('递出信封。')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '检查当前指令', exact: true }).click({ timeout: 5000 })
  await page.getByText('检查任务：等待执行', { exact: true }).waitFor()
  const checksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-checks`
  const tasks = (await (await fetch(checksUrl)).json()).data
  assert.equal(tasks.length, 1)
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${tasks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '查看检查结果', exact: true }).click()
  await page.getByText('六岗检查均通过，尚待明确核对结果', { exact: true }).waitFor()
  assert.equal(await page.getByText('检查夹具：动作表达一致', { exact: true }).count(), 6)
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByText('当前指令检查结果已确认', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  let videoSubmissions = 0
  page.on('request', request => { if (request.method() === 'POST' && (request.url().endsWith('/video/save-and-submit') || request.url().endsWith('/video'))) videoSubmissions++ })
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    window.restoreVideoStorage = () => { Storage.prototype.setItem = original }
    Storage.prototype.setItem = function (key, value) {
      if (key === 'jellyfish:scene-unsaved:local-user' && JSON.parse(value).pending?.video) throw new DOMException('fixture quota', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '保存并生成当前单元视频', exact: true }).click({ timeout: 5000 })
  await page.getByText(/未获得崩溃恢复保护/).waitFor()
  assert.equal(videoSubmissions, 0)
  await page.evaluate(() => window.restoreVideoStorage())
  let saveAccepted, loseSaveResponse
  const saveRequests = []
  const acceptedSave = new Promise(resolve => { saveAccepted = resolve })
  const saveResponseGate = new Promise(resolve => { loseSaveResponse = resolve })
  await page.route('**/video/save-and-submit', async route => {
    saveRequests.push(route.request().postDataJSON())
    await route.fetch()
    saveAccepted()
    await saveResponseGate
    await route.abort('failed')
  })
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '保存并生成当前单元视频', exact: true }).click({ timeout: 5000 })
  await acceptedSave
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 拆开信封', { exact: true }).click()
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('保存未知期间 B 的编辑')
  await page.route('**/units/unit-one/video', route => route.abort('failed'))
  loseSaveResponse()
  await page.getByRole('status').filter({ hasText: '视频提交待核实' }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '保存未知期间 B 的编辑')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '生成当前单元指令建议', exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).click()
  await page.getByText('单元 1 · 拆开信封', { exact: true }).click()
  await page.unroute('**/units/unit-one/video')
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '核实当前单元原视频请求', exact: true }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 保存未知期间 B 的编辑', { exact: true }).click()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '保存未知期间 B 的编辑')
  assert.equal(videoSubmissions, 2)
  assert.deepEqual(saveRequests[1], saveRequests[0])
  await page.unroute('**/video/save-and-submit')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 1 · 拆开信封', { exact: true }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '查看当前单元视频任务', exact: true }).waitFor()
  const videoUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  const videos = (await (await fetch(videoUrl)).json()).data
  assert.equal(videos.length, 1)
  assert.equal(videos[0].preparation.request.execution_prompt, '递出信封。')
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].instruction_check_task_id, tasks[0].task_id)
  assert.equal(await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '取消本次视频任务', exact: true }).click()
  await page.getByText('视频任务：已取消', { exact: true }).waitFor()
  let releaseSubmission, receivedSubmission
  const responseGate = new Promise(resolve => { releaseSubmission = resolve })
  const received = new Promise(resolve => { receivedSubmission = resolve })
  await page.route('**/units/unit-one/video{,/save-and-submit}', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const response = await route.fetch()
    receivedSubmission()
    await responseGate
    await route.fulfill({ response })
  })
  const submissionsBeforeStorageFailure = videoSubmissions
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    window.restoreVideoStorage = () => { Storage.prototype.setItem = original }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('jellyfish:scene-video-requests:')) throw new DOMException('fixture quota', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await page.getByText(/视频授权恢复记录未保存，尚未提交/).waitFor()
  assert.equal(videoSubmissions, submissionsBeforeStorageFailure)
  await page.evaluate(() => window.restoreVideoStorage())
  const beforeCleanGeneration = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.revision
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await received
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.revision, beforeCleanGeneration)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 拆开信封', { exact: true }).click()
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('另一单元独立新动作')
  releaseSubmission()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '另一单元独立新动作')
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[1].coverage[0].action_scope, '另一单元独立新动作')
  const updatedVideos = (await (await fetch(videoUrl)).json()).data
  assert.equal(updatedVideos.length, 2)
  assert.ok(updatedVideos.every(row => row.preparation.unit_id === 'unit-one' && row.preparation.request.execution_prompt === '递出信封。'))
  await page.unroute('**/units/unit-one/video{,/save-and-submit}')
  const backgroundTaskId = updatedVideos.find(row => row.status === 'queued').task_id
  const notification = page.getByRole('region', { name: `单元 1 视频任务 ${backgroundTaskId} 通知`, exact: true })
  await notification.getByText('视频任务等待执行', { exact: true }).waitFor({ timeout: 5000 })
  await page.route('**/units/unit-one/video', route => route.abort('failed'))
  await notification.getByText('视频任务状态读取失败', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '另一单元独立新动作')
  await page.unroute('**/units/unit-one/video')
  await notification.getByRole('button', { name: '重试视频通知', exact: true }).click()
  await notification.getByText('视频任务等待执行', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal((await fetch(`${api}/api/v1/film/tasks/${updatedVideos.find(row => row.status === 'queued').task_id}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '浏览器验收取消' }),
  })).status, 200)
  await notification.getByText('视频任务已取消', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '另一单元独立新动作')
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  await notification.getByRole('button', { name: '返回视频任务', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '递出信封。')
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).waitFor()
  let lostBody, responseLost
  const lostResponse = new Promise(resolve => { responseLost = resolve })
  await page.route('**/units/unit-one/video{,/save-and-submit}', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    lostBody = route.request().postDataJSON()
    await route.fetch()
    await route.abort('failed')
    responseLost()
  })
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await lostResponse
  await page.getByRole('status').filter({ hasText: '视频提交待核实' }).waitFor({ timeout: 5000 })
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '核实当前单元原视频请求', exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).isDisabled(), true)
  // A 的原响应仍不可读，B 独立编辑、保存、检查并提交视频。
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 另一单元独立新动作', { exact: true }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('独立单元 B 的指令。')
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click({ timeout: 5000 })
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '检查当前指令', exact: true }).click()
  await page.getByText('检查任务：等待执行', { exact: true }).waitFor()
  const bChecksUrl = `${versionsUrl}/${version.id}/units/unit-two/instruction-checks`
  await page.setViewportSize({ width: 390, height: 844 })
  const bCheck = (await (await fetch(bChecksUrl)).json()).data[0]
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${bCheck.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '查看检查结果', exact: true }).click()
  await page.getByText('六岗检查均通过，尚待明确核对结果', { exact: true }).waitFor()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByText('当前指令检查结果已确认', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  const bVideos = (await (await fetch(`${versionsUrl}/${version.id}/units/unit-two/video`)).json()).data
  assert.equal(bVideos.length, 1)
  await page.screenshot({ path: join(output, 'narrow-generation.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  assert.equal(bVideos[0].preparation.request.execution_prompt, '独立单元 B 的指令。')
  assert.equal((await (await fetch(videoUrl)).json()).data.length, 3)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 1 · 拆开信封', { exact: true }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.unroute('**/units/unit-one/video{,/save-and-submit}')
  let retriedBody
  await page.route('**/units/unit-one/video{,/save-and-submit}', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    retriedBody = route.request().postDataJSON()
    await route.continue()
  })
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '核实当前单元原视频请求', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual(retriedBody, lostBody)
  assert.equal((await (await fetch(videoUrl)).json()).data.length, 3)
  await page.unroute('**/units/unit-one/video{,/save-and-submit}')
  await page.getByRole('button', { name: '取消本次视频任务', exact: true }).click()
  let refreshBody
  await page.route('**/units/unit-one/video{,/save-and-submit}', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    refreshBody = route.request().postDataJSON()
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '视频提交待核实' }).waitFor()
  await page.unroute('**/units/unit-one/video{,/save-and-submit}')
  let restoredBody
  await page.route('**/units/unit-one/video{,/save-and-submit}', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    restoredBody = route.request().postDataJSON()
    await route.continue()
  })
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual(restoredBody, refreshBody)
  assert.equal((await (await fetch(videoUrl)).json()).data.length, 4)
  assert.equal(await page.getByRole('button', { name: '恢复编辑', exact: true }).count(), 0)
  await page.unroute('**/units/unit-one/video{,/save-and-submit}')
  const restoredTask = (await (await fetch(videoUrl)).json()).data.find(row => row.status === 'queued')
  await page.getByRole('button', { name: '镜头 1：读信反应', exact: true }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 另一单元独立新动作', { exact: true }).click()
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('完成通知到达时继续编辑')
  const completed = await fetch(`${api}/browser-test/video-tasks/${restoredTask.task_id}/complete`, { method: 'POST' })
  assert.equal(completed.status, 200, await completed.text())
  const completionNotice = page.getByRole('region', { name: `单元 1 视频任务 ${restoredTask.task_id} 通知`, exact: true })
  await completionNotice.getByText('视频任务已完成', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '完成通知到达时继续编辑')
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  await completionNotice.getByRole('button', { name: '返回视频任务', exact: true }).click()
  await page.getByText('候选素材 1 · 未审片 · 不自动采用', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '递出信封。')
  const candidate = page.getByRole('region', { name: `视频执行 ${restoredTask.execution_id}`, exact: true })
  const completedVideo = (await (await fetch(videoUrl)).json()).data.find(row => row.task_id === restoredTask.task_id)
  assert.equal(completedVideo.takes.length, 1)
  const mediaResponse = await fetch(`${versionsUrl}/${version.id}/units/unit-one/takes/${completedVideo.takes[0].id}/media`)
  assert.equal(mediaResponse.status, 200)
  const media = (await mediaResponse.json()).data
  assert.equal(media.duration_ms, 2000)
  assert.equal(completedVideo.preparation.inputs.unit.duration_ms, 5000)
  await candidate.getByRole('button', { name: '查看候选视频 1', exact: true }).click({ timeout: 5000 })
  await candidate.getByText('实际媒体时长：2 秒', { exact: true }).waitFor()
  const video = candidate.getByLabel('候选视频 1', { exact: true })
  await video.evaluate(element => element.readyState >= 1 ? Promise.resolve() : new Promise((resolve, reject) => {
    element.addEventListener('loadedmetadata', resolve, { once: true })
    element.addEventListener('error', () => reject(new Error('candidate video decode failed')), { once: true })
  }))
  assert.equal(await video.evaluate(element => element.duration), 2)
  await page.route(`**${media.url}`, route => route.abort('failed'))
  await candidate.getByRole('button', { name: '查看候选视频 1', exact: true }).click()
  await candidate.getByText('候选视频读取失败', { exact: true }).waitFor()
  await page.unroute(`**${media.url}`)
  await candidate.getByRole('button', { name: '重试候选视频 1', exact: true }).click()
  await video.evaluate(element => element.readyState >= 1 ? Promise.resolve() : new Promise((resolve, reject) => {
    element.addEventListener('loadedmetadata', resolve, { once: true })
    element.addEventListener('error', () => reject(new Error('candidate retry failed')), { once: true })
  }))
  assert.equal(await video.evaluate(element => element.duration), 2)


  await candidate.getByText('视频固定输入与当前内容一致，候选仍需审片', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('收下信封。')
  await candidate.getByText('旧依据候选：当前正文或相关依据已变化，请重新核对', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await candidate.getByText('视频固定输入与当前内容一致，候选仍需审片', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('与旧视频不同的新动作')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await candidate.getByText('旧依据候选：当前正文或相关依据已变化，请重新核对', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await candidate.getByText('视频固定输入与当前内容一致，候选仍需审片', { exact: true }).waitFor({ timeout: 5000 })
  await page.route('**/units/unit-one/instruction-basis', route => route.abort('failed'))
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('触发依据读取失败')
  await page.getByText('检查适用性读取失败', { exact: true }).waitFor()
  await candidate.getByText('候选适用性待核实，尚不能判断是否符合当前要求', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('检查适用性读取失败', { exact: true }).waitFor()
  assert.equal(await candidate.getByText('视频固定输入与当前内容一致，候选仍需审片', { exact: true }).count(), 0)
  await page.unroute('**/units/unit-one/instruction-basis')
  await page.getByRole('button', { name: '重试检查适用性', exact: true }).click()
  await candidate.getByText('视频固定输入与当前内容一致，候选仍需审片', { exact: true }).waitFor()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 完成通知到达时继续编辑', { exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '完成通知到达时继续编辑')
  await page.screenshot({ path: join(output, 'scene-video.png'), animations: 'disabled' })
  console.log(`PASS scene video workflow; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
