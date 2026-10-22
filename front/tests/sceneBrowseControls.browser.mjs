import { opaqueCanvasAddresses, remapCanvasGraph } from './canvas-graph-fixtures.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { closeWorkbenchDetails, selectWorkbenchOption, unitCard } from './workbenchControls.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-graph-')
const api = 'http://127.0.0.1:8193'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache', SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8193' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let backendOutput = ''
backend.stdout.on('data', data => { backendOutput += data })
backend.stderr.on('data', data => { backendOutput += data })
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
try {
  let chapter
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error(backendOutput)
    try {
      const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`)
      if (response.ok) { chapter = (await response.json()).data; break }
    } catch { /* 等待独立测试后端启动。 */ }
    await delay(250)
  }
  assert.ok(chapter, `test backend did not become ready: ${backendOutput}`)
  const sequenceId = chapter.sequences[0].id
  const versionsUrl = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequenceId}/versions`
  const created = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), title: '服务端画布展示验收' }) })
  assert.equal(created.status, 200)
  let version = (await created.json()).data
  const note = { state: 'proposal', text: '读信后抬头', sources: [{ kind: 'human', reference: 'graph-browser', version: '1' }] }
  version.content.design.events = [{ id: 'event', description: note }]
  version.content.design.criteria = [{ id: 'criterion', requirement: note }]
  version.content.design.direction.shots = ['A', 'B'].map(id => ({ id, beat_ids: [], event_ids: ['event'],
    blocking_state_ids: [], participant_ids: [], criterion_ids: ['criterion'], visible_result: note, narrative_function: note }))
  const uploadForm = new FormData()
  uploadForm.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'reference.png')
  const upload = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: uploadForm })
  assert.equal(upload.status, 201)
  const referenceFile = (await upload.json()).data
  version.content.units = [{ id: 'shared', coverage: [{ id: 'first', shot_id: 'A', action_scope: '读信' }, { id: 'second', shot_id: 'B', action_scope: '抬头' }], references: [{ id: 'bound-image', file_id: referenceFile.id, media_kind: 'image', purpose: 'space', participant_ids: [], ordinal: 0, input_role: 'subject', source: { kind: 'file', reference: referenceFile.id, version: '1', file_id: referenceFile.id } }], model_id: null, duration_ms: null, ratio: '16:9' }]
  version.content.units.push({ id: 'only-B', coverage: [{ id: 'only-B-action', shot_id: 'B', action_scope: '仅镜头 B 的动作' }], references: [], model_id: null, duration_ms: null, ratio: '16:9', instruction: '精确单元的现有指令' })
  const prepared = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: 1, content: version.content }) })
  assert.equal(prepared.status, 200)
  version = (await prepared.json()).data
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  page = await context.newPage()
  await context.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
    localStorage.setItem('jellyfish:scene-autosave:local-user', 'off')
  })
  let graphCounts
  await page.route('**/versions*', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch(), payload = await response.json()
    for (const row of Array.isArray(payload.data) ? payload.data : [payload.data]) {
      for (const key of ['director_graph', 'unit_graph', 'instruction_graph', 'edit_graph']) if (row?.[key]) remapCanvasGraph(row[key], opaqueCanvasAddresses(row[key]))
      if (row?.director_graph && graphCounts) Object.assign(row.director_graph, graphCounts)
    }
    await route.fulfill({ response, json: payload })
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await selectWorkbenchOption(page, '导演镜头筛选', '镜头 1')
  const crumb = page.getByRole('navigation', { name: '导演画布位置', exact: true })
  await crumb.getByText('› 镜头 01 子图', { exact: true }).waitFor()
  const filters = page.getByRole('complementary', { name: '画布筛选', exact: true })
  assert.ok((await filters.boundingBox()).height <= 48, 'expanded shot filter is a compact horizontal strip')
  const filterBounds = await filters.boundingBox()
  assert.equal(filterBounds.x, (await crumb.boundingBox()).x, 'expanded filter aligns with the floating breadcrumb')
  const collapseBounds = await page.getByRole('button', { name: '收起筛选', exact: true }).boundingBox()
  assert.ok(collapseBounds.x + collapseBounds.width >= filterBounds.x + filterBounds.width - 8, 'collapse handle is on the right edge')
  assert.equal(await crumb.getByRole('button', { name: '后退', exact: true }).count(), 0)
  assert.equal(await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '后退', exact: true }).count(), 1)
  await page.getByRole('button', { name: '收起筛选', exact: true }).click()
  assert.ok((await filters.boundingBox()).width <= 40, 'collapsed filter leaves only a narrow edge handle')
  assert.equal((await filters.boundingBox()).x, filterBounds.x, 'collapsed filter keeps the same floating inset')
  assert.equal(await page.getByRole('button', { name: '展开筛选', exact: true }).getByRole('img', { name: 'search', exact: true }).count(), 1)
  await filters.getByRole('status', { name: '筛选已生效', exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '导演镜头筛选', exact: true }).isVisible(), false)
  assert.equal(await crumb.isVisible(), true)
  await page.reload()
  await page.getByRole('button', { name: '展开筛选', exact: true }).waitFor()
  await page.getByRole('button', { name: '展开筛选', exact: true }).click()
  await crumb.getByRole('button', { name: '总览', exact: true }).click()
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '后退', exact: true }).click()
  await crumb.getByText('› 镜头 01 子图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  const unitCrumb = page.getByRole('navigation', { name: '单元画布位置', exact: true })
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  await unitCrumb.getByText('› 单元 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: '查看节点：动作覆盖 2', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '当前单元主操作', exact: true }).waitFor()
  const canvasBounds = await page.locator('.director-canvas-surface').boundingBox()
  const breadcrumbBounds = await unitCrumb.boundingBox()
  assert.ok(canvasBounds.y <= breadcrumbBounds.y + 1, 'breadcrumb overlays the canvas instead of reserving viewport height')
  await unitCrumb.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="当前单元主操作"]'))
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '后退', exact: true }).click()
  await unitCrumb.getByText('› 单元 1', { exact: true }).waitFor()
  await page.getByRole('navigation', { name: '当前单元主操作', exact: true }).waitFor()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  const instructionCrumb = page.getByRole('navigation', { name: '指令画布位置', exact: true })
  await instructionCrumb.getByText('› 单元 1', { exact: true }).waitFor()
  await selectWorkbenchOption(page, '指令所属单元', '单元 2')
  await instructionCrumb.getByText('› 单元 2', { exact: true }).waitFor()
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '后退', exact: true }).click()
  await instructionCrumb.getByText('› 单元 1', { exact: true }).waitFor()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await unitCrumb.getByText('› 单元 1', { exact: true }).waitFor()
  await unitCrumb.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.getByRole('button', { name: '指令画布', exact: true }).click()
  await page.getByText('明确选择单元后查看和编辑其正文。', { exact: true }).waitFor()
  assert.equal(await instructionCrumb.getByText('› 单元 1', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  const editCrumb = page.getByRole('navigation', { name: '编辑画布位置', exact: true })
  await editCrumb.getByText('› 整场图', { exact: true }).waitFor()
  assert.equal(await page.getByRole('complementary', { name: '画布筛选', exact: true }).count(), 0)
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '打开剪辑工作区', exact: true }).click()
  await editCrumb.getByText('› 剪辑工作区', { exact: true }).waitFor()
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '后退', exact: true }).click()
  await editCrumb.getByText('› 整场图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await crumb.waitFor()
  assert.equal(await crumb.getByRole('button', { name: '总览', exact: true }).isDisabled(), true, 'edit has no explicit shot to restore')
  await selectWorkbenchOption(page, '导演镜头筛选', '镜头 1')
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 2')
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await crumb.getByText('› 镜头 02 子图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.goBack()
  await crumb.getByText('› 镜头 02 子图', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('canvas'), 'director')
  await page.goForward()
  await unitCrumb.getByText('› 镜头 2', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑画布', exact: true }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  assert.equal(new URL(page.url()).searchParams.get('unitShot'), '', 'edit does not restore a hidden unit shot')
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&canvas=director&directorView=shot&directorScope=shot&directorShot=deleted`)
  await crumb.getByText('› 原镜头不可用', { exact: true }).waitFor()
  await page.getByRole('button', { name: '返回有效总览', exact: true }).click()
  await crumb.getByRole('button', { name: '总览', exact: true }).waitFor()
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&canvas=units&browseUnit=only-B&unitShot=A`)
  await unitCrumb.getByText('› 单元 2', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="单元镜头筛选"]')?.closest('.ant-select')?.textContent.includes('全部镜头'))
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&canvas=units&browseUnit=deleted`)
  await unitCrumb.getByText('› 原单元不可用', { exact: true }).waitFor()
  assert.equal(await page.getByRole('navigation', { name: '当前单元主操作', exact: true }).count(), 0)
  await page.getByRole('button', { name: '返回全部镜头', exact: true }).click()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  const geometry = () => page.locator('.director-canvas-surface').evaluate(node => ({
    viewport: node.querySelector('.director-canvas-content')?.getAttribute('style'),
    cards: [...node.querySelectorAll('[data-canvas-node]')].map(card => [card.getAttribute('data-canvas-node'), card.getAttribute('style')])
  }))
  await page.getByRole('button', { name: '收起小地图', exact: true }).click()
  const beforeCollapse = await geometry()
  await page.getByRole('button', { name: '收起筛选', exact: true }).click()
  assert.deepEqual(await geometry(), beforeCollapse, 'collapse preserves viewport and node layout')
  await page.getByRole('button', { name: '展开筛选', exact: true }).click()
  await page.route('**/unit-canvas/preview', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '预览暂时失败' }) }))
  await unitCard(page, '动作覆盖 1')
  await page.getByRole('textbox', { name: '单元动作范围', exact: true }).fill('保留草稿与选择')
  await closeWorkbenchDetails(page)
  await page.getByText('单元卡片更新失败，当前编辑已保留', { exact: true }).waitFor()
  await page.getByRole('status', { name: '画布状态', exact: true }).getByText('图待同步', { exact: true }).waitFor()
  await unitCrumb.getByText('› 单元 1', { exact: true }).waitFor()
  await selectWorkbenchOption(page, '当前单元', '单元 2')
  await unitCrumb.getByText('› 单元 2', { exact: true }).waitFor()
  await page.unroute('**/unit-canvas/preview')
  await page.getByRole('button', { name: '重试单元卡片', exact: true }).click()
  await page.getByRole('button', { name: '查看节点：动作覆盖 1', exact: true }).waitFor()
  await page.getByRole('button', { name: '展开小地图', exact: true }).waitFor()
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  await unitCard(page, '动作覆盖 1')
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '保留草稿与选择')
  await closeWorkbenchDetails(page)
  await selectWorkbenchOption(page, '当前单元', '单元 2')
  await unitCard(page, '动作覆盖 1')
  await selectWorkbenchOption(page, '覆盖 1 所属镜头', '镜头 1')
  await closeWorkbenchDetails(page)
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 2')
  const tree = page.getByRole('navigation', { name: '场次关系树', exact: true })
  await tree.getByRole('button', { name: '展开关系树', exact: true }).click()
  await tree.getByRole('button', { name: '展开镜头 2', exact: true }).click()
  await tree.getByRole('button', { name: /^定位单元 2：/ }).click()
  await unitCrumb.getByText('› 单元 2', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('unitShot'), '', 'saved relation does not block the current unit after coverage changes')
  await tree.getByRole('button', { name: '收起关系树', exact: true }).click()
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '后退', exact: true }).focus()
  await page.keyboard.press('Escape')
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(output, 'browse-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'browse-mobile.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  graphCounts = { pending_count: 2, unlinked_count: 3 }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&directorView=outer&directorScope=all`)
  await page.getByRole('button', { name: '丢弃本地编辑', exact: true }).click()
  await page.getByRole('button', { name: '丢弃本地编辑', exact: true }).waitFor({ state: 'hidden' })
  const canvasStatus = page.getByRole('status', { name: '画布状态', exact: true, includeHidden: true })
  await canvasStatus.getByText('待归镜头 2', { exact: true }).waitFor({ timeout: 5000 })
  await canvasStatus.getByText('未关联设计 3', { exact: true }).waitFor()
  assert.doesNotMatch(await filters.innerText(), /待归镜头|未关联设计 3/)
  const undo = page.getByRole('navigation', { name: '编辑历史', exact: true })
  assert.ok((await canvasStatus.boundingBox()).x + (await canvasStatus.boundingBox()).width <= (await undo.boundingBox()).x, 'desktop status sits left of undo and redo')
  await selectWorkbenchOption(page, '导演镜头筛选', '镜头 1')
  assert.doesNotMatch(await canvasStatus.textContent(), /待归镜头|未关联设计/)
  await crumb.getByRole('button', { name: '总览', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const status = document.querySelector('[aria-label="画布状态"]')?.getBoundingClientRect()
    const history = document.querySelector('[aria-label="编辑历史"]')?.getBoundingClientRect()
    return status && history && status.bottom <= history.top && status.left >= 0 && status.right <= innerWidth
  })
  await page.screenshot({ path: join(output, 'compact-status-mobile.png'), animations: 'disabled' })
  graphCounts = { pending_count: 0, unlinked_count: 0 }
  await page.reload()
  await page.getByRole('combobox', { name: '导演镜头筛选', exact: true }).waitFor()
  assert.doesNotMatch(await canvasStatus.textContent(), /待归镜头|未关联设计/)
  console.log(`PASS canvas browse controls; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Evidence: ${output}\n${backendOutput}`)
  throw error
} finally { await cleanup() }
