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
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const primaryTasksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-suggestions`
  const primaryTask = (await (await fetch(primaryTasksUrl)).json()).data[0]
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${primaryTask.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).waitFor()
  await page.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByText('查看本次固定输入', { exact: true }).click()
  await page.getByText('指令生成模型：test-design-model', { exact: true }).waitFor({ timeout: 5000 })
  await page.getByText('视频模型：test-video-model', { exact: true }).waitFor()
  assert.equal(await page.locator('.wb-details:visible').count(), 0, '原生折叠阅读不激活所属卡片详情')
  await page.getByText('当次适用风格', { exact: true }).click()
  await page.getByText('当次风格：镜头保持稳定', { exact: true }).last().waitFor()
  await page.screenshot({ path: join(output, 'instruction-fixed-inputs.png'), animations: 'disabled' })
  await page.getByText('当次六岗设计', { exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '观察视点', exact: true }).first().inputValue(), '当次设计：从收信者观察')
  assert.equal(await page.getByRole('textbox', { name: '观察视点', exact: true }).first().isDisabled(), true)
  await page.getByText('当次六岗设计', { exact: true }).click()
  await page.getByText('查看本次固定输入', { exact: true }).click()
  await page.route('**/instruction-suggestions', async route => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令提交未核实，保留原请求：', { exact: false }).waitFor()
  await page.getByRole('region', { name: '当前单元指令建议', exact: true }).getByRole('button', { name: '核实原指令请求', exact: true }).waitFor()
  await page.unroute('**/instruction-suggestions')
  await page.getByRole('region', { name: '当前单元指令建议', exact: true }).getByRole('button', { name: '核实原指令请求', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const tasksUrl = `${versionsUrl}/${version.id}/units/unit-one/instruction-suggestions`
  const tasks = (await (await fetch(tasksUrl)).json()).data
  assert.equal(tasks.length, 2)
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${tasks[0].task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('新人工正文不得被覆盖')
  await page.getByRole('button', { name: '应用指令建议', exact: true }).click()
  await page.getByText('本单元正文或生成依据已变化，请核对差异后重新生成建议', { exact: false }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '新人工正文不得被覆盖')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '应用指令建议', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="当前单元指令正文"]')?.value === '固定中景，手指拆开信封，人物抬眼看向门口。')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '固定中景，手指拆开信封，人物抬眼看向门口。')
  const applied = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units
  assert.equal(applied[0].instruction, '固定中景，手指拆开信封，人物抬眼看向门口。')
  assert.equal(applied[1].instruction, '')
  assert.equal(applied[0].instruction_source.kind, 'model')
  assert.ok(applied[0].instruction_source.reference)
  assert.ok(applied[0].instruction_basis_id)
  await page.getByText('指令依据一致，尚不代表检查通过', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].instruction_basis_id, null)
  await page.screenshot({ path: join(output, 'instruction-suggestion.png'), animations: 'disabled' })
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByRole('button', { name: '取消本次指令任务', exact: true }).click()
  await page.getByText('指令任务：已取消', { exact: true }).waitFor()
  const cancelled = (await (await fetch(tasksUrl)).json()).data
  assert.equal(cancelled.length, 3)
  assert.equal(cancelled.filter(row => row.status === 'cancelled').length, 1)
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.route('**/instruction-suggestions', route => route.abort('failed'))
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令建议读取失败', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).isDisabled(), true)
  await page.unroute('**/instruction-suggestions')
  if (await page.getByRole('button', { name: '收起关系树', exact: true }).isVisible()) await page.getByRole('button', { name: '收起关系树', exact: true }).click()
  await page.getByRole('region', { name: '当前单元指令建议', exact: true }).getByRole('button', { name: '重试指令记录', exact: true }).click()
  await page.getByText('指令建议读取失败', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 3)
  let releaseHeld, resolveHeldTask, resolveRetry
  const heldGate = new Promise(resolve => { releaseHeld = resolve })
  const heldTask = new Promise(resolve => { resolveHeldTask = resolve })
  const retried = new Promise(resolve => { resolveRetry = resolve })
  const requests = []
  await page.route('**/instruction-suggestions', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) {
      const response = await route.fetch()
      resolveHeldTask((await response.json()).data.task_id)
      await heldGate
      await route.fulfill({ response })
    } else if (requests.length === 2) {
      await route.fetch(); await route.abort('failed')
    } else { resolveRetry(route.request().postDataJSON()); await route.continue() }
  })
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  const heldTaskId = await heldTask
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${heldTaskId}/complete`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('指令任务：已完成', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令提交未核实，保留原请求：', { exact: false }).waitFor()
  const heldResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/instruction-suggestions'))
  releaseHeld()
  await (await heldResponse).finished()
  await page.getByRole('region', { name: '当前单元指令建议', exact: true }).getByRole('button', { name: '核实原指令请求', exact: true }).click()
  assert.equal((await retried).request_id, requests[1].request_id, 'late response must not clear the newer pending request')
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 5)
  await page.unroute('**/instruction-suggestions')
  await page.getByRole('button', { name: '取消本次指令任务', exact: true }).click()
  await page.getByText('指令任务：已取消', { exact: true }).waitFor()
  let interruptedRequest
  await page.route('**/instruction-suggestions', async route => {
    if (route.request().method() === 'POST') {
      interruptedRequest = route.request().postDataJSON()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('textbox', { name: '本次指令编写要求', exact: true }).fill('刷新后保留原编写要求')
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令提交未核实，保留原请求：', { exact: false }).waitFor()
  await page.unroute('**/instruction-suggestions')
  await page.reload()
  await (await workbenchShot(page, '镜头 1：读信反应')).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('ArrowDown')
  await page.getByRole('combobox', { name: '当前单元', exact: true }).press('Enter')
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByRole('region', { name: '当前单元指令建议', exact: true }).getByRole('button', { name: '核实原指令请求', exact: true }).waitFor({ timeout: 5000 })
  const recoveredRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/instruction-suggestions'))
  await page.getByRole('navigation', { name: '当前指令主操作', exact: true }).getByRole('button', { name: '核实原指令请求', exact: true }).click()
  assert.deepEqual((await recoveredRequest).postDataJSON(), interruptedRequest, 'refresh must preserve the exact original request and input')
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 6)
  await page.getByRole('button', { name: '取消本次指令任务', exact: true }).click()
  await page.getByText('指令任务：已取消', { exact: true }).waitFor()
  await page.evaluate(() => {
    window.originalStorageSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('jellyfish:scene-instruction-request:')) throw new DOMException('Storage full', 'QuotaExceededError')
      return window.originalStorageSetItem.call(this, key, value)
    }
  })
  await page.getByRole('textbox', { name: '本次指令编写要求', exact: true }).fill('存储失败仍保留输入')
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('无法保存原指令请求的恢复信息，尚未提交。请检查浏览器存储后重试', { exact: true }).waitFor()
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 6)
  assert.equal(await page.getByRole('textbox', { name: '本次指令编写要求', exact: true }).inputValue(), '存储失败仍保留输入')
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSetItem })
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  assert.equal((await (await fetch(tasksUrl)).json()).data.length, 7)
  await page.getByRole('button', { name: '取消本次指令任务', exact: true }).click()
  await page.getByText('指令任务：已取消', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).fill('🙂开头旧文结尾')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('combobox', { name: '指令修订范围', exact: true }).click()
  await page.getByText('限定选中文字', { exact: true }).click()
  const rangeText = page.getByRole('textbox', { name: '选择允许修订的正文', exact: true })
  const selectionPoints = await rangeText.evaluate(field => {
    const rect = field.getBoundingClientRect(), style = getComputedStyle(field)
    const measure = document.createElement('canvas').getContext('2d')
    measure.font = style.font
    const x = rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
    const y = rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2
    return { start: x + measure.measureText('🙂开头').width, end: x + measure.measureText('🙂开头旧文').width, y }
  })
  await page.mouse.move(selectionPoints.start, selectionPoints.y)
  await page.mouse.down()
  await page.mouse.move(selectionPoints.end, selectionPoints.y, { steps: 8 })
  await page.mouse.up()
  assert.equal(await rangeText.evaluate(field => field.value.slice(field.selectionStart, field.selectionEnd)), '旧文')
  await page.getByText('允许修改：旧文', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const scopedRows = (await (await fetch(tasksUrl)).json()).data
  const scopedTask = scopedRows.find(row => row.status === 'queued')
  assert.deepEqual(scopedTask.scope, { start: 3, end: 5 })
  const resultText = '🙂开头新的动作结尾'
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${scopedTask.task_id}/complete?${new URLSearchParams({ text: resultText })}`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '🙂开头旧文结尾')
  await page.getByRole('button', { name: '应用指令建议', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="当前单元指令正文"]')?.value === '🙂开头新的动作结尾')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '🙂开头旧文结尾')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const outsideTask = (await (await fetch(tasksUrl)).json()).data.find(row => row.status === 'queued')
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${outsideTask.task_id}/complete?${new URLSearchParams({ text: '越界开头新的动作结尾' })}`, { method: 'POST' })).status, 200)
  await page.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  await page.getByRole('button', { name: '应用指令建议', exact: true }).click()
  await page.getByText('建议修改了限定范围外的正文，整次拒绝应用', { exact: false }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '🙂开头旧文结尾')
  const rejection = page.getByText('建议修改了限定范围外的正文，整次拒绝应用', { exact: false })
  const rejectionBox = await rejection.boundingBox()
  assert.ok(rejectionBox && rejectionBox.y >= 0 && rejectionBox.y + rejectionBox.height <= 960, 'the rejection reason must be visible after applying')
  await page.screenshot({ path: join(output, 'instruction-scope-rejection.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 2 · 拆开信封', { exact: true }).click()
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const secondUnitTasksUrl = tasksUrl.replace('/unit-one/', '/unit-two/')
  const editingTask = (await (await fetch(secondUnitTasksUrl)).json()).data[0]
  await unitSettings(page)
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('等待期间继续修改动作')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${editingTask.task_id}/complete`, { method: 'POST' })).status, 200)
  await page.getByText('指令任务：已完成', { exact: true }).waitFor()
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '等待期间继续修改动作')
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  await page.getByRole('button', { name: '查看指令建议', exact: true }).click()
  await page.getByRole('button', { name: '应用指令建议', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const backgroundTask = (await (await fetch(secondUnitTasksUrl)).json()).data.find(row => row.status === 'queued')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('combobox', { name: '当前单元', exact: true }).click()
  await page.getByText('单元 1 · 拆开信封', { exact: true }).click()
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${backgroundTask.task_id}/complete?${new URLSearchParams({ text: '第二单元后台结果，不覆盖第一单元。' })}`, { method: 'POST' })).status, 200)
  const backgroundNotice = page.getByRole('region', { name: '单元 2 指令任务通知', exact: true })
  await backgroundNotice.getByText('指令任务已完成', { exact: true }).waitFor({ timeout: 6000 })
  await unitSettings(page)
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '拆开信封')
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  await closeWorkbenchDetails(page)
  await backgroundNotice.getByRole('button', { name: '定位指令结果', exact: true }).click()
  await page.getByText('第二单元后台结果，不覆盖第一单元。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const unreadTask = (await (await fetch(secondUnitTasksUrl)).json()).data.find(row => row.status === 'queued')
  await page.route('**/units/unit-two/instruction-suggestions', route => route.abort('failed'))
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  const unreadNotice = page.getByRole('region', { name: '单元 2 指令任务通知', exact: true })
  await unreadNotice.getByText('指令任务状态读取失败', { exact: true }).waitFor({ timeout: 6000 })
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${unreadTask.task_id}/complete?${new URLSearchParams({ text: '重读恢复后的第二单元建议。' })}`, { method: 'POST' })).status, 200)
  await page.unroute('**/units/unit-two/instruction-suggestions')
  await unreadNotice.getByRole('button', { name: '重试通知状态', exact: true }).click()
  await unreadNotice.getByText('指令任务已完成', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  assert.equal((await (await fetch(secondUnitTasksUrl)).json()).data.length, 3)
  await unreadNotice.getByRole('button', { name: '定位指令结果', exact: true }).click()
  await page.getByText('重读恢复后的第二单元建议。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '生成当前单元指令建议', exact: true }).click()
  await page.getByText('指令任务：等待执行', { exact: true }).waitFor()
  const removedTask = (await (await fetch(secondUnitTasksUrl)).json()).data.find(row => row.status === 'queued')
  await (await workbenchControl(page, '版本管理', 'button', '新建场次版本')).click()
  await page.waitForURL(url => url.searchParams.get('version') !== version.id)
  const remainingUrl = page.url()
  const originalVersion = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  const removedContent = { ...originalVersion.content, units: originalVersion.content.units.filter(unit => unit.id !== 'unit-two') }
  const removeResponse = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: originalVersion.revision, content: removedContent }) })
  assert.equal(removeResponse.status, 200, await removeResponse.text())
  assert.equal((await fetch(`${api}/browser-test/instruction-tasks/${removedTask.task_id}/complete`, { method: 'POST' })).status, 200)
  const removedNotice = page.getByRole('region', { name: '单元 2 指令任务通知', exact: true })
  await removedNotice.getByText('指令任务已完成', { exact: true }).waitFor({ timeout: 6000 })
  await removedNotice.getByRole('button', { name: '定位指令结果', exact: true }).click()
  await removedNotice.getByText('原单元或关联镜头已不可用，未切换或选择替代对象', { exact: true }).waitFor()
  assert.equal(page.url(), remainingUrl)
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).count(), 0)
  await page.screenshot({ path: join(output, 'instruction-missing-target.png'), animations: 'disabled' })
  console.log(`PASS instruction suggestion workflow; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
