import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { closeWorkbenchDetails, directorObject, workbenchControl } from './workbenchControls.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-periodic-save-')
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* 等待独立测试后端启动。 */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  const created = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), title: '周期保存验收' }) })
  assert.equal(created.status, 200)
  const version = (await created.json()).data
  const detailUrl = `${versionsUrl}/${version.id}`
  const saved = async () => (await (await fetch(detailUrl)).json()).data
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
    localStorage.setItem('jellyfish:scene-autosave:local-user', 'off')
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await directorObject(page, '全场叙事与约束')
  const input = page.getByRole('textbox', { name: '观察视点', exact: true })
  await input.waitFor()
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  const requests = []
  let rejectValidation = false
  let malformedGraph
  let holdSave, saveStarted
  await page.route('**/versions/*', async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    requests.push(route.request().postDataJSON())
    if (holdSave) { saveStarted(); await holdSave }
    if (requests.length === 1) await route.abort('failed')
    else if (rejectValidation) await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '观察视点需修正' }) })
    else if (malformedGraph) {
      const response = await route.fetch()
      const body = await response.json()
      body.data[malformedGraph].revision -= 1
      await route.fulfill({ response, json: body })
    } else await route.continue()
  })
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await input.fill('第一次发送的输入')
  await page.clock.runFor(1200)
  assert.equal(requests.length, 0, 'a pause in typing must not submit before the periodic check')
  await input.fill('周期开始时的内容 A')
  await page.clock.runFor(3800)
  await page.getByRole('status').filter({ hasText: '保存失败' }).first().waitFor()
  assert.equal(requests.length, 1)
  assert.equal((await saved()).revision, 1)
  await input.fill('失败后继续编辑的内容 B')
  const retried = page.waitForResponse(response => response.request().method() === 'PUT' && response.status() === 200)
  await page.clock.runFor(5000)
  await retried
  await page.getByRole('status').filter({ hasText: '未保存' }).first().waitFor()
  assert.deepEqual(requests[1], requests[0], 'unknown save must replay the same content, request ID, and revision')
  assert.equal(await input.inputValue(), '失败后继续编辑的内容 B')
  assert.equal((await saved()).content.design.direction.viewpoint.text, '周期开始时的内容 A')
  await page.clock.runFor(5000)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal(requests.length, 3)
  assert.equal(requests[2].expected_revision, 2)
  assert.notEqual(requests[2].request_id, requests[0].request_id)
  assert.equal((await saved()).content.design.direction.viewpoint.text, '失败后继续编辑的内容 B')
  await page.clock.runFor(15000)
  assert.equal(requests.length, 3, 'unchanged content must not generate periodic requests')

  rejectValidation = true
  await input.fill('需要修正的内容')
  await page.clock.runFor(5000)
  await page.getByRole('status').filter({ hasText: '保存失败' }).first().waitFor()
  const invalidAttempts = requests.length
  await page.clock.runFor(10000)
  assert.equal(requests.length, invalidAttempts, 'unchanged invalid input must wait for correction')
  rejectValidation = false
  await input.fill('已修正的内容')
  await page.clock.runFor(5000)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await saved()).content.design.direction.viewpoint.text, '已修正的内容')

  let releaseSave
  holdSave = new Promise(resolve => { releaseSave = resolve })
  const started = new Promise(resolve => { saveStarted = resolve })
  await input.fill('手动保存发送的内容')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await started
  const inFlightCount = requests.length
  await input.fill('手动请求期间继续编辑')
  await page.clock.runFor(15000)
  assert.equal(requests.length, inFlightCount, 'periodic ticks must not overlap a manual save')
  const released = page.waitForResponse(response => response.request().method() === 'PUT' && response.status() === 200)
  releaseSave()
  holdSave = undefined
  await released
  await page.getByRole('status').filter({ hasText: '未保存' }).first().waitFor()
  assert.equal(await input.inputValue(), '手动请求期间继续编辑')
  await page.clock.runFor(5000)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()

  for (const canvas of ['单元画布', '指令画布', '编辑画布', '导演画布']) {
    await page.getByRole('button', { name: '导演画布', exact: true }).click()
    await directorObject(page, '全场叙事与约束')
    await input.fill(`切换到${canvas}后的待保存输入`)
    await closeWorkbenchDetails(page)
    await page.getByRole('button', { name: canvas, exact: true }).click()
    await page.clock.runFor(5000)
    await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
    assert.equal((await saved()).content.design.direction.viewpoint.text, `切换到${canvas}后的待保存输入`)
  }

  await directorObject(page, '全场叙事与约束')
  for (const graphKey of ['director_graph', 'unit_graph']) {
    malformedGraph = graphKey
    const revisionBefore = (await saved()).revision
    await input.fill(`${graphKey} 异常响应中的输入 A`)
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '保存失败' }).first().waitFor()
    const original = requests.at(-1)
    assert.equal((await saved()).revision, revisionBefore + 1, 'server committed despite the malformed graph response')
    await input.fill(`${graphKey} 失败后继续输入 B`)
    assert.equal(await page.getByText('保存失败，输入已保留', { exact: true }).count(), 1)
    malformedGraph = undefined
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '未保存' }).first().waitFor()
    assert.deepEqual(requests.at(-1), original, 'graph response failure replays the original request exactly')
    assert.equal(await input.inputValue(), `${graphKey} 失败后继续输入 B`)
    assert.equal((await saved()).revision, revisionBefore + 1)
    await page.clock.runFor(5000)
    await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
    assert.equal((await saved()).revision, revisionBefore + 2)
    assert.equal((await saved()).content.design.direction.viewpoint.text, `${graphKey} 失败后继续输入 B`)
  }
  const remote = await saved()
  remote.content.design.direction.viewpoint.text = '另一编辑者的新内容'
  const concurrent = await fetch(detailUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: remote.revision, content: remote.content }) })
  assert.equal(concurrent.status, 200)
  await input.fill('冲突时应保留的本地输入')
  await page.clock.runFor(5000)
  await page.getByRole('dialog', { name: '保存冲突 · 比较本地与服务器', exact: true }).waitFor()
  const conflictAttempts = requests.length
  await page.clock.runFor(10000)
  assert.equal(requests.length, conflictAttempts, 'conflict must await an explicit decision')
  assert.equal((await saved()).content.design.direction.viewpoint.text, '另一编辑者的新内容')
  await page.getByRole('button', { name: '以服务器修订为基线保留本地编辑', exact: true }).click()
  assert.equal(await input.inputValue(), '冲突时应保留的本地输入')
  await page.clock.runFor(5000)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await saved()).content.design.direction.viewpoint.text, '冲突时应保留的本地输入')
  console.log(`PASS four-canvas periodic save, retry identity, newer input, validation, serialization, conflict; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Evidence: ${output}\n${backendOutput}`)
  throw error
} finally { await cleanup() }
