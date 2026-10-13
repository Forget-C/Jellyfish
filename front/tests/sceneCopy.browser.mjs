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
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  const before = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('9:16 竖屏', { exact: true }).last().click()
  let writes = 0, copies = 0, release
  page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith(`/versions/${version.id}`)) writes++ })
  await page.route('**/copy-readiness', route => route.abort('failed'))
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.locator('.canvas-workbench-toolbar').getByRole('alert').waitFor()
  await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.hasAttribute('inert'))
  assert.equal((await (await fetch(versionsUrl)).json()).data.length, 1)
  assert.equal(writes, 0)
  await page.unroute('**/copy-readiness')
  await page.evaluate(() => {
    window.originalCopyStorageSet = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('jellyfish:scene-copy:')) throw new DOMException('Fixture storage failure', 'QuotaExceededError')
      return window.originalCopyStorageSet.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.getByText(/Fixture storage failure/).waitFor()
  await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.hasAttribute('inert'))
  assert.equal((await (await fetch(versionsUrl)).json()).data.length, 1)
  assert.equal(writes, 0)
  await page.evaluate(() => { Storage.prototype.setItem = window.originalCopyStorageSet })
  await page.route('**/versions/*/copy', async route => {
    copies++
    await new Promise(resolve => { release = resolve })
    await route.continue()
  })
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click({ timeout: 5000 })
  await page.getByRole('dialog', { name: '正在另存为新版本', exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.canvas-workbench')?.hasAttribute('inert'))
  for (let i = 0; i < 50 && !release; i++) await delay(100)
  assert.ok(release)
  assert.equal(writes, 0)
  release()
  await page.waitForURL(url => url.searchParams.get('version') !== version.id)
  const copiedId = new URL(page.url()).searchParams.get('version')
  const copied = (await (await fetch(`${versionsUrl}/${copiedId}`)).json()).data
  assert.equal(copied.content.output_aspect_ratio, '9:16')
  assert.equal(copied.copied_from_version_id, version.id)
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, before)
  assert.equal(writes, 0)
  assert.equal(copies, 1)
  await page.unroute('**/versions/*/copy')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let originalRequest
  await page.route('**/versions/*/copy', async route => {
    originalRequest = route.request().postDataJSON()
    const response = await route.fetch()
    assert.equal(response.status(), 200)
    await route.abort('failed')
  }, { times: 1 })
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.getByRole('button', { name: '核实原另存请求', exact: true }).waitFor()
  const count = (await (await fetch(versionsUrl)).json()).data.length
  page.on('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '核实原另存请求', exact: true }).waitFor()
  const replay = page.waitForRequest(request => request.url().endsWith('/copy') && request.method() === 'POST')
  await page.getByRole('button', { name: '核实原另存请求', exact: true }).click()
  assert.deepEqual((await replay).postDataJSON(), originalRequest)
  await page.waitForURL(url => url.searchParams.get('version') !== copiedId)
  assert.equal((await (await fetch(versionsUrl)).json()).data.length, count)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.route('**/versions/*/copy', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: '关联任务尚未结束' }) }), { times: 1 })
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.getByText('关联任务尚未结束', { exact: true }).first().waitFor()
  await page.waitForFunction(() => !document.querySelector('.canvas-workbench')?.hasAttribute('inert'))
  assert.equal((await (await fetch(versionsUrl)).json()).data.length, count)
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('1:1 方形', { exact: true }).last().click()
  const savingId = new URL(page.url()).searchParams.get('version')
  let releaseSave, copyWhileSaving = 0
  await page.route(`**/versions/${savingId}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await new Promise(resolve => { releaseSave = resolve })
    await route.continue()
  })
  await page.route('**/versions/*/copy', async route => { copyWhileSaving++; await route.continue() })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  for (let i = 0; i < 50 && !releaseSave; i++) await delay(100)
  assert.ok(releaseSave)
  await page.getByRole('combobox', { name: '场次输出画幅', exact: true }).click()
  await page.getByText('16:9 横屏', { exact: true }).last().click()
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.getByRole('dialog', { name: '正在另存为新版本', exact: true }).waitFor()
  assert.equal(copyWhileSaving, 0)
  releaseSave()
  await page.waitForURL(url => url.searchParams.get('version') !== savingId)
  assert.equal(copyWhileSaving, 1)
  const savedOrigin = (await (await fetch(`${versionsUrl}/${savingId}`)).json()).data
  const savedCopy = (await (await fetch(`${versionsUrl}/${new URL(page.url()).searchParams.get('version')}`)).json()).data
  assert.equal(savedOrigin.content.output_aspect_ratio, '1:1')
  assert.equal(savedCopy.content.output_aspect_ratio, '16:9')
  console.log(`PASS unsaved copy, page lock, refresh recovery, rejection and in-flight save coordination; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
