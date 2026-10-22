import { closeWorkbenchDetails } from './workbenchControls.mjs'
import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchControl } from './workbenchControls.mjs'
import { workbenchShot } from './workbenchControls.mjs'
import { unitCard, selectWorkbenchOption } from './workbenchControls.mjs'
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
const api = 'http://127.0.0.1:8247'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8247' },
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4247, strictPort: true, open: false, proxy: { '/api': api } } })
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
  content.design.direction.shots = [{ id: 'shot-one', beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: [], criterion_ids: [], narrative_function: {}, visible_result: note('抬头') }]
  const detail = `${versionsUrl}/${version.id}`
  const saved = await fetch(detail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content }) })
  assert.equal(saved.status, 200, await saved.text())
  const before = (await (await fetch(detail)).json()).data
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：抬头')).click()
  await page.getByRole('button', { name: '下一步：单元画布', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: /^(建立单元|为当前镜头建立单元)$/ }).count(), 0)
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'AI设计', exact: true })
  const start = dialog.getByRole('button', { name: '开始设计', exact: true })
  await dialog.getByRole('combobox', { name: '目标视频模型', exact: true }).waitFor()
  assert.equal(await start.isDisabled(), true, 'no global video default must require explicit selection')
  await page.route('**/video-generation-options?*', route => route.abort('failed'))
  await dialog.getByRole('combobox', { name: '目标视频模型', exact: true }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('test-video-model', { exact: true }).click()
  await dialog.getByText(/模型能力核实失败/).waitFor()
  assert.equal(await start.isDisabled(), true)
  await page.unroute('**/video-generation-options?*')
  await dialog.getByRole('button', { name: '重试能力核实', exact: true }).click()
  await dialog.getByText('视频模型能力已核实', { exact: true }).waitFor()
  const longRequirement = Array.from({ length: 40 }, (_, index) => `第${index + 1}项拍摄要求：保持已有动作及空间关系，不新增故事内容。`).join('\n')
  await dialog.getByRole('textbox', { name: '本次要求（可选）', exact: true }).fill(longRequirement)
  await page.route('**/unit-design-suggestions', async route => {
    if (route.request().method() === 'POST') { await route.fetch(); await route.abort('failed') } else await route.continue()
  })
  await start.click()
  await dialog.getByText(/提交未核实，保留原请求/).waitFor()
  await page.unroute('**/unit-design-suggestions')
  await dialog.getByRole('button', { name: '核实原设计请求', exact: true }).click()
  await dialog.getByText('等待执行', { exact: true }).waitFor()
  const rows = (await (await fetch(detail + '/unit-design-suggestions')).json()).data
  assert.equal(rows.length, 1)
  const completed = await fetch(`${api}/browser-test/unit-design-tasks/${rows[0].task_id}/complete`, { method: 'POST' })
  assert.equal(completed.status, 200, await completed.text())
  await dialog.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor({ timeout: 15000 })
  await dialog.getByText('完整动作，单段拍摄', { exact: true }).waitFor()
  await dialog.getByText('固定依据与模型', { exact: true }).click()
  const expandRequirement = dialog.getByRole('button', { name: '展开本次要求', exact: true })
  await expandRequirement.waitFor()
  assert.equal(await expandRequirement.getAttribute('aria-expanded'), 'false')
  await expandRequirement.click()
  const collapseRequirement = dialog.getByRole('button', { name: '收起本次要求', exact: true })
  assert.equal(await collapseRequirement.getAttribute('aria-expanded'), 'true')
  await collapseRequirement.click()
  await dialog.getByText('固定依据与模型', { exact: true }).click()
  assert.deepEqual((await (await fetch(detail)).json()).data, before)
  await page.screenshot({ path: join(output, 'unit-ai-design-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(250)
  await page.screenshot({ path: join(output, 'unit-ai-design-mobile.png'), animations: 'disabled' })
  assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
  await dialog.getByRole('button', { name: '关闭预览', exact: true }).click()
  assert.deepEqual((await (await fetch(detail)).json()).data, before)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '单元设计记录', exact: true }).click()
  const records = page.getByRole('complementary', { name: '单元设计记录', exact: true })
  await records.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'AI设计', exact: true }).isEnabled(), true)
  assert.equal(await page.locator('.canvas-workbench').evaluate(node => node.inert), false)
  await page.getByRole('button', { name: '放大画布', exact: true }).click()
  await page.getByText('110%', { exact: true }).waitFor()
  await records.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'unit-design-records-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  const narrowRecords = page.getByRole('dialog', { name: '单元设计记录', exact: true })
  await narrowRecords.waitFor()
  assert.equal(await narrowRecords.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true)
  await page.screenshot({ path: join(output, 'unit-design-records-mobile.png'), animations: 'disabled' })
  await narrowRecords.getByRole('button', { name: '关闭详情', exact: true }).click()
  const settingsBefore = (await (await fetch(`${api}/api/v1/llm/model-settings`)).json()).data
  assert.equal(settingsBefore.default_video_model_id, null, 'modal model selection must not modify global settings')
  const settingsChanged = await fetch(`${api}/api/v1/llm/model-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_text_model_id: 'browser-text-model', default_video_model_id: 'browser-video-model' }) })
  assert.equal(settingsChanged.status, 200)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.reload()
  await (await workbenchShot(page, '镜头 1：抬头')).click()
  await page.getByRole('button', { name: '下一步：单元画布', exact: true }).click()
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  await dialog.getByText('视频模型能力已核实', { exact: true }).waitFor()
  assert.equal(await start.isDisabled(), false, 'valid global video model must be visibly preselected')
  await start.click()
  await dialog.getByText('等待执行', { exact: true }).waitFor()
  const nextRows = (await (await fetch(detail + '/unit-design-suggestions')).json()).data
  const next = nextRows.find(row => row.task_id !== rows[0].task_id)
  assert.ok(next)
  const multi = await fetch(`${api}/browser-test/unit-design-tasks/${next.task_id}/complete?multiple=true`, { method: 'POST' })
  assert.equal(multi.status, 200, await multi.text())
  await dialog.getByRole('region', { name: '建议单元 2', exact: true }).waitFor({ timeout: 15000 })
  assert.deepEqual((await (await fetch(detail)).json()).data, before)
  await dialog.getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&view=units&directorShot=shot-one&unitDesignTask=${next.task_id}`)
  await records.getByRole('region', { name: '建议单元 2', exact: true }).waitFor({ timeout: 15000 })
  await records.getByText('多个独立执行段', { exact: true }).waitFor()
  await records.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: /历\s*史/ }).click()
  await page.getByRole('row').filter({ hasText: 'AI 设计 · 单元方案' }).first().getByRole('button', { name: /查\s*看/ }).click()
  await records.getByRole('region', { name: '建议单元 2', exact: true }).waitFor({ timeout: 5000 })
  await records.getByRole('button', { name: '关闭详情', exact: true }).click()
  const invalidDefault = await fetch(`${api}/api/v1/llm/model-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_video_model_id: 'browser-text-model' }) })
  assert.equal(invalidDefault.status, 200)
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await (await workbenchShot(page, '镜头 1：抬头')).click()
  await page.getByRole('button', { name: '下一步：单元画布', exact: true }).click()
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  await dialog.getByText('没有有效默认视频模型时，请明确选择。', { exact: true }).waitFor()
  assert.equal(await start.isDisabled(), true, 'invalid global video model must not select first model in list')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&view=units&directorShot=shot-one&unitDesignTask=${next.task_id}`)
  await records.getByRole('button', { name: '比较并应用方案', exact: true }).click()
  await dialog.getByRole('button', { name: '确认应用方案', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByText('已保存', { exact: true }).first().waitFor({ timeout: 10000 })
  const applied = (await (await fetch(detail)).json()).data
  assert.equal(applied.content.units.length, 2)
  assert.equal(applied.content.units[0].organization.source.kind, 'model')
  await page.reload()
  assert.deepEqual((await (await fetch(detail)).json()).data.content, applied.content)
  const manualVersionResponse = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '手动保存方案' }) })
  const manualVersion = (await manualVersionResponse.json()).data
  const manualDetail = `${versionsUrl}/${manualVersion.id}`
  const manualContent = structuredClone(content)
  assert.equal((await fetch(manualDetail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content: manualContent }) })).status, 200)
  await fetch(`${api}/api/v1/llm/model-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ default_video_model_id: 'browser-video-model' }) })
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${manualVersion.id}&view=units&directorShot=shot-one`)
  await (await workbenchControl(page, '保存设置', 'switch', '自动保存')).click()
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await (await workbenchShot(page, '镜头 1：抬头')).click()
  await page.getByRole('button', { name: '下一步：单元画布', exact: true }).click()
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  await dialog.getByText('视频模型能力已核实', { exact: true }).waitFor()
  await start.click()
  await dialog.getByText('等待执行', { exact: true }).waitFor()
  const manualTask = (await (await fetch(manualDetail + '/unit-design-suggestions')).json()).data[0]
  assert.equal((await fetch(`${api}/browser-test/unit-design-tasks/${manualTask.task_id}/complete`, { method: 'POST' })).status, 200)
  await dialog.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor({ timeout: 15000 })
  await page.route(`**/versions/${manualVersion.id}/unit-canvas/preview`, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '测试预览失败' }) }))
  await dialog.getByRole('button', { name: '确认应用方案', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('.canvas-toolbar-identity [role="status"]').filter({ hasText: '未保存' }).waitFor()
  assert.equal((await (await fetch(manualDetail)).json()).data.content.units.length, 0)
  await page.getByText('单元卡片更新失败，当前编辑已保留', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '查看单元设置', exact: true }).count(), 0)
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  const draftCards = page.getByRole('region', { name: '当前单元配置卡片', exact: true })
  await draftCards.getByRole('button', { name: '编辑组织要求', exact: true }).click()
  const organizationSettings = page.locator('.wb-details:visible').filter({ has: page.getByRole('heading', { name: '组织要求', exact: true }) })
  await organizationSettings.getByRole('textbox', { name: '组织进入状态', exact: true }).fill('人工核对进入状态')
  await draftCards.getByText('人工核对进入状态', { exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  await page.unroute(`**/versions/${manualVersion.id}/unit-canvas/preview`)
  await page.getByRole('button', { name: '重试单元卡片', exact: true }).click()
  await unitCard(page, '组织要求')
  await page.locator('[data-canvas-node$=":organization"]').filter({ hasText: '人工核对进入状态' }).waitFor()
  assert.equal((await (await fetch(manualDetail)).json()).data.content.units.length, 0, 'AI 应用及卡片编辑不依赖保存')
  await unitCard(page, '组织要求')
  await page.screenshot({ path: join(output, 'unit-organization-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(250)
  await page.screenshot({ path: join(output, 'unit-organization-mobile.png'), animations: 'disabled' })
  await closeWorkbenchDetails(page)
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.route(`**/versions/${manualVersion.id}`, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '测试保存失败' }) }) : route.continue(), { times: 1 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('保存失败，输入已保留', { exact: true }).waitFor()
  await page.locator('[data-canvas-node$=":organization"]').filter({ hasText: '人工核对进入状态' }).waitFor()
  assert.equal((await (await fetch(manualDetail)).json()).data.content.units.length, 0)
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复编辑', exact: true }).click()
  await page.locator('[data-canvas-node$=":organization"]').filter({ hasText: '人工核对进入状态' }).waitFor()
  assert.equal((await (await fetch(manualDetail)).json()).data.content.units.length, 0, '恢复的单元在保存前已有完整卡片')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.canvas-toolbar-identity [role="status"]').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(manualDetail)).json()).data.content.units[0].organization.entry_state, '人工核对进入状态')
  await page.reload()
  assert.equal((await (await fetch(manualDetail)).json()).data.content.units[0].organization.entry_state, '人工核对进入状态')
  // 确认 HTTP 已发出后用户继续编辑：响应不能覆盖卡片中的新输入。
  const raceVersion = (await (await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), title: '确认在途保护' }) })).json()).data
  const raceDetail = `${versionsUrl}/${raceVersion.id}`
  const raceContent = structuredClone(content)
  raceContent.units = [{ id: 'race-unit', ratio: '16:9', model_id: 'browser-video-model', coverage: [{ id: 'race-coverage', shot_id: 'shot-one', action_scope: '抬头' }] }]
  assert.equal((await fetch(raceDetail, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content: raceContent }) })).status, 200)
  const raceTask = (await (await fetch(raceDetail + '/unit-design-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 2, content: raceContent, source_unit_id: 'race-unit', shot_id: 'shot-one', target_model_id: 'browser-video-model' }) })).json()).data.task_id
  assert.equal((await fetch(`${api}/browser-test/unit-design-tasks/${raceTask}/complete?revise=true`, { method: 'POST' })).status, 200)
  await page.goto(`http://127.0.0.1:4247/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${raceVersion.id}&directorShot=shot-one&unitDesignTask=${raceTask}`)
  await records.getByRole('button', { name: '比较并应用方案', exact: true }).click()
  await dialog.getByRole('heading', { name: '单元方案预览', exact: true }).waitFor()
  let releaseResponse, markRequested
  const heldResponse = new Promise(resolve => { releaseResponse = resolve })
  const requested = new Promise(resolve => { markRequested = resolve })
  await page.route('**/unit-design-suggestions/*/apply', async route => {
    const response = await route.fetch()
    markRequested()
    await heldResponse
    await route.fulfill({ response })
  })
  await dialog.getByRole('button', { name: '确认应用方案', exact: true }).click()
  await requested
  await dialog.getByRole('button', { name: '关闭预览', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  const raceSettings = await unitCard(page)
  await raceSettings.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('人工在途编辑')
  releaseResponse()
  await delay(300)
  assert.equal(await raceSettings.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '人工在途编辑')
  assert.equal((await (await fetch(raceDetail)).json()).data.content.units[0].coverage[0].action_scope, '抬头')
  await page.unroute('**/unit-design-suggestions/*/apply')
  console.log(`PASS unit AI design preview, auto/manual save and in-flight edit protection; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {})
  console.error(`Browser evidence: ${output}`)
  throw error
} finally {
  await browser?.close()
  await server?.close()
  backend.kill('SIGTERM')
}
