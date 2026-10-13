import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rename, readFile } from 'node:fs/promises'
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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_FRAMING: '1', SCENE_BROWSER_TEST_LEGACY_DURATION: '60', SCENE_BROWSER_TEST_LEGACY_AUDIO: '1' },
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
  content.timeline.items = [{ kind: 'media', id: 'original-sixty', take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, fit: 'contain', media_range: { source_in_ms: 0, source_out_ms: 60000 }, timeline_start_ms: 0 }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  const detailUrl = `${versionsUrl}/${version.id}`
  const records = async () => (await (await fetch(`${detailUrl}/exports`)).json()).data
  const serverVersion = async () => (await (await fetch(detailUrl)).json()).data
  const mediaPath = join(output, 'objects/files/legacy-take.mp4')
  const originalBytes = await readFile(mediaPath)
  await page.locator('.canvas-workbench-toolbar').getByTitle('1080 档 · 1920×1080', { exact: true }).click()
  await page.getByText('720 档 · 1280×720', { exact: true }).last().click()
  await page.getByRole('button', { name: '导出整场视频', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '整场导出：等待执行' }).waitFor()
  const first = (await records())[0]
  await rename(mediaPath, mediaPath + '.offline')
  try {
    const failed = await fetch(`${api}/browser-test/exports/${first.task_id}/run`, { method: 'POST' })
    assert.equal(failed.status, 200, await failed.text())
  } finally { await rename(mediaPath + '.offline', mediaPath) }
  assert.equal((await records())[0].status, 'failed')
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('45000')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  await page.locator('.canvas-workbench-toolbar').getByTitle('720 档 · 1280×720', { exact: true }).click()
  await page.getByText('1080 档 · 1920×1080', { exact: true }).last().click()
  await page.getByRole('button', { name: '导出记录', exact: true }).click()
  const record = page.getByRole('region', { name: '当前导出记录', exact: true })
  await record.getByText('失败', { exact: true }).waitFor()
  await record.getByRole('button', { name: '按原记录重试', exact: true }).click()
  await record.getByText('等待执行', { exact: true }).waitFor()
  const retry = (await records())[0]
  assert.equal(retry.retry_of_task_id, first.task_id)
  assert.equal(retry.snapshot.content.timeline.items[0].media_range.source_out_ms, 60000)
  assert.equal(retry.snapshot.profile.size, 720)
  assert.equal((await serverVersion()).content.timeline.items[0].media_range.source_out_ms, 60000)
  await page.getByRole('button', { name: '返回画布', exact: true }).click()
  await page.getByRole('region', { name: '时间线片段 1', exact: true }).getByText('源区间：0–45000 毫秒', { exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: '未保存' }).waitFor()
  const retried = await fetch(`${api}/browser-test/exports/${retry.task_id}/run`, { method: 'POST' })
  assert.equal(retried.status, 200, await retried.text())
  await page.getByRole('button', { name: '导出记录', exact: true }).click()
  await record.getByText('已完成', { exact: true }).waitFor({ timeout: 10000 })
  const completed = (await records()).find(row => row.task_id === retry.task_id)
  const firstBytes = await page.evaluate(async url => {
    const response = await fetch(url, { headers: { Range: 'bytes=0-1023' } })
    return { status: response.status, length: (await response.arrayBuffer()).byteLength }
  }, completed.download_url)
  assert.deepEqual(firstBytes, { status: 206, length: 1024 })
  await page.route(`**/files/${completed.file_id}/download`, route => route.abort())
  assert.equal(await page.evaluate(async url => { try { await fetch(url, { cache: 'no-store' }); return false } catch { return true } }, completed.download_url), true)
  assert.equal((await records()).length, 2)
  assert.equal((await records()).find(row => row.task_id === retry.task_id).status, 'succeeded')
  await page.unroute(`**/files/${completed.file_id}/download`)
  const downloadEvent = page.waitForEvent('download')
  await record.getByRole('link', { name: '下载成片', exact: true }).click()
  const originalDownload = await downloadEvent
  const originalFile = join(output, 'original-sixty.mp4')
  await originalDownload.saveAs(originalFile)
  const probe = file => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })).streams.find(row => row.codec_type === 'video')
  const sixty = probe(originalFile)
  assert.equal(sixty.width, 1280); assert.equal(sixty.height, 720)
  assert.ok(Math.abs(Number(sixty.duration) - 60) < 0.04)
  await page.getByRole('button', { name: '返回画布', exact: true }).click()
  await page.getByRole('button', { name: '保存并导出整场视频', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '整场导出：等待执行' }).waitFor()
  const current = (await records())[0]
  assert.equal(current.snapshot.content.timeline.items[0].media_range.source_out_ms, 45000)
  assert.equal(current.snapshot.profile.size, 1080)
  assert.equal((await serverVersion()).content.timeline.items[0].media_range.source_out_ms, 45000)
  const rendered = await fetch(`${api}/browser-test/exports/${current.task_id}/run`, { method: 'POST' })
  assert.equal(rendered.status, 200, await rendered.text())
  await page.getByRole('button', { name: '导出记录', exact: true }).click()
  await record.getByText('已完成', { exact: true }).waitFor({ timeout: 10000 })
  const currentEvent = page.waitForEvent('download')
  await record.getByRole('link', { name: '下载成片', exact: true }).click()
  const currentDownload = await currentEvent
  const currentFile = join(output, 'current-forty-five.mp4')
  await currentDownload.saveAs(currentFile)
  const fortyFive = probe(currentFile)
  assert.equal(fortyFive.width, 1920); assert.equal(fortyFive.height, 1080)
  assert.ok(Math.abs(Number(fortyFive.duration) - 45) < 0.04)
  assert.equal((await records()).length, 3)
  assert.equal((await records()).find(row => row.task_id === first.task_id).status, 'failed')
  assert.equal((await records()).find(row => row.task_id === retry.task_id).status, 'succeeded')
  assert.deepEqual(await readFile(mediaPath), originalBytes)
  const oldAgain = await fetch(`${api}${completed.download_url}`)
  assert.deepEqual(Buffer.from(await oldAgain.arrayBuffer()), await readFile(originalFile))
  console.log(`PASS original 60-second retry, unsaved 45-second edit, actual downloads and interrupted download recovery; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
