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
const api = 'http://127.0.0.1:8421'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8421' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4421, strictPort: true, open: false, proxy: { '/api': api } } })
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
  await page.goto(`http://127.0.0.1:4421/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.getByRole('navigation',{name:'生成画布位置',exact:true}).getByRole('button',{name:'总览',exact:true}).waitFor()
  if(await page.getByRole('button',{name:'关闭详情',exact:true}).isVisible())await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  const world=()=>page.locator('.generation-world').getAttribute('style')
  const originalView=await world()
  const select=page.getByRole('combobox',{name:'卡片分类',exact:true})
  await select.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('模型生成',{exact:true}).click()
  await page.locator('[data-card-id="source"]').waitFor({state:'hidden'})
  await page.locator('[data-card-id="model"]').waitFor({state:'visible'})
  await page.getByRole('button',{name:'收起筛选',exact:true}).click()
  await page.getByLabel('筛选已生效',{exact:true}).waitFor()
  assert.equal(await world(),originalView)
  assert.deepEqual((await read()).document,before.document)
  assert.equal((await read()).revision,before.revision)
  const afterPreview=await precheck()
  assert.deepEqual(afterPreview.input,initialPreview.input)
  await page.locator('[data-card-id="model"]').press('Enter')
  await page.getByRole('complementary').filter({has:page.getByText('被隐藏但明确采用的内容',{exact:false})}).waitFor()
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.screenshot({path:join(output,'filters-desktop.png'),animations:'disabled'})
  await page.getByRole('button',{name:'展开筛选',exact:true}).click()
  await select.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('全部分类',{exact:true}).click()
  await page.locator('[data-card-id="source"]').waitFor({state:'visible'})
  await page.getByRole('switch',{name:'仅显示问题卡片',exact:true}).click()
  await page.locator('[data-card-id="source"]').waitFor({state:'hidden'})
  await page.getByRole('switch',{name:'仅显示问题卡片',exact:true}).click()
  const modality=page.getByRole('combobox',{name:'卡片模态',exact:true})
  await modality.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('图片',{exact:true}).click()
  assert.equal(await page.locator('[data-card-id]').count(),0)
  await modality.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('全部模态',{exact:true}).click()
  await page.locator('[data-card-id="source"]').waitFor({state:'visible'})
  await page.getByRole('button',{name:'收起筛选',exact:true}).click()
  await page.reload()
  await page.getByRole('button',{name:'展开筛选',exact:true}).waitFor()
  if(await page.getByRole('button',{name:'关闭详情',exact:true}).isVisible())await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'展开筛选',exact:true}).click()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  const filterBox=await page.getByRole('complementary',{name:'画布筛选',exact:true}).boundingBox()
  assert.ok(filterBox.x+filterBox.width<=390,'filter controls remain within narrow viewport')
  await page.screenshot({path:join(output,'filters-mobile.png'),animations:'disabled'})
  console.log('filters preserve bindings, revision, viewport and real precheck inputs; collapse preference and responsive layout verified')
} finally { await cleanup() }
