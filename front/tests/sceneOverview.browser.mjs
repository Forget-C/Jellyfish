import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl, workbenchShot } from './workbenchControls.mjs'
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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193', SCENE_BROWSER_TEST_LEGACY_TAKE: '1' },
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
  const content = version.content
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'overview', version: '1' }] })
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信') }]
  content.units = ['A', 'B'].map(id => ({ id, model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', instruction: `${id}正文`, coverage: [{ id: `${id}-coverage`, shot_id: 'shot', action_scope: `${id}动作` }] }))
  content.timeline.items = [0, 1].map(index => ({ id: crypto.randomUUID(), kind: 'media', take_kind: library[0].take_kind, take_id: library[0].take_id, file_id: library[0].file_id, media_range: { source_in_ms: index * 1000, source_out_ms: (index + 1) * 1000 }, timeline_start_ms: index * 3000, fit: 'contain' }))
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...structuredClone(makeWorkspace().designs[0].content.cinematography[0]), id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(saved.status, 200, await saved.clone().text())
  const baseline = (await saved.json()).data
  const designTaskResponse = await fetch(`${versionsUrl}/${version.id}/design-suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: baseline.revision, content: baseline.content, instruction: '保持读信动作，补齐设计' }) })
  assert.equal(designTaskResponse.status, 200, await designTaskResponse.clone().text())
  const designTask = (await designTaskResponse.json()).data.task_id
  const checkContent = structuredClone(baseline.content)
  const unitUrl = `${versionsUrl}/${version.id}/units/A`
  const confirmation = await fetch(`${unitUrl}/instruction-basis/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: baseline.revision, content: checkContent }) })
  assert.equal(confirmation.status, 200, await confirmation.clone().text())
  checkContent.units[0].instruction_basis_id = (await confirmation.json()).data.basis_id
  const submitted = await fetch(`${unitUrl}/instruction-checks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: baseline.revision, content: checkContent }) })
  assert.equal(submitted.status, 200, await submitted.clone().text())
  const checkTask = (await submitted.json()).data.task_id
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchShot(page, '镜头 1：读信')).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByRole('combobox', { name: '指令所属单元', exact: true }).click()
  await page.getByText('单元 2 · B动作', { exact: true }).last().click()
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('B未保存正文')
  if (await page.getByRole('button', { name: '展开关系树', exact: true }).count()) await page.getByRole('button', { name: '展开关系树', exact: true }).click()
  await page.getByRole('button', { name: '展开全图', exact: true }).click({ timeout: 5000 })
  const overview = page.getByRole('complementary', { name: '全场关系总览', exact: true })
  await overview.getByRole('button', { name: '选择总览对象：素材 1', exact: true }).waitFor()
  assert.equal(await overview.getByRole('button', { name: '选择总览对象：素材 1', exact: true }).count(), 1)
  await overview.getByRole('button', { name: '选择总览对象：片段 2', exact: true }).click()
  await overview.getByText('源区间：1000–2000 毫秒', { exact: true }).waitFor()
  await overview.getByRole('button', { name: '定位当前对象', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '时间线片段 2')
  assert.equal(await page.getByRole('region', { name: '时间线片段 1', exact: true }).count(), 1)
  assert.equal(await page.getByRole('region', { name: '时间线片段 2', exact: true }).count(), 1)
  assert.equal(await page.locator('video').count(), 0)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'B未保存正文')
  await page.route('**/take-library', route => route.abort('failed'))
  if (await page.getByRole('button', { name: '展开关系树', exact: true }).count()) await page.getByRole('button', { name: '展开关系树', exact: true }).click()
  await page.getByRole('button', { name: '展开全图', exact: true }).click()
  await overview.getByText('总览素材读取失败', { exact: true }).waitFor()
  assert.equal(await overview.getByText('本场暂无素材', { exact: true }).count(), 0)
  await overview.getByRole('button', { name: '选择总览对象：单元 1', exact: true }).click()
  assert.equal(await overview.getByRole('button', { name: '定位当前对象', exact: true }).isEnabled(), true)
  await page.unroute('**/take-library')
  await overview.getByRole('button', { name: '重试总览素材', exact: true }).click()
  await overview.getByRole('button', { name: '选择总览对象：素材 1', exact: true }).waitFor()
  await page.route('**/units/A/instruction-checks', route => route.abort('failed'))
  await overview.getByRole('button', { name: '选择总览对象：单元 1 任务与检查', exact: true }).click()
  const history = overview.getByRole('region', { name: '总览任务与检查', exact: true })
  await history.getByText('总览记录读取失败', { exact: true }).waitFor()
  assert.equal(await history.locator('details').count(), 0)
  await page.unroute('**/units/A/instruction-checks')
  await history.getByRole('button', { name: '重新读取任务与检查', exact: true }).click()
  await history.getByText(`任务 ${checkTask} · 等待执行`, { exact: true }).click()
  await history.getByText('当时指令：A正文', { exact: true }).waitFor()
  assert.equal((await fetch(`${api}/browser-test/instruction-checks/${checkTask}/complete`, { method: 'POST' })).status, 200)
  await history.getByText(`任务 ${checkTask} · 已完成`, { exact: true }).waitFor()
  assert.equal(await history.locator('summary').filter({ hasText: `任务 ${checkTask}` }).count(), 1)
  assert.equal((await (await fetch(`${unitUrl}/instruction-checks`)).json()).data.length, 1)
  await overview.getByRole('button', { name: '选择总览对象：整场设计任务', exact: true }).click({ timeout: 5000 })
  const designHistory = overview.getByRole('region', { name: '总览设计任务', exact: true })
  await designHistory.getByText(`任务 ${designTask} · 等待执行`, { exact: true }).click()
  await designHistory.getByText('当时要求：保持读信动作，补齐设计', { exact: true }).waitFor()
  await designHistory.getByText('当时设计', { exact: true }).click()
  assert.equal(await designHistory.getByRole('textbox', { name: '可见结果', exact: true }).isDisabled(), true)
  assert.equal((await fetch(`${api}/browser-test/design-tasks/${designTask}/complete`, { method: 'POST' })).status, 200)
  await designHistory.getByText(`任务 ${designTask} · 已完成`, { exact: true }).waitFor()
  await page.route('**/design-suggestions', route => route.abort('failed'))
  await designHistory.getByRole('button', { name: '重新读取设计任务', exact: true }).click()
  await designHistory.getByText('总览设计任务读取失败', { exact: true }).waitFor()
  assert.equal(await designHistory.getByText('本版本尚无设计任务', { exact: true }).count(), 0)
  await page.unroute('**/design-suggestions')
  await designHistory.getByRole('button', { name: '重新读取设计任务', exact: true }).click()
  await designHistory.getByText(`任务 ${designTask} · 已完成`, { exact: true }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}/design-suggestions`)).json()).data.length, 1)
  const returnBounds = await overview.getByRole('button', { name: '关闭详情', exact: true }).boundingBox()
  assert.ok(returnBounds && returnBounds.y >= 0 && returnBounds.y + returnBounds.height <= 960, '返回当前工作必须在视口内')
  await page.screenshot({ path: join(output, 'overview-history.png'), fullPage: true })
  await overview.getByRole('button', { name: '关闭详情', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), 'B未保存正文')
  assert.deepEqual((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data, baseline)
  console.log(`PASS whole-scene overview identities, targeted navigation and isolated read recovery; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
