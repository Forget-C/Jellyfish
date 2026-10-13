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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1' },
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
  const sceneUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}`
  const originalTakes = (await (await fetch(sceneUrl)).json()).data.takes
  assert.equal(originalTakes.length, 1)
  const library = (await (await fetch(`${versionsUrl}/${version.id}/take-library`)).json()).data
  assert.equal(library.length, 1)
  assert.equal(library[0].take_kind, 'production_plan')
  assert.equal(library[0].file_id, 'legacy-take-file')
  assert.equal(library[0].task_id, 'legacy-video-task')
  assert.equal(library[0].prompt.text, '旧生产计划的固定拍摄指令')
  const content = structuredClone(version.content)
  content.design.direction.shots = [{ id: 'framing-shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '构图测试', sources: [{ kind: 'human', reference: 'author', version: '1' }] } }]
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: index * 5000 }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  const originalDesign = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.design
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: 'AI 提取设计 · 整场', exact: true }).click()
  await page.getByRole('textbox', { name: '设计要求（可选）', exact: true }).fill('保留点击时的设计要求')
  let firstRequest
  await page.route('**/design-suggestions', async route => {
    if (route.request().method() === 'POST') { firstRequest = route.request().postDataJSON(); await route.abort('failed') }
    else await route.continue()
  })
  await page.getByRole('button', { name: '生成整场设计建议', exact: true }).click()
  await page.getByText(/提交未核实，保留本次请求/).waitFor()
  await page.getByRole('button', { name: '关闭建议', exact: true }).click()
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.getByText('设计提交结果尚未核实，请先核实原设计请求。', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal((await (await fetch(versionsUrl)).json()).data.length, 1)
  await page.reload()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: 'AI 提取设计 · 整场', exact: true }).click()
  await page.getByRole('button', { name: '核实原设计请求', exact: true }).waitFor()
  await page.unroute('**/design-suggestions')
  const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/design-suggestions'))
  await page.getByRole('button', { name: '核实原设计请求', exact: true }).click()
  assert.deepEqual((await submitted).postDataJSON(), firstRequest)
  await page.getByText('状态：等待执行', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭建议', exact: true }).click()
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.getByText(/关联任务尚未结束：/).waitFor()
  const tasksUrl = `${versionsUrl}/${version.id}/design-suggestions`
  const tasks = (await (await fetch(tasksUrl)).json()).data
  assert.equal(tasks.length, 1)
  assert.equal((await fetch(`${api}/browser-test/design-tasks/${tasks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('version') !== version.id)
  const copiedId = new URL(page.url()).searchParams.get('version')
  const copied = (await (await fetch(`${versionsUrl}/${copiedId}`)).json()).data
  assert.deepEqual(copied.content.design, originalDesign)
  assert.equal((await (await fetch(`${versionsUrl}/${copiedId}/design-suggestions`)).json()).data.length, 0)
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 1)
  console.log(`PASS pending design persistence, copy gating and unapplied successful suggestion; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
