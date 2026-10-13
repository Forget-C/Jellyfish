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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1', SCENE_BROWSER_TEST_LEGACY_DURATION: '8' },
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
  const designed = structuredClone(version.content)
  designed.design.direction.shots = [{ id: 'planned-shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '待拍动作', sources: [{ kind: 'human', reference: 'author', version: '1' }] } }]
  const prepared = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content: designed }) })
  assert.equal(prepared.status, 200, await prepared.text())
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('switch', { name: '自动保存', exact: true }).click()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '选择素材 1', exact: true }).click()
  await page.getByText('旧生产计划素材：请按当前方案人工核对适用性', { exact: true }).waitFor()
  await page.getByText(`原所属生产计划：${library[0].origin_id}`, { exact: true }).waitFor()
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '预览当前素材', exact: true }).click()
  const video = page.getByLabel('当前素材视频', { exact: true })
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1)
  assert.equal(await video.evaluate(node => node.duration), 8)
  assert.equal(await video.evaluate(node => node.paused), true)
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  await page.getByRole('button', { name: '准备待拍占位', exact: true }).click({ timeout: 5000 })
  await page.getByRole('combobox', { name: '占位所属镜头', exact: true }).click()
  await page.getByText('镜头 1：待拍动作', { exact: true }).click()
  await page.getByRole('spinbutton', { name: '占位预计时长毫秒', exact: true }).fill('5000')
  await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).fill('1000')
  await page.getByRole('button', { name: '添加待拍占位', exact: true }).click()
  await page.getByRole('spinbutton', { name: '片段源入点毫秒', exact: true }).fill('0')
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('1000')
  await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).fill('6000')
  await page.getByRole('button', { name: '采用当前素材', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const before = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(before.content.timeline.items[0].kind, 'planned')
  assert.equal(before.content.timeline.items[0].estimated_duration_ms, 5000)
  assert.equal(before.content.timeline.items[1].timeline_start_ms, 6000)
  await page.getByRole('button', { name: '播放整场时间线', exact: true }).click()
  await page.getByLabel('时间线待拍占位', { exact: true }).waitFor()
  await page.getByText('待拍占位 · 预计 5000 毫秒，不代表真实覆盖', { exact: true }).waitFor()
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '停止时间线', exact: true }).click()
  await page.getByRole('button', { name: '用当前素材替换片段 1', exact: true }).click()
  assert.equal(await page.getByRole('spinbutton', { name: '片段源入点毫秒', exact: true }).inputValue(), '')
  assert.equal(await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).inputValue(), '')
  assert.equal(await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).inputValue(), '1000')
  await page.getByRole('spinbutton', { name: '片段源入点毫秒', exact: true }).fill('0')
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('8000')
  await page.getByRole('button', { name: '应用替换', exact: true }).click()
  await page.getByText('片段时间位置重叠，请调整起点或源区间；原时间线保持不变。', { exact: true }).waitFor()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, before)
  assert.equal(await page.getByRole('heading', { name: '片段 1 · 待拍占位', exact: true }).count(), 1)
  await page.getByRole('spinbutton', { name: '片段源出点毫秒', exact: true }).fill('4000')
  await page.getByRole('button', { name: '应用替换', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const after = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(after.content.timeline.items[0].id, before.content.timeline.items[0].id)
  assert.equal(after.content.timeline.items[0].kind, 'media')
  assert.deepEqual(after.content.timeline.items[0].media_range, { source_in_ms: 0, source_out_ms: 4000 })
  assert.equal(after.content.timeline.items[0].timeline_start_ms, 1000)
  assert.deepEqual(after.content.timeline.items[1], before.content.timeline.items[1])
  await page.getByText('空白 5000–6000 毫秒', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.timeline, before.content.timeline)
  await page.reload()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '时间线', exact: true }).click()
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  assert.equal(await page.getByRole('spinbutton', { name: '占位预计时长毫秒', exact: true }).inputValue(), '5000')
  assert.equal(await page.getByRole('spinbutton', { name: '片段时间线起点毫秒', exact: true }).inputValue(), '1000')
  await page.getByRole('spinbutton', { name: '占位预计时长毫秒', exact: true }).fill('3000')
  await page.getByRole('button', { name: '保存片段修改', exact: true }).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const trimmed = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(trimmed.content.timeline.items[0].estimated_duration_ms, 3000)
  assert.equal(trimmed.content.timeline.items[0].timeline_start_ms, 1000)
  assert.deepEqual(trimmed.content.timeline.items[1], before.content.timeline.items[1])
  await page.getByText('空白 4000–6000 毫秒', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑片段 1', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('spinbutton', { name: '占位预计时长毫秒', exact: true }).fill('2000')
  assert.equal(await page.getByRole('button', { name: '保存片段修改', exact: true }).isDisabled(), true)
  await page.getByText('原片段已变化或失效，请重新选择；当前时间线保持不变。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.timeline, before.content.timeline)
  assert.deepEqual((await (await fetch(sceneUrl)).json()).data.takes, originalTakes)
  console.log(`PASS planned replacement conflict preserves timeline and undo; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
