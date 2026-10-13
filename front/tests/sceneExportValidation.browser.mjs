import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, rename } from 'node:fs/promises'
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
  const detailUrl = `${versionsUrl}/${version.id}`
  await page.getByRole('combobox', { name: '片段 1 构图', exact: true }).click()
  await page.getByText('居中填满', { exact: true }).last().click()
  await page.route(`**/versions/${version.id}`, async route => {
    if (route.request().method() === 'PUT') return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '导出前保存失败夹具' }) })
    return route.continue()
  })
  await page.getByRole('button', { name: '保存并导出整场视频', exact: true }).click()
  await page.getByText('保存尚未成功，未提交导出；请核实保存结果后重试。', { exact: true }).waitFor()
  await page.getByText('导出前保存失败夹具', { exact: true }).waitFor()
  assert.equal((await (await fetch(detailUrl)).json()).data.content.timeline.items[0].fit, 'contain')
  assert.equal((await (await fetch(`${detailUrl}/exports`)).json()).data.length, 0)
  await page.unroute(`**/versions/${version.id}`)
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  const mediaPath = join(output, 'objects/files/legacy-take.mp4')
  await rename(mediaPath, mediaPath + '.offline')
  try {
    await page.getByRole('button', { name: '保存并导出整场视频', exact: true }).click()
    await page.getByText(/内容已保存，导出检查失败/).waitFor()
    assert.equal((await (await fetch(`${detailUrl}/exports`)).json()).data.length, 0)
    const persisted = (await (await fetch(detailUrl)).json()).data
    assert.equal(persisted.content.timeline.items[0].fit, 'cover')
    await page.getByRole('button', { name: '定位导出问题片段 1', exact: true }).click({ timeout: 5000 })
    const clip = page.getByRole('region', { name: '时间线片段 1', exact: true })
    await clip.waitFor()
    assert.equal(await clip.evaluate(node => document.activeElement === node), true)
  } finally { await rename(mediaPath + '.offline', mediaPath) }
  await page.getByRole('button', { name: '编辑片段 2', exact: true }).click()
  await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).fill('500')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByText('片段时间位置重叠，请调整起点或源区间；原时间线保持不变。', { exact: true }).waitFor()
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('9001')
  assert.equal(await page.getByRole('button', { name: '保存片段修改', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '准备待拍占位', exact: true }).click()
  await page.getByRole('combobox', { name: '占位所属镜头', exact: true }).click()
  await page.getByText('镜头 1：构图测试', { exact: true }).last().click()
  await page.getByRole('spinbutton', { name: '占位预计时长毫秒', exact: true }).fill('1000')
  await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).fill('7000')
  await page.getByRole('button', { name: '添加待拍占位', exact: true }).click()
  await page.getByRole('button', { name: '保存并导出整场视频', exact: true }).click()
  await page.getByText(/仍为待拍占位，请补齐真实媒体后导出/).waitFor()
  assert.equal((await (await fetch(`${detailUrl}/exports`)).json()).data.length, 0)
  const planned = (await (await fetch(detailUrl)).json()).data
  assert.equal(planned.content.timeline.items.length, 3)
  assert.equal(planned.content.timeline.items[2].kind, 'planned')
  const bypass = await fetch(`${detailUrl}/exports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: planned.revision }) })
  assert.equal(bypass.status, 422)
  assert.equal((await (await fetch(`${detailUrl}/exports`)).json()).data.length, 0)
  const placeholder = page.getByRole('region', { name: '时间线片段 3', exact: true })
  assert.equal(await placeholder.evaluate(node => document.activeElement === node), true)
  for (const index of [3, 2, 1]) await page.getByRole('button', { name: `删除片段 ${index}`, exact: true }).click()
  await page.getByRole('button', { name: '保存并导出整场视频', exact: true }).click()
  await page.getByText('时间线为空，请先添加真实采用后导出。', { exact: true }).waitFor()
  assert.equal((await (await fetch(detailUrl)).json()).data.content.timeline.items.length, 0)
  assert.equal((await (await fetch(`${detailUrl}/exports`)).json()).data.length, 0)
  console.log(`PASS export validation: save failure, missing media location, invalid ranges, overlap, planned and empty timeline create no tasks; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
