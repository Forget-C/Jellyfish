import { locateCanvasNode } from './workbenchControls.mjs'
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
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整落幅记录历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  const framesUrl = `${versionsUrl}/${version.id}/end-frames`
  const detailUrl = `${versionsUrl}/${version.id}`
  const before = (await (await fetch(detailUrl)).json()).data
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click({ timeout: 5000 })
  await page.getByText('落幅 1：当前采用适用', { exact: true }).waitFor()
  const first = (await (await fetch(framesUrl)).json()).data[0]
  assert.equal(first.at_ms, 960)
  assert.equal(first.source.media_range.source_in_ms, 960)
  assert.equal(first.clip.media_range.source_out_ms, 1000)
  const image = page.getByRole('img', { name: '原素材落幅 1', exact: true })
  await image.evaluate(image => image.decode())
  assert.equal(await image.evaluate(image => image.naturalWidth), 160)
  assert.equal(await image.evaluate(image => image.naturalHeight), 90)
  assert.deepEqual((await (await fetch(detailUrl)).json()).data.content, before.content)
  assert.equal((await (await fetch(detailUrl)).json()).data.revision, before.revision)
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('2000')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByText('落幅 1：依据已变，原图保留', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let submitted
  await page.route('**/end-frames', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    submitted = route.request().postDataJSON()
    const response = await route.fetch()
    assert.equal(response.status(), 200, await response.text())
    await route.abort('failed')
  })
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click()
  await page.getByRole('button', { name: '核实原提帧请求', exact: true }).waitFor()
  const second = (await (await fetch(framesUrl)).json()).data[1]
  assert.equal(second.at_ms, 1960)
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('1500')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.unroute('**/end-frames')
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整落幅记录历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  const replay = page.waitForRequest(request => request.url().endsWith('/end-frames') && request.method() === 'POST')
  await page.getByRole('button', { name: '核实原提帧请求', exact: true }).click()
  assert.deepEqual((await replay).postDataJSON(), submitted)
  await page.getByText('落幅 2：依据已变，原图保留', { exact: true }).waitFor()
  assert.deepEqual((await (await fetch(framesUrl)).json()).data, [{ ...first, matches_current: false }, { ...second, matches_current: false }])
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  assert.equal((await (await fetch(detailUrl)).json()).data.content.units.length, 0)
  await page.route('**/end-frames', route => route.request().method() === 'GET' ? route.abort('failed') : route.continue())
  await page.getByRole('button', { name: '重读落幅记录', exact: true }).click()
  await page.getByText('落幅记录读取失败，当前适用性尚未核实', { exact: true }).waitFor()
  assert.equal(await page.getByText('落幅 2：依据已变，原图保留', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).isDisabled(), true)
  await page.unroute('**/end-frames')
  await page.getByRole('button', { name: '重读落幅记录', exact: true }).click()
  await page.getByText('落幅 2：依据已变，原图保留', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.originalStorageSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('scene-end-frame:')) throw new Error('fixture storage failure')
      return window.originalStorageSetItem.call(this, key, value)
    }
  })
  let unexpectedPosts = 0
  page.on('request', request => { if (request.url().endsWith('/end-frames') && request.method() === 'POST') unexpectedPosts++ })
  await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).click()
  await page.getByText('无法保存提帧核实凭据，本次未提交。', { exact: true }).waitFor()
  assert.equal(unexpectedPosts, 0)
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSetItem })
  await page.getByRole('button', { name: '重读提帧凭据', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '提取片段 1 实际落幅', exact: true }).isEnabled(), true)
  assert.equal((await (await fetch(framesUrl)).json()).data.length, 2)
  console.log(`PASS actual decoded end frame, fixed provenance and original-request recovery; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
