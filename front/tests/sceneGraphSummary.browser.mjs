import { opaqueCanvasAddresses, remapCanvasGraph } from './canvas-graph-fixtures.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { closeWorkbenchDetails } from './workbenchControls.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-graph-summary-')
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
    body: JSON.stringify({ request_id: crypto.randomUUID(), title: '长摘要与诊断可达性' }) })
  assert.equal(created.status, 200)
  let version = (await created.json()).data
  const note = { state: 'proposal', text: '打开旧信', sources: [{ kind: 'human', reference: 'summary-browser', version: '1' }] }
  version.content.design.direction.shots = [{ id: 'shot', beat_ids: [], event_ids: [], blocking_state_ids: [],
    participant_ids: [], criterion_ids: [], visible_result: note, narrative_function: note }]
  const image = new FormData()
  image.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'reference.png')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: image })
  assert.equal(uploaded.status, 201)
  const file = (await uploaded.json()).data
  version.content.units = [{ id: 'summary-unit', ratio: '16:9', model_id: null, duration_ms: null,
    coverage: [{ id: 'coverage', shot_id: 'shot', action_scope: '长动作范围。'.repeat(200) }],
    parameters: { long_parameter: '长参数内容。'.repeat(200) }, references: Array.from({ length: 5 }, (_, index) => ({
      id: `reference-${index}`, file_id: file.id, media_kind: 'image', purpose: 'space', participant_ids: [], ordinal: index,
      input_role: 'subject', source: { kind: 'file', reference: file.id, version: '1', file_id: file.id } })) }]
  const saved = await fetch(`${versionsUrl}/${version.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: version.revision, content: version.content }) })
  assert.equal(saved.status, 200)
  version = (await saved.json()).data
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4193, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const addresses = opaqueCanvasAddresses(version.unit_graph)
  await page.route('**/versions*', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    for (const row of Array.isArray(body.data) ? body.data : [body.data]) {
      if (!row?.director_graph || !row.unit_graph) continue
      const director = opaqueCanvasAddresses(row.director_graph)
      remapCanvasGraph(row.director_graph, director)
      remapCanvasGraph(row.unit_graph, { ...opaqueCanvasAddresses(row.unit_graph), externalNodes: director.nodes })
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(`http://127.0.0.1:4193/projects/canvas-project/chapters/canvas-chapter/sequences/${sequenceId}?version=${version.id}&unitView=${addresses.views['unit:summary-unit']}`)
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '生成配置', exact: true }).click()
  const generation = page.locator(`[data-canvas-node="${addresses.nodes['unit:summary-unit:generation']}"]`)
  const visibleDiagnostic = async () => generation.evaluate(node => {
    const parent = node.querySelector('.director-canvas-object-content').getBoundingClientRect()
    const diagnostic = [...node.querySelectorAll('[role="status"]')].find(row => row.textContent.includes('视频模型尚未选择'))?.getBoundingClientRect()
    const action = [...node.querySelectorAll('button')].find(row => row.textContent === '查看详情')?.getBoundingClientRect()
    const fields = node.querySelector('.design-compact-fields').getBoundingClientRect()
    const summariesFit = [...node.querySelectorAll('.design-compact-fields > p')].every(row => row.getBoundingClientRect().bottom <= fields.bottom + 1)
    return { summariesFit, diagnostic: !!diagnostic && diagnostic.top >= parent.top && diagnostic.bottom <= parent.bottom,
      action: !!action && action.top >= parent.top && action.bottom <= parent.bottom }
  })
  assert.deepEqual(await visibleDiagnostic(), { summariesFit: true, diagnostic: true, action: true }, '长摘要不能挤出实际缺项和详情入口')
  await generation.getByRole('button', { name: '查看详情', exact: true }).click()
  await page.getByRole('combobox', { name: '单元视频模型', exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑模型参数', exact: true }).click()
  await page.getByRole('button', { name: '移除参数 long_parameter', exact: true }).waitFor()
  assert.match(await page.locator('.wb-details:not([hidden])').innerText(), /长参数内容/)
  await closeWorkbenchDetails(page)
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '参考素材', exact: true }).click()
  const references = page.locator(`[data-canvas-node="${addresses.nodes['unit:summary-unit:references']}"]`)
  assert.match(await references.innerText(), /已绑定素材[\s：]*5 项/)
  assert.equal(await references.locator('img').count(), 2, '卡面只预览有限参考，后端绑定总数不裁剪')
  await references.getByRole('button', { name: /^查看节点：/ }).click()
  const referenceDetails = page.getByRole('dialog', { name: '编辑参考素材', exact: true })
  await referenceDetails.waitFor()
  assert.equal(await referenceDetails.locator('img').count(), 5, '参考管理仍提供全部真实绑定')
  await referenceDetails.getByRole('button', { name: /^取\s*消$/ }).click()
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: '生成配置', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.deepEqual(await visibleDiagnostic(), { summariesFit: true, diagnostic: true, action: true }, '窄屏仍保留诊断与卡内入口')
  await page.screenshot({ path: join(output, 'summary-mobile.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  const directorAddresses = opaqueCanvasAddresses(version.director_graph)
  const sourceId = version.director_graph.nodes.find(node => node.kind === 'source').id
  await page.locator(`[data-canvas-node="${directorAddresses.nodes[sourceId]}"]`).waitFor()
  await page.locator(`[data-canvas-node="${directorAddresses.nodes['shot:shot']}"]`).getByRole('button', { name: /^进入子图：/ }).click()
  await page.locator(`[data-layout-view="${directorAddresses.views['shot:shot']}"]`).waitFor()
  await page.getByRole('button', { name: '总览', exact: true }).click()
  await page.locator(`[data-canvas-node="${directorAddresses.nodes[sourceId]}"]`).waitFor()
  assert.deepEqual(errors, [])
  console.log(`PASS long graph summaries keep issues and details accessible; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(`Evidence: ${output}\n${backendOutput}`)
  throw error
} finally { await cleanup() }
