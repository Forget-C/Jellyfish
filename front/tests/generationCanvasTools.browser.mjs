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
const api = 'http://127.0.0.1:8425'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8425' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4425, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'筛选保持采用'})})
  const canvas=(await response.json()).data
  const source={canvas_id:canvas.id,card_id:'source',port_id:'text',position:0}
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'被隐藏但明确采用的内容'},
    {id:'model',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[{id:'reference',kind:'reference',source}]},config:{}}],
    edges:[{id:'candidate',source_card:'source',source_port:'text',target_card:'model',target_port:'text'}],input_order:{model:{text:['candidate']}}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.clone().text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const before=await read()
  const precheck=async()=>(await(await fetch(`${base}/${canvas.id}/precheck`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_id:'model'})})).json()).data
  const initialPreview=await precheck()
  assert.match(initialPreview.input.text,/被隐藏但明确采用的内容/)
  await page.goto(`http://127.0.0.1:4425/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.getByRole('navigation',{name:'画布视图工具',exact:true}).waitFor()
  if(await page.getByRole('button',{name:'关闭详情',exact:true}).isVisible())await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  const original=await read()
  const view=()=>page.locator('.generation-world').getAttribute('style')
  const initial=await view()
  await page.getByRole('button',{name:'放大',exact:true}).click()
  assert.notEqual(await view(),initial)
  assert.match(await page.getByLabel('画布缩放比例').innerText(),/%/)
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('button',{name:'展开小地图',exact:true}).click()
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('img',{name:'小地图导航',exact:true}).press('ArrowLeft')
  const mapView=await view()
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('button',{name:'整理布局',exact:true}).click()
  await page.getByRole('button',{name:'撤销布局整理',exact:true}).click()
  await page.getByRole('button',{name:'布局',exact:true}).click()
  assert.equal(await view(),mapView)
  assert.deepEqual((await read()).document,original.document)
  assert.deepEqual((await precheck()).input,initialPreview.input)
  assert.equal(await page.getByRole('button',{name:'将所选卡片分组',exact:true}).count(),0)
  for (const id of ['source','model']) {
    const card=page.locator(`[data-card-id="${id}"]`)
    await card.getByRole('button',{name:'卡片操作',exact:true}).click()
    await card.getByRole('button',{name:'选择卡片',exact:true}).click()
  }
  await page.getByRole('button',{name:'定位所选',exact:true}).click()
  await page.getByRole('button',{name:'将所选卡片分组',exact:true}).click()
  await page.getByRole('textbox',{name:'分组名称',exact:true}).waitFor()
  await page.getByRole('button',{name:'撤销内容',exact:true}).click()
  await page.getByRole('textbox',{name:'分组名称',exact:true}).waitFor({state:'hidden'})
  await page.getByRole('button',{name:'重做内容',exact:true}).click()
  await page.getByRole('textbox',{name:'分组名称',exact:true}).waitFor()
  await page.getByRole('button',{name:'解散组',exact:true}).click()
  await page.getByRole('textbox',{name:'分组名称',exact:true}).waitFor({state:'hidden'})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await page.screenshot({path:join(output,'tools-desktop.png'),animations:'disabled'})
  await page.setViewportSize({width:390,height:844})
  await delay(300)
  const toolbar=await page.getByRole('navigation',{name:'画布视图工具'}).boundingBox()
  const addButton=await page.getByRole('button',{name:'添加卡片',exact:true}).boundingBox()
  assert.ok(toolbar.y+toolbar.height<=addButton.y || addButton.y+addButton.height<=toolbar.y,'mobile addition and view tools do not overlap')
  await page.screenshot({path:join(output,'tools-mobile.png'),animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  console.log('PASS isolated view tools keep document and actual generation input unchanged')
} finally { await cleanup() }
