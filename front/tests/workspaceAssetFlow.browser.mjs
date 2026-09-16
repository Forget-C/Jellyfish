import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false } })
const workspace = makeWorkspace(), assets = [], requests = [], errors = []
workspace.designs[0].content.participants[0].name = '张三'
const output = await mkdtemp(join(tmpdir(), 'jellyfish-asset-flow-')), results = []
let browser, page, ambiguous = true, saved
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工填写' })))
    if (req.method() !== 'GET') requests.push({ path, body: req.postDataJSON() })
    if (path.endsWith('/s1/assets') && req.method() === 'POST') {
      const body = req.postDataJSON()
      if (!assets.length) assets.push({ id: 'created-role', kind: body.kind, name: body.name, description: body.description, image_file_ids: [], unavailable_image_count: 0 })
      if (ambiguous) { ambiguous = false; return route.fulfill({ status: 503, json: { detail: '响应暂不可用' } }) }
      return respond(assets[0])
    }
    if (path.endsWith('/s1/revisions')) {
      saved = req.postDataJSON()
      workspace.designs.push(revision('saved-design', saved.document.content, false))
      return respond(workspace)
    }
    if (path.endsWith('/assets')) return respond(assets)
    if (path.endsWith('/entities/character/created-role')) return respond({ ...assets[0], visual_style: '现实', style: '真人都市', view_count: 1, tags: [] })
    if (path.endsWith('/images')) return respond({ items: [], total: 0 })
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/s1/feedback')) return respond({ reviews: [], repairs: [], knowledge: [] })
    if (/\/(styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  await page.goto('http://127.0.0.1:4197/projects/p1/chapters/ch1/sequences/s1?view=design&design=d1&plan=&unit=')
  await page.getByRole('button', { name: /^本场资产/ }).click()
  const row = page.getByRole('region', { name: '本场对象 张三', exact: true })
  await row.getByRole('combobox', { name: '张三资产类型', exact: true }).locator('../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '角色' }).click()
  const typed = page.getByRole('region', { name: '本场对象 张三 · 角色', exact: true })
  await typed.getByRole('button', { name: '新建并关联', exact: true }).click()
  const modal = page.getByRole('dialog', { name: '创建角色并关联本场', exact: true })
  assert.equal(await modal.getByRole('textbox', { name: '新资产名称' }).inputValue(), '张三')
  await modal.getByRole('button', { name: '创建并关联', exact: true }).click()
  await modal.getByText(/保留本次请求身份/).waitFor()
  assert.ok(await modal.getByRole('textbox', { name: '新资产名称' }).isDisabled())
  await modal.getByRole('button', { name: '核实并重试创建', exact: true }).click()
  await typed.getByText('尚无图片', { exact: false }).waitFor()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].body.request_id, requests[1].body.request_id)
  assert.equal(assets.length, 1)
  await page.getByText('角色档案「张三」已创建；本场关联待保存', { exact: true }).waitFor()
  await typed.getByRole('button', { name: '查看资产', exact: true }).click()
  const details = page.getByRole('dialog', { name: '角色资产 · 张三 · 当前项目', exact: true })
  await details.getByRole('button', { name: '返回本场资产', exact: true }).waitFor()
  await details.getByRole('button', { name: '准备图片视角', exact: true }).waitFor()
  assert.equal(requests.length, 2, '查看详情不能自动建立图片槽位')
  await details.getByRole('textbox', { name: '名称', exact: true }).fill('张三修改中')
  await details.getByRole('button', { name: '返回本场资产', exact: true }).click()
  const protection = page.getByRole('dialog').filter({ hasText: '资产档案有未保存的修改' })
  await protection.getByRole('button', { name: '继续编辑', exact: true }).click()
  await protection.waitFor({ state: 'hidden' })
  assert.equal(await details.getByRole('textbox', { name: '名称', exact: true }).inputValue(), '张三修改中')
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: join(output, `${width}-detail.png`), animations: 'disabled' })
    results.push({ width, state: 'detail' })
  }
  await details.getByRole('textbox', { name: '名称', exact: true }).fill('张三')
  await details.getByRole('button', { name: '返回本场资产', exact: true }).click()
  await details.waitFor({ state: 'hidden' })
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await typed.getByRole('button', { name: '查看资产', exact: true }).scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    const contentWidth = await page.locator('.scene-asset-result .ant-alert-content').evaluate(el => el.getBoundingClientRect().width)
    assert.ok(contentWidth >= 180, '创建反馈正文不能挤成窄列')
    await page.locator('.scene-asset-result').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, `${width}-assets.png`), animations: 'disabled' })
    const bounds = await typed.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    results.push({ width, state: 'assets' })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: '本场资产 · 已关联 1', exact: true }).waitFor()
  await page.locator('.ant-drawer-open').last().getByRole('button', { name: 'Close', exact: true }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.ant-drawer-mask')].every(el => !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden'))
  await page.getByRole('button', { name: '保存为新设计草稿', exact: true }).click()
  await page.getByRole('button', { name: '保存设计草稿', exact: true }).waitFor()
  assert.equal(saved.parent_id, 'd1')
  assert.equal(saved.revision_id, undefined)
  assert.equal(saved.document.content.participants[0].character_id, 'created-role')
  assert.equal(workspace.designs[0].content.participants[0].character_id, null)
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, requests, errors }, null, 2))
  console.log(output)
  console.log('PASS: explicit type, contextual creation/link, ambiguous retry identity, real entity result, no implicit image writes, detail return, confirmed revision derives draft')
} catch (error) { if (page) { console.log(await page.locator('body').innerText()); console.log(await page.locator('[role=dialog]').evaluateAll(nodes => nodes.map(node => ({label:node.getAttribute('aria-labelledby'), hidden:node.getAttribute('aria-hidden'), text:node.innerText.slice(0,140), rect:JSON.stringify(node.getBoundingClientRect())})))); await page.screenshot({path:'/tmp/jellyfish-asset-flow-failure.png'}); } throw error } finally { await browser?.close(); await server.close() }
