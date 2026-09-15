import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-design-views-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4187, strictPort: true, open: false } })
const workspace = makeWorkspace()
const note = text => ({ state: 'proposal', text, sources: [{ kind: 'human', reference: 'design-views-fixture', version: '2' }] })
const design = workspace.designs[1].content
const shot = structuredClone(design.direction.shots[0])
design.direction.shots = Array.from({ length: 200 }, (_, i) => ({ ...structuredClone(shot), id: `shot${i+1}`, beat_ids: [i < 100 ? 'beat1' : 'beat2'], visible_result: note(`明确动作 ${i+1}`), narrative_function: note(`叙事作用 ${i+1}`) }))
design.direction.beats.push({ ...structuredClone(design.direction.beats[0]), id: 'beat2', objective: note('确认身份') })
design.direction.shots[0].beat_ids.push('beat2')
design.direction.shots[0].criterion_ids.push('missing-criterion')
design.direction.information_change = note('观众认出两人的关系')
const preview = (id, revisionId, shotId, image) => ({ kind: 'planned', id, design_revision_id: revisionId, shot_id: shotId, preview_file_id: image, estimated_duration_ms: 3000, timeline_start_ms: 0, dialogue_cues: [] })
workspace.cuts[0].content.items = [preview('old-image', 'd1', 'shot1', 'old-image')]
workspace.cuts[1].content.items = [preview('one-a', 'd2', 'shot1', 'one-a'), preview('one-b', 'd2', 'shot1', 'one-b'), preview('two', 'd2', 'shot2', 'two'), preview('wrong-version', 'd1', 'shot3', 'wrong-version')]
workspace.cuts[2].content.items = [preview('latest', 'd2', 'shot1', 'latest')]
const writes = [], images = [], errors = [], results = []
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1586, height: 992 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/download')) { images.push(path); return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#bcd6fa"/><text x="30" y="90" font-size="24">明确绑定的测试预演</text></svg>' }) }
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4187/projects/p1/chapters/ch1/sequences/s1?view=design&design=d2'
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).locator('../..').click()
    const popup = page.locator('.ant-select-dropdown:visible').last()
    await popup.locator('.ant-select-item-option').filter({ hasText: option }).first().click()
    await popup.waitFor({ state: 'hidden' })
  }
  const closeDrawer = async () => {
    await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(el => !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden'))
  }
  await page.goto(base)
  await page.getByRole('grid', { name: '镜头清单' }).waitFor()
  await page.getByRole('tab', { name: '分镜板', exact: true }).click()
  assert.equal(await page.locator('.design-storyboard img').count(), 0)
  await page.getByRole('combobox', { name: '复用已绑定预演图片', exact: true }).locator('../..').click()
  assert.equal(await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '剪辑 1' }).count(), 0)
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '剪辑 2' }).click()
  assert.equal(await page.getByRole('button', { name: '分镜 1', exact: true }).locator('img').count(), 0)
  assert.equal(await page.getByRole('button', { name: '分镜 3', exact: true }).locator('img').count(), 0)
  const secondImage = page.getByRole('button', { name: '分镜 2', exact: true }).locator('img')
  await secondImage.waitFor()
  assert.ok((await secondImage.getAttribute('src')).endsWith('/two/download'))
  await choose('镜头 1 预演来源片段', '预演片段 2')
  const firstImage = page.getByRole('button', { name: '分镜 1', exact: true }).locator('img')
  assert.ok((await firstImage.getAttribute('src')).endsWith('/one-b/download'))
  await firstImage.evaluate(image => image.decode())
  await page.screenshot({ path: join(output, 'explicit-preview-source.png') })
  assert.ok(!images.some(path => /latest|wrong-version|old-image/.test(path)))
  assert.ok(await page.locator('.design-storyboard-card').count() < 45)
  await choose('查看或编辑设计版本', '设计 01')
  await page.getByRole('button', { name: '分镜 1', exact: true }).waitFor()
  assert.equal(await page.locator('.design-storyboard img').count(), 0)
  results.push('分镜只显示显式所选来源；多候选不默认选取，版本与镜头不匹配不加载；200镜头仅渲染可见卡片')

  await choose('查看或编辑设计版本', '设计 02')
  await page.getByRole('tab', { name: '关系视图', exact: true }).click()
  await page.locator('[data-graph-node="criterion:missing-criterion"].is-missing').waitFor()
  const canvas = page.locator('.design-graph-canvas')
  const initial = await canvas.getAttribute('style')
  await page.getByRole('button', { name: '放大关系图', exact: true }).click()
  assert.notEqual(await canvas.getAttribute('style'), initial)
  await page.getByLabel('镜头关系画布', { exact: true }).focus(); await page.keyboard.press('ArrowRight')
  assert.notEqual(await canvas.getAttribute('style'), initial)
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  await page.getByText('完整关联', { exact: true }).click()
  await page.locator('[data-relation="节拍表演"]').waitFor()
  assert.equal(await page.locator('[data-relation="节拍表演"] path').getAttribute('stroke-dasharray'), '5 4')
  await page.getByRole('button', { name: '全场节拍', exact: true }).click()
  assert.equal(await page.locator('[data-beat-group]').count(), 2)
  assert.ok(await page.locator('.design-beat-map button').count() <= 5)
  await page.locator('[data-beat-group="beat2"]').getByText('101 个关联镜头', { exact: false }).waitFor()
  await page.screenshot({ path: join(output, 'beat-aggregation-200.png') })
  await page.getByRole('button', { name: '查看节拍 2 的镜头清单', exact: true }).click()
  assert.equal(await page.getByRole('grid', { name: '镜头清单' }).getAttribute('aria-rowcount'), '101')
  await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).fill('明确动作 200')
  await page.locator('[data-shot-id="shot200"]').click()
  await page.locator('.design-navigation').getByRole('button', { name: '镜头 01', exact: true }).click()
  await page.locator('[data-shot-id="shot1"][aria-selected="true"]').waitFor()
  assert.equal(await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).inputValue(), '')
  results.push('关系过滤、间接与缺失引用、缩放和平移有效；全场200镜头按节拍聚合并可进入过滤清单；侧栏定位清除阻挡条件')

  await page.getByRole('button', { name: '仅看问题', exact: true }).click()
  assert.equal(await page.getByRole('grid', { name: '镜头清单' }).getAttribute('aria-rowcount'), '1')
  await page.getByRole('button', { name: '仅看问题', exact: true }).click()
  const grid = page.getByRole('grid', { name: '镜头清单' }); await grid.focus(); await page.keyboard.press('End')
  await page.locator('[data-shot-id="shot200"][aria-selected="true"]').waitFor()
  await choose('查看或编辑设计版本', '设计 01')
  await page.getByRole('tab', { name: '关系视图', exact: true }).click()
  await page.locator('[data-graph-node="shot:shot1"]').waitFor()
  await choose('查看或编辑设计版本', '设计 02')
  await page.getByRole('tab', { name: '镜头清单', exact: true }).click()
  const baseline = await page.getByRole('combobox', { name: '查看或编辑设计版本', exact: true }).locator('../..').innerText()
  await page.getByRole('button', { name: '更多场次操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '版本与历史', exact: true }).click()
  await choose('比较基准版本', '设计 1')
  await choose('查看或比较的历史版本', '设计 2')
  const changes = page.locator('.revision-differences')
  await changes.getByText('新增', { exact: true }).first().waitFor()
  assert.ok((await changes.innerText()).includes('设计建议'))
  assert.ok((await changes.innerText()).includes('design-views-fixture'))
  await page.screenshot({ path: join(output, 'revision-differences.png') })
  await page.getByRole('tab', { name: '完整快照', exact: true }).click()
  await page.locator('.ant-drawer-open').getByRole('tab', { name: '岗位审阅', exact: true }).click()
  await page.locator('.ant-drawer-open').getByRole('combobox', { name: '岗位', exact: true }).waitFor()
  await closeDrawer()
  assert.equal(await page.getByRole('combobox', { name: '查看或编辑设计版本', exact: true }).locator('../..').innerText(), baseline)
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  results.push('历史比较包含对象增删、Note状态和来源；完整历史可审阅岗位；浏览不写入且不改变编辑基线或采用')
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, images, writes, errors }, null, 2))
  console.log(JSON.stringify({ output, results }, null, 2))
} catch (error) {
  if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.log(await page.locator('body').innerText()) }
  console.log('Browser evidence:', output)
  throw error
} finally { await browser?.close(); await server.close() }
