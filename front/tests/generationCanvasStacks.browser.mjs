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
const api = 'http://127.0.0.1:8460'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8460' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4460, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin }; Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true }) })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '类型化画布' }) })).json()).data
  const doc = { ...canvas.document, cards: [
    { id: 'a', type: 'content.text', text: '第一份来源' },
    { id: 'b', type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: [{id:'prompt',kind:'text',text:'继续生成'}] }, config: {} },
    { id: 'm', type: 'content.text', text: '外部来源' },
  ], input_order:{b:{text:['internal','incoming']}}, edges: [{id:'internal',source_card:'a',source_port:'text',target_card:'b',target_port:'text'}, {id:'incoming',source_card:'m',source_port:'text',target_card:'b',target_port:'text'}] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: doc }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4460/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = id => page.locator(`[data-card-id="${id}"]`)
  const selected = () => page.locator('[data-card-id][data-selected="true"]')
  await card('a').waitFor()
  await closeCardList(page)
  await openCanvasCard(page,'b')
  await page.locator('.wb-details:not([hidden])').getByRole('button',{name:'预检运行',exact:true}).click()
  const preview=page.getByRole('dialog',{name:'运行预检',exact:true})
  await preview.waitFor()
  await preview.getByRole('button',{name:'确认执行',exact:true}).click()
  await page.locator('[data-card-id="b"]').getByText('第一段',{exact:true}).waitFor()
  await page.keyboard.press('Escape')
  await card('a').click()
  await card('b').click({ modifiers: ['Control'] })
  assert.equal(await selected().count(), 2)
  const menu = page.getByRole('toolbar', { name: '所选卡片操作', exact: true })
  await menu.waitFor()
  const menuBox = await menu.boundingBox(), aBox = await card('a').boundingBox()
  assert.ok(menuBox.y + menuBox.height <= aBox.y + 1, 'organization toolbar above selection')
  await menu.getByRole('button', { name: '堆叠', exact: true }).click()
  await page.locator('[data-stack-id]').waitFor()
  await page.screenshot({path:join(output,'stack-default.png'),fullPage:true})
  const stack = page.locator('[data-stack-id]')
  assert.equal(await card('a').count(), 0)
  assert.equal(await card('b').count(), 0)
  assert.equal(await page.locator('[data-edge-active]').count(), 1, 'internal edge hidden, external edge retained')
  await stack.hover()
  await page.screenshot({path:join(output,'stack-hover.png'),fullPage:true})
  await stack.click()
  const reading=page.getByRole('dialog',{name:'堆叠内容（只读）',exact:true})
  await reading.waitFor()
  assert.equal(await reading.locator('article').count(),2)
  await reading.getByText('第一份来源',{exact:true}).waitFor()
  await reading.getByText('第一段',{exact:true}).waitFor()
  await fetch(`${api}/test/runtime-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({release:2})})
  await reading.getByText('第一段第二段第三段',{exact:true}).first().waitFor()
  assert.equal(await reading.getByRole('textbox').count(),0)
  assert.equal(await reading.getByRole('button',{name:'提交生成',exact:true}).count(),0)
  await page.screenshot({path:join(output,'stack-reading.png'),fullPage:true})
  await page.keyboard.press('Escape')
  await reading.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'保存画布',exact:true}).click()
  await page.getByRole('status').filter({hasText:'已保存'}).first().waitFor()
  let saved=(await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.groups[0].kind,'stack')
  assert.deepEqual(saved.document.groups[0].card_ids,['a','b'])
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('combobox',{name:'选择候选连线',exact:true}).click()
  await page.locator('.ant-select-item-option').nth(1).click()
  await page.getByRole('button',{name:'删除此候选连接',exact:true}).click()
  await page.getByRole('status').filter({hasText:'请先解除堆叠后删除输入连线'}).waitFor()
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.document.edges.length,2)
  await page.keyboard.press('Escape')
  await openCardMenu(page,'m')
  await page.getByRole('button',{name:'删除卡片',exact:true}).click()
  await page.getByRole('status').filter({hasText:'请先解除相关堆叠后删除'}).waitFor()
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await page.waitForFunction(() => document.querySelector('[data-stack-id]').getBoundingClientRect().left >= 0)
  const original=await stack.boundingBox()
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('button',{name:'整理布局',exact:true}).click()
  await page.getByRole('button',{name:'撤销布局整理',exact:true}).click()
  await page.keyboard.press('Escape')
  const undone=await stack.boundingBox()
  assert.ok(Math.abs(undone.x-original.x)<2 && Math.abs(undone.y-original.y)<2,'whole-organization arrangement can be undone')
  const before=await stack.boundingBox()
  await page.mouse.move(before.x+before.width/2,before.y+before.height/2)
  await page.mouse.down(); await page.mouse.move(before.x+before.width/2+60,before.y+before.height/2+40,{steps:5}); await page.mouse.up()
  const after=await stack.boundingBox()
  assert.ok(Math.abs(after.x-before.x-60)<2 && Math.abs(after.y-before.y-40)<2)
  await page.reload(); await stack.waitFor()
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await stack.tap(); await reading.waitFor(); await reading.getByText('第一份来源',{exact:true}).waitFor()
  await page.waitForFunction(modal => Number(getComputedStyle(modal).opacity) > .99, await reading.elementHandle())
  await page.screenshot({path:join(output,'stack-mobile-reading.png'),fullPage:true})
  assert.equal(await reading.isVisible(),true,'touch tap keeps read-only overlay open')
  await page.keyboard.press('Escape'); await reading.waitFor({state:'hidden'})
  await page.setViewportSize({width:1440,height:960})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await stack.click(); await reading.waitFor(); await reading.getByRole('button',{name:'Close',exact:true}).click()
  await stack.hover(); await stack.getByRole('button',{name:'解除堆叠',exact:true}).click()
  await card('a').waitFor(); await card('b').waitFor()
  assert.equal(await selected().count(),2)
  await menu.waitFor()
  assert.equal(await page.locator('[data-canvas-details]:visible').count(),0)
  await page.getByRole('button',{name:'保存画布',exact:true}).click()
  await page.getByRole('status').filter({hasText:'已保存'}).first().waitFor()
  saved=(await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.deepEqual(saved.document.groups,[])
  assert.equal(saved.document.edges.length,2)
  console.log('stack create, readonly, relation protection, movement, reopen and unstack passed')
} finally { await cleanup() }
