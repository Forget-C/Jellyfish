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
const output = await browserOutput('jellyfish-generation-canvas-carried-images-')
const api = 'http://127.0.0.1:8667', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8667' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4667, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const form = new FormData()
  form.set('project_id','canvas-project');form.set('usage_kind','generation_upload')
  form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lmN8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'reference.png')
  const uploaded=await fetch(`${api}/api/v1/studio/files/upload`,{method:'POST',body:form})
  assert.ok(uploaded.ok,await uploaded.clone().text());const file=(await uploaded.json()).data.id
  const identity=id=>({canvas_id:canvas.id,card_id:id,port_id:id==='reference'?'image':'text',position:0})
  const document={...canvas.document,cards:[{id:'reference',type:'content.image',file_id:file},
    {id:'style',type:'direction.camera',fields:{viewpoint:{state:'proposal',document:{segments:[{id:'before',kind:'text',text:'参考人物：'},{id:'image',kind:'reference',source:identity('reference')}]}}}},
    {id:'criterion',type:'direction.criterion',criterion_id:'clear',name:'主体清晰',standard:{text:'表情可辨认'}},
    {id:'image',type:'model.image',model_id:'canvas-image-model',input_bindings:[{id:'direct-image',input_port:'image',prompt_owned:false,source:identity('reference')}]}],
    edges:[{id:'ref',source_card:'reference',source_port:'image',target_card:'style',target_port:'image'}, {id:'design',source_card:'style',source_port:'text',target_card:'image',target_port:'text'},
      {id:'acceptance',source_card:'criterion',source_port:'criterion',target_card:'style',target_port:'acceptance_basis'},
      {id:'direct-criterion',source_card:'criterion',source_port:'text',target_card:'image',target_port:'text'},
      {id:'direct-image-edge',source_card:'reference',source_port:'image',target_card:'image',target_port:'image'}],
    input_order:{style:{image:['ref'],acceptance_basis:['acceptance']},image:{text:['design','direct-criterion'],image:['direct-image-edge']}}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})});assert.ok(seed.ok,await seed.text())
  const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('carried save did not arrive')}
  const compiled=async()=> (await (await fetch(`${base}/${canvas.id}/cards/image/compile`)).json()).data
  await page.goto(`http://127.0.0.1:4667/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="image"]').press('Enter')
  await page.getByRole('region',{name:'关联来源',exact:true}).getByRole('button',{name:/机位与视角卡/}).click()
  // A sole independent design connection is adopted immediately.
  await poll(state=>state.document.cards.find(c=>c.id==='image').input_bindings?.length===3)
  await page.getByRole('region',{name:'随设计携带的素材',exact:true}).waitFor()
  assert.equal((await compiled()).media.length,1)
  assert.equal((await read()).document.edges.length,5,'adoption does not add a direct media edge')
  await page.getByText('此素材也由本卡直接采用', { exact: true }).waitFor()
  await page.getByText('此验收要求也由本卡直接采用', { exact: true }).waitFor()
  const strip = page.getByRole('region', { name: '关联来源', exact: true })
  assert.equal(await strip.locator('.generation-material-reference').count(), 3, 'carried paths do not create duplicate source entries')
  await page.keyboard.press('Escape')
  await strip.getByRole('button', { name: /图片内容卡/ }).click()
  await page.locator('.canvas-association-inspect:visible').getByRole('button', { name: /^取消采用/ }).click()
  await poll(state => !state.document.cards.find(card => card.id === 'image').input_bindings.some(binding => binding.id === 'direct-image'))
  await page.keyboard.press('Escape')
  await strip.getByRole('button', { name: /机位与视角卡/ }).click()
  await page.getByRole('region', { name: '随设计携带的素材', exact: true }).waitFor()
  assert.equal((await compiled()).media.length, 1, 'clearing direct adoption preserves the carried path')
  await page.screenshot({path:join(output,'carried-images.png'),animations:'disabled'})
  await page.getByRole('button',{name:'查看 机位与视角卡 · 观察视点',exact:true}).click()
  const field=page.getByRole('textbox',{name:'观察视点内容',exact:true})
  await field.waitFor();await delay(350);await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='观察视点内容')
  await page.screenshot({path:join(output,'carried-image-origin.png'),animations:'disabled'})
  await field.fill('改为纯文字风格')
  await poll(state=>state.document.cards.find(c=>c.id==='style').fields.viewpoint.document.segments.every(s=>s.kind==='text'))
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.locator('[data-card-id="image"]').press('Enter');await page.getByRole('region',{name:'关联来源',exact:true}).getByRole('button',{name:/机位与视角卡/}).click()
  for(let i=0;i<80&&(await compiled()).media.length;i++)await delay(100)
  assert.equal((await compiled()).media.length,0)
  assert.equal(await page.getByRole('region',{name:'随设计携带的素材',exact:true}).count(),0)
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:join(output,'carried-image-mobile.png'),animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  console.log(`Design-carried image, explicit adoption, origin field navigation and last-reference removal passed: ${output}`)
} finally { await cleanup() }
