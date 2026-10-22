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
  content.timeline.items = ['first', 'second', 'third'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: index === 2 ? 3000 : index * 1000 }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整接缝审查历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByRole('button', { name: '审查接缝：片段 1 → 2', exact: true }).click({ timeout: 5000 })
  assert.equal(await page.getByRole('button', { name: '审查接缝：片段 2 → 3', exact: true }).count(), 0)
  const left = page.getByLabel('接缝前段落幅', { exact: true })
  const right = page.getByLabel('接缝后段入幅', { exact: true })
  await page.waitForFunction(() => [...document.querySelectorAll('video[aria-label^="接缝"]')].filter(video => video.readyState >= 2).length === 2)
  assert.ok(Math.abs(await left.evaluate(video => video.currentTime) - 0.999) < 0.002)
  assert.equal(await right.evaluate(video => video.currentTime), 0)
  assert.equal(await left.evaluate(video => video.paused), true)
  assert.equal(await right.evaluate(video => video.paused), true)
  await page.getByRole('textbox', { name: '接缝观察依据', exact: true }).fill('前段落幅和后段入幅方向相符')
  await selectWorkbenchOption(page, '接缝结论', '接缝通过')
  await page.getByRole('button', { name: '记录本次接缝审查', exact: true }).click()
  await page.getByText('所选接缝当前通过', { exact: true }).waitFor()
  const reviewUrl = `${versionsUrl}/${version.id}/seam-reviews`
  const original = (await (await fetch(reviewUrl)).json()).data[0]
  await selectWorkbenchOption(page, '片段 3 构图', '居中填满')
  await page.getByText('所选接缝当前通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.deepEqual((await (await fetch(reviewUrl)).json()).data[0], original)
  await selectWorkbenchOption(page, '片段 1 构图', '居中填满')
  await page.getByText('所选接缝依据已变，请重新核对', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.deepEqual((await (await fetch(reviewUrl)).json()).data[0], { ...original, matches_current: false })
  await page.getByText('查看接缝记录 1', { exact: true }).click()
  await page.getByRole('button', { name: '预览历史接缝 1', exact: true }).click({ timeout: 5000 })
  const history = page.getByRole('complementary', { name: '历史接缝预览', exact: true })
  await history.getByText('当时输出画幅：16:9', { exact: true }).waitFor()
  assert.equal(await history.locator('video').count(), 0)
  await history.getByRole('button', { name: '播放接缝片段', exact: true }).click()
  await page.waitForFunction(() => { const node = document.querySelector('.wb-details:not([hidden]) video'); return node && !node.paused && node.currentTime > 0 })
  await history.getByRole('button', { name: '暂停接缝', exact: true }).click()
  assert.equal(await history.getByLabel('接缝媒体', { exact: true }).evaluate(node => getComputedStyle(node).objectFit), 'contain')
  await history.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('所选接缝当前通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '播放接缝片段', exact: true }).click()
  const seamVideo = page.getByLabel('接缝媒体', { exact: true })
  await page.waitForFunction(() => { const node = document.querySelector('video[aria-label="接缝媒体"]'); return node && !node.paused && node.currentTime > 0 })
  assert.equal(await seamVideo.evaluate(node => node.muted), false)
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  assert.equal(await seamVideo.count(), 0)
  await page.getByRole('button', { name: '停止时间线', exact: true }).click()
  let request
  await page.route('**/seam-reviews', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    request = route.request().postDataJSON(); await route.fetch(); await route.abort()
  })
  await page.getByRole('textbox', { name: '接缝观察依据', exact: true }).fill('重新观看原两侧边界')
  await page.getByRole('button', { name: '记录本次接缝审查', exact: true }).click()
  await page.getByRole('button', { name: '核实原接缝审查', exact: true }).click({ trial: true })
  await page.unroute('**/seam-reviews')
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整接缝审查历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByRole('textbox', { name: '接缝观察依据', exact: true }).fill('核实时保留新观察')
  const replay = page.waitForRequest(row => row.method() === 'POST' && row.url().endsWith('/seam-reviews'))
  await page.getByRole('button', { name: '核实原接缝审查', exact: true }).click()
  assert.deepEqual((await replay).postDataJSON(), request)
  await page.getByText('接缝审查结果待核实', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '接缝观察依据', exact: true }).inputValue(), '核实时保留新观察')
  const records = (await (await fetch(reviewUrl)).json()).data
  assert.equal(records.length, 2)
  assert.deepEqual(records[0], original)
  const mediaPath = new URL(library[0].media_url, api).pathname
  await page.route(`**${mediaPath}*`, route => route.abort())
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整接缝审查历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByText('接缝前段落幅无法读取或定位，暂不能记录新结论', { exact: true }).waitFor()
  await page.getByText('接缝后段入幅无法读取或定位，暂不能记录新结论', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '记录本次接缝审查', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('textbox', { name: '接缝观察依据', exact: true }).inputValue(), '核实时保留新观察')
  await page.unroute(`**${mediaPath}*`)
  await page.getByRole('button', { name: '重试接缝前段落幅', exact: true }).click()
  await page.getByRole('button', { name: '重试接缝后段入幅', exact: true }).click()
  await page.getByRole('button', { name: '记录本次接缝审查', exact: true }).click({ trial: true })
  await page.route('**/seam-reviews', route => route.request().method() === 'GET' ? route.abort() : route.continue())
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await page.getByRole('button', { name: '查看完整接缝审查历史', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByText('接缝记录读取失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('所选接缝当前通过', { exact: true }).count(), 0)
  await page.unroute('**/seam-reviews')
  await page.getByRole('button', { name: '重读接缝记录', exact: true }).click()
  await page.getByText('所选接缝当前通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑片段 2', exact: true }).click()
  await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).fill('1100')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByText('原接缝已不再直接相接或包含占位，请明确重新选择；原观察保留。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '审查接缝：片段 1 → 2', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '记录本次接缝审查', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('textbox', { name: '接缝观察依据', exact: true }).inputValue(), '核实时保留新观察')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByText('所选接缝当前通过', { exact: true }).waitFor()
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  console.log(`PASS local seam review, actual boundaries, preview exclusivity and request recovery; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
