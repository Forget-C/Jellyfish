import { selectWorkbenchOption } from './workbenchControls.mjs'
import { exportControl } from './workbenchControls.mjs'
import { locateCanvasNode } from './workbenchControls.mjs'
import { workbenchControl } from './workbenchControls.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
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
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  const detailUrl = `${versionsUrl}/${version.id}`
  await selectWorkbenchOption(page, '片段 1 构图', '居中填满')
  await page.route(`**/versions/${version.id}`, async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '导出前保存失败夹具' }) })
    return route.continue()
  })
  await (await exportControl(page, '保存并导出整场视频')).click()
  await page.getByRole('dialog', { name: '整场导出', exact: true }).getByText('保存尚未成功，未提交导出；请核实保存结果后重试。', { exact: true }).waitFor()
  assert.equal((await (await fetch(`${detailUrl}/exports`)).json()).data.length, 0)
  await page.unroute(`**/versions/${version.id}`)
  let releaseSave, saveEntered
  const saveGate = new Promise(resolve => { releaseSave = resolve })
  const saveStarted = new Promise(resolve => { saveEntered = resolve })
  await page.route(`**/versions/${version.id}`, async route => {
    if (route.request().method() === 'PUT') { saveEntered(); await saveGate }
    await route.continue()
  })
  await (await exportControl(page, '保存并导出整场视频')).click()
  await saveStarted
  await page.getByRole('dialog', { name: '整场导出', exact: true }).getByRole('button', { name: '返回画布', exact: true }).click()
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  releaseSave()
  await (await exportControl(page, '导出记录')).click()
  await page.getByRole('complementary', { name: '整场导出记录', exact: true }).getByText('等待执行', { exact: true }).waitFor()
  await page.locator('.wb-details:visible').getByRole('button', { name: '返回画布', exact: true }).click()
  await (await workbenchControl(page, '版本管理', 'button', '另存为新版本')).click()
  await page.getByText(/关联任务尚未结束：导出整场视频/).waitFor()
  assert.equal((await (await fetch(versionsUrl)).json()).data.length, 1)
  await page.unroute(`**/versions/${version.id}`)
  await (await exportControl(page, '导出记录')).click()
  await page.getByText('等待执行', { exact: true }).waitFor()
  const records = async () => (await (await fetch(`${detailUrl}/exports`)).json()).data
  const first = (await records())[0]
  assert.equal((await records()).length, 1)
  assert.equal(first.snapshot.content.output_aspect_ratio, '16:9')
  assert.equal(first.snapshot.content.timeline.items.length, 2)
  assert.equal(first.snapshot.content.timeline.items[0].fit, 'cover')
  await page.locator('.wb-details:visible').getByRole('button', { name: '返回画布', exact: true }).click()
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await locateCanvasNode(page, '时间线')
  await selectWorkbenchOption(page, '场次输出画幅', '1:1 方形')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const run = await fetch(`${api}/browser-test/exports/${first.task_id}/run`, { method: 'POST' })
  assert.equal(run.status, 200, await run.text())
  await (await exportControl(page, '导出记录')).click()
  const record = page.getByRole('region', { name: '当前导出记录', exact: true })
  await record.getByText('已完成', { exact: true }).waitFor({ timeout: 10000 })
  assert.equal((await records())[0].snapshot.content.output_aspect_ratio, '16:9')
  const downloadEvent = page.waitForEvent('download')
  await record.getByRole('link', { name: '下载成片', exact: true }).click()
  const download = await downloadEvent
  const file = join(output, 'first-download.mp4')
  await download.saveAs(file)
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }))
  const video = probe.streams.find(row => row.codec_type === 'video')
  assert.equal(video.width, 1920)
  assert.equal(video.height, 1080)
  assert.equal(video.r_frame_rate, '30/1')
  assert.ok(Math.abs(Number(video.duration) - 6) < 0.04)
  await page.getByLabel('导出成片预览', { exact: true }).evaluate(async node => { await node.play() })
  await page.locator('.wb-details:visible').getByRole('button', { name: '返回画布', exact: true }).click()
  assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('video')).every(node => node.paused)), true)
  await page.getByLabel('导出成片预览', { exact: true }).waitFor({ state: 'detached' })
  await exportControl(page, '导出记录')
  await page.getByTitle('1080 档 · 1080×1080', { exact: true }).click()
  await page.getByText('720 档 · 720×720', { exact: true }).last().click()
  await page.getByRole('button', { name: '2 个片段将普通放大', exact: true }).click()
  await page.getByText('将进行普通缩放，不增加原素材真实细节，也不会重新拍摄或 AI 超分。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '2 个片段将普通放大', exact: true }).click()
  let lostRequest
  await page.route(`**/versions/${version.id}/exports`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    lostRequest = route.request().postDataJSON()
    const accepted = await route.fetch()
    assert.equal(accepted.status(), 200)
    await route.abort()
  })
  await (await exportControl(page, '导出整场视频')).click()
  await page.getByRole('button', { name: '核实原导出请求', exact: true }).waitFor()
  await page.getByRole('dialog', { name: '整场导出', exact: true }).getByRole('button', { name: '返回画布', exact: true }).click()
  assert.equal(await (await workbenchControl(page, '版本管理', 'button', '另存为新版本')).isDisabled(), true)
  await page.unroute(`**/versions/${version.id}/exports`)
  await page.reload()
  await page.getByRole('button', { name: '查看导出待核实状态', exact: true }).waitFor()
  await (await exportControl(page, '核实原导出请求')).click()
  await (await exportControl(page, '导出整场视频')).waitFor()
  assert.equal((await records()).length, 2)
  assert.equal((await records())[0].request_id, lostRequest.request_id)
  assert.equal((await records())[0].snapshot.content.output_aspect_ratio, '1:1')
  assert.equal((await records())[0].snapshot.profile.size, 720)
  assert.equal((await records())[0].snapshot.profile.width, 720)
  await (await exportControl(page, '导出记录')).click()
  await page.getByRole('button', { name: '取消此导出', exact: true }).click()
  await record.getByText('已取消', { exact: true }).waitFor()
  await page.getByRole('button', { name: '按原记录重试', exact: true }).click()
  await record.getByText('等待执行', { exact: true }).waitFor()
  const retried = (await records())[0]
  assert.equal((await records()).length, 3)
  assert.equal(retried.retry_of_task_id, (await records())[1].task_id)
  assert.deepEqual(retried.snapshot, (await records())[1].snapshot)
  await page.locator('.wb-details:visible').getByRole('button', { name: '返回画布', exact: true }).click()
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&exportTask=${first.task_id}`)
  await record.getByText('已完成', { exact: true }).waitFor()
  assert.ok((await record.textContent()).includes('16:9'))
  await record.getByRole('button', { name: '定位片段 2', exact: true }).click()
  await page.getByRole('region', { name: '时间线片段 2', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '时间线片段 2', exact: true }).evaluate(node => document.activeElement === node), true)
  await page.route('**/export-inspection', route => route.abort())
  await exportControl(page, '导出记录')
  await page.getByTitle('1080 档 · 1080×1080', { exact: true }).click()
  await page.getByText('720 档 · 720×720', { exact: true }).last().click()
  await page.getByText('导出媒体检查失败', { exact: true }).waitFor()
  assert.equal((await records()).length, 3)
  await page.unroute('**/export-inspection')
  await page.getByRole('button', { name: '重查导出媒体', exact: true }).click()
  await page.getByRole('button', { name: '2 个片段将普通放大', exact: true }).waitFor()
  await (await exportControl(page, '导出记录')).click()
  await record.getByRole('button', { name: '删除成果文件', exact: true }).click({ timeout: 5000 })
  const deletion = page.getByRole('dialog', { name: '删除这份导出成果？', exact: true })
  await deletion.getByRole('button', { name: '保留文件', exact: true }).click()
  assert.equal((await records()).find(row => row.task_id === first.task_id).file_deleted, false)
  await record.getByRole('button', { name: '删除成果文件', exact: true }).click()
  await page.route(`**/exports/${first.task_id}/file`, async route => {
    const accepted = await route.fetch()
    assert.equal(accepted.status(), 200)
    await route.abort()
  })
  await deletion.getByRole('button', { name: '删除成果文件', exact: true }).click()
  await deletion.getByRole('button', { name: '关闭并核实', exact: true }).waitFor()
  assert.equal((await records()).find(row => row.task_id === first.task_id).file_deleted, true)
  await page.unroute(`**/exports/${first.task_id}/file`)
  await deletion.getByRole('button', { name: '删除成果文件', exact: true }).click()
  await record.getByText('成果文件已删除，成功记录仍保留', { exact: true }).waitFor()
  assert.equal((await records()).length, 3)
  assert.equal((await records()).find(row => row.task_id === first.task_id).status, 'succeeded')
  assert.equal((await records()).find(row => row.task_id === first.task_id).download_url, null)
  console.log(`PASS real export download, frozen input, unknown replay and original retry; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
