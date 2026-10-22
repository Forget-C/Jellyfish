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

import { opaqueCanvasAddresses, remapCanvasGraph } from './canvas-graph-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await mkdtemp(join(tmpdir(), 'jellyfish-scene-version-'))
const api = 'http://127.0.0.1:8245'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8245', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4245, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; localStorage.setItem('jellyfish:scene-autosave:local-user', 'off') })
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
  content.design.direction.shots = [{ id: 'shot', event_ids: [], blocking_state_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '开门', sources: [{ kind: 'human', reference: 'fixture', version: '1' }] } }]
  content.timeline.items = [
    { kind: 'media', id: 'first', take_kind: 'production_plan', take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 0, source_out_ms: 700 }, timeline_start_ms: 0, fit: 'contain' },
    { kind: 'media', id: 'second', take_kind: 'production_plan', take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: 900, source_out_ms: 1700 }, timeline_start_ms: 700, fit: 'cover' },
    { kind: 'planned', id: 'planned', shot_id: 'shot', estimated_duration_ms: 900, timeline_start_ms: 4000 },
  ]
  content.timeline.items.push(...Array.from({ length: 12 }, (_, index) => ({ kind: 'planned', id: `long-${index}`, shot_id: 'shot', estimated_duration_ms: 500, timeline_start_ms: 5000 + index * 1000 })))
  const detail = `${versionsUrl}/${version.id}`
  const put = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(put.status, 200, await put.clone().text())
  const saved = (await put.json()).data
  const seam = saved.edit_graph.nodes.find(node => node.kind === 'edit_seam')
  assert.ok(seam)
  assert.equal(seam.review_status, 'unreviewed')
  let posts = 0
  await page.route('**/seam-reviews', async route => {
    if (route.request().method() === 'POST') posts++
    return route.continue()
  })
  await page.route(/\/versions(?:\/[^/?]+)?(?:\?.*)?$/, async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const payload = await response.json()
    const rows = Array.isArray(payload.data) ? payload.data : [payload.data]
    for (const row of rows) if (row?.edit_graph) remapCanvasGraph(row.edit_graph, opaqueCanvasAddresses(row.edit_graph))
    await route.fulfill({ response, json: payload })
  })
  await page.goto(`http://127.0.0.1:4245/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  const graph = page.getByLabel('整场剪辑画布视口', { exact: true })
  const seamCard = graph.locator('[data-canvas-node]').filter({ hasText: '真实接缝' }).filter({ hasText: 'first → second' })
  await seamCard.getByRole('button', { name: '定位接缝审查', exact: true }).waitFor({ timeout: 8000 })
  await seamCard.getByText('尚未审查', { exact: true }).waitFor()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '真实接缝', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem', { name: '真实接缝', exact: true }).waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'seam-graph-desktop.png'), fullPage: true })
  await seamCard.getByRole('button', { name: '定位接缝审查', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByLabel('接缝观察依据', { exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '接缝审查')
  assert.equal(await page.getByRole('region', { name: '时间线片段 1', exact: true }).count(), 1)
  assert.equal(await page.getByRole('region', { name: '时间线片段 2', exact: true }).count(), 1)
  assert.equal(posts, 0)
  await page.getByLabel('接缝观察依据', { exact: true }).fill('未提交的当前观察')
  const input = await page.getByLabel('接缝观察依据', { exact: true }).elementHandle()
  await page.getByRole('button', { name: '播放接缝片段', exact: true }).click()
  const playback = page.getByLabel('接缝媒体', { exact: true })
  await playback.waitFor()
  await playback.evaluate(video => { video.playbackRate = 0.1 })
  await page.waitForFunction(() => { const video = document.querySelector('video[aria-label="接缝媒体"]'); return video && !video.paused && video.currentTime > 0 })
  const player = await playback.elementHandle()
  const recorded = await fetch(detail + '/seam-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    request_id: crypto.randomUUID(), expected_revision: saved.revision, left_clip_id: 'first', right_clip_id: 'second',
    decision: { verdict: 'pass', observation: 'HTTP 独立审查证据', established: '动作接续', issues: '' },
  }) })
  assert.equal(recorded.status, 200, await recorded.clone().text())
  const record = (await recorded.json()).data
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await seamCard.getByText('HTTP 独立审查证据', { exact: true }).waitFor({ state: 'attached' })
  assert.equal(await page.getByLabel('接缝观察依据', { exact: true }).inputValue(), '未提交的当前观察')
  assert.equal(await page.getByLabel('接缝观察依据', { exact: true }).evaluate((node, original) => node === original, input), true)
  assert.equal(await playback.evaluate((node, original) => node === original, player), true)
  assert.equal(await playback.evaluate(video => video.paused), false)
  await page.getByRole('button', { name: '停止接缝', exact: true }).click()
  await page.getByRole('button', { name: '浏览整场剪辑', exact: true }).click()
  await seamCard.getByText('当前适用', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '真实接缝', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('menuitem', { name: '真实接缝', exact: true }).waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'seam-graph-narrow.png'), fullPage: true })
  await seamCard.getByRole('button', { name: '定位接缝审查', exact: true }).focus()
  await page.keyboard.press('Enter')
  assert.equal(await page.getByLabel('接缝观察依据', { exact: true }).inputValue(), '未提交的当前观察')
  await page.getByText('查看接缝记录 1', { exact: true }).click()
  await page.getByText('查看接缝固定依据', { exact: true }).click()
  await page.getByLabel('接缝审查', { exact: true }).getByText('HTTP 独立审查证据', { exact: true }).waitFor()
  assert.equal((await (await fetch(detail)).json()).data.revision, saved.revision)
  assert.equal(record.left_clip_id, 'first')
  assert.equal(posts, 0)
  console.log(`PASS seam graph exact opaque navigation, same-revision review refresh, drafts/history and keyboard/narrow; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
