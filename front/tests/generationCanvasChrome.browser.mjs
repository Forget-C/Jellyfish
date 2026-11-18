import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath } from './storyboard-canvas-fixture.mjs'
import { closeCanvasDetails, closePrecheck, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { openCardList } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8420'
const base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8420' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4420, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const chapterRequests = []
  page.on('request', request => { if (/chapters/.test(request.url())) chapterRequests.push(request.url()) })
  await page.goto('http://127.0.0.1:4420/canvases')
  await page.getByRole('button', { name: /新建画布/ }).click()
  await page.waitForURL(/\/canvases\/[^/]+$/)
  const savedName = page.waitForResponse(response => response.request().method() === 'PUT' && response.ok())
  await page.getByRole('textbox', { name: '画布名称' }).fill('菜单中的画布')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await savedName
  await page.getByLabel('画布保存状态').filter({ hasText: '已保存' }).waitFor()
  const freeId = new URL(page.url()).pathname.split('/').at(-1)
  assert.equal((await (await fetch(`${base}/${freeId}`)).json()).data.document.name, '菜单中的画布')
  assert.equal(await page.getByRole('button', { name: '后退', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '前进', exact: true }).isDisabled(), true)
  const surface = await page.getByLabel('生成画布视口').boundingBox()
  assert.ok(surface.y <= 1 && surface.height >= 959, 'canvas fills viewport under floating toolbar')
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  await page.getByRole('complementary', { name: '运行历史', exact: true }).waitFor()
  assert.deepEqual(await page.getByLabel('生成画布视口').boundingBox(), surface)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await openCardList(page, '模型生成')
  await page.getByRole('button', { name: '文本模型卡', exact: true }).click()
  assert.equal(await page.getByRole('button',{name:'预检运行',exact:true}).isDisabled(),true,'empty model input cannot submit')
  await page.getByRole('textbox',{name:'模型正文',exact:true}).fill('画布外壳预检验证')
  await page.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor()
  await page.getByRole('button', { name: '定位问题', exact: true }).first().click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor({ state: 'hidden' })
  await page.locator('.generation-card-editor:visible').waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选择模型')
  await closeCanvasDetails(page)
  const cardMenu = page.getByRole('button', { name: '卡片操作', exact: true })
  await cardMenu.click()
  await page.getByRole('button', { name: /^(取消)?选择卡片$/ }).press('Escape')
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '卡片操作')
  const issues = page.getByRole('button', { name: '查看卡片问题', exact: true })
  await issues.press('Enter')
  const issueList = page.getByRole('region', { name: '卡片问题', exact: true })
  await issueList.getByText('请选择模型', { exact: true }).waitFor()
  await issueList.getByRole('button', { name: '定位模型配置', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选择模型')
  await closeCanvasDetails(page)
  await page.screenshot({ path: join(output, 'chrome-desktop.png'), animations: 'disabled' })
  const independent = (await (await fetch(`${base}/${freeId}`)).json()).data
  const saved = await createStoryboardCanvas(base, '设计诊断工作台')
  const id = saved.id
  const model = independent.document.cards.find(item => item.type === 'model.text')
  const modelId = model.id
  const promptSegmentId = model.prompt.segments[0].id
  const groupedCard = { id: 'grouped', type: 'direction.criterion', name: '编组内验收' }
  const collapsed = { id: 'collapsed', name: '折叠编组', card_ids: [groupedCard.id], collapsed: true }
  const criterion = { id: 'criterion', type: 'direction.criterion', name: '手部可见' }
  const performance = { id: 'performance', type: 'direction.performance' }
  const source = { id: 'phase-source', type: 'content.text', text: '长廊中的手部动作' }
  const movement = { id: 'movement', type: 'direction.movement', phases: [
    { id: 'second', name: '推近', frame: { text: '向前推进', state: 'fact' } },
    { id: 'first', name: '停留', frame: { state: 'fact', document: { segments: [
      { kind: 'reference', id: 'phase-ref', source: { canvas_id: id, card_id: source.id, port_id: 'text', position: 0 } },
    ] } } },
  ] }
  const edge = { id: 'phase-source-edge', source_card: source.id, source_port: 'text', target_card: movement.id, target_port: 'text' }
  const seeded = await fetch(storyboardCanvasApi(base, id), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'diagnostic-targets', expected_revision: saved.revision, document: { ...saved.document, cards: [...saved.document.cards, model, criterion, performance, source, movement, groupedCard], groups: [...(saved.document.groups || []), collapsed], edges: [...saved.document.edges, edge], input_order: { ...saved.document.input_order, [movement.id]: { text: [edge.id] } } } }),
  })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4420${storyboardCanvasPath(saved)}`)
  await page.route('**/precheck?project_id=*', async route => {
    const response = await route.fetch(), payload = await response.json()
    payload.data.diagnostics = [
      { code: 'TITLE_REVIEW', message: '需要核对验收要求名称', severity: 'error', blocks: ['run'], target: { card_id: criterion.id, path: ['name'] } },
      { code: 'TITLE_NOTE', message: '同时核对验收要求来源', severity: 'warning', blocks: [], target: { card_id: criterion.id } },
      { code: 'FIELD_REVIEW', message: '需要核对表演设计', severity: 'error', blocks: ['run'], target: { card_id: performance.id, path: ['hands', 'document'] } },
      { code: 'PHASE_REVIEW', message: '需要核对阶段引用', severity: 'error', blocks: ['run'], target: { card_id: movement.id, path: ['phases', 'first', 'frame', 'document'], segment_id: 'phase-ref' } },
      { code: 'PHASE_GONE', message: '原阶段已删除', severity: 'warning', blocks: [], target: { card_id: movement.id, path: ['phases', 'deleted', 'frame', 'document'] } },
      { code: 'CARD_GONE', message: '原设计卡已删除', severity: 'warning', blocks: [], target: { card_id: 'deleted-design', path: ['fields', 'direction', 'document'] } },
      { code: 'TEXT_REQUIRED', message: '请填写模型正文', severity: 'error', blocks: ['run'], target: { card_id: modelId, path: ['prompt'] } },
      { code: 'PROMPT_SEGMENT', message: '请核对正文片段', severity: 'error', blocks: ['run'], target: { card_id: modelId, path: ['prompt', 'segments', promptSegmentId], segment_id: promptSegmentId } },
      { code: 'UNKNOWN_PATH', message: '仅保留问题说明', severity: 'warning', blocks: [], target: { card_id: modelId, path: ['design_media_uses'], segment_id: promptSegmentId } },
      { code: 'GROUPED_CARD', message: '请核对编组内名称', severity: 'warning', blocks: [], target: { card_id: groupedCard.id, path: ['name'] } },
      { code: 'GLOBAL_NOTE', message: '当前请求需要核实', severity: 'warning', blocks: [], target: {} },
    ]
    await route.fulfill({ response, json: payload })
  })
  await (await openCanvasCard(page, modelId)).getByRole('button', { name: '预检运行', exact: true }).click()
  const precheck = page.getByRole('dialog', { name: '运行预检', exact: true })
  const globalIssue = precheck.getByRole('alert').filter({ hasText: '当前请求需要核实' })
  await globalIssue.waitFor()
  assert.equal(await globalIssue.getByRole('button').count(), 0)
  const unsupported = precheck.getByRole('alert').filter({ hasText: '仅保留问题说明' })
  assert.equal(await unsupported.getByRole('button').count(), 0, 'unknown path has no precheck action')
  await precheck.getByRole('alert').filter({ hasText: '请填写模型正文' }).getByRole('button', { name: '定位问题', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '模型正文')
  await closeCanvasDetails(page)
  await page.locator(`[data-card-id="${modelId}"]`).getByRole('button', { name: '查看卡片问题', exact: true }).press('Enter')
  await issueList.getByRole('button', { name: '定位模型正文', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '模型正文')
  await closeCanvasDetails(page)
  await page.locator(`[data-card-id="${modelId}"]`).getByRole('button', { name: '查看卡片问题', exact: true }).press('Enter')
  assert.equal(await issueList.getByText('仅保留问题说明').locator('..').getByRole('button').count(), 0)
  await issueList.getByRole('button', { name: '定位正文片段', exact: true }).click()
  await page.waitForFunction(id => document.activeElement?.getAttribute('data-segment-id') === id, promptSegmentId)
  await closeCanvasDetails(page)
  await (await openCanvasCard(page, modelId)).getByRole('button', { name: '预检运行', exact: true }).click()
  await precheck.getByRole('alert').filter({ hasText: '请核对编组内名称' }).getByRole('button', { name: '定位问题', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '问题所指的卡片位于已折叠的编组内' }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-group-id') === 'collapsed')
  assert.equal(await page.locator('[data-card-id="grouped"]').count(), 0)
  await closeCanvasDetails(page)
  await page.locator('[data-card-id="criterion"]').getByRole('button', { name: '查看卡片问题', exact: true }).press('Enter')
  await issueList.getByText('错误', { exact: true }).waitFor()
  await issueList.getByText('警告', { exact: true }).waitFor()
  assert.equal(await issueList.getByRole('button').count(), 1, 'unstructured warning has no field action')
  await issueList.getByRole('button', { name: '定位名称', exact: true }).press('Enter')
  await page.waitForFunction(() => document.activeElement?.closest('[data-diagnostic-name]') !== null && document.activeElement?.tagName === 'BUTTON')
  assert.equal(await page.getByRole('button', { name: '高级设置', exact: true }).isVisible(), true, 'name location leaves the preset page open')
  await closeCanvasDetails(page)
  const performanceCard = page.locator('[data-card-id="performance"]')
  await performanceCard.getByRole('button', { name: '查看卡片问题', exact: true }).press('Enter')
  await issueList.getByRole('button', { name: '定位设计字段', exact: true }).click()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '手部内容')
  assert.equal(await page.getByRole('tab', { name: /表现细节/ }).getAttribute('aria-selected'), 'true')
  await closeCanvasDetails(page)
  await performanceCard.press('Enter')
  await page.getByRole('button', { name: '高级设置', exact: true }).waitFor()
  await closeCanvasDetails(page)
  const movementCard = page.locator('[data-card-id="movement"]')
  await movementCard.waitFor({ state: 'attached' })
  assert.equal((await (await fetch(storyboardCanvasApi(base, id))).json()).data.revision, saved.revision + 1, 'field navigation does not write the canvas')
  const movementIssues = movementCard.getByRole('button', { name: '查看卡片问题', exact: true })
  await movementIssues.press('Enter')
  await issueList.getByRole('button', { name: '查看卡片', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '无法定位原位置' }).waitFor()
  assert.equal(await page.getByRole('tab', { name: '起始', exact: true }).getAttribute('aria-selected'), 'true')
  await closeCanvasDetails(page)
  await (await openCanvasCard(page, modelId)).getByRole('button', { name: '预检运行', exact: true }).click()
  const deletedIssue = precheck.getByRole('alert').filter({ hasText: '原设计卡已删除' })
  assert.equal(await deletedIssue.getByRole('button').count(), 0, 'a deleted card has no action')
  await deletedIssue.getByText('问题所指的卡片已不可用', { exact: true }).waitFor()
  await closePrecheck(page)
  assert.equal(await page.locator('[data-card-details="deleted-design"]').count(), 0)
  await closeCanvasDetails(page)
  const observer = await context.newPage()
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByRole('button', { name: '取得编辑权', exact: true }).click()
  await page.getByText('此画布当前只读', { exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await movementIssues.press('Enter')
  await issueList.getByRole('button', { name: '定位运镜阶段', exact: true }).click()
  const focusedReference = () => document.activeElement?.getAttribute('data-segment-id') === 'phase-ref'
  await page.waitForFunction(focusedReference)
  const phase = page.getByRole('tabpanel', { name: '停留', exact: true })
  assert.equal(await phase.getByRole('textbox', { name: '此时的画面内容', exact: true }).getAttribute('aria-readonly'), 'true')
  assert.equal(await phase.locator('[data-segment-id="phase-ref"]').evaluate(node => {
    const bounds = node.getBoundingClientRect(), viewport = node.closest('.design-preset-advanced').getBoundingClientRect()
    return bounds.top >= viewport.top + 2 && bounds.bottom <= viewport.bottom - 2 && getComputedStyle(node).outlineStyle !== 'none'
  }), true, 'the structured reference and its focus ring are visible on a narrow screen')
  await page.screenshot({ path: join(output, 'diagnostic-phase-mobile.png'), animations: 'disabled' })
  await observer.close()
  assert.equal((await (await fetch(storyboardCanvasApi(base, id))).json()).data.revision, saved.revision + 1, 'reading diagnostics does not write the canvas')
  await closeCanvasDetails(page)
  await page.goto(`http://127.0.0.1:4420/canvases/${freeId}`)
  assert.equal(await page.getByRole('textbox', { name: '画布名称' }).inputValue(), '菜单中的画布')
  await page.getByRole('textbox', { name: '画布名称' }).press('Escape')
  if (await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('textbox', { name: '画布名称' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(output, 'chrome-mobile.png'), animations: 'disabled' })
  console.log('floating chrome management, save/reopen, history and responsive layout verified')
} finally { await cleanup() }
