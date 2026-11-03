import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-independent-designs-')
const api = 'http://127.0.0.1:8298', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8298' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4298, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id:'consumer',type:'model.text' }] }
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('independent design save did not arrive')}
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:4298/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:visible')
  const cases=[['camera','机位与视角卡','平视机位','观察视点','支撑方式'],['lighting','光影与色彩卡','侧光塑形','光线方向','色彩关系'],['focus','焦点与成像卡','浅景深','景深与焦点','禁止项']]
  const created=[]
  for(const [kind,title,preset,main,extra] of cases){
    await page.getByRole('button',{name:'画面设计',exact:true}).click()
    await page.getByRole('button',{name:title,exact:true}).click()
    const state=await poll(s=>s.document.cards.some(card=>card.type==='direction.'+kind))
    const card=state.document.cards.find(card=>card.type==='direction.'+kind);created.push(card.id)
    await page.locator(`[data-card-id="${card.id}"]`).getByRole('button',{name:'开始设计',exact:true}).click()
    await detail.getByRole('button',{name:'预览 '+preset,exact:true}).waitFor()
    assert.equal(await detail.getByRole('tab').count(),0)
    assert.equal(await detail.getByRole('button',{name:'应用此预设',exact:true}).isDisabled(),true)
    await detail.getByRole('button',{name:'预览 '+preset,exact:true}).click()
    await detail.getByRole('button',{name:'应用此预设',exact:true}).click()
    await poll(s=>Object.values(s.document.cards.find(c=>c.id===card.id).fields).some(f=>f.text))
    await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    assert.equal(await detail.getByRole('textbox',{name:main+'内容',exact:true}).isVisible(),true)
    await detail.getByRole('textbox',{name:'设计适用范围',exact:true}).fill('仅用于'+kind+'试拍')
    await poll(s=>s.document.cards.find(c=>c.id===card.id).scope.description==='仅用于'+kind+'试拍')
    await detail.getByRole('textbox',{name:extra+'内容',exact:true}).fill('独立的'+kind+'说明')
    await poll(s=>Object.values(s.document.cards.find(c=>c.id===card.id).fields).some(f=>f.text==='独立的'+kind+'说明'))
    await detail.getByRole('button',{name:'返回预设',exact:true}).click()
    await detail.screenshot({path:join(output,kind+'-presets-desktop.png'),animations:'disabled'})
    await page.setViewportSize({width:390,height:844})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const actions=await detail.locator('.generation-editor-actions').boundingBox()
    assert.ok(actions.y+actions.height<=844)
    await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    await detail.screenshot({path:join(output,kind+'-advanced-mobile.png'),animations:'disabled'})
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
    await page.setViewportSize({width:1440,height:960})
    await page.reload()
    await page.locator(`[data-card-id="${card.id}"]`).getByRole('button',{name:'编辑设计',exact:true}).click()
    await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    assert.equal(await detail.getByRole('textbox',{name:extra+'内容',exact:true}).innerText(),'独立的'+kind+'说明')
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  const saved=(await read()).document
  assert.equal(saved.cards.length,4,'only explicitly created cards exist')
  assert.equal(saved.cards.filter(c=>c.type==='direction.photography').length,0,'new entries never create a hidden photography owner')
  assert.equal(new Set(created).size,3)
  const observer=await context.newPage();await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  for(let index=0;index<cases.length;index++){
    await observer.locator(`[data-card-id="${created[index]}"]`).getByRole('button',{name:'查看设计',exact:true}).click()
    const readonly=observer.locator('.wb-details:visible')
    await readonly.getByRole('button',{name:'高级设置',exact:true}).click()
    assert.equal(await readonly.getByRole('textbox',{name:cases[index][3]+'内容',exact:true}).isDisabled(),true)
    await readonly.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  await observer.close();assert.deepEqual(errors,[])
  console.log('Independent camera/lighting/focus create, apply, edit, save, refresh, readonly and responsive layouts passed:',output)
} finally { await cleanup() }
