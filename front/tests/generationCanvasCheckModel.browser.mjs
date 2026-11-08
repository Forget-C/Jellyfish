import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openCanvasCard, closeCanvasDetails, prepareCanvasCard, assertControlReachable } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-check-model-')
const api = 'http://127.0.0.1:8311'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const json = { 'Content-Type': 'application/json' }
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8311' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 80 && backend.exitCode === null, 'isolated backend ready')
    try { if ((await fetch(base)).ok) break } catch {}
    await delay(250)
  }
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'),
    server: { host: '127.0.0.1', port: 4311, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '独立文字检查' }) })).json()).data
  const canvasUrl = `${base}/${canvas.id}`
  const document = { ...canvas.document, cards: [
    { id: 'shot', type: 'direction.shot', estimated_duration: { text: '12 秒', state: 'proposal' },
      visible_result: { text: '保留灯光', state: 'fact' } },
    { id: 'target', type: 'model.video', config: { seconds: 5 }, input_bindings: [
      { id: 'upstream-binding', input_port: 'text',
        source: { canvas_id: canvas.id, card_id: 'upstream', port_id: 'text', position: 0 } },
    ] },
    { id: 'upstream', type: 'model.text', model_id: 'canvas-runtime-text',
      prompt: { segments: [{ id: 'source-text', kind: 'text', text: '检查依赖的独立来源' }] } },
    { id: 'check', type: 'review.check', enabled_categories: ['P01', 'P06'] },
  ], edges: [
    { id: 'adopt', source_card: 'shot', source_port: 'text', target_card: 'target', target_port: 'text' },
    { id: 'adopt-upstream', source_card: 'upstream', source_port: 'text', target_card: 'target', target_port: 'text' },
    { id: 'observe', source_card: 'target', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { target: { text: ['adopt', 'adopt-upstream'] }, check: { check_basis: ['observe'] } } }
  const seed = await fetch(canvasUrl, { method: 'PUT', headers: json, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  await page.getByRole('toolbar', { name: '卡片分类' }).getByRole('button', { name: '检查', exact: true }).click()
  const menu = page.getByRole('navigation', { name: '添加卡片' })
  assert.ok((await menu.boundingBox()).width >= 240, 'short check category keeps a usable search width')
  await menu.getByRole('searchbox', { name: '搜索卡片' }).fill('检查')
  await menu.getByRole('button', { name: '检查卡', exact: true }).waitFor()
  await menu.getByRole('button', { name: '关闭卡片列表' }).click()
  const face = page.locator('[data-card-id="check"]')
  await face.getByRole('button', { name: /^全部 \d+ 项$/ }).waitFor()
  assert.ok(await face.getByRole('button', { name: /^查看检查项：/ }).count() > 0, 'face shows actual check items before opening details')
  await openCanvasCard(page, 'check')
  const editor = page.locator('.generation-card-editor:visible')
  assert.equal(await page.getByRole('dialog', { name: '检查卡', exact: true }).getAttribute('aria-modal'), 'true', 'desktop opens the check editor directly as a modal')
  await editor.getByRole('region', { name: '已采用要求落实', exact: true })
    .getByText('暂不可执行 · 请选择独立的文字检查模型', { exact: true }).waitFor()
  await editor.getByRole('combobox', { name: '文字检查模型' }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('controlled-text', { exact: true }).click()
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  for (let attempt = 0; ; attempt++) {
    const saved = (await (await fetch(canvasUrl)).json()).data.document.cards.find(card => card.id === 'check')
    if (saved.check_model_id === 'canvas-runtime-text') break
    assert.ok(attempt < 60, 'selected check model is saved')
    await delay(100)
  }
  const state = await (await fetch(canvasUrl)).json()
  assert.equal(state.data.document.cards.find(card => card.id === 'check').check_model_id, 'canvas-runtime-text')
  await page.reload()
  await prepareCanvasCard(page, 'check')
  await face.getByRole('button', { name: '检查', exact: true }).click()
  assert.equal(await editor.count(), 0, 'quick check does not open the editor')
  await face.getByRole('button', { name: '取消本轮检查', exact: true }).waitFor()
  const frozenOrder = await face.getByRole('button', { name: /^查看检查项：/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
  await page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(`${canvas.id}/checks/check/reports`))
  assert.deepEqual(await face.getByRole('button', { name: /^查看检查项：/ }).evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))), frozenOrder, 'running checks keep their row positions')
  assert.ok(frozenOrder.length <= 4, 'face has a finite item list')
  await page.screenshot({ path: join(output, 'check-face-running.png') })
  const controlUrl = `${api}/test/runtime-controls`
  const beforeEdit = (await (await fetch(canvasUrl)).json()).data
  const changedDocument = structuredClone(beforeEdit.document)
  changedDocument.cards.find(card => card.id === 'shot').visible_result.text = '保留柔和灯光'
  const changed = await fetch(canvasUrl, { method: 'PUT', headers: json, body: JSON.stringify({ request_id: 'change-running-basis', expected_revision: beforeEdit.revision, document: changedDocument }) })
  assert.ok(changed.ok, await changed.text())
  await page.reload()
  await prepareCanvasCard(page, 'check')
  await face.getByRole('button', { name: /查看检查项：.*可见结果/ }).locator('[data-check-status="待重查"]').waitFor()
  await fetch(controlUrl, { method: 'POST', headers: json, body: JSON.stringify({ check_release: true }) })
  await page.waitForResponse(response => response.request().method() === 'GET' && response.url().endsWith(`${canvas.id}/checks/check/reports`))
  await face.locator('[data-check-status="待重查"]').first().waitFor()
  assert.equal(await editor.count(), 0, 'closed detail does not interrupt report polling')
  await face.getByRole('button', { name: '查看卡片问题' }).click()
  const checkIssues = page.getByRole('region', { name: '卡片问题', exact: true })
  const staleResult = checkIssues.getByRole('listitem').filter({ hasText: /可见结果.*待重查/ })
  await staleResult.getByRole('button', { name: '查看检查报告', exact: true }).click()
  const pinnedReport = editor.getByRole('region', { name: '检查报告', exact: true })
  await pinnedReport.getByText('保留灯光', { exact: true }).waitFor()
  assert.equal(await pinnedReport.getByText('12 秒', { exact: true }).filter({ visible: true }).count(), 0, 'explicit item opens only the matching report item')
  await pinnedReport.getByRole('button', { name: '定位当前来源', exact: true }).click()
  await page.locator('[data-card-details="shot"]').getByRole('textbox', { name: '可见结果内容' }).waitFor()
  await closeCanvasDetails(page)
  await openCanvasCard(page, 'check')
  await pinnedReport.getByText('保留灯光', { exact: true }).waitFor()
  await pinnedReport.getByRole('button', { name: '查看整份报告', exact: true }).click()
  await closeCanvasDetails(page)
  await face.getByRole('button', { name: /^查看检查项：/ }).first().click()
  assert.equal(await editor.getByRole('tab', { name: '生成前检查', exact: true }).getAttribute('aria-selected'), 'true')
  const preSize = await editor.boundingBox()
  await editor.getByRole('tab', { name: '检查记录', exact: true }).click()
  assert.deepEqual(await editor.boundingBox(), preSize, 'switching tabs keeps the modal bounds')
  await page.keyboard.press('Escape')
  await editor.waitFor({ state: 'hidden' })
  await openCanvasCard(page, 'check')
  assert.equal(await editor.getByRole('tab', { name: '检查记录', exact: true }).getAttribute('aria-selected'), 'true', 'ordinary reopen restores the last page')
  await page.mouse.click(2, 2)
  await editor.waitFor({ state: 'hidden' })
  await face.getByRole('button', { name: /^查看检查项：/ }).first().click()
  assert.equal(await editor.getByRole('tab', { name: '生成前检查', exact: true }).getAttribute('aria-selected'), 'true', 'explicit item takes priority over the restored tab')
  await editor.getByRole('tab', { name: '检查记录', exact: true }).click()
  const report = page.getByRole('region', { name: '检查报告', exact: true })
  const statuses = report.getByRole('list', { name: '模型检查执行状态' })
  await report.getByText('风险建议', { exact: true }).waitFor()
  await report.getByText('保留灯光', { exact: true }).waitFor()
  await statuses.getByRole('button', { name: '重新检查此项', exact: true }).click()
  await report.getByRole('button', { name: '查看最新报告', exact: true }).waitFor()
  await report.getByText(/整卡检查/).waitFor()
  await report.getByRole('button', { name: '查看最新报告', exact: true }).click()
  await report.getByText(/单项检查/).waitFor()
  await report.getByText('12 秒', { exact: true }).waitFor()
  const { check_calls: calls } = await (await fetch(controlUrl)).json()
  assert.equal(calls.length, 3)
  assert.equal(calls.filter(field => field === 'visible_result').length, 1)
  assert.equal(calls.filter(field => field === 'estimated_duration').length, 2)
  const history = await (await fetch(`${canvasUrl}/checks/check/reports`)).json()
  assert.equal(history.data.length, 2)
  assert.equal(history.data[1].results.length, 2)
  assert.ok(history.data[1].executions.some(execution => execution.status === 'failed'))
  const currentBasis = (await (await fetch(`${canvasUrl}/checks/check`)).json()).data.basis
  assert.deepEqual(currentBasis.observed_model_inputs, ['upstream'])
  await editor.getByRole('tab', { name: '生成前检查', exact: true }).click()
  const basisRequests = []
  page.on('request', request => {
    if (request.method() === 'GET' && request.url().endsWith(`${canvas.id}/checks/check`)) basisRequests.push(request.url())
  })
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 50, 'canvas SSE was not connected')
    if ((await (await fetch(controlUrl)).json()).stream_connections > 0) break
    await delay(100)
  }
  const upstream = await (await fetch(`${canvasUrl}/precheck`, { method: 'POST', headers: json,
    body: JSON.stringify({ card_id: 'upstream' }) })).json()
  assert.ok(upstream.data.can_run)
  const generated = await fetch(`${canvasUrl}/runs`, { method: 'POST', headers: json,
    body: JSON.stringify({ request_id: 'upstream-output', preview_token: upstream.data.preview_token }) })
  assert.ok(generated.ok, await generated.text())
  await fetch(controlUrl, { method: 'POST', headers: json, body: JSON.stringify({ release: 1 }) })
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 50)
    const runtime = (await (await fetch(`${canvasUrl}/runtime`)).json()).data
    if (JSON.stringify(runtime.runs).includes('第二段')) break
    await delay(100)
  }
  assert.equal(basisRequests.length, 0, 'provisional upstream text does not reload the check basis')
  const refreshed = page.waitForResponse(response => response.url().endsWith(`${canvas.id}/checks/check`))
  await fetch(controlUrl, { method: 'POST', headers: json, body: JSON.stringify({ release: 2 }) })
  assert.ok((await refreshed).ok())
  await editor.getByText('生成检查依据', { exact: true }).click()
  await editor.getByRole('region', { name: '实际提交文本' }).getByText(/第一段第二段第三段/).waitFor()
  const taskList = (await (await fetch(`${api}/api/v1/film/tasks?project_id=canvas-project&target_id=${history.data[1].id}`)).json()).data
  assert.equal(taskList.items[0].source.check_report_id, history.data[1].id)
  const params = new URLSearchParams({ tab: 'generation', canvas: canvas.id, check: taskList.items[0].source.check_card_id,
    report: taskList.items[0].source.check_report_id })
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?${params}`)
  await report.getByText(/整卡检查/).waitFor()
  await page.screenshot({ path: join(output, 'check-task-link-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await report.getByText(/整卡检查/).waitFor()
  assert.equal(await page.locator('.wb-details:visible').evaluate(node => node.scrollWidth <= node.clientWidth), true)
  await page.screenshot({ path: join(output, 'check-task-link-mobile.png') })
  await editor.getByRole('tab', { name: '生成前检查', exact: true }).click()
  await assertControlReachable(editor.getByRole('button', { name: '重新检查', exact: true }), 'narrow check footer')
  await closeCanvasDetails(page)
  await page.getByRole('toolbar', { name: '卡片分类' }).getByRole('button', { name: '检查', exact: true }).click()
  const menuBox = await menu.boundingBox()
  assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= 390, 'narrow check menu stays within viewport')
  assert.equal(await menu.evaluate(node => node.scrollWidth <= node.clientWidth), true)
  await menu.getByRole('button', { name: '关闭卡片列表' }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  params.set('report', '00000000-0000-0000-0000-000000000000')
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?${params}`)
  await report.getByText('指定报告暂不可用', { exact: true }).waitFor()
  assert.equal(await report.getByRole('list', { name: '模型检查执行状态' }).count(), 0, 'missing explicit report does not show actions for another report')
  const sound = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '声音能力检查' }) })).json()).data
  const soundDocument = { ...sound.document, cards: [
    { id: 'sound', type: 'direction.guidance', sound_strategy: { text: '使用音频参考', state: 'fact' } },
    { id: 'target', type: 'model.text', model_id: 'canvas-runtime-text' },
    { id: 'check', type: 'review.check', enabled_categories: ['P08'] },
  ], edges: [
    { id: 'adopt', source_card: 'sound', source_port: 'text', target_card: 'target', target_port: 'text' },
    { id: 'observe', source_card: 'target', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { target: { text: ['adopt'] }, check: { check_basis: ['observe'] } } }
  const soundSaved = await fetch(`${base}/${sound.id}`, { method: 'PUT', headers: json,
    body: JSON.stringify({ request_id: 'seed-sound', expected_revision: 0, document: soundDocument }) })
  assert.ok(soundSaved.ok, await soundSaved.text())
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?tab=generation&canvas=${sound.id}`)
  await openCanvasCard(page, 'check')
  await editor.getByRole('switch', { name: '启用类别：声音要求与已声明能力匹配', exact: true }).waitFor()
  await editor.getByRole('button', { name: '检查', exact: true }).click()
  await editor.getByRole('tab', { name: '检查记录', exact: true }).click()
  await report.getByText(/音频参考输入：明确不支持/).waitFor()
  await report.getByText(/实际音轨的对白准确性.*未核验/).waitFor()
  await report.getByRole('list', { name: '要求证据', exact: true }).getByText(/使用音频参考/).waitFor()
  await report.getByRole('button', { name: '补充说明后重新检查', exact: true }).click()
  await report.getByRole('textbox', { name: '本次复核说明', exact: true }).fill('请按原模型能力复核')
  await report.getByRole('button', { name: '按原报告复核', exact: true }).click()
  await report.getByRole('button', { name: '查看最新报告', exact: true }).click()
  await report.getByText(/原报告复核 · /).waitFor()
  await report.getByText(/音频参考输入：明确不支持/).filter({ visible: true }).waitFor()
  assert.equal((await (await fetch(controlUrl)).json()).check_calls.length, 3, 'explicit P08 and recheck required no provider call')
  const many = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '检查清单边界' }) })).json()).data
  const manyUrl = `${base}/${many.id}`
  const shots = Array.from({ length: 6 }, (_, index) => ({ id: `shot-${index}`, name: `镜头${index + 1}`, type: 'direction.shot', estimated_duration: { text: '12 秒', state: 'proposal' } }))
  const manyDocument = { ...many.document, cards: [...shots, { id: 'target', type: 'model.video', config: { seconds: 5 } }, { id: 'check', type: 'review.check', enabled_categories: ['P06'] }],
    edges: [...shots.map(shot => ({ id: `adopt-${shot.id}`, source_card: shot.id, source_port: 'text', target_card: 'target', target_port: 'text' })), { id: 'observe', source_card: 'target', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' }],
    input_order: { target: { text: shots.map(shot => `adopt-${shot.id}`) }, check: { check_basis: ['observe'] } } }
  const seeded = await fetch(manyUrl, { method: 'PUT', headers: json, body: JSON.stringify({ request_id: 'seed-many', expected_revision: 0, document: manyDocument }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?tab=generation&canvas=${many.id}`)
  await face.getByText(/已启用 6 项/).waitFor()
  assert.equal(await face.getByRole('button', { name: /^查看检查项：/ }).count(), 4)
  await openCanvasCard(page, 'check')
  const category = editor.getByRole('region', { name: '明确时长要求匹配', exact: true })
  const itemSwitch = category.getByRole('switch', { name: /^纳入整卡检查：镜头1/ })
  await itemSwitch.uncheck()
  const categorySwitch = category.getByRole('switch', { name: '启用类别：明确时长要求匹配', exact: true })
  await categorySwitch.uncheck()
  await categorySwitch.check()
  assert.equal(await itemSwitch.isChecked(), false, 'category toggle preserves excluded items')
  await page.screenshot({ path: join(output, 'check-pre-desktop.png') })
  await page.setViewportSize({ width: 1440, height: 500 })
  await assertControlReachable(editor.getByRole('button', { name: '检查', exact: true }), 'short desktop check footer')
  const firstItem = category.getByRole('button', { name: /^镜头1 ·/ })
  await firstItem.click()
  await category.getByRole('button', { name: '定位来源' }).click()
  await page.getByRole('dialog', { name: '镜头1', exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: '检查卡', exact: true }).count(), 0)
  await openCanvasCard(page, 'check')
  assert.equal(await firstItem.getAttribute('aria-expanded'), 'true', 'returning from the source keeps the check item expanded')
  const checkPage = editor.getByRole('region', { name: '生成前检查', exact: true })
  const position = await checkPage.evaluate(element => { element.scrollTop = 100; return element.scrollTop })
  assert.ok(position > 0, 'long list scrolls within the short modal')
  await page.waitForFunction(() => document.querySelector('[aria-label="生成前检查"]')?.scrollTop > 0)
  await closeCanvasDetails(page)
  await openCanvasCard(page, 'check')
  assert.equal(await checkPage.evaluate(element => element.scrollTop), position, 'reopen restores the current page scroll')
  await page.screenshot({ path: join(output, 'check-pre-short-desktop.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await face.getByText(/已启用 5 项/).waitFor()
  await page.reload()
  await face.getByText(/已启用 5 项/).waitFor()
  const other = await page.context().newPage()
  await other.goto(page.url())
  await other.getByText('此画布当前只读', { exact: true }).waitFor()
  await openCanvasCard(other, 'check')
  await other.getByRole('tab', { name: '检查记录', exact: true }).click()
  assert.equal(await other.getByRole('combobox', { name: '检查记录筛选' }).isEnabled(), true, 'readonly can browse reports')
  await other.getByRole('tab', { name: '生成前检查', exact: true }).click()
  assert.equal(await other.locator('.generation-card-editor:visible').getByRole('button', { name: '检查', exact: true }).isDisabled(), true)
  await other.close()
  const single = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '未纳入整卡的单项检查' }) })).json()).data
  const singleSeed = await fetch(`${base}/${single.id}`, { method: 'PUT', headers: json, body: JSON.stringify({
    request_id: 'seed-single', expected_revision: 0,
    document: { ...single.document, cards: [shots[0], ...manyDocument.cards.slice(-2)],
      edges: manyDocument.edges.filter(edge => ['adopt-shot-0', 'observe'].includes(edge.id)),
      input_order: { target: { text: ['adopt-shot-0'] }, check: { check_basis: ['observe'] } } },
  }) })
  assert.ok(singleSeed.ok, await singleSeed.text())
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?tab=generation&canvas=${single.id}`)
  await face.getByText(/已启用 1 项/).waitFor()
  await openCanvasCard(page, 'check')
  await itemSwitch.uncheck()
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await face.getByText(/已启用 0 项/).waitFor()
  await openCanvasCard(page, 'check')
  const excluded = category.getByRole('button', { name: /^检查此项：镜头1/ })
  await excluded.click()
  await category.getByRole('button', { name: /^重新检查此项：镜头1/ }).waitFor()
  await closeCanvasDetails(page)
  await face.getByText(/已启用 0 项/).waitFor()
  await face.getByRole('button', { name: '查看卡片问题', exact: true }).click()
  const excludedIssue = page.getByRole('region', { name: '卡片问题', exact: true }).getByRole('listitem').filter({ hasText: /镜头1.*风险建议/ })
  await excludedIssue.getByRole('button', { name: '查看检查报告', exact: true }).click()
  await editor.getByRole('tab', { name: '检查记录', exact: true, selected: true }).waitFor()
  await editor.getByRole('region', { name: '检查报告', exact: true }).getByText(/单项检查/).waitFor()
  console.log('check model, partial failure, single-item retry, and sound capability rule passed')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
