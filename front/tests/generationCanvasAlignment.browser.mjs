import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { writeFile } from 'node:fs/promises'
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
const api = 'http://127.0.0.1:8426'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8426' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4426, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'筛选保持采用'})})
  const canvas=(await response.json()).data
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'被隐藏但明确采用的内容'},
    {id:'model',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}},{id:'dense',type:'direction.performance',input_bindings:[],examples:[],scope:{}},{id:'other',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}}],
    edges:[],input_order:{}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.clone().text())
  await page.goto(`http://127.0.0.1:4426/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="source"]').waitFor()
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('button',{name:'展开小地图',exact:true}).click()
  await page.keyboard.press('Escape')
  const snapshot = async name => {
    await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
    await page.screenshot({path:join(output,`${name}.png`),animations:'disabled'})
    const geometry=await page.evaluate(()=>({page:[document.documentElement.scrollWidth,innerWidth],toolbar:document.querySelector('.generation-workbench-header').getBoundingClientRect().toJSON(), regions:[...document.querySelectorAll('.generation-browse,.generation-card-list-host,.generation-view-tools,.generation-bottom-right,.generation-minimap')].map(n=>({name:n.getAttribute('class'),box:n.getBoundingClientRect().toJSON(),background:getComputedStyle(n).backgroundColor})),cards:[...document.querySelectorAll('[data-card-id]')].map(n=>({id:n.dataset.cardId,box:n.getBoundingClientRect().toJSON()}))}))
    const browse=geometry.regions.find(region=>region.name.includes('generation-browse'))
    const map=geometry.regions.find(region=>region.name.includes('generation-minimap'))
    assert.equal(Math.round(map.box.width),200,'minimap uses workbench 200px width')
    assert.equal(Math.round(browse.box.top-geometry.toolbar.bottom),12,'breadcrumb uses workbench 12px toolbar clearance')
    assert.ok(geometry.page[0]<=geometry.page[1],`${name} has no horizontal page overflow`)
    await writeFile(join(output,`${name}.json`),JSON.stringify(geometry,null,2))
  }
  for(const [name,width,height] of [['desktop',1440,960],['mobile',390,844],['wide',3830,1688]]){
    await page.setViewportSize({width,height})
    await snapshot(`generation-${name}`)
    const transform=await page.locator('.generation-world').getAttribute('style')
    await page.getByRole('button',{name:'添加卡片',exact:true}).click()
    await snapshot(`generation-list-${name}`)
    await page.getByRole('button',{name:'关闭卡片列表',exact:true}).click()
    await page.getByRole('button',{name:'画布管理',exact:true}).click()
    await snapshot(`generation-menu-${name}`)
    await page.keyboard.press('Escape')
    await page.locator('[data-card-id="source"]').press('Enter')
    const details=page.locator('.wb-details:visible')
    await details.waitFor()
    if(await details.getByRole('button',{name:'收起详情',exact:true}).isVisible())await details.getByRole('button',{name:'收起详情',exact:true}).click()
    await snapshot(`generation-details-${name}`)
    const field=details.getByRole('textbox',{name:'文本内容',exact:true})
    await field.fill(`连续编辑-${name}`)
    await details.getByRole('button',{name:'展开详情',exact:true}).click()
    await snapshot(`generation-expanded-${name}`)
    assert.equal(await field.inputValue(),`连续编辑-${name}`)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.generation-world').getAttribute('style'),transform)
    assert.equal(await page.locator('[data-card-id="source"]').evaluate(n=>n.contains(document.activeElement)),true)
  }
  const beforeMapClose=await page.locator('.generation-world').getAttribute('style')
  await page.getByRole('button',{name:'关闭小地图',exact:true}).click()
  await page.getByRole('img',{name:'小地图导航',exact:true}).waitFor({state:'hidden'})
  assert.equal(await page.locator('.generation-world').getAttribute('style'),beforeMapClose)
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('button',{name:'展开小地图',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.setViewportSize({width:1440,height:960})
  await fetch(`${api}/test/runtime-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fail_next:true,release:0})})
  await page.locator('[data-card-id="model"]').press('Enter')
  const details=page.locator('.wb-details:visible')
  await details.getByRole('textbox',{name:'模型正文',exact:true}).fill('视觉验收运行与失败状态')
  await details.getByRole('button',{name:'预检运行',exact:true}).click()
  await snapshot('generation-precheck-desktop')
  await page.getByRole('button',{name:'确认执行',exact:true}).click()
  const waitStatus=async status=>{for(let i=0;i<80;i++){const runtime=(await(await fetch(`${base}/${canvas.id}/runtime`)).json()).data;if(runtime.runs.some(run=>run.nodes.some(node=>node.card_id==='model'&&node.status===status)))return;await delay(100)}throw Error(`runtime never reached ${status}`)}
  await waitStatus('running')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'任务中心',exact:true}).click()
  await snapshot('generation-task-desktop')
  await page.keyboard.press('Escape')
  for(const [name,width,height] of [['desktop',1440,960],['mobile',390,844],['wide',3830,1688]]){await page.setViewportSize({width,height});await snapshot(`generation-running-${name}`)}
  await fetch(`${api}/test/runtime-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({release:2})})
  await waitStatus('failed')
  await page.locator('[data-card-id="model"] [aria-label="模型状态摘要"]').getByText(/失败/).waitFor()
  await details.getByText('失败 · 未完成',{exact:false}).waitFor()
  for(const [name,width,height] of [['desktop',1440,960],['mobile',390,844],['wide',3830,1688]]){await page.setViewportSize({width,height});await snapshot(`generation-failed-${name}`)}
} finally { await cleanup() }
