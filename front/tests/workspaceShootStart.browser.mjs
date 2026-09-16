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
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4196, strictPort: true, open: false } })
const workspace = makeWorkspace(), existing = structuredClone(workspace.plans)
workspace.plans = []
const writes = [], errors = []
const output = await mkdtemp(join(tmpdir(), 'jellyfish-shoot-start-')), results = []
let browser, page
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工填写' })))
    if (req.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ reviews: [], repairs: [], knowledge: [] })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4196/projects/p1/chapters/ch1/sequences/s1?design=d1&plan=&unit=&prompt=&review='
  await page.goto(base + '&view=design')
  await page.getByRole('button', { name: '准备试拍 →', exact: true }).click()
  const start = page.getByRole('region', { name: '试拍准备起点', exact: true })
  await start.waitFor()
  assert.equal(await page.getByText('先确认导演设计，再创建拍摄单元。', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '拆分与重组', exact: true }).count(), 0)
  assert.ok(await start.getByRole('button', { name: /建立试拍草稿/ }).isDisabled())
  await start.getByRole('checkbox').first().check()
  await page.reload()
  assert.ok(await start.getByRole('checkbox').first().isChecked())
  await start.getByRole('button', { name: /建立试拍草稿/ }).click()
  await page.getByRole('combobox', { name: '视频模型', exact: true }).waitFor()
  await page.getByRole('tab', { name: '导演设计', exact: true }).click()
  await page.getByRole('button', { name: '继续试拍 →', exact: true }).click()
  assert.equal(await page.locator('.production-unit-list > button').count(), 1)
  assert.equal(await page.getByRole('dialog').count(), 0)
  // 新的独立导航样本：旧版本未保存准备不应混入其他设计。
  await page.goto(base.replace('design=d1', 'design=d2') + '&view=shoot')
  await start.getByRole('button', { name: '返回导演设计', exact: true }).waitFor()
  assert.equal(await start.getByRole('button', { name: /建立试拍草稿/ }).count(), 0)
  workspace.plans = existing
  await page.goto(base + '&view=shoot')
  await start.getByRole('button', { name: /继续计划 1/ }).waitFor()
  assert.equal(await start.getByRole('button', { name: /继续计划/ }).count(), 2)
  await start.getByRole('button', { name: /继续计划 2/ }).click()
  await page.getByRole('combobox', { name: '查看或编辑生产计划', exact: true }).waitFor()
  assert.match(page.url(), /plan=p-new/)
  workspace.plans = [existing[0]]
  await page.goto(base + '&view=design')
  await page.getByRole('button', { name: '继续试拍 →', exact: true }).click()
  await page.getByRole('combobox', { name: '视频模型', exact: true }).waitFor()
  assert.match(page.url(), /plan=p-old/)
  workspace.plans = []
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto(base + '&view=shoot')
    await start.waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const button = start.getByRole('button', { name: /建立试拍草稿/ })
    await button.scrollIntoViewIfNeeded()
    const bounds = await button.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    await page.screenshot({ path: join(output, `${width}-start.png`) })
    results.push({ width, bounds })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  workspace.designs[1].confirmed_at = '2026-09-16T00:00:00'
  await page.goto(base + '&view=shoot')
  await start.getByRole('combobox', { name: '试拍设计依据' }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '设计 2' }).click()
  await page.waitForURL(url => url.searchParams.get('prepareDesign') === 'd2')
  await page.reload()
  await start.getByRole('heading', { name: '基于设计 2准备试拍', exact: true }).waitFor()
  await page.goto(base.replace('plan=', 'plan=missing-plan') + '&view=shoot')
  await start.getByText('所选生产计划不可用，未自动改用其他版本', { exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('plan'), 'missing-plan')
  workspace.plans = [{ ...structuredClone(existing[0]), id: 'missing-plan' }]
  await start.getByRole('button', { name: '重试读取计划', exact: true }).click()
  await page.getByRole('combobox', { name: '查看或编辑生产计划', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('plan'), 'missing-plan')
  await page.goto(base.replace('design=d1', 'design=missing-design') + '&view=shoot')
  await start.getByText('当前设计依据不可用，不能用其他版本代替', { exact: true }).waitFor()
  assert.equal(await start.getByRole('button', { name: /建立试拍草稿/ }).count(), 0)
  // 多镜选择保留真实顺序；空计划复用原身份，不另建空记录。
  await page.setViewportSize({ width: 1440, height: 900 })
  const shot = structuredClone(workspace.designs[0].content.direction.shots[0])
  shot.id = 'shot2'
  workspace.designs[0].content.direction.shots.push(shot)
  workspace.plans = [structuredClone(existing[1])]
  workspace.plans[0].content.units = []
  await page.goto(base.replace('plan=', 'plan=p-new') + '&view=shoot')
  await start.getByRole('checkbox').nth(1).check()
  await start.getByRole('checkbox').first().check()
  await start.getByRole('button', { name: '建立试拍草稿 · 2 个单元', exact: true }).press('Enter')
  await page.getByRole('combobox', { name: '视频模型', exact: true }).waitFor()
  assert.equal(await page.locator('.production-unit-list > button').count(), 2)
  assert.equal(new URL(page.url()).searchParams.get('plan'), 'p-new')
  assert.equal(workspace.plans[0].content.units.length, 0, '建立本地草稿没有写入服务端计划')
  assert.deepEqual(writes, [])
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, writes, errors }, null, 2))
  console.log(output)
  console.log('PASS: confirmed/direct-tab entry, explicit shot selection, refresh, draft reuse, unconfirmed design, exact multi/single plans, four widths; no writes')
} catch (error) { if (page) console.log(await page.locator('body').innerText()); throw error } finally { await browser?.close(); await server.close() }
