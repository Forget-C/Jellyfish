import { closeCardList, openCardMenu, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-graph-')
const api = 'http://127.0.0.1:8274'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_graph_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8274' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4274, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '类型化画布' }) })).json()).data
  const doc = { ...canvas.document, cards: [
    { id: 'a', type: 'content.text', text: '第一份来源' },
    { id: 'b', type: 'content.text', text: '第二份来源' },
    { id: 'm', type: 'model.text', model_id: 'graph-text', prompt: { segments: [] }, config: {} },
  ] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: doc }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4274/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = id => page.locator(`[data-card-id="${id}"]`)
  await openCanvasCard(page, 'a')
  await page.getByRole('textbox', { name: '文本内容', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await closeCardList(page)
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  console.log('graph loaded')
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  const dragPort = async (from, output, to, input) => {
    await card(from).hover()
    const source = await card(from).locator('[data-connection-side="right"]').boundingBox()
    const target = await card(to).locator('[data-connection-side="left"]').boundingBox()
    assert.ok(source && target)
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
    await page.mouse.up()
    const purposes = page.getByRole('menu', { name: '选择连接用途', exact: true })
    if (await purposes.isVisible()) {
      const option = purposes.getByRole('menuitem').filter({ hasText: input === 'subject_image' ? '主体图片' : '文本' })
      if (await option.count()) await option.click()
    }
  }
  await dragPort('a', 'text', 'm', 'text')
  await page.getByRole('status').filter({ hasText: '已连接候选输入' }).waitFor()
  await dragPort('a', 'text', 'm', 'text')
  await page.getByRole('status').filter({ hasText: '该候选连接已存在' }).waitFor()
  await dragPort('b', 'text', 'm', 'text')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.edges.length, 2)
  const order = saved.document.input_order.m.text
  await card('m').press('Enter')
  await page.getByRole('button', { name: `前移输入 ${order[1]}`, exact: true }).click()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let puts = 0
  page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/generation-canvases/')) puts++ })
  const beforeMove = await card('a').boundingBox()
  // 新卡片使用有限默认尺寸；布局与视口仍须独立恢复。
  assert.ok(beforeMove.width >= 200 && beforeMove.height >= 100)
  await card('a').getByRole('button', { name: '移动布局：文本内容卡', exact: true }).press('ArrowDown')
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await delay(5200)
  assert.equal(puts, 0, 'layout/viewport does not save content')
  const afterMove = await card('a').boundingBox()
  assert.ok(afterMove.y > beforeMove.y)
  await page.reload()
  await card('a').waitFor()
  const reopened = await card('a').boundingBox()
  assert.ok(Math.abs(reopened.y - afterMove.y) < 2, 'layout/viewport restored')
  assert.ok(Math.abs(reopened.width - afterMove.width) < 2 && Math.abs(reopened.height - afterMove.height) < 2, 'card size restored')
  await closeCardList(page)
  await openCardMenu(page, 'a')
  await card('a').getByRole('button', { name: '选择卡片', exact: true }).click()
  await openCardMenu(page, 'b')
  await card('b').getByRole('button', { name: '选择卡片', exact: true }).click()
  await page.getByRole('button', { name: '将所选卡片分组', exact: true }).click()
  await page.getByRole('textbox', { name: '分组名称', exact: true }).fill('保留独立输入')
  const group = page.locator('[data-group-id]')
  await group.getByRole('button', { name: '移动布局：分组 保留独立输入', exact: true }).press('ArrowDown')
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  assert.ok((await group.boundingBox()).y > (await page.getByRole('complementary', { name: '画布筛选', exact: true }).boundingBox()).y, 'group controls stay below navigation after fitting')
  await group.getByRole('button', { name: '折叠组', exact: true }).click()
  assert.equal(await page.locator('[data-card-id="a"]').count(), 0)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.deepEqual(saved.document.input_order.m.text, [order[1], order[0]])
  assert.equal(saved.document.groups[0].collapsed, true)
  const fresh = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await fresh.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await fresh.goto(page.url())
  await fresh.locator('[data-card-id="m"]').waitFor()
  await fresh.waitForFunction(() => {
    const group = document.querySelector('[data-group-id]')?.getBoundingClientRect()
    const model = document.querySelector('[data-card-id="m"]')?.getBoundingClientRect()
    return group && model && model.x > group.x + group.width
  })
  await fresh.screenshot({ path: join(output, 'collapsed-fresh-browser.png'), fullPage: true })
  await fresh.close()
  await group.getByRole('button', { name: '展开组', exact: true }).click()
  await group.getByRole('button', { name: '解散组', exact: true }).click()
  assert.equal(await page.locator('[data-card-id]').count(), 3)
  await dragPort('m', 'text', 'm', 'text')
  await page.getByRole('status').filter({ hasText: '卡片不能连接自身' }).waitFor()
  await page.screenshot({ path: join(output, 'typed-graph-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  const second = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '模型切换' }) })).json()).data
  const modelDoc = { ...second.document, cards: [
    { id: 'i', type: 'content.image', file_id: null },
    { id: 'j', type: 'content.image', file_id: null },
    { id: 'v', type: 'model.video', model_id: 'graph-video-main', prompt: { segments: [{ id: 'retained', kind: 'text', text: '保留正文' }] }, config: { ratio: '9:16', seconds: 4, seed: 7 } },
  ] }
  const modelSave = await fetch(`${base}/${second.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed-model', expected_revision: 0, document: modelDoc }) })
  assert.ok(modelSave.ok, await modelSave.text())
  await page.goto(`http://127.0.0.1:4274/projects/canvas-project?tab=generation&canvas=${second.id}`)
  await card('v').waitFor()
  await card('v').press('Enter')
  await page.getByRole('textbox', { name: '模型正文', exact: true }).waitFor()
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  await page.getByRole('combobox', { name: '视频画幅', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await dragPort('i', 'image', 'v', 'subject_image')
  await card('v').press('Enter')
  await page.getByRole('status').filter({ hasText: '已连接候选输入' }).waitFor()
  await page.getByRole('combobox', { name: '选择模型', exact: true }).press('ArrowDown')
  await page.getByText('graph-video-alt', { exact: true }).last().click()
  await page.getByText('当前模型不支持，候选保留', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '模型正文', exact: true }).textContent(), '保留正文')
  await page.getByText('当前模型不支持已有视频画幅，配置已保留', { exact: true }).waitFor()
  await page.getByText('视频时长超出模型范围，配置已保留', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await dragPort('j', 'image', 'v', 'subject_image')
  const purposes = page.getByRole('menu', { name: '选择连接用途', exact: true })
  await purposes.waitFor()
  assert.equal(await purposes.getByRole('menuitem').filter({ hasText: '主体图片' }).count(), 0, 'unsupported model purpose is not offered')
  await page.keyboard.press('Escape')
  await dragPort('i', 'image', 'v', 'text')
  await purposes.waitFor()
  assert.equal(await purposes.getByRole('menuitem').filter({ hasText: '文本' }).count(), 0, 'image cannot be implicitly converted into text input')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const switched = (await (await fetch(`${base}/${second.id}`)).json()).data.document
  assert.equal(switched.edges.length, 1)
  assert.equal(switched.cards[2].model_id, 'graph-video-alt')
  assert.deepEqual(switched.cards[2].config, { ratio: '9:16', seconds: 4, seed: 7 })
  await page.screenshot({ path: join(output, 'model-switch-preserved.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'typed-graph-narrow.png'), fullPage: true })
  console.log('typed port drag, duplicate/self rejection, independent input order, group move/collapse/dissolve, local layout+viewport reopen and no content PUT verified')

} catch (error) {
  const pages = browser?.contexts()[0]?.pages() || []
  if (pages[0]) await pages[0].screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw error
} finally { await cleanup() }
