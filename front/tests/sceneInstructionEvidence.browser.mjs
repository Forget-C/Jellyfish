import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl, workbenchShot, closeWorkbenchDetails } from './workbenchControls.mjs'
import { unitSettings } from './workbenchControls.mjs'
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
const api = 'http://127.0.0.1:8252'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8252' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4252, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const create = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '覆盖编辑验收' }) })
  assert.equal(create.status, 200)
  const version = (await create.json()).data
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'coverage-browser', version: '1' }] })
  const content = version.content
  content.design.direction.beats = ['beat-one', 'beat-two'].map((id, index) => ({ id, event_ids: [], objective: note(`目标 ${index + 1}`), obstacle: {}, expected_change: {}, must_show: note(`可拍变化 ${index + 1}`) }))
  content.design.events = [{ id: 'event-one', description: note('拆开信封') }]
  content.design.participants = [{ id: 'reader', name: '读信者' }]
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: ['beat-one', 'beat-two'], event_ids: ['event-one'], blocking_state_ids: [], participant_ids: ['reader'], criterion_ids: [], narrative_function: {}, visible_result: note('读信反应') }]
  content.units = [{ id: 'unit-one', model_id: 'browser-video-model', duration_ms: 5000, ratio: '16:9', coverage: [
    { id: 'coverage-one', shot_id: 'shot-one', beat_ids: ['beat-one'], event_ids: [], action_scope: '拆开信封' },
    { id: 'coverage-two', shot_id: 'shot-one', beat_ids: [], event_ids: [], action_scope: '' },
  ] }]
  content.units[0].coverage = content.units[0].coverage.slice(0, 1)
  content.units.push({ ...structuredClone(content.units[0]), id: 'unit-two' })
  const stylesUrl = `${api}/api/v1/studio/projects/canvas-project/directing/styles`
  const styleSource = { kind: 'human', reference: 'browser-style', version: '1' }
  const styleCreate = await fetch(stylesUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: {
    title: '指令输入风格', sources: [styleSource], rules: [{ id: 'camera-rule', role: 'cinematography', requirement: '当次风格：镜头保持稳定', status: 'confirmed', sources: [styleSource] }],
  } }) })
  assert.equal(styleCreate.status, 200)
  const fixedStyle = (await styleCreate.json()).data[0]
  assert.equal((await fetch(`${stylesUrl}/${fixedStyle.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_version: fixedStyle.version }) })).status, 200)
  content.design.style_revision_id = fixedStyle.id
  content.design.direction.viewpoint = note('当次设计：从收信者观察')
  content.design.cinematography = content.design.direction.shots.map((shot, index) => ({ ...structuredClone(makeWorkspace().designs[0].content.cinematography[0]), id: `camera-${index}`, shot_id: shot.id, criterion_ids: [] }))
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  await page.goto(`http://127.0.0.1:4252/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const primaryTasksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-suggestions`
  const primaryTask = (await (await fetch(primaryTasksUrl)).json()).data[0]
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByLabel('已保存指令记录').getByText('建议 · 等待执行', { exact: true }).waitFor({ timeout: 6000 })
  const before = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  const input = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await input.fill('刷新期间保留的未保存正文')
  const handle = await input.elementHandle()
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${primaryTask.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByLabel('已保存指令记录').getByText('建议 · 已完成', { exact: true }).waitFor({ timeout: 6000 })
  assert.equal(await input.inputValue(), '刷新期间保留的未保存正文')
  assert.equal(await input.evaluate((node, original) => node === original, handle), true)
  assert.equal(await input.evaluate(node => node === document.activeElement), true)
  const after = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(after.revision, before.revision)
  assert.equal(after.content.units[0].instruction, '')
  // 两次读取同一 revision，先发请求迟到时不能把新证据退回 queued。
  const detailPattern = `**/versions/${version.id}`
  let releaseOld, firstStarted
  const started = new Promise(resolve => { firstStarted = resolve })
  let reads = 0
  await page.route(detailPattern, async route => {
    if (route.request().method() !== 'GET') return route.continue()
    reads += 1
    if (reads === 1) {
      firstStarted()
      await new Promise(resolve => { releaseOld = resolve })
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data: before }) })
    } else await route.continue()
  })
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await started
  const newerRead = page.waitForResponse(response => response.url().endsWith(`/versions/${version.id}`) && response.request().method() === 'GET')
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await newerRead
  await input.focus()
  releaseOld()
  await delay(250)
  await page.getByLabel('已保存指令记录').getByText('建议 · 已完成', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), '刷新期间保留的未保存正文')
  assert.equal(await input.evaluate((node, original) => node === original, handle), true)
  assert.equal(await input.evaluate(node => node === document.activeElement), true)
  await page.unroute(detailPattern)
  await page.route(detailPattern, route => route.abort('failed'))
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '图证据读取失败' }).waitFor()
  await page.getByLabel('已保存指令记录').getByText('建议 · 已完成', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), '刷新期间保留的未保存正文')
  await page.unroute(detailPattern)
  await page.getByRole('button', { name: '刷新图证据', exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('alert').filter({ hasText: '图证据读取失败' }).waitFor({ state: 'hidden' })
  // 外部新记录可从 graph 精确打开，不能依赖已经停止轮询的旧历史列表。
  const externalTaskResponse = await fetch(primaryTasksUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: after.revision, content: after.content, model_id: 'browser-text-model', requirements: '外部记录' }) })
  assert.equal(externalTaskResponse.status, 200, await externalTaskResponse.clone().text())
  const externalTask = (await externalTaskResponse.json()).data
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${externalTask.task_id}/complete`, { method: 'POST' })).status, 200)
  const refreshedGraph = page.waitForResponse(response => response.url().endsWith(`/versions/${version.id}`) && response.request().method() === 'GET')
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await refreshedGraph
  await page.getByRole('button', { name: '查看原建议记录', exact: true }).click()
  await page.getByText('建议 2 · 已完成', { exact: true }).first().waitFor({ timeout: 5000 })
  assert.equal(await input.inputValue(), '刷新期间保留的未保存正文')
  await page.screenshot({ path: join(output, 'instruction-evidence-refresh.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await input.fill('窄屏键盘编辑保留')
  await input.press('ArrowLeft')
  assert.equal(await input.inputValue(), '窄屏键盘编辑保留')
  assert.equal(await input.evaluate(node => node === document.activeElement), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(output, 'instruction-evidence-narrow.png'), animations: 'disabled' })
  // 外部内容变更进入既有冲突处理，不能用证据刷新覆盖本地输入。
  const externalContent = structuredClone(after.content)
  externalContent.units[0].instruction = '另一编辑者保存的正文'
  const externalSave = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: after.revision, content: externalContent }) })
  assert.equal(externalSave.status, 200)
  await page.getByRole('button', { name: '刷新图证据', exact: true }).click()
  await page.getByRole('dialog', { name: '保存冲突 · 比较本地与服务器', exact: true }).waitFor()
  assert.equal(await input.inputValue(), '窄屏键盘编辑保留')
  await page.getByRole('button', { name: '以服务器修订为基线保留本地编辑', exact: true }).click()
  assert.equal(await input.inputValue(), '窄屏键盘编辑保留')
  console.log(`PASS same revision instruction evidence preserves input and focus: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
