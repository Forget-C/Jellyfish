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
const output = await browserOutput('jellyfish-canvas-locale-')
const api = 'http://127.0.0.1:8689', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_PORT: '8689', CORS_ORIGINS: 'http://127.0.0.1:4689' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4689, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context=await browser.newContext({ viewport: { width: 1440, height: 1000 } });page=await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const read = async id => (await (await fetch(base + '/' + id)).json()).data
  const projections = []
  const origin = 'http://127.0.0.1:4689'
  const body = '门边的信 · Blue'
  for (const english of [false, true]) {
    const t = (zh, en) => english ? en : zh
    const name = '双语连线 ' + (english ? 'EN' : 'ZH')
    const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json()).data
    await page.goto(origin + '/canvases')
    if (english) {
      await page.getByRole('button', { name: '用户与语言设置' }).click()
      await page.getByRole('menuitem', { name: 'English' }).click()
    }
    await page.getByRole('textbox', { name: t('搜索画布', 'Search canvases') }).fill(name)
    await page.getByRole('link', { name, exact: true }).click()
    await page.getByLabel(t('生成画布视口', 'Generation canvas viewport'), { exact: true }).waitFor()
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      const values = page.locator('.generation-browse .ant-select-selection-item')
      assert.equal(await values.count(), 2)
      assert.ok(await values.evaluateAll(items => items.every(item => item.scrollWidth <= item.clientWidth + 1)), `Full canvas filters at ${width}px`)
    }
    await page.getByRole('button', { name: t('基础卡', 'Basic cards'), exact: true }).click()
    const list = page.getByRole('navigation', { name: t('添加卡片', 'Add card') })
    await list.getByRole('searchbox').fill(t('文本卡', 'text card'))
    await list.getByRole('button', { name: t('文本卡', 'Text card'), exact: true }).click()
    const source = page.locator('article[data-card-type="content.text"]')
    await source.press('Enter')
    await page.getByRole('textbox', { name: t('文本内容', 'Text content'), exact: true }).fill(body)
    await page.keyboard.press('Escape')
    await page.mouse.click(1050, 680, { button: 'right' })
    const menu = page.getByRole('menu', { name: t('画布右键菜单', 'Canvas context menu') })
    await menu.getByRole('menuitem', { name: t('新建节点', 'New node'), exact: true }).dispatchEvent('click')
    await page.getByRole('menuitem', { name: t('基础卡', 'Basic cards'), exact: true }).hover()
    await page.getByRole('menuitem', { name: t('文本卡', 'Text card'), exact: true }).waitFor()
    await page.getByRole('menuitem', { name: t('模型生成', 'Generation models'), exact: true }).hover()
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/models/canvas-runtime-text/capability') && response.ok()),
      (async () => {
        await page.getByRole('menuitem', { name: t('文本模型卡', 'Text model card'), exact: true }).click()
        await page.locator('article[data-card-type="model.text"]').press('Enter')
      })(),
    ])
    await page.keyboard.press('Escape')
    await source.getByRole('button', { name: t('右侧连接点', 'Right connection point'), exact: true }).press('Enter')
    const model = page.locator('article[data-card-type="model.text"]')
    await model.waitFor()
    const connected = page.waitForResponse(response => {
      const request = response.request()
      return request.method() === 'PUT' && request.postDataJSON()?.document?.edges?.length === 1 && response.ok()
    })
    await page.getByRole('dialog', { name: t('选择连接目标', 'Select connection target') })
      .getByRole('button', { name: t('连接到文本模型卡 · 卡片 2', 'Connect to Text model card · Card 2'), exact: true }).click()
    await connected
    const saved = page.getByRole('status', { name: t('画布保存状态', 'Canvas save status'), exact: true })
    await saved.filter({ hasText: t('已保存', 'Saved') }).waitFor()
    const record = await read(canvas.id)
    const edge = record.document.edges[0]
    assert.equal(record.document.edges.length, 1)
    assert.equal(record.document.cards.find(card => card.id === edge.source_card).text, body)
    projections.push([record.document.cards.find(card => card.id === edge.source_card).type, edge.source_port,
      record.document.cards.find(card => card.id === edge.target_card).type, edge.target_port])
    await page.reload()
    await source.waitFor()
    assert.deepEqual((await read(canvas.id)).document, record.document)
    if (english) {
      await page.setViewportSize({width:390,height:844})
      const categories=page.getByRole('button',{name:'Basic cards',exact:true})
      await categories.click()
      const search=page.getByRole('navigation',{name:'Add card'}).getByRole('searchbox')
      await search.fill('Text card')
      const choice=page.getByRole('button',{name:'Text card',exact:true})
      await choice.focus()
      const bounds=await choice.boundingBox()
      assert.ok(bounds && bounds.x>=0 && bounds.x+bounds.width<=390 && bounds.y+bounds.height<=844)
      await page.setViewportSize({width:1440,height:1000})
      await page.goto(origin + '/canvases')
      await page.getByRole('button', { name: 'User and language settings' }).click()
      await page.getByRole('menuitem', { name: '简体中文' }).click()
      await page.goto(origin + '/canvases/' + canvas.id)
      await page.getByLabel('生成画布视口', { exact: true }).waitFor()
      await source.press('Enter')
      assert.equal(await page.getByRole('textbox', { name: '文本内容' }).inputValue(), body)
      assert.equal((await read(canvas.id)).revision, record.revision)
    }
  }
  assert.deepEqual(projections[0], projections[1])
  console.log('Bilingual canvas search, card creation, connections, save, revision and reopen verified.')
} finally {
  await cleanup()
}
