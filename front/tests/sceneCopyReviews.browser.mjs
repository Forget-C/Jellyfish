import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { locateCanvasNode } from './workbenchControls.mjs'

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
  content.timeline.items = ['first', 'second'].map((id, index) => ({ kind: 'media', id, take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 1000 }, timeline_start_ms: index * 1000 }))
  content.take_judgments = [{ take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, annotation: { coverage: [], review_status: 'reviewed', verdict: 'retain', rationale: {}, retained_ranges: [{ source_in_ms: 0, source_out_ms: 1000 }] } }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  const savedVersion = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const decision = { verdict: 'pass', overall: '画面已核对', established: '剪辑关系成立', coverage_status: 'verified', coverage_notes: '实际片段已核对', issues: [], sound_status: 'pending_postproduction', sound_notes: '待后期' }
  const reviewResponse = await fetch(`${versionsUrl}/${version.id}/cut-reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: savedVersion.revision, decision }) })
  assert.equal(reviewResponse.status, 200, await reviewResponse.clone().text())
  const review = (await reviewResponse.json()).data
  const seamResponse = await fetch(`${versionsUrl}/${version.id}/seam-reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: savedVersion.revision, left_clip_id: 'first', right_clip_id: 'second', decision: { verdict: 'pass', observation: '边界相接', established: '画面连续', issues: '' } }) })
  assert.equal(seamResponse.status, 200, await seamResponse.clone().text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const publishDelivery = async (id, revision) => {
    const response = await fetch(`${versionsUrl}/${id}/deliveries`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: revision }),
    })
    assert.equal(response.status, 200, await response.clone().text())
  }
  await publishDelivery(version.id, savedVersion.revision)
  const deliveriesUrl = `${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter/deliveries`
  const beforeCopy = (await (await fetch(deliveriesUrl)).json()).data
  assert.equal(beforeCopy.sequences[0].delivery.version_id, version.id)
  await page.getByRole('button', { name: '版本管理', exact: true }).click()
  await page.getByRole('button', { name: '另存为新版本', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('version') !== version.id)
  const copiedId = new URL(page.url()).searchParams.get('version')
  assert.deepEqual((await (await fetch(deliveriesUrl)).json()).data, beforeCopy)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await page.getByText('当前画面验收通过', { exact: true }).waitFor()
  await page.getByText(`引用原版本审片：${version.id}`, { exact: true }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '审查接缝：片段 1 → 2', exact: true }).click()
  await page.getByText(`引用原版本接缝审查：${version.id}`, { exact: true }).waitFor({ timeout: 5000 })
  await locateCanvasNode(page, '同场次素材')
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await locateCanvasNode(page, '方案判断')
  await page.getByText('当前判断与固定审片依据一致', { exact: true }).waitFor()
  await page.getByText(`引用原版本素材审查：${version.id}`, { exact: true }).waitFor({ timeout: 5000 })
  assert.deepEqual((await (await fetch(deliveriesUrl)).json()).data, beforeCopy)
  const copy = (await (await fetch(`${versionsUrl}/${copiedId}`)).json()).data
  await publishDelivery(copiedId, copy.revision)
  const delivery = (await (await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter/deliveries`)).json()).data.sequences[0].delivery
  assert.equal(delivery.version_id, copiedId)
  assert.equal(delivery.review_id, review.id)
  assert.equal(delivery.review.verdict, 'pass')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}/cut-reviews`)).json()).data, [review])
  console.log(`PASS copied cut review provenance and retained chapter delivery API; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
