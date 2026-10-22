import { remapCanvasGraph } from './canvas-graph-fixtures.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { closeWorkbenchDetails, directorObject, selectWorkbenchOption, unitCard } from './workbenchControls.mjs'

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
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&unitView=unit:only-B&unitShot=A`)
  await page.locator('[data-layout-view="unit:only-B"]').waitFor()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '前段依赖', exact: true }).click()
  await page.getByRole('button', { name: '查看节点：前段依赖', exact: true }).click()
  await page.getByRole('button', { name: '前往当前单元指令核对', exact: true }).click()
  await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '当前单元指令正文', exact: true }).inputValue(), '精确单元的现有指令', 'instruction entry preserves exact unit outside the current shot filter')
  assert.equal(new URL(page.url()).searchParams.has('unitView'), false, 'leaving the unit subgraph removes its entry URL context')
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&unitView=unit:shared&unitShot=A`)
  await page.getByRole('navigation', { name: '单元画布位置', exact: true }).waitFor()
  await page.locator('[data-layout-view="unit:shared"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node="unit:shared:coverage:second"]').count(), 1, 'exact unit links keep all coverage, including a different shot')
  await page.getByRole('button', { name: 'AI设计', exact: true }).click()
  const multiCoverageDesign = page.getByRole('dialog', { name: 'AI设计', exact: true })
  await multiCoverageDesign.getByText('当前 AI 组织仅支持一个覆盖出现项；此单元保留完整范围，不会自动拆分或改选', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await multiCoverageDesign.getByRole('button', { name: '开始设计', exact: true }).isDisabled(), true)
  assert.match(await multiCoverageDesign.textContent(), /shared/, 'AI preparation keeps the exact selected cross-shot unit instead of treating it as a new design')
  await multiCoverageDesign.getByRole('button', { name: '取消', exact: true }).click()

  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '本单元执行依据', exact: true }).click()
  await page.getByRole('button', { name: '查看节点：本单元执行依据', exact: true }).click()
  const scopeDetails = page.getByRole('complementary', { name: '本单元执行依据', exact: true })
  await scopeDetails.waitFor()
  assert.equal(await scopeDetails.getByRole('textbox').count(), 0)
  assert.match(await scopeDetails.getByRole('region', { name: '本次执行项', exact: true }).textContent(), /读信/)
  await scopeDetails.getByRole('region', { name: '本次执行项', exact: true }).getByRole('button', { name: '定位来源字段', exact: true }).first().click()
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).inputValue(), '读信')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '查看节点：本单元执行依据', exact: true }).click()
  await scopeDetails.getByRole('region', { name: '解释背景', exact: true }).getByRole('button', { name: '定位来源字段', exact: true }).first().click()
  await page.getByRole('navigation', { name: '导演画布位置', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).waitFor()
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.locator('[data-canvas-node="unit:shared"]').getByRole('button', { name: /^进入子图：/ }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.getByRole('navigation', { name: '单元画布位置', exact: true }).evaluate(node => node.scrollWidth <= node.clientWidth + 1), true, 'unit navigation fits a narrow viewport')
  assert.equal(await page.getByRole('navigation', { name: '单元画布位置', exact: true }).getByText('› 单元 1', { exact: true }).evaluate(node => node.getBoundingClientRect().height <= 32), true, 'unit breadcrumb remains one readable line')
  await page.screenshot({ path: join(output, 'unit-graph-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&unitView=unit:deleted&unitShot=A`)
  await page.getByText('原浏览目标已不可用', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-canvas-node="unit:shared"]').count(), 0, 'missing exact targets must not select another unit')
  await page.route('**/versions*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    for (const row of Array.isArray(body.data) ? body.data : [body.data]) if (row) delete row.unit_graph
    await route.fulfill({ response, json: body })
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&unitView=unit:shared&unitShot=A`)
  await page.getByText('单元图数据与当前版本不一致；当前编辑内容已保留', { exact: true }).waitFor({ timeout: 5000 })
  assert.equal(await page.locator('[data-canvas-node="unit:shared"]').count(), 0, 'missing graph must show a load error without reconstructing business nodes')
  await page.unroute('**/versions*')
  // 合法服务端视图 ID 是不透明地址，浏览器不能按 shot:/unit: 前缀重新组装。
  await page.route('**/versions*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    const rows = Array.isArray(body.data) ? body.data : [body.data]
    for (const row of rows) {
      for (const graphKey of ['director_graph', 'unit_graph']) {
        const graph = row?.[graphKey]
        if (!graph) continue
        const names = graphKey === 'director_graph'
          ? { scene: 'service-director-root', 'shot:A': 'service-director-shot-view' }
          : { scene: 'service-unit-root', 'shot:A': 'service-shot-view', 'unit:shared': 'service-unit-view' }
        remapCanvasGraph(graph, { views: names })
      }
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  await page.locator('[data-canvas-node="shot:A"]').getByRole('button', { name: /^进入子图：/ }).waitFor({ timeout: 5000 })
  await page.locator('[data-canvas-node="shot:A"]').getByRole('button', { name: /^进入子图：/ }).click()
  await page.locator('[data-layout-view="service-director-shot-view"]').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: '总览', exact: true }).click()
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await selectWorkbenchOption(page, '单元镜头筛选', '全部镜头')
  await page.locator('[data-layout-view="service-unit-root"]').waitFor({ timeout: 5000 })
  const sharedPreview = page.locator('[data-canvas-node="unit:shared"]')
  assert.equal(await sharedPreview.locator('.director-subgraph-purpose').innerText(), '镜头 1、镜头 2 — 单元 1')
  assert.match(await sharedPreview.locator('.director-subgraph-status').innerText(), /已绑定素材：1 项/)
  const singlePreview = page.locator('[data-canvas-node="unit:only-B"]')
  assert.equal(await singlePreview.locator('.director-subgraph-purpose').innerText(), '镜头 2 — 单元 2')
  assert.match(await singlePreview.locator('.director-subgraph-status').innerText(), /已绑定素材：0 项/)
  await page.screenshot({ path: join(output, 'unit-labels-desktop.png'), animations: 'disabled' })
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 1')
  await page.locator('[data-layout-view="service-shot-view"]').waitFor()
  assert.equal(await sharedPreview.locator('.director-subgraph-purpose').innerText(), '镜头 1、镜头 2 — 单元 1', '镜头筛选不裁掉单元完整范围或改变单元编号')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '单元 1', exact: true }).click()
  await page.screenshot({ path: join(output, 'unit-labels-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('[data-canvas-node="unit:shared"]').getByRole('button', { name: /^进入子图：/ }).click()
  await page.locator('[data-layout-view="service-unit-view"]').waitFor()
  assert.equal(await page.getByRole('button', { name: '查看单元设置', exact: true }).count(), 0)
  await page.unroute('**/versions*')
  // HTTP 边界控制展示内容：不改业务字段，证明客户端消费的是 graph 而非自行重算。
  await page.route('**/unit-canvas/preview', async route => {
    const response = await route.fetch()
    const body = await response.json()
    for (const node of body.data.nodes) if (node.kind === 'unit_references') for (const preview of node.previews) { preview.display_name = '后端素材名称'; preview.thumbnail_url += '?from=graph' }
    body.data.nodes.find(node => node.kind === 'unit').preview_title = '服务端已经解析的单元范围'
    body.data.nodes.find(node => node.kind === 'unit_config' && node.coverage_item_id === 'second').summary[1].text = '服务端解析的第二覆盖摘要'
    await route.fulfill({ response, json: body })
  })
  await page.route('**/versions*', async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return }
    const response = await route.fetch()
    const body = await response.json()
    for (const row of Array.isArray(body.data) ? body.data : [body.data]) {
      if (!row?.director_graph || row.id !== version.id) continue
      const card = row.director_graph.nodes.find(node => node.id === 'overview')
      card.title = '服务端全场卡片'
      card.summary[0].text = '后端已经解析的展示摘要'
      const view = row.director_graph.views[0]
      view.members.find(member => member.node_id === 'space').group = 'scene-unlinked'
      for (const group of view.groups) group.node_count = view.members.filter(member => member.group === group.id).length
      row.director_graph.unlinked_count += 1
      const shot = row.director_graph.views.find(candidate => candidate.id === 'shot:A')
      shot.members = shot.members.filter(member => member.node_id !== 'criterion:criterion')
      const memberIds = new Set(shot.members.map(member => member.node_id))
      const edgeIds = new Set(row.director_graph.edges.filter(edge => memberIds.has(edge.source) && memberIds.has(edge.target)).map(edge => edge.id))
      shot.edge_ids = shot.edge_ids.filter(id => edgeIds.has(id))
      shot.node_count = 2
      shot.reference_count = 1
      shot.issue_count = row.director_graph.issues.filter(issue => memberIds.has(issue.target.node_id)).length
      for (const group of shot.groups) group.node_count = shot.members.filter(member => member.group === group.id).length
      row.director_graph.nodes.find(node => node.kind === 'source').text = '后端返回的原文卡片正文'
      for (const node of row.unit_graph.nodes) if (node.kind === 'unit_references') for (const preview of node.previews) { preview.display_name = '后端素材名称'; preview.thumbnail_url += '?from=graph' }
      row.unit_graph.nodes.find(node => node.kind === 'unit').preview_title = '服务端已经解析的单元范围'
      row.unit_graph.nodes.find(node => node.kind === 'unit_config' && node.coverage_item_id === 'second').summary[1].text = '服务端解析的第二覆盖摘要'
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}`)
  const card = page.locator('[data-canvas-node="overview"]')
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await card.getByRole('heading', { name: '服务端全场卡片', exact: true }).waitFor({ state: 'attached', timeout: 5000 })
  assert.match(await card.textContent(), /后端已经解析的展示摘要/)
  assert.equal(await page.locator('[data-canvas-node="space"]').count(), 0)
  assert.match(await page.locator('[data-canvas-node="原文依据"]').textContent(), /后端返回的原文卡片正文/)
  const entry = page.locator('[data-canvas-node="shot:A"]')
  assert.match(await entry.textContent(), /共享引用 1/)
  assert.equal(await entry.locator('.director-subgraph-preview rect').count(), 2)
  await entry.getByRole('button', { name: /^进入子图：/ }).click()
  await page.locator('[data-layout-view="shot:A"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node="shot:B"]').count(), 0)
  assert.equal(await page.locator('[data-canvas-node="criterion:criterion"]').count(), 0)
  const shared = page.locator('[data-canvas-node="event:event"]')
  assert.equal(await shared.getByRole('button', { name: '编辑此卡', exact: true }).count(), 0)
  await shared.getByRole('button', { name: '定位共享原卡', exact: true }).click()
  await page.locator('[data-layout-view="overview"]').waitFor()
  await directorObject(page, '服务端全场卡片')
  const input = page.getByRole('textbox', { name: '观察视点', exact: true })
  assert.equal(await input.inputValue(), '', 'editor must retain actual content rather than use the display summary')
  await input.fill('用户正在编辑的真实内容')
  await closeWorkbenchDetails(page)
  assert.match(await card.textContent(), /后端已经解析的展示摘要/, 'unsaved edit must not locally rebuild the graph')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  assert.match(await card.textContent(), /用户正在编辑的真实内容/)
  const saved = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(saved.director_graph.revision, 3)
  assert.equal(saved.content.design.direction.viewpoint.text, '用户正在编辑的真实内容')
  await directorObject(page, '全场叙事与约束')
  await input.fill('未知请求随后被明确拒绝的输入')
  let rejectRecovery = false
  await page.route('**/versions/*', async route => {
    if (route.request().method() !== 'PUT') { await route.continue(); return }
    if (rejectRecovery) await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '原保存明确失败' }) })
    else await route.abort('failed')
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '保存失败' }).first().waitFor()
  rejectRecovery = true
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复编辑', exact: true }).click()
  await card.getByRole('heading', { name: '服务端全场卡片', exact: true }).waitFor({ state: 'attached', timeout: 5000 })
  await directorObject(page, '服务端全场卡片')
  assert.equal(await input.inputValue(), '未知请求随后被明确拒绝的输入', 'explicitly rejected recovery keeps edited input and the freshly read graph')
  await page.unroute('**/versions/*')
  await input.fill('关闭后恢复的最新输入')
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复编辑', exact: true }).click()
  await card.getByRole('heading', { name: '服务端全场卡片', exact: true }).waitFor({ state: 'attached', timeout: 5000 })
  await directorObject(page, '服务端全场卡片')
  assert.equal(await input.inputValue(), '关闭后恢复的最新输入')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '单元画布', exact: true }).click()
  await page.locator('[data-canvas-node="unit:shared"]').waitFor()
  const unitFilter = page.getByRole('combobox', { name: '单元镜头筛选', exact: true })
  await unitFilter.waitFor()
  await page.locator('[data-canvas-node="unit:shared"]').filter({ hasText: '服务端已经解析的单元范围' }).waitFor()
  const referenceImage = page.locator('[data-canvas-node="unit:shared:reference-group:bound-image"]').getByRole('img', { name: '参考素材：后端素材名称', exact: true })
  await referenceImage.waitFor()
  assert.match(await referenceImage.getAttribute('src'), /from=graph/)
  assert.equal(await referenceImage.evaluate(image => image.decode().then(() => image.naturalWidth > 0).catch(() => false)), true, 'the backend preview renders actual image bytes')
  const referenceCard = page.locator('[data-canvas-node="unit:shared:reference-group:bound-image"]')
  assert.equal(await referenceCard.getByRole('button', { name: '编辑本单元参考', exact: true }).count(), 0, 'reference card has one direct entry')
  await selectWorkbenchOption(page, '当前单元', '单元 1')
  await page.locator('[data-layout-view="unit:shared"]').waitFor()
  const referenceEntry = referenceCard.getByRole('button', { name: /^查看节点：/ })
  const canvasGeometry = () => page.locator('.director-canvas-content').evaluate(node => ({ transform: node.style.transform, cards: [...node.querySelectorAll('[data-canvas-node]')].map(card => [card.getAttribute('data-canvas-node'), card.style.left, card.style.top]) }))
  const beforeReference = await canvasGeometry()
  await referenceEntry.focus(); await page.keyboard.press('Enter')
  const referenceManager = page.getByRole('dialog', { name: '编辑参考组', exact: true })
  await referenceManager.waitFor({ timeout: 3000 })
  assert.equal(await page.getByRole('complementary', { name: '单元参考 · 只读', exact: true }).count(), 0)
  assert.equal(await referenceManager.getByRole('button', { name: '更换素材', exact: true }).count(), 1)
  assert.equal(await referenceManager.getByRole('combobox', { name: '参考素材来源', exact: true }).count(), 0, 'selected references precede candidate selection')
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(output, 'reference-manager-desktop.png'), animations: 'disabled' })
  await referenceManager.getByRole('button', { name: /^取\s*消$/ }).click()
  await referenceManager.waitFor({ state: 'hidden' })
  await referenceEntry.focus(); await page.keyboard.press('Space'); await referenceManager.waitFor()
  await referenceManager.getByRole('button', { name: /^取\s*消$/ }).focus()
  await page.keyboard.press('Escape'); await referenceManager.waitFor({ state: 'hidden' })
  assert.deepEqual(await canvasGeometry(), beforeReference, 'reference management preserves viewport and card positions')
  await page.setViewportSize({ width: 390, height: 844 })
  await referenceEntry.tap(); await referenceManager.waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))))
  await page.screenshot({ path: join(output, 'reference-manager-mobile-page.png'), animations: 'disabled' })
  await referenceManager.locator('.ant-modal-content').screenshot({ path: join(output, 'reference-manager-mobile.png'), animations: 'disabled' })
  await referenceManager.getByRole('button', { name: /^取\s*消$/ }).tap(); await referenceManager.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1440, height: 960 })
  const reader = await context.newPage()
  await reader.goto(page.url())
  await reader.getByRole('button', { name: '转到此页编辑', exact: true }).waitFor({ timeout: 5000 })
  await reader.locator('[data-canvas-node="unit:shared:reference-group:bound-image"]').getByRole('button', { name: /^查看节点：/ }).click()
  const readonlyReferences = reader.getByRole('dialog', { name: '编辑参考组', exact: true })
  await readonlyReferences.getByRole('status').filter({ hasText: '只读' }).waitFor()
  assert.equal(await readonlyReferences.getByRole('button', { name: '应用到本单元', exact: true }).count(), 0)
  assert.equal(await readonlyReferences.getByRole('button', { name: '更换素材', exact: true }).isDisabled(), true)
  await readonlyReferences.getByRole('button', { name: /^关\s*闭$/ }).click()
  await reader.close()
  await selectWorkbenchOption(page, '单元镜头筛选', '镜头 2')
  await page.locator('[data-layout-view="shot:B"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node="shot:A"]').count(), 0)
  await page.locator('[data-canvas-node="unit:shared"]').getByRole('button', { name: /^进入子图：/ }).click()
  await page.locator('[data-layout-view="unit:shared"]').waitFor()
  assert.equal(await page.locator('[data-canvas-node="unit:shared:coverage:first"]').count(), 1)
  assert.equal(await page.locator('[data-canvas-node="unit:shared:coverage:second"]').count(), 1)
  assert.match(await page.locator('[data-canvas-node="unit:shared:coverage:second"]').textContent(), /服务端解析的第二覆盖摘要/)
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '后退', exact: true }).click()
  await page.locator('[data-layout-view="shot:B"]').waitFor()
  await page.locator('.canvas-workbench-toolbar').getByRole('button', { name: '前进', exact: true }).click()
  await page.locator('[data-layout-view="unit:shared"]').waitFor()
  const overlappingGroups = await page.locator('.director-layout-region').evaluateAll(regions => {
    const boxes = regions.map(region => ({ x: region.offsetLeft, y: region.offsetTop, w: region.offsetWidth, h: region.offsetHeight }))
    return boxes.flatMap((box, index) => boxes.slice(index + 1).filter(other => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y))
  })
  assert.deepEqual(overlappingGroups, [], 'automatic layout must keep semantic groups separate')
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '动作覆盖 2', exact: true }).click()
  await page.getByRole('button', { name: '查看节点：动作覆盖 2', exact: true }).click()
  await page.unroute('**/unit-canvas/preview')
  const coverageInput = page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true })
  assert.equal(await coverageInput.inputValue(), '抬头')
  assert.equal(await page.getByRole('textbox', { name: '单元动作范围', exact: true }).count(), 0, 'coverage card edits its own occurrence only')
  await coverageInput.fill('仅修改第二出现项')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '查看节点：动作覆盖 2', exact: true }).click()
  assert.equal(await coverageInput.inputValue(), '仅修改第二出现项')
  await closeWorkbenchDetails(page)
  const openUnitCard = async title => {
    await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
    await page.getByRole('menuitem', { name: title, exact: true }).click()
    await page.getByRole('button', { name: `查看节点：${title}`, exact: true }).click()
  }
  await openUnitCard('生成配置')
  assert.equal(await page.getByRole('textbox', { name: '覆盖 2 动作范围', exact: true }).count(), 0)
  await page.getByRole('spinbutton', { name: '单元预计时长', exact: true }).fill('6')
  await page.getByRole('textbox', { name: '单元画幅', exact: true }).fill('9:16')
  await page.getByRole('spinbutton', { name: '单元随机种子', exact: true }).fill('42')
  await closeWorkbenchDetails(page)
  await openUnitCard('组织要求')
  await page.getByRole('textbox', { name: '组织理由', exact: true }).fill('保留开门与抬头的连续关系')
  await page.getByRole('button', { name: '建立组织要求', exact: true }).click()
  await page.getByRole('textbox', { name: '组织进入状态', exact: true }).fill('门关闭')
  await page.getByRole('textbox', { name: '组织结束状态', exact: true }).fill('读信后抬头')
  await page.getByRole('textbox', { name: '组织参考需求', exact: true }).fill('门的空间参考')
  await closeWorkbenchDetails(page)
  await openUnitCard('组织要求')
  assert.equal(await page.getByRole('textbox', { name: '组织进入状态', exact: true }).inputValue(), '门关闭')
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const configured = (await (await fetch(`${versionsUrl}/${version.id}`)).json()).data
  assert.equal(configured.content.units[0].coverage[0].action_scope, '读信')
  assert.equal(configured.content.units[0].coverage[1].action_scope, '仅修改第二出现项')
  assert.equal(configured.content.units[0].parameters.seed, 42)
  assert.equal(configured.content.units[0].organization.entry_state, '门关闭')
  assert.equal(configured.content.units[0].references.length, 1)
  assert.match(await page.locator('[data-canvas-node="unit:shared:organization"]').textContent(), /门的空间参考/)
  await openUnitCard('本单元执行依据')
  const organizationSource = page.getByRole('region', { name: '适用约束', exact: true }).getByRole('listitem').filter({ hasText: 'unit:shared / exit_state' })
  await organizationSource.getByRole('button', { name: '定位来源字段', exact: true }).click()
  await page.getByRole('textbox', { name: '组织结束状态', exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '组织结束状态', null, { timeout: 5000 })
  assert.equal(await page.getByRole('textbox', { name: '组织结束状态', exact: true }).evaluate(node => node === document.activeElement), true, 'basis location focuses the exact organization field')
  await closeWorkbenchDetails(page)
  await unitCard(page, '动作覆盖 2')
  await coverageInput.fill('保存失败后仍显示的当前动作')
  await closeWorkbenchDetails(page)
  await page.locator('[data-canvas-node="unit:shared:coverage:second"]').filter({ hasText: '保存失败后仍显示的当前动作' }).waitFor()
  await page.route(`**/versions/${version.id}`, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '单元内容待修正' }) }) : route.continue(), { times: 1 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('保存失败，输入已保留', { exact: true }).waitFor()
  await page.locator('[data-canvas-node="unit:shared:coverage:second"]').filter({ hasText: '保存失败后仍显示的当前动作' }).waitFor()
  assert.equal((await (await fetch(`${versionsUrl}/${version.id}`)).json()).data.content.units[0].coverage[1].action_scope, '仅修改第二出现项')
  await page.screenshot({ path: join(output, 'unit-save-failure-current-cards.png'), animations: 'disabled' })
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复编辑', exact: true }).click()
  await page.locator('[data-canvas-node="unit:shared:coverage:second"]').filter({ hasText: '保存失败后仍显示的当前动作' }).waitFor()
  assert.equal(await page.getByRole('button', { name: '查看单元设置', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: /^(建立单元|为当前镜头建立单元)$/ }).count(), 0)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.locator('[data-canvas-node="unit:shared:coverage:second"]').filter({ hasText: '仅修改第二出现项' }).waitFor()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.locator('[data-canvas-node="unit:shared:coverage:second"]').filter({ hasText: '保存失败后仍显示的当前动作' }).waitFor()

  const newDirectorResponse = await fetch(versionsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), title: '未保存导演对象重进' }) })
  assert.equal(newDirectorResponse.status, 200)
  const newDirector = (await newDirectorResponse.json()).data
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${newDirector.id}`)
  await page.getByRole('button', { name: '添加首个镜头', exact: true }).click()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).fill('保存前的首个镜头')
  await closeWorkbenchDetails(page)
  await page.route(`**/versions/${newDirector.id}`, async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: '镜头内容待修正' }) })
    else await route.continue()
  })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByText('保存失败，输入已保留', { exact: true }).waitFor()
  await page.getByRole('button', { name: '附加信息', exact: true }).click()
  await page.getByRole('combobox', { name: '编辑待同步对象', exact: true }).waitFor({ timeout: 5000 })
  await selectWorkbenchOption(page, '编辑待同步对象', '镜头 01 · 保存前的首个镜头')
  assert.equal(await page.getByRole('textbox', { name: '可见结果', exact: true }).inputValue(), '保存前的首个镜头', 'a new director object can be reopened after a failed first save')
  assert.equal(await page.locator('[data-canvas-node^="shot:"]').count(), 0, 'editing a new director object does not create temporary graph nodes')
  const unsavedDirector = (await (await fetch(`${versionsUrl}/${newDirector.id}`)).json()).data
  assert.equal(unsavedDirector.content.design.direction.shots.length, 0)
  assert.equal(unsavedDirector.director_graph.shot_count, 0)
  await page.unroute(`**/versions/${newDirector.id}`)
  console.log(`PASS backend card titles, summaries, members, source, current editor and save graph; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Evidence: ${output}\n${backendOutput}`)
  throw error
} finally { await cleanup() }
