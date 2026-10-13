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
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let originalRequest
  await page.route('**/units/unit-one/video', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    originalRequest = route.request().postDataJSON()
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '视频提交待核实' }).waitFor()
  await page.unroute('**/units/unit-one/video')
  const videoUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  const original = (await (await fetch(videoUrl)).json()).data[0]
  const chapterUrl = `${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`
  const chapterNow = (await (await fetch(chapterUrl)).json()).data
  const oldSequence = chapterNow.sequences.find(row => row.id === sequenceId)
  const division = { source_version: chapterNow.source_version,
    baseline: [{ sequence_id: sequenceId, version: oldSequence.version }],
    members: [{ key: 'new', sequence_id: null, title: '新划分', span: { start: 0, end: 4 } }],
    exited_sequence_ids: [sequenceId], lineage: [{ sequence_id: sequenceId, target_keys: ['new'] }] }
  const preview = await fetch(`${chapterUrl}/division/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(division) })
  assert.equal(preview.status, 200)
  const divided = await fetch(`${chapterUrl}/division`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), draft: division, preview_token: (await preview.json()).data.preview_token, identity_changes_confirmed: true }) })
  assert.equal(divided.status, 200, await divided.text())
  let verifiedRequest
  await page.route('**/units/unit-one/video', async route => {
    if (route.request().method() === 'POST') verifiedRequest = route.request().postDataJSON()
    await route.continue()
  })
  await page.reload()
  await page.getByRole('status').filter({ hasText: '历史场次 · 只读' }).waitFor()
  await page.getByRole('region', { name: `单元 1 视频任务 ${original.task_id} 通知`, exact: true }).getByText('视频任务等待执行', { exact: true }).waitFor({ timeout: 5000 })
  assert.deepEqual(verifiedRequest, originalRequest)
  assert.equal((await (await fetch(videoUrl)).json()).data.length, 1)
  await page.getByRole('button', { name: '返回视频任务', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).isDisabled(), true)
  console.log(`PASS historical scene request verification; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
