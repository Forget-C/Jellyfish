import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchShot, selectWorkbenchOption } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-instruction-video-')
const api = 'http://127.0.0.1:8262'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8262' },
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
    } catch { /* The dedicated test server is still starting. */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4262, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: note(`可拍变化 ${index + 1}`) }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },

  ] }]
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...structuredClone(makeWorkspace().designs[0].content.cinematography[0]), id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4262/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const card = page.locator('[data-canvas-node="instruction:unit-one"]')
  const actions = card.getByRole('navigation', { name: '当前指令主操作', exact: true })
  await actions.waitFor()
  await card.getByRole('button', { name: '修改指令', exact: true }).click()
  const body = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await body.fill('拆开信封。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await card.getByText(/模型：.*test-video-model/).waitFor()
  await card.getByText(/时长：5 秒.*画幅：16:9.*参考：0/).waitFor()
  let submissions = 0
  page.on('request', request => { if (request.method() === 'POST' && /\/video(?:\/save-and-submit)?$/.test(new URL(request.url()).pathname)) submissions++ })
  await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '按当前内容生成视频', exact: true }).isDisabled(), true)
  assert.equal(submissions, 0)
  await actions.getByRole('button', { name: '核对当前单元指令依据', exact: true }).click()
  await page.getByRole('button', { name: '确认已按当前依据核对正文', exact: true }).click()
  await actions.getByRole('button', { name: '检查当前单元指令', exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await actions.getByRole('button', { name: '检查当前单元指令', exact: true }).click()
  await actions.getByRole('button', { name: '查看当前单元检查任务', exact: true }).waitFor()
  const checksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-checks`
  const checks = (await (await fetch(checksUrl)).json()).data
  assert.equal(checks.length, 1)
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${checks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await actions.getByRole('button', { name: '查看当前单元检查结果', exact: true }).click()
  await page.getByRole('button', { name: '确认已核对检查结果', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await actions.getByRole('button', { name: '生成当前单元视频', exact: true }).waitFor()
  assert.equal(submissions, 0, '检查通过不会自动生成视频')
  await actions.getByRole('button', { name: '生成当前单元视频', exact: true }).click()
  const videosUrl = `${versionsUrl}/${version.id}/units/unit-one/video`
  await actions.getByRole('button', { name: '查看当前单元视频任务', exact: true }).waitFor()
  const videos = (await (await fetch(videosUrl)).json()).data
  assert.equal(videos.length, 1)
  assert.equal(videos[0].preparation.request.execution_prompt, '拆开信封。')
  assert.deepEqual(videos[0].preparation.request.media, { frames: { first: null, last: null, keys: [] }, subjects: [] })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'instruction-card-390.png'), animations: 'disabled' })
  assert.equal(await actions.getByRole('button', { name: '查看当前单元视频任务', exact: true }).isEnabled(), true)
  console.log(`PASS current instruction card owns check and video actions, pure-prompt input stays frozen; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await cleanup()
}
