import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { makeWorkspace } from './directing-fixtures.mjs'
import { workbenchShot } from './workbenchControls.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-design-scope-')
const api = 'http://127.0.0.1:8198'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.directing.scene_version_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/jellyfish-uv-cache',
    SCENE_BROWSER_TEST_DATABASE: join(output, 'browser.sqlite'), SCENE_BROWSER_TEST_PORT: '8198' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let logs = '', server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
captureBackend(backend, output)
backend.stdout.on('data', data => { logs += data })
backend.stderr.on('data', data => { logs += data })
const errors = []
async function request(url, body, method = 'POST') {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result.data
}
try {
  let chapter
  for (let i = 0; i < 100; i++) {
    if (backend.exitCode !== null) throw new Error(logs)
    try { const response = await fetch(`${api}/api/v1/studio/projects/canvas-project/directing/chapters/canvas-chapter`); if (response.ok) { chapter = (await response.json()).data; break } } catch {}
    await delay(250)
  }
  assert.ok(chapter, logs)
  const sequence = chapter.sequences[0].id
  const versions = `${api}/api/v1/studio/projects/canvas-project/directing/sequences/${sequence}/versions`
  let version = await request(versions, { request_id: crypto.randomUUID(), title: '范围完整性验收' })
  const shape = makeWorkspace().designs[0].content
  const design = version.content.design
  const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'browser', version: '1' }] })
  design.direction.shots = [{ ...shape.direction.shots[0], id: 'shot1', beat_ids: [], event_ids: [],
    criterion_ids: [], participant_ids: [], blocking_state_ids: [], visible_result: note('看见空旷的门口') }]
  design.cinematography = [{ ...shape.cinematography[0], id: 'camera1', shot_id: 'shot1', criterion_ids: [] }]
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2', visible_result: note('看见窗边的树影') })
  design.cinematography.push({ ...structuredClone(design.cinematography[0]), id: 'camera2', shot_id: 'shot2' })
  design.direction.anchors = [{ id: 'anchor1', description: note('门口的固定位置') }]
  design.participants = structuredClone(shape.participants)
  design.events = structuredClone(shape.events)
  design.direction.blocking_states = structuredClone(shape.direction.blocking_states)
  design.direction.shots[0].blocking_state_ids = ['state1']
  design.direction.shots[0].event_ids = ['event1']
  version = await request(`${versions}/${version.id}`, { request_id: crypto.randomUUID(), expected_revision: version.revision,
    content: { ...version.content, design } }, 'PUT')
  assert.equal(version.relationship_graph.complete, true)
  assert.deepEqual(version.relationship_graph.nodes.find(row => row.key === 'camera:camera1').shot_ids, ['shot1'])
  assert.ok(version.relationship_graph.preparation_issues.length > 0)
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4198, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await page.goto(`http://127.0.0.1:4198/projects/canvas-project/chapters/canvas-chapter/sequences/${sequence}?version=${version.id}`)
  await page.getByRole('status').filter({ hasText: '设计范围完整' }).waitFor()
  const nextStep = page.getByRole('button', { name: '下一步：单元画布', exact: true })
  await nextStep.waitFor({ timeout: 5000 })
  await nextStep.hover()
  await page.getByRole('tooltip').getByText(/填写动作范围、模型、时长和参考/).waitFor()
  await nextStep.blur()
  const positions = await page.evaluate(() => {
    const nav = document.querySelector('.canvas-director-navigation-host')
    const toolbar = document.querySelector('.canvas-workbench-toolbar')
    const next = [...toolbar.querySelectorAll('button')].find(button => button.textContent === '下一步：单元画布')
    const ai = toolbar.querySelector('[aria-label="AI 设计"]')
    return { floating: getComputedStyle(nav).position, insideToolbar: toolbar.contains(nav),
      nextRight: next.getBoundingClientRect().right, aiLeft: ai.getBoundingClientRect().left }
  })
  assert.equal(positions.floating, 'absolute')
  assert.equal(positions.insideToolbar, false)
  assert.ok(positions.nextRight <= positions.aiLeft)
  await nextStep.click()
  await page.getByRole('button', { name: '建立单元', exact: true }).waitFor()
  await page.locator('[data-layout-view="scene"]').waitFor()
  assert.deepEqual((await (await fetch(`${versions}/${version.id}`)).json()).data, version, '下一步只导航，不创建单元或保存设计')
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await (await workbenchShot(page, '镜头 2：看见窗边的树影')).click()
  await nextStep.focus()
  await page.getByRole('tooltip').getByText(/^进入镜头 2 的单元画布/).waitFor()
  await nextStep.click()
  await page.locator('[data-layout-view="shot:shot2"]').waitFor()
  assert.match(await page.locator('[data-canvas-node="shot:shot2"]').textContent(), /看见窗边的树影/)
  assert.deepEqual((await (await fetch(`${versions}/${version.id}`)).json()).data, version)
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.getByRole('button', { name: '总览', exact: true }).click()
  await page.getByRole('button', { name: '隐藏附加信息', exact: true }).click()
  const anchor = page.locator('[data-canvas-node="anchor:anchor1"]')
  assert.match(await anchor.innerText(), /全场背景/)
  assert.doesNotMatch(await anchor.innerText(), /未建立镜头关联/)
  await page.getByRole('button', { name: '定位画布节点', exact: true }).click()
  await page.getByRole('menuitem', { name: /锚点/ }).click()
  await anchor.getByRole('button', { name: /^查看节点：/ }).click()
  const anchorSummary = page.locator('.wb-details:not([hidden]) .design-object-summary')
  assert.match(await anchorSummary.innerText(), /全场背景/)
  assert.doesNotMatch(await anchorSummary.innerText(), /关联镜头与依据|修改将影响镜头/, '详情关系沿用后端全场归属，不以引用连通性重判')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '附加信息', exact: true }).click()
  await page.getByText(/拍摄分工待补 · /).click()
  await page.getByText('应拍内容尚未分配负责的生产单元', { exact: false }).first().waitFor()
  await page.screenshot({ path: join(output, 'scope-desktop.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '隐藏附加信息', exact: true }).click()
  await page.getByRole('button', { name: 'AI 设计', exact: true }).click()
  await page.locator('.scene-ai-footer').getByRole('button', { name: '重新生成整场', exact: true }).click()
  await page.getByText('状态：等待执行', { exact: true }).waitFor()
  const tasks = (await (await fetch(`${versions}/${version.id}/design-suggestions`)).json()).data
  await request(`${api}/browser-test/design-tasks/${tasks[0].task_id}/complete?incomplete=true&empty_row=true`, {})
  await page.getByText('状态：待完善 · 待应用', { exact: true }).waitFor()
  const issues = page.getByRole('region', { name: '设计待完善问题', exact: true })
  assert.match(await issues.locator('strong').innerText(), /整条记录/)
  await issues.getByText(/^待明确范围：/).waitFor()
  await issues.getByText('查看相关设计', { exact: true }).click()
  assert.match(await issues.locator('pre').innerText(), /activity-incomplete/)
  assert.equal(await page.getByRole('button', { name: '应用为待完善设计', exact: true }).isEnabled(), true)
  assert.deepEqual((await (await fetch(`${versions}/${version.id}`)).json()).data.content, version.content)
  await page.screenshot({ path: join(output, 'incomplete-result-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(node => node.textContent === '应用为待完善设计')
    const bounds = button?.getBoundingClientRect()
    return bounds && bounds.top >= 0 && bounds.bottom <= window.innerHeight
  }, undefined, { timeout: 5000 })
  await page.screenshot({ path: join(output, 'incomplete-result-narrow.png'), animations: 'disabled' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('button', { name: '应用为待完善设计', exact: true }).click()
  await page.getByRole('dialog', { name: 'AI 设计', exact: true }).waitFor({ state: 'hidden' })
  await page.waitForFunction(async url => {
    const data = (await (await fetch(url)).json()).data
    return data.content.design.staging.activities.some(row => row.id === 'activity-incomplete') && !data.relationship_graph.complete
  }, new URL(`${versions}/${version.id}`).pathname)
  const incomplete = (await (await fetch(`${versions}/${version.id}`)).json()).data
  const prepare = nextStep
  await prepare.waitFor()
  const bounds = await prepare.boundingBox()
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844)
  const textBounds = await prepare.locator('span').first().boundingBox()
  const aiBounds = await page.getByRole('button', { name: 'AI 设计', exact: true }).boundingBox()
  assert.ok(textBounds && textBounds.y >= bounds.y && textBounds.y + textBounds.height <= bounds.y + bounds.height, '窄屏按钮文字不溢出')
  assert.ok(aiBounds && bounds.x + bounds.width <= aiBounds.x && Math.abs(bounds.y - aiBounds.y) <= 8, '窄屏下一步仍在 AI 设计左侧')
  await page.screenshot({ path: join(output, 'next-step-narrow.png'), animations: 'disabled' })
  await prepare.click()
  await page.getByRole('button', { name: '为当前镜头建立单元', exact: true }).waitFor()
  await page.locator('[data-layout-view="shot:shot2"]').waitFor()
  assert.deepEqual((await (await fetch(`${versions}/${version.id}`)).json()).data, incomplete, '缺项不阻断准备入口，导航保留设计缺项')
  await page.getByRole('button', { name: '导演画布', exact: true }).click()
  await page.getByRole('button', { name: '附加信息', exact: true }).click()
  await page.getByRole('button', { name: /定位缺项/ }).first().click()
  await page.screenshot({ path: join(output, 'incomplete-applied-narrow.png'), animations: 'disabled' })
  assert.deepEqual(errors, [])
  console.log(`PASS design-to-unit guidance, shot navigation without writes, incomplete candidate preview, explicit apply, persisted issues and issue location; evidence: ${output}`)
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(`Evidence: ${output}`)
  throw error
} finally { await cleanup() }
