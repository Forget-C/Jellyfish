import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-frame-targets-')
const api = 'http://127.0.0.1:8669', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8669' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4669, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const identity = id => ({canvas_id:canvas.id,card_id:id,port_id:'text',position:0})
  const document = {...canvas.document,cards:[
    {id:'movement',type:'direction.movement',fields:{movement_start:{state:'fact',text:'门外全景'}},phases:[{id:'end',name:'落幅',frame:{state:'proposal',text:'窗边停顿'}}]},
    {id:'composition',type:'direction.composition',fields:{composition:{state:'proposal',text:'保持人物偏左'}}},
    {id:'image',type:'model.image',model_id:'canvas-image-model',input_bindings:[{id:'composition-use',input_port:'text',source:identity('composition')},{id:'movement-use',input_port:'text',source:identity('movement')}]}],
    edges:[{id:'frame-candidate',source_card:'movement',source_port:'text',target_card:'composition',target_port:'text'},...['composition','movement'].map(id=>({id,source_card:id,source_port:'text',target_card:'image',target_port:'text'}))],input_order:{composition:{text:['frame-candidate']},image:{text:['composition','movement']}}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.text())
  const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('target save did not arrive')}
  await page.goto(`http://127.0.0.1:4669/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  await page.locator('[data-card-id="composition"]').getByRole('button',{name:/设计/}).click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.locator('[data-design-source]').first().click()
  await page.getByRole('combobox',{name:'定位到画面',exact:true}).locator('xpath=../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="落幅"]').click()
  await poll(state=>state.document.cards.find(c=>c.id==='composition').frame_target?.state_id==='phase:end')
  await page.getByRole('button',{name:'解除定位',exact:true}).click()
  await poll(state=>!state.document.cards.find(c=>c.id==='composition').frame_target)
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(state=>state.document.cards.find(c=>c.id==='composition').frame_target?.state_id==='phase:end')
  await detail.locator('[data-design-source]').first().click()
  await page.getByRole('button',{name:'断开候选连接',exact:true}).click()
  await page.getByRole('button',{name:'解除定位并断开',exact:true}).click()
  await poll(state=>!state.document.cards.find(c=>c.id==='composition').frame_target&&!state.document.edges.some(e=>e.id==='frame-candidate'))
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(state=>state.document.cards.find(c=>c.id==='composition').frame_target?.state_id==='phase:end'&&state.document.edges.some(e=>e.id==='frame-candidate'))
  await page.screenshot({path:join(output,'composition-frame-target.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.locator('[data-card-id="image"]').press('Enter')
  await openModelInspection(page)
  await detail.getByRole('combobox',{name:'画面目标 @文本2',exact:true}).locator('xpath=../..').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="落幅"]').click()
  await poll(state=>state.document.cards.find(c=>c.id==='image').frame_targets?.[0]?.state_id==='phase:end')
  await page.screenshot({path:join(output,'image-frame-target.png'),animations:'disabled'})
  await page.reload()
  await page.locator('[data-card-id="composition"]').getByRole('button',{name:/设计/}).click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.locator('[data-design-source]').first().click()
  assert.equal(await page.getByRole('combobox',{name:'定位到画面',exact:true}).locator('xpath=../..').innerText(),'落幅')
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:join(output,'frame-target-mobile.png'),animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.setViewportSize({width:1440,height:960})
  await page.locator('[data-card-id="movement"]').getByRole('button',{name:/设计/}).click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('tab',{name:/落幅/}).click()
  await detail.getByRole('tab',{name:/落幅/}).hover()
  await detail.getByRole('button',{name:'删除画面 落幅',exact:true}).click()
  await page.getByText('此画面正被 2 处定位使用',{exact:true}).waitFor()
  await page.screenshot({path:join(output,'delete-confirm.png'),animations:'disabled'})
  await page.getByRole('button',{name:/取\s*消/}).click()
  assert.equal((await read()).document.cards.find(card=>card.id==='movement').phases.length,1)
  await detail.getByRole('tab',{name:/落幅/}).hover()
  await detail.getByRole('button',{name:'删除画面 落幅',exact:true}).click()
  await page.getByRole('button',{name:'删除画面',exact:true}).click()
  await poll(state=>state.document.cards.find(card=>card.id==='movement').phases.length===0)
  assert.equal((await read()).document.cards.find(card=>card.id==='composition').frame_target.state_id,'phase:end','deletion retains invalid target until explicitly replaced')
  console.log(`Composition stable target, image goal, save/reload and narrow layout passed: ${output}`)
} finally { await cleanup() }
