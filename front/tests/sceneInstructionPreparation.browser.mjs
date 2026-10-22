import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl, workbenchShot } from './workbenchControls.mjs'
import { unitCard, closeWorkbenchDetails } from './workbenchControls.mjs'
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
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
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
  const content = version.content
  content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: { state: 'proposal', text: '准备指令', sources: [{ kind: 'human', reference: 'fixture', version: '1' }] } }]
  content.units = [{ id: 'unit', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [{ id: 'coverage', shot_id: 'shot', action_scope: '拆开信封' }] }]
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...structuredClone(makeWorkspace().designs[0].content.cinematography[0]), id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  const savedResponse = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content }) })
  assert.equal(savedResponse.status, 200, await savedResponse.clone().text())
  const saved = (await savedResponse.json()).data

  const tasksUrl = `${versionsUrl}/${version.id}/units/unit/instruction-suggestions`
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchShot(page, '镜头 1：准备指令')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '生成配置')
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const primary = page.getByRole('navigation', { name: '当前指令主操作', exact: true })
  await page.getByRole('button', { name: '单元准备状态', exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('button', { name: '补齐当前单元准备', exact: true }).count(), 0)
  const suggestions = page.getByRole('region', { name: '当前单元指令建议', exact: true })
  assert.equal(await suggestions.getByRole('button', { name: '生成当前单元指令建议', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '单元准备状态', exact: true }).click()
  await page.getByRole('group', { name: '单元准备状态选项', exact: true }).getByRole('button', { name: '填写预计时长', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.id === 'scene-unit-duration')
  assert.deepEqual((await (await fetch(tasksUrl)).json()).data, [])
  await unitCard(page, '生成配置')
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('5')
  await page.route('**/video-generation-options?*', route => route.abort('failed'))
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByRole('button', { name: '单元准备状态', exact: true }).click()
  await page.getByRole('group', { name: '单元准备状态选项', exact: true }).getByRole('button', { name: /模型能力核实失败/ }).click()
  await page.getByText('模型能力读取失败', { exact: true }).waitFor()
  assert.deepEqual((await (await fetch(tasksUrl)).json()).data, [])
  await page.unroute('**/video-generation-options?*')
  await page.getByRole('button', { name: '重试模型能力', exact: true }).click()
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '单元准备状态', exact: true }).filter({ hasText: '准备齐备' }).waitFor()

  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await primary.getByRole('button', { name: '生成当前单元指令建议', exact: true }).waitFor()
  await primary.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await primary.getByRole('button', { name: '查看指令任务', exact: true }).waitFor()
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 1)
  const missingCameraVersion = (await (await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '缺少摄影工作单定位' }) })).json()).data
  const missingCameraContent = structuredClone(saved.content)
  missingCameraContent.design.cinematography = []
  assert.equal((await fetch(`${versionsUrl}/${missingCameraVersion.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content: missingCameraContent }) })).status, 200)
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${missingCameraVersion.id}&view=units`)
  await (await workbenchShot(page, '镜头 1：准备指令')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '生成配置')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '单元准备状态', exact: true }).click()
  await page.getByRole('group', { name: '单元准备状态选项', exact: true }).getByRole('button', { name: /镜头缺少摄影工作单/ }).click()
  await page.getByRole('button', { name: '建立工作单', exact: true }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${missingCameraVersion.id}`)).json()).data.content.design.cinematography.length, 0, '问题定位只打开创建表单，不自动创建工作单')
  console.log(`PASS instruction preparation locates missing duration before generation; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
