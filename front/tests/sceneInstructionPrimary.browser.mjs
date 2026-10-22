import { instructionDesign, closeInstructionDesign, selectWorkbenchOption } from './workbenchControls.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl, workbenchShot } from './workbenchControls.mjs'
import { unitCard } from './workbenchControls.mjs'
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
  const submitted = await fetch(tasksUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: saved.content, requirements: '' }) })
  assert.equal(submitted.status, 200, await submitted.clone().text())
  const task = (await submitted.json()).data
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${task.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await closeInstructionDesign(page)
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchShot(page, '镜头 1：准备指令')).click()
  await closeInstructionDesign(page)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  const enter = page.getByRole('button', { name: '进入指令画布', exact: true })
  await enter.click()
  assert.equal(await page.getByRole('dialog', { name: 'AI 指令设计', exact: true }).count(), 0)
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 1)
  await instructionDesign(page)
  await page.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await closeInstructionDesign(page)
  const nextResponse = await fetch(tasksUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, content: saved.content, requirements: '新任务' }) })
  assert.equal(nextResponse.status, 200, await nextResponse.clone().text())
  const nextTask = (await nextResponse.json()).data
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await enter.click()
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('任务期间的人工正文')
  await instructionDesign(page)
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '任务期间的人工正文')

  await closeInstructionDesign(page)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '生成配置')
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('')
  await instructionDesign(page)
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${nextTask.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByText('指令任务：已完成', { exact: true }).waitFor({ timeout: 6000 })
  assert.equal(await page.getByRole('button', { name: '生成指令', exact: true }).isDisabled(), true)
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].duration_ms, 5000)
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '任务期间的人工正文')
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 2)

  console.log(`PASS browsing existing instruction tasks preserves drafts and never creates duplicates; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
