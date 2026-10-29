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
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8482'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8482' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4482, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'筛选保持采用'})})
  const canvas=(await response.json()).data
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'用于候选的正文'}, {id:'model',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}}, {id:'other',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}}, {id:'person',type:'content.object',object_id:'actor',name:'张三',category:'character',text:'人物描述'}, {id:'photo',type:'direction.photography',input_bindings:[],examples:[],scope:{}}],edges:[],input_order:{}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.clone().text())
  await page.goto(`http://127.0.0.1:4482/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const source=page.locator('[data-card-id="source"]')
  await source.waitFor()
  await source.getByRole('button',{name:'卡片操作',exact:true}).click()
  await source.getByRole('button',{name:'连接到…',exact:true}).click()
  await page.getByRole('dialog',{name:'选择连接目标',exact:true}).waitFor()
  await page.getByRole('button',{name:'连接到文本模型卡 · 卡片 2',exact:true}).first().click()
  await page.getByRole('status').filter({hasText:'已连接候选输入'}).waitFor()
  await delay(1400)
  const saved=(await(await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.edges.length,1)
  assert.equal(saved.document.cards.find(c=>c.id==='model').input_bindings?.length||0,0)
  await source.getByRole('button',{name:'上侧连接点',exact:true}).press('Enter')
  await page.getByRole('dialog',{name:'选择连接目标',exact:true}).waitFor()
  await page.locator('[data-card-id="other"]').press('Enter')
  await page.getByRole('status').filter({hasText:'已连接候选输入'}).waitFor()
  assert.equal(await page.locator('.wb-details:visible').count(),0,'choosing a target does not open details')
  await delay(1300)
  assert.equal((await(await fetch(`${base}/${canvas.id}`)).json()).data.document.edges.length,2)
  await page.screenshot({path:join(output,'accessible-desktop.png'),animations:'disabled'})
  await source.press('Enter')
  const details=page.locator('.wb-details:visible')
  await details.getByRole('textbox',{name:'文本内容',exact:true}).fill('连接期间保留输入')
  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(200)
  const transform=await page.locator('.generation-world').getAttribute('style')
  await details.getByRole('button',{name:'添加卡片',exact:true}).tap()
  assert.equal(await page.locator('.wb-details:visible').count(),0,'mobile adding temporarily hides details')
  await page.getByRole('navigation',{name:'添加卡片',exact:true}).waitFor()
  await page.screenshot({path:join(output,'accessible-mobile-adding.png'),animations:'disabled'})
  await page.getByRole('button',{name:'关闭卡片列表',exact:true}).tap()
  await details.waitFor()
  assert.equal(await details.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'连接期间保留输入')
  assert.equal(await page.locator('.generation-world').getAttribute('style'),transform)
  await details.getByRole('button',{name:'连接到…',exact:true}).tap()
  await page.getByRole('dialog',{name:'选择连接目标',exact:true}).waitFor()
  assert.equal(await page.locator('.wb-details:visible').count(),0,'mobile connection hides original details')
  const targetBounds=await page.getByRole('dialog',{name:'选择连接目标',exact:true}).boundingBox()
  assert.ok(targetBounds.x+targetBounds.width<=390,'target menu stays inside viewport')
  await page.screenshot({path:join(output,'accessible-mobile-targets.png'),animations:'disabled'})
  await page.keyboard.press('Escape')
  await details.waitFor()
  assert.equal(await details.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'连接期间保留输入')
  await details.getByRole('button',{name:'添加卡片',exact:true}).tap()
  await page.getByRole('navigation',{name:'添加卡片',exact:true}).getByRole('button',{name:'添加文本卡',exact:true}).tap()
  await details.waitFor()
  assert.equal(await details.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'','successful creation opens new card, not previous editor')
  await page.getByRole('button',{name:'关闭详情',exact:true}).tap()
  await source.press('Enter')
  assert.equal(await details.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'连接期间保留输入','original editor session remains mounted')
  await page.getByRole('button',{name:'关闭详情',exact:true}).tap()
  await page.setViewportSize({width:1440,height:960})
  await source.getByRole('button',{name:'右侧连接点',exact:true}).press('Enter')
  await page.getByRole('button',{name:'连接到张三 · 卡片 4',exact:true}).click()
  await page.getByRole('status').filter({hasText:'没有兼容的接收用途'}).waitFor()
  await page.getByRole('button',{name:'取消连接',exact:true}).click()
  const person=page.locator('[data-card-id="person"]')
  await person.getByRole('button',{name:'右侧连接点',exact:true}).press('Enter')
  await page.getByRole('button',{name:'连接到摄影设计卡 · 卡片 5',exact:true}).click()
  const purposes=page.getByRole('menu',{name:'选择连接用途',exact:true})
  await purposes.waitFor()
  assert.equal(await page.getByRole('navigation',{name:'添加卡片',exact:true}).count(),0)
  await page.screenshot({path:join(output,'accessible-purposes.png'),animations:'disabled'})
  await page.keyboard.press('Escape')
  assert.equal(await purposes.count(),0)
  assert.equal(await person.getByRole('button',{name:'右侧连接点',exact:true}).evaluate(element=>element===document.activeElement),true,'cancel restores source focus')
  await person.getByRole('button',{name:'右侧连接点',exact:true}).press('Enter')
  await page.getByRole('button',{name:'连接到摄影设计卡 · 卡片 5',exact:true}).click()
  await purposes.getByRole('menuitem').filter({hasText:'焦点对象'}).click()
  await delay(1300)
  const final=(await(await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(final.document.edges.length,3)
  assert.equal(final.document.cards.find(c=>c.id==='photo').input_bindings.length,0)
  assert.equal(final.document.cards.find(c=>c.id==='source').text,'连接期间保留输入')
  assert.equal(final.document.cards.length,6)
  await page.reload()
  await source.press('Enter')
  assert.equal(await details.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'连接期间保留输入')
  console.log('mouse, keyboard, touch, purposes, zero-input refusal, mobile session and creation restoration verified')
} finally { await cleanup() }
