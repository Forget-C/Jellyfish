import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4195, strictPort: true, open: false } })
const workspace = makeWorkspace(), design = workspace.designs[1].content
const note = text => ({ state: 'proposal', text, sources: [] })
design.direction.shots = Array.from({ length: 2 }, (_, i) => ({ ...structuredClone(design.direction.shots[0]), id: `shot${i+1}`, visible_result: note(`动作 ${i+1}`), narrative_function: note('递出旧信'), estimated_duration_ms: 3000 }))
let failedAssets = false
const assets = [{ id: 'place', kind: 'scene', name: '街道' }]
const writes = [], errors = []
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工填写' })))
    if (req.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/assets')) return failedAssets ? route.fulfill({ status: 500, json: { detail: '资产加载失败' } }) : respond(assets)
    if (/\/(styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4195/projects/p1/chapters/ch1/sequences/s1?view=design&design=d2'
  const close = async () => {
    await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(el => !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden'))
  }
  await page.goto(base)
  await page.getByRole('button', { name: '本场资产 · 未关联', exact: true }).waitFor()
  await page.getByRole('button', { name: '设计问题 · 0', exact: true }).click()
  await page.getByText('当前范围未发现设计问题', { exact: true }).waitFor()
  await close()
  assert.equal(await page.getByRole('button', { name: '仅看问题', exact: true }).getAttribute('aria-pressed'), 'false')
  await page.getByRole('button', { name: '分镜 1', exact: true }).click()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).fill('未保存修改')
  await page.getByRole('button', { name: /^本场资产/ }).click()
  await page.getByRole('combobox', { name: '本场场所资产', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '街道' }).click()
  await page.getByText('已关联 1 项 · 角色 0 · 场所 1 · 道具 0', { exact: true }).waitFor()
  await close()
  await page.getByRole('button', { name: '本场资产 · 已关联 1', exact: true }).waitFor()
  await page.getByRole('button', { name: '全场规则', exact: true }).click()
  await page.getByRole('tab', { name: '分镜', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '可见结果', exact: true }).inputValue(), '未保存修改')
  await page.getByRole('button', { name: '仅看问题', exact: true }).click()
  await page.locator('.ant-empty-description:visible').filter({ hasText: '当前范围没有符合筛选条件的镜头，原有 2 个镜头仍保留。' }).waitFor()
  assert.match(await page.locator('.design-filter-status').innerText(), /0 \/ 2/)
  await page.reload()
  await page.getByRole('button', { name: '退出筛选', exact: true }).click()
  await page.getByRole('button', { name: '分镜 2', exact: true }).waitFor()
  for (const mode of ['分镜', '清单', '关系图']) {
    await page.getByRole('tab', { name: mode, exact: true }).click()
    await page.getByRole('textbox', { name: '搜索镜头、动作、人物', exact: true }).fill('不存在的动作')
    await page.locator('.ant-empty-description:visible').filter({ hasText: '当前范围没有符合筛选条件的镜头，原有 2 个镜头仍保留。' }).waitFor()
    await page.locator('.design-filter-status').getByRole('button', { name: '清除筛选', exact: true }).click()
  }
  design.direction.location_asset_id = 'missing'
  await page.reload()
  await page.getByRole('button', { name: '本场资产 · 已关联 0 · 不可用 1', exact: true }).waitFor()
  failedAssets = true
  await page.reload()
  await page.getByRole('button', { name: '本场资产 · 待核实', exact: true }).click()
  await page.getByText('资产列表加载失败，关联数量暂未核实', { exact: true }).waitFor()
  assert.ok(await page.getByRole('combobox', { name: '本场场所资产', exact: true }).isDisabled())
  failedAssets = false
  await page.getByRole('button', { name: '重试加载资产', exact: true }).click()
  await page.getByText('1 项资产引用在当前项目中不可用，请重新关联或清除；未自动更改设计。', { exact: true }).waitFor()
  await close()
  design.direction.shots[0].visible_result = { state: 'unset' }
  await page.reload()
  await page.getByRole('button', { name: '设计问题 · 1', exact: true }).click()
  await page.getByRole('button', { name: '动作待明确 · 定位', exact: true }).click()
  await page.getByRole('textbox', { name: '可见结果', exact: true }).waitFor()
  await page.setViewportSize({ width: 375, height: 812 })
  if (await page.locator('.ant-drawer-open').count()) await close()
  await page.getByRole('button', { name: '场次导航', exact: true }).click()
  await page.getByRole('button', { name: /^本场资产/ }).click()
  await page.getByRole('combobox', { name: '本场场所资产', exact: true }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await close()
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  console.log('PASS: assets count, unsaved draft, issues panel, persisted filter recovery, three empty views, unavailable assets, loading failure/retry, issue location; no writes')
} finally { await browser?.close(); await server.close() }
