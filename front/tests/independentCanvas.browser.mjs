import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openCardList } from './generationCanvasWorkbench.browser-helpers.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-independent-canvas-')
const api = 'http://127.0.0.1:8471'
const backend = spawn(process.env.CANVAS_TEST_PYTHON || 'python3', ['-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8471' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited: ' + output)
    try { if ((await fetch(`${api}/health`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4471, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(12000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await page.goto('http://127.0.0.1:4471/canvases')
  await page.getByRole('link', { name: '画布', exact: true }).waitFor()
  await page.getByRole('button', { name: /新建画布/ }).click()
  await page.waitForURL(/\/canvases\/[^/]+$/)
  const canvasId = new URL(page.url()).pathname.split('/').at(-1)
  const toolbar = page.getByRole('toolbar', { name: '卡片分类', exact: true })
  await toolbar.waitFor()
  assert.equal(await toolbar.getByRole('button').count(), 3)
  for (const category of ['画面设计', '表演与调度', '叙事与镜头', '声音设计', '连续性与约束', '检查']) {
    assert.equal(await toolbar.getByRole('button', { name: category, exact: true }).count(), 0)
  }
  await page.evaluate(() => sessionStorage.setItem('jellyfish:card-clipboard:', JSON.stringify({
    schema: 1, projectId: '', cards: [{ id: 'forbidden', type: 'direction.style' }], positions: [{ x: 0, y: 0 }],
  })))
  await page.locator('.generation-surface').focus()
  await page.keyboard.press('ControlOrMeta+v')
  await page.getByText('无法粘贴：包含当前画布不支持的分镜专属卡片', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-card-id]').count(), 0)
  await openCardList(page, '基础卡')
  await page.getByRole('button', { name: '文本卡', exact: true }).click()
  await page.locator('[data-card-id]').first().waitFor()
  await page.getByRole('textbox', { name: '画布名称', exact: true }).fill('独立画布验收')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('button', { name: '返回画布列表', exact: true }).click()
  await page.getByRole('link', { name: /独立画布验收/ }).waitFor()
  await page.getByRole('button', { name: '独立画布验收的更多操作' }).press('Enter')
  await page.getByRole('menuitem', { name: '重命名' }).click()
  await page.getByRole('textbox', { name: '画布名称' }).fill('列表重命名')
  await page.getByRole('button', { name: '确 定', exact: true }).click()
  await page.getByRole('link', { name: /列表重命名/ }).waitFor()
  await page.getByRole('dialog', { name: '重命名画布' }).waitFor({ state: 'hidden' })
  const data = (await (await fetch(`${api}/api/v1/studio/generation-canvases/${canvasId}`)).json()).data
  assert.equal(data.project_id, null)
  assert.equal(data.document.cards[0].type, 'content.text')
  await page.screenshot({ path: join(output, 'canvas-list.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.getByRole('link', { name: '画布', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'canvas-list-mobile.png') })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '列表重命名的更多操作' }).click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('暂无画布', { exact: true }).waitFor()
  const studio = `${api}/api/v1/studio`
  const request = async (url, body) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  const chapter = 'separation-chapter', text = '门打开了。', project = 'canvas-project'
  await request(`${studio}/chapters`, { id: chapter, project_id: project, index: 0, title: '画布隔离', raw_text: text })
  const scope = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(scope, { title: '开门', position: 0, source_version: createHash('sha256').update(text).digest('hex'), span: { start: 0, end: Array.from(text).length } })
  const scene = await request(`${scope}/${sequence.id}/canvases`, { name: '分镜方案' })
  assert.equal((await fetch(`${studio}/generation-canvases/${scene.id}`)).status, 404)
  assert.equal((await (await fetch(`${studio}/generation-canvases`)).json()).data.pagination.total, 0)
  await page.goto(`http://127.0.0.1:4471/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${scene.id}`)
  await page.getByRole('toolbar', { name: '卡片分类', exact: true }).waitFor()
  assert.equal(await page.getByRole('toolbar', { name: '卡片分类', exact: true }).getByRole('button').count(), 9)
  await openCardList(page, '基础卡')
  await page.getByRole('button', { name: '文本卡', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const savedScene = (await (await fetch(`${studio}/generation-canvases/${scene.id}?project_id=${project}`)).json()).data
  assert.ok(savedScene.document.fixed_source)
  assert.ok(savedScene.document.cards.some(card => card.type === 'content.text'))
  await page.getByRole('button', { name: '返回工作台管理', exact: true }).click()
  await page.waitForURL(/workbench-management/)
  for (let index = 1; index <= 13; index++) {
    await request(`${studio}/generation-canvases`, { name: `分页画布 ${String(index).padStart(2, '0')}` })
  }
  await page.goto('http://127.0.0.1:4471/canvases')
  await page.getByText('共 13 张画布', { exact: true }).waitFor()
  const pagination = page.getByRole('navigation', { name: '画布列表分页' })
  const firstFooter = await pagination.boundingBox()
  assert.ok(firstFooter.x > 1000 && firstFooter.y > 900, '分页栏位于桌面右下角')
  assert.equal(await page.getByRole('article').count(), 12, '桌面四列三行显示 12 张')
  const summaries = (await (await fetch(`${studio}/generation-canvases?page_size=100`)).json()).data.items
  const lastName = summaries.at(-1).name
  const oldest = page.getByRole('link', { name: lastName, exact: true })
  assert.equal(await oldest.count(), 0)
  await page.screenshot({ path: join(output, 'canvas-list-paginated-desktop.png') })
  const searchCanvas = page.getByRole('textbox', { name: '搜索画布' })
  await searchCanvas.fill(lastName)
  await page.getByText('匹配 1 张画布', { exact: true }).waitFor()
  await oldest.waitFor()
  assert.equal(await pagination.count(), 0)
  await searchCanvas.fill('分页画布')
  await page.getByText('匹配 13 张画布', { exact: true }).waitFor()
  await pagination.getByText('2', { exact: true }).click()
  await oldest.waitFor()
  assert.equal((await pagination.boundingBox()).y, firstFooter.y)
  assert.equal(await page.getByRole('article').count(), 1)
  await oldest.click()
  await page.reload()
  await page.getByRole('button', { name: '返回画布列表', exact: true }).click()
  await oldest.waitFor()
  assert.equal(await searchCanvas.inputValue(), '分页画布')
  assert.equal(await page.getByRole('article').count(), 1)

  await page.setViewportSize({ width: 390, height: 844 })
  await pagination.getByRole('button', { name: '上一页' }).waitFor()
  await pagination.getByText('7 / 7', { exact: true }).waitFor()
  await page.waitForFunction(() => document.querySelector('.canvas-list-grid') && getComputedStyle(document.querySelector('.canvas-list-grid')).gridTemplateColumns.split(' ').length === 1)
  await oldest.waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.screenshot({ path: join(output, 'canvas-list-paginated-mobile.png') })

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForFunction(() => document.querySelector('.canvas-list-grid') && getComputedStyle(document.querySelector('.canvas-list-grid')).gridTemplateColumns.split(' ').length === 4)
  await pagination.locator('.ant-pagination-item-active').filter({ hasText: /^2$/ }).waitFor()
  await oldest.waitFor()
  await page.getByRole('button', { name: `${lastName}的更多操作` }).click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('匹配 12 张画布', { exact: true }).waitFor()
  assert.equal(await pagination.count(), 0)
  assert.equal(await page.getByRole('article').count(), 12)
  assert.equal(new URL(page.url()).searchParams.has('offset'), false)

  assert.deepEqual(errors, [])
  console.log('Independent canvas browser journey passed; evidence: ' + output)
} catch (error) {
  console.log(await page?.locator('body').innerText())
  await page?.screenshot({ path: join(output, 'failure.png') })
  console.log('Failure evidence: ' + output)
  throw error
} finally { await cleanup() }
