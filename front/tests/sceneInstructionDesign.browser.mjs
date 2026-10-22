import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl, workbenchShot } from './workbenchControls.mjs'
import { unitCard, closeWorkbenchDetails, selectWorkbenchOption } from './workbenchControls.mjs'
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
const api = 'http://127.0.0.1:8291'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8291' },
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4291, strictPort: true, open: false, proxy: { '/api': api } } })
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

  const tasksUrl = `${versionsUrl}/${version.id}/units/unit/instruction-suggestions`
  await page.goto(`http://127.0.0.1:4291/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  page.setDefaultTimeout(5000)
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await (await workbenchShot(page, '镜头 1：准备指令')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '生成配置')
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '进入指令画布', exact: true }).click()
  const instruction = page.getByRole('textbox', { name: '当前单元指令正文', exact: true })
  await instruction.waitFor()
  assert.equal(await instruction.inputValue(), '')
  assert.deepEqual((await (await fetch(tasksUrl)).json()).data, [], '导航不能起草指令')
  const trigger = page.getByRole('button', { name: 'AI 设计', exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'AI 指令设计', exact: true })
  await dialog.waitFor()
  await dialog.getByText('当前单元 1', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '生成指令', exact: true }).isDisabled(), true, '准备不足只允许查看')
  assert.deepEqual((await (await fetch(tasksUrl)).json()).data, [], '打开 AI 设计不能提交任务')
  await dialog.getByRole('button', { name: '返回画布', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent === 'AI 设计')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCard(page, '生成配置')
  assert.equal(await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).inputValue(), '', '导航保留未保存输入')
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('5')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '进入指令画布', exact: true }).click()
  await trigger.click()
  await dialog.getByRole('button', { name: '生成指令', exact: true }).click()
  await dialog.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const task = (await (await fetch(tasksUrl)).json()).data[0]
  assert.equal(task.requirements, '', '额外要求可以留空')
  assert.equal(task.unit.duration_ms, 5000)
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${task.task_id}/complete`, { method: 'POST' })).status, 200)
  await dialog.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  assert.equal(await instruction.inputValue(), '', '预览建议不能改写当前指令')
  await dialog.getByRole('button', { name: '应用指令建议', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await instruction.inputValue(), '固定中景，手指拆开信封，人物抬眼看向门口。')
  await instruction.fill('应用后手工修改')
  assert.equal(await instruction.inputValue(), '应用后手工修改')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await instruction.inputValue(), '固定中景，手指拆开信封，人物抬眼看向门口。')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await instruction.inputValue(), '', '应用应当可以整次撤销')
  await trigger.click()
  await dialog.getByRole('button', { name: '生成指令', exact: true }).click()
  await dialog.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const backgroundTask = (await (await fetch(tasksUrl)).json()).data.find(row => row.status === 'queued')
  await dialog.getByRole('button', { name: '返回画布', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await instruction.fill('等待期间的新人工指令')
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${backgroundTask.task_id}/complete`, { method: 'POST' })).status, 200)
  const notice = page.getByRole('region', { name: '单元 1 指令任务通知', exact: true })
  await notice.getByText('指令任务已完成', { exact: true }).waitFor({ timeout: 6000 })
  assert.equal(await dialog.isVisible(), false, '后台完成不重开 AI 工作区')
  assert.equal(await instruction.inputValue(), '等待期间的新人工指令')
  await notice.getByRole('button', { name: '定位指令结果', exact: true }).click()
  await dialog.waitFor()
  await dialog.getByRole('button', { name: '应用指令建议', exact: true }).click()
  await dialog.getByText('本单元正文或生成依据已变化，请核对差异后重新生成建议', { exact: false }).waitFor()
  assert.equal(await instruction.inputValue(), '等待期间的新人工指令', '旧建议不能覆盖后续编辑')
  await page.screenshot({ path: join(output, 'instruction-ai-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await dialog.waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  await page.screenshot({ path: join(output, 'instruction-ai-narrow.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal(await instruction.inputValue(), '等待期间的新人工指令')
  const chapterUrl = `${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`
  const chapterNow = (await (await fetch(chapterUrl)).json()).data
  const oldSequence = chapterNow.sequences.find(row => row.id === sequenceId)
  const division = { source_version: chapterNow.source_version,
    baseline: [{ sequence_id: sequenceId, version: oldSequence.version }],
    members: [{ key: 'new', sequence_id: null, title: '新划分', span: { start: 0, end: 4 } }],
    exited_sequence_ids: [sequenceId], lineage: [{ sequence_id: sequenceId, target_keys: ['new'] }] }
  const preview = await fetch(`${chapterUrl}/division/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(division) })
  assert.equal(preview.status, 200)
  const divided = await fetch(`${chapterUrl}/division`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), draft: division, preview_token: (await preview.json()).data.preview_token, identity_changes_confirmed: true }) })
  assert.equal(divided.status, 200, await divided.clone().text())
  const readonlyContext = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const readonlyPage = await readonlyContext.newPage()
  await readonlyPage.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await readonlyPage.goto(`http://127.0.0.1:4291/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await readonlyPage.getByRole('status').filter({ hasText: '历史场次 · 只读' }).waitFor()
  await (await workbenchShot(readonlyPage, '镜头 1：准备指令')).click()
  await readonlyPage.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(readonlyPage, '当前单元', '单元 1')
  await readonlyPage.getByRole('button', { name: '进入指令画布', exact: true }).click()
  await readonlyPage.getByRole('button', { name: 'AI 设计', exact: true }).click()
  const readonlyDialog = readonlyPage.getByRole('dialog', { name: 'AI 指令设计', exact: true })
  assert.equal(await readonlyDialog.getByRole('button', { name: '生成指令', exact: true }).isDisabled(), true)
  assert.equal(await readonlyDialog.getByRole('textbox', { name: '本次指令编写要求', exact: true }).isDisabled(), true)
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 2, '只读浏览不创建任务')
  await readonlyContext.close()
  console.log(`PASS AI instruction workspace navigation, application, and background protection; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
