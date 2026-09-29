import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url)); process.chdir(root)
const output = await mkdtemp(join(tmpdir(), 'jellyfish-production-graph-'))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4203, strictPort: true, open: false } })
const workspace = makeWorkspace(), writes = [], errors = []
workspace.plans[0].content.units[0].dependencies = [{ plan_revision_id: 'p-new', unit_id: 'u1', frame_id: 'historical-frame', reference_id: 'historical-reference' }]
workspace.plans[0].content.units.push({ ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2', dependencies: [] })
workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: '固定输入', sources: [], decisions: [], format_version: 'v4' })]
let browser, page
try {
  await server.listen(); browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (path.endsWith('/sources/resolve')) return respond(req.postDataJSON().sources.map(source => ({ source, status: 'ready', label: '人工', description: '隔离来源' })))
    if (req.method() !== 'GET') writes.push(path)
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: 'c-active', reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
    if (path.endsWith('/overview')) return respond({ sequences: [{ ...workspace.sequence, source_excerpt: '', confirmed_design_count: 1, plan_count: 2 }] })
    if (/\/(assets|styles|batches)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4203/projects/p1/chapters/ch1/sequences/s1?view=shoot&design=d1&plan=p-old&unit=u1&prompt=&review='
  await page.goto(base)
  const graph = page.getByRole('region', { name: '试拍关系图' })
  await graph.waitFor()
  assert.equal(await graph.locator('[data-node-kind="unit"]').count(), 1)
  assert.equal(await graph.locator('[data-node-kind="take"]').count(), 3)
  await graph.locator('[data-node-kind="dependency"]').getByRole('button').click()
  await page.getByText('计划 2 · 固定历史依据', { exact: true }).waitFor()
  await page.locator('.production-unit-list').getByRole('button').filter({ hasText: '单元 02' }).click()
  await page.getByRole('combobox', { name: '视频模型', exact: true }).waitFor()
  assert.equal(await page.getByText('计划 2 · 固定历史依据', { exact: true }).count(), 0)
  await page.locator('.production-unit-list').getByRole('button').filter({ hasText: '单元 01' }).click()
  await graph.getByRole('button', { name: '参考输入', exact: true }).click()
  await page.getByRole('button', { name: '添加参考', exact: true }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '视频模型', exact: true }).isVisible(), false)
  await page.evaluate(() => {
    const query = new URL(location.href); query.searchParams.set('focus', 'unit-model:u1')
    history.pushState({}, '', query); dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.getByRole('combobox', { name: '视频模型', exact: true }).waitFor()
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 })
    if (width < 1280) {
      assert.equal(await graph.locator('svg').isVisible(), false)
      const drawer = page.locator('.ant-drawer-open')
      if (await drawer.count()) {
        await drawer.getByRole('button', { name: 'Close', exact: true }).click()
        await drawer.waitFor({ state: 'hidden' })
      }
    }
    assert.equal(await graph.locator('.production-graph-node > button').evaluateAll(buttons => buttons.every(button => {
      const box = button.getBoundingClientRect()
      return [...button.children].every(child => {
        const content = child.getBoundingClientRect()
        return child.scrollHeight <= child.clientHeight + 1 && content.top >= box.top && content.bottom <= box.bottom
      })
    })), true, `${width}: graph node text clipped`)
    await page.screenshot({ path: join(output, `graph-${width}.png`) })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await graph.locator('[data-node-kind="take"]').first().getByRole('button').click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('view') === 'cut')
  assert.equal(new URL(page.url()).searchParams.get('take'), 't1')
  assert.deepEqual(writes, []); assert.deepEqual(errors, [])
  console.log(JSON.stringify({ output, result: 'graph inputs use existing inspector, candidate deep link, four widths and zero writes passed' }))
} catch (error) { console.error(await page?.locator('body').innerText()); throw error }
finally { await browser?.close(); await server.close() }
