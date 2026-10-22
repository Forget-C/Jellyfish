import { selectWorkbenchOption } from './workbenchControls.mjs'
import { locateCanvasNode } from './workbenchControls.mjs'
import { workbenchControl } from './workbenchControls.mjs'
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
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 2000 }, timeline_start_ms: index * 2500 }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整整场验收历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByRole('textbox', { name: '整场画面判断', exact: true }).fill('真实画面连贯，构图成立')
  await page.getByRole('textbox', { name: '整场成立内容', exact: true }).fill('动作与反应成立')
  await selectWorkbenchOption(page, '整场覆盖核对', '已核对无覆盖缺口')
  await page.getByRole('textbox', { name: '整场覆盖依据', exact: true }).fill('逐项观看并核对当前动作要求')
  await selectWorkbenchOption(page, '整场画面结论', '画面通过')
  await page.getByRole('button', { name: '记录本次整场验收', exact: true }).click({ timeout: 5000 })
  await page.getByText('当前画面验收通过', { exact: true }).waitFor()
  await page.getByText('当前声音：待后期', { exact: true }).waitFor()
  await page.getByText('当前覆盖核对：已核对无覆盖缺口', { exact: true }).waitFor({ timeout: 5000 })
  const reviewUrl = `${versionsUrl}/${version.id}/cut-reviews`
  const first = (await (await fetch(reviewUrl)).json()).data[0]
  assert.equal(first.matches_current, true)
  assert.equal(first.decision.sound_status, 'pending_postproduction')
  await selectWorkbenchOption(page, '片段 1 构图', '居中填满')
  await page.getByText('整场验收依据已变，请重新审阅当前内容', { exact: true }).waitFor()
  assert.equal(await page.getByText('当前画面验收通过', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '记录本次整场验收', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.deepEqual((await (await fetch(reviewUrl)).json()).data[0], { ...first, matches_current: false })
  await page.getByText('查看整场验收记录 1', { exact: true }).click()
  await page.getByRole('button', { name: '预览历史整场验收 1', exact: true }).click({ timeout: 5000 })
  const history = page.getByRole('complementary', { name: '历史整场预览', exact: true })
  await history.getByText('当时输出画幅：16:9', { exact: true }).waitFor()
  assert.equal(await history.locator('video').count(), 0)
  await history.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  await page.waitForFunction(() => { const node = document.querySelector('.wb-details:not([hidden]) video'); return node && !node.paused && node.currentTime > 0 })
  await history.getByRole('button', { name: '暂停时间线', exact: true }).click()
  assert.equal(await history.getByLabel('时间线媒体', { exact: true }).evaluate(node => getComputedStyle(node).objectFit), 'contain')
  await history.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('当前画面验收通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await selectWorkbenchOption(page, '场次输出画幅', '9:16 竖屏')
  await page.getByText('整场验收依据已变，请重新审阅当前内容', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.deepEqual((await (await fetch(reviewUrl)).json()).data[0], { ...first, matches_current: false })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('当前画面验收通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  let originalRequest
  await page.route('**/cut-reviews', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    originalRequest = route.request().postDataJSON()
    await route.fetch()
    await route.abort()
  })
  await page.getByRole('textbox', { name: '整场画面判断', exact: true }).fill('再次明确核对当前画面')
  await page.getByRole('button', { name: '记录本次整场验收', exact: true }).click()
  await page.getByText('整场验收结果待核实', { exact: true }).waitFor()
  await page.getByRole('button', { name: '核实原整场验收', exact: true }).click({ trial: true })
  await page.unroute('**/cut-reviews')
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整整场验收历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByRole('textbox', { name: '整场画面判断', exact: true }).fill('核实期间的新输入须保留')
  const replay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/cut-reviews'))
  await page.getByRole('button', { name: '核实原整场验收', exact: true }).click()
  assert.deepEqual((await replay).postDataJSON(), originalRequest)
  await page.getByText('整场验收结果待核实', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '整场画面判断', exact: true }).inputValue(), '核实期间的新输入须保留')
  const reviews = (await (await fetch(reviewUrl)).json()).data
  assert.equal(reviews.length, 2)
  assert.deepEqual(reviews[0], first)
  assert.equal(reviews[1].decision.overall, '再次明确核对当前画面')
  await page.route('**/cut-reviews', route => route.request().method() === 'GET' ? route.abort() : route.continue())
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整整场验收历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByText('整场验收记录读取失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('当前画面验收通过', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('textbox', { name: '整场画面判断', exact: true }).inputValue(), '核实期间的新输入须保留')
  await page.unroute('**/cut-reviews')
  await page.getByRole('button', { name: '重读整场验收', exact: true }).click()
  await page.getByText('当前画面验收通过', { exact: true }).waitFor()
  let unexpectedPosts = 0
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/cut-reviews')) unexpectedPosts++ })
  await page.evaluate(() => {
    window.originalReviewSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('scene-cut-review:')) throw new Error('fixture storage unavailable')
      return window.originalReviewSetItem.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: '记录本次整场验收', exact: true }).click()
  await page.getByText('无法保存核实凭据，本次未提交；请恢复本地存储后重试。', { exact: true }).waitFor()
  assert.equal(unexpectedPosts, 0)
  await page.evaluate(() => { Storage.prototype.setItem = window.originalReviewSetItem })
  await page.getByRole('button', { name: '重读本地验收凭据', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '整场画面判断', exact: true }).inputValue(), '核实期间的新输入须保留')
  await selectWorkbenchOption(page, '整场画面结论', '画面需修改')
  await selectWorkbenchOption(page, '整场覆盖核对', '存在覆盖缺口')
  await page.getByRole('textbox', { name: '整场覆盖依据', exact: true }).fill('第二段动作未完整覆盖，需补拍')
  await page.getByRole('textbox', { name: '整场画面判断', exact: true }).fill('重新观看发现覆盖缺口')
  await page.getByRole('button', { name: '记录本次整场验收', exact: true }).click()
  await page.getByText('当前画面仍需修改', { exact: true }).waitFor()
  await page.getByText('当前覆盖核对：存在覆盖缺口', { exact: true }).waitFor()
  await page.getByText('当前声音：待后期', { exact: true }).waitFor()
  assert.equal(await page.getByText('当前画面验收通过', { exact: true }).count(), 0)
  const revised = (await (await fetch(reviewUrl)).json()).data
  assert.equal(revised.length, 3)
  assert.deepEqual(revised.slice(0, 2), reviews)
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  console.log(`PASS fixed scene acceptance, framing invalidation and unknown-response recovery; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
