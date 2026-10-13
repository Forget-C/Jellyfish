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
  await body.fill('历史场次的原指令。')
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
  await page.getByRole('button', { name: '保存并生成视频', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  const videoUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  const original = (await (await fetch(videoUrl)).json()).data[0]
  await page.getByRole('button', { name: '取消本次视频任务', exact: true }).click()
  await page.getByText('视频任务：已取消', { exact: true }).waitFor()
  await body.fill('当前后来编辑的全新指令，不用于原依据重试。')
  const before = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const originalRegion = page.getByRole('region', { name: `视频执行 ${original.execution_id}`, exact: true })
  await originalRegion.getByRole('button', { name: '按原依据重试视频', exact: true }).click({ timeout: 5000 })
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  const records = (await (await fetch(videoUrl)).json()).data
  assert.equal(records.length, 2)
  const retried = records.find(row => row.task_id !== original.task_id)
  assert.equal(retried.retry_of_task_id, original.task_id)
  assert.deepEqual(retried.preparation, original.preparation)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, before)
  assert.equal(await body.inputValue(), '当前后来编辑的全新指令，不用于原依据重试。')
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  assert.equal((await fetch(`${api}/browser-test/video-tasks/${retried.task_id}/start`, { method: 'POST' })).status, 200)
  const runningRegion = page.getByRole('region', { name: `视频执行 ${retried.execution_id}`, exact: true })
  await runningRegion.getByText('视频任务：执行中', { exact: true }).waitFor()
  await page.getByRole('button', { name: '取消本次视频任务', exact: true }).click()
  await runningRegion.getByText('视频任务：取消处理中', { exact: true }).waitFor()
  assert.equal(await runningRegion.getByRole('button', { name: '已请求取消，等待执行结束', exact: true }).isDisabled(), true)
  assert.equal(await originalRegion.getByRole('button', { name: '按原依据重试视频', exact: true }).isDisabled(), true)
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).click()
  await page.getByText('单元 2 · 拆开信封', { exact: true }).click()
  await body.fill('取消处理中继续编辑另一个单元。')
  const cancellingNotice = page.getByRole('region', { name: `单元 1 视频任务 ${retried.task_id} 通知`, exact: true })
  await cancellingNotice.getByText('视频任务取消处理中', { exact: true }).waitFor()
  assert.equal((await fetch(`${api}/browser-test/video-tasks/${retried.task_id}/finish-cancellation`, { method: 'POST' })).status, 200)
  await cancellingNotice.getByText('视频任务已取消', { exact: true }).waitFor()
  assert.equal(await body.inputValue(), '取消处理中继续编辑另一个单元。')
  await cancellingNotice.getByRole('button', { name: '返回视频任务', exact: true }).click()
  await runningRegion.getByText('视频任务：已取消', { exact: true }).waitFor()
  assert.equal(await originalRegion.getByRole('button', { name: '按原依据重试视频', exact: true }).isEnabled(), true)
  let originalRetry, replay
  await page.route('**/video/*/retry', async route => {
    originalRetry = route.request().postDataJSON()
    await route.fetch()
    await route.abort('failed')
  })
  await originalRegion.getByRole('button', { name: '按原依据重试视频', exact: true }).click()
  await page.getByText(/单元 1：视频提交待核实/).waitFor()
  await page.unroute('**/video/*/retry')
  await page.route('**/video/*/retry', async route => { replay = route.request().postDataJSON(); await route.continue() })
  await page.getByRole('button', { name: '核实原视频请求', exact: true }).click()
  await page.getByText('视频任务：等待执行', { exact: true }).waitFor()
  assert.deepEqual(replay, originalRetry)
  const after = (await (await fetch(videoUrl)).json()).data
  assert.equal(after.length, 3)
  const active = after.find(row => row.status === 'queued')
  assert.equal((await fetch(`${api}/browser-test/video-tasks/${active.task_id}/complete`, { method: 'POST' })).status, 200)
  const candidate = page.getByRole('region', { name: `视频执行 ${active.execution_id}`, exact: true })
  await candidate.getByText('旧依据候选：当前正文或相关依据已变化，请重新核对', { exact: true }).waitFor()
  assert.equal(await body.inputValue(), '当前后来编辑的全新指令，不用于原依据重试。')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, before)
  await page.unroute('**/video/*/retry')
  let acknowledge, release
  const received = new Promise(resolve => { acknowledge = resolve })
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/video/*/retry', async route => { acknowledge(); await gate; await route.continue() })
  await originalRegion.getByRole('button', { name: '按原依据重试视频', exact: true }).click()
  await received
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).click()
  await page.getByText('单元 2 · 拆开信封', { exact: true }).click()
  await body.fill('另一个单元的未保存编辑。')
  const competing = await fetch(`${videoUrl}/${original.execution_id}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID() }) })
  assert.equal(competing.status, 200)
  release()
  await page.getByText(/视频未提交：.*本单元已有视频任务/).waitFor()
  const originalRecords = `**/units/unit-one/video`
  await page.route(originalRecords, route => route.abort('failed'))
  await page.getByRole('button', { name: '返回原视频执行', exact: true }).click()
  await page.locator('.canvas-workbench-notice').filter({ hasText: '视频未提交' }).locator('.ant-alert-description').waitFor()
  assert.equal(await body.inputValue(), '另一个单元的未保存编辑。')
  assert.equal(await originalRegion.count(), 0)
  await page.unroute(originalRecords)
  await page.getByRole('button', { name: '返回原视频执行', exact: true }).click({ timeout: 5000 })
  await originalRegion.locator('details[open]').waitFor({ timeout: 5000 })
  assert.equal(await page.locator('.canvas-workbench-notice').filter({ hasText: '视频未提交' }).locator('.ant-alert-description').count(), 0)
  assert.equal(await originalRegion.evaluate(node => node === document.activeElement), true)
  assert.equal(await body.inputValue(), '当前后来编辑的全新指令，不用于原依据重试。')
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).click()
  await page.getByText('单元 2 · 拆开信封', { exact: true }).click()
  assert.equal(await body.inputValue(), '另一个单元的未保存编辑。')
  console.log(`PASS original input video retry; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
