import { openModelInspection, closeCanvasDetails, connectCanvasCards } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const api = 'http://127.0.0.1:8480'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8480' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4480, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'先布线再采用'})})).json()).data
  const document = {...canvas.document,cards:[
    {id:'upstream',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[{id:'p',kind:'text',text:'明确运行上游'}]},config:{}},
    {id:'consumer',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}},
    {id:'image',type:'content.image',file_id:null},
    {id:'ref',type:'reference.character',title:'角色参考',angle:'正面',objects:[],input_bindings:[]},
    {id:'person',type:'content.object',object_id:null,name:'',category:'character',text:''},
    {id:'unknown',type:'model.text',model_id:null,prompt:{segments:[]},config:{}}
  ],edges:[],input_order:{}}
  assert.ok((await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})).ok)
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for(let i=0;i<90;i++){const value=await read();if(predicate(value))return value;await delay(100)}throw Error('saved state not reached') }
  const controls = async () => (await (await fetch(`${api}/test/runtime-controls`)).json())
  const open = async id => { await closeCanvasDetails(page);await page.getByRole('button',{name:'适应全部',exact:true}).click();await page.locator(`[data-card-id="${id}"]`).press('Enter');await page.locator('.wb-details:visible').waitFor();await openModelInspection(page);return page.locator('.wb-details:visible') }
  const connect = async (target,source,port) => {
    const editor=await open(target)
    if(target==='ref'){await connectCanvasCards(page,source,target,port);await open(target);return}
    const detail=editor
    await detail.getByRole('combobox',{name:'连接已有卡',exact:true}).press('ArrowDown')
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({hasText:new RegExp(`· ${source} → ${port}$`)}).click()
  }
  await page.goto(`http://127.0.0.1:4480/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="consumer"]').waitFor()
  await open('consumer')
  await page.locator('.wb-details:visible').getByRole('combobox',{name:'连接已有卡',exact:true}).press('ArrowDown')
  await page.keyboard.press('Escape')
  assert.equal((await read()).document.edges.length,0,'cancelled candidate choice creates nothing')
  await connect('consumer','upstream','文本')
  await poll(value=>value.document.edges.length===1)
  const details=page.locator('.wb-details:visible')
  await details.getByRole('region',{name:'候选输出状态',exact:true}).getByText('暂无可用输出',{exact:true}).waitFor()
  assert.equal(await details.getByRole('button',{name:'@文本1',exact:true}).count(),0,'unpublished future output is not selectable')
  assert.equal((await read()).document.cards.find(card=>card.id==='consumer').input_bindings?.length||0,0)
  assert.equal((await controls()).calls.length,0,'prewiring does not execute upstream')
  assert.deepEqual((await(await fetch(`${base}/${canvas.id}/cards/consumer/outputs`)).json()).data.candidates,[])
  const emptyPreview=(await(await fetch(`${base}/${canvas.id}/precheck`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_id:'consumer'})})).json()).data
  assert.doesNotMatch(emptyPreview.input.text,/明确运行上游/)
  await page.screenshot({path:join(output,'prewire-empty-desktop.png'),animations:'disabled'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('dialog',{name:'文本模型卡',exact:true}).waitFor()
  assert.equal(await page.locator('.wb-details:visible').count(),1)
  await page.screenshot({path:join(output,'prewire-empty-mobile.png'),animations:'disabled'})
  await page.setViewportSize({width:1440,height:960})
  await page.reload()
  await open('consumer')
  await details.getByRole('region',{name:'候选输出状态',exact:true}).getByText('暂无可用输出',{exact:true}).waitFor()
  await connect('ref','image','图片来源')
  await poll(value=>value.document.edges.length===2)
  await details.getByRole('combobox',{name:'关联图片',exact:true}).press('ArrowDown')
  await page.getByText('暂无已连线图片内容卡，可从当前画布选择',{exact:true}).waitFor()
  await page.keyboard.press('Escape')
  assert.equal((await read()).document.cards.find(card=>card.id==='ref').image_binding ?? null,null)
  assert.equal((await controls()).calls.length,0)
  await open('unknown')
  await details.getByRole('combobox',{name:'连接已有卡',exact:true}).press('ArrowDown')
  assert.equal(await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').count(),0,'unknown model capability is not guessed')
  await page.keyboard.press('Escape')
  await open('upstream')
  await details.getByRole('combobox',{name:'连接已有卡',exact:true}).press('ArrowDown')
  assert.equal(await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({hasText:/· consumer → 文本$/}).count(),0,'even unadopted candidate edges prevent a cycle')
  await page.keyboard.press('Escape')
  // Populate a directly connected image via the real upload UI; publication is not adoption.
  await open('image')
  await details.getByLabel('上传媒体文件',{exact:true}).setInputFiles({name:'reference.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64')})
  await poll(value=>!!value.document.cards.find(card=>card.id==='image').file_id)
  await open('ref')
  assert.equal((await read()).document.cards.find(card=>card.id==='ref').image_binding ?? null,null)
  await details.getByRole('combobox',{name:'关联图片',exact:true}).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click()
  await poll(value=>!!value.document.cards.find(card=>card.id==='ref').image_binding)
  const imageEdge=(await read()).document.edges.find(edge=>edge.source_card==='image')
  const disconnect=async()=>{
    await closeCanvasDetails(page)
    await page.getByRole('button',{name:'适应全部',exact:true}).click()
    await page.locator(`[data-generation-edge-id="${imageEdge.id}"]`).getByRole('button').press('Enter')
    await page.getByRole('button',{name:'删除此候选连接',exact:true}).click()
  }
  await disconnect()
  await page.getByRole('status').filter({hasText:/先取消|仍被|已被|采用|引用/}).waitFor()
  assert.equal((await read()).document.edges.length,2,'adopted source cannot silently disconnect')
  await open('ref');await details.getByRole('button',{name:'移除参考图',exact:true}).click()
  await poll(value=>!value.document.cards.find(card=>card.id==='ref').image_binding)
  await disconnect();await poll(value=>value.document.edges.length===1)
  // Explicitly execute upstream, then verify downstream stays unadopted until chosen.
  await fetch(`${api}/test/runtime-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({release:2})})
  const execute = async id => {
    await open(id)
    await details.getByRole('button',{name:'预检运行',exact:true}).click()
    const preview=page.getByRole('region',{name:'运行预检',exact:true});await preview.waitFor()
    await preview.getByRole('button',{name:'确认执行',exact:true}).click()
  }
  await execute('upstream')
  for(let i=0;i<80;i++){const snapshot=(await(await fetch(`${base}/${canvas.id}/runtime`)).json()).data;if(snapshot.current_outputs.upstream?.length)break;await delay(100);if(i===79)throw Error('upstream never published')}
  assert.equal((await controls()).calls.length,1,'upstream publication does not execute consumer')
  await open('consumer')
  await details.getByRole('button',{name:'@文本1',exact:true}).waitFor()
  await details.getByRole('region',{name:'候选输出状态',exact:true}).getByText('可用输出 1 项',{exact:true}).waitFor()
  assert.equal((await read()).document.cards.find(card=>card.id==='consumer').input_bindings?.length||0,0)
  const preview = (await(await fetch(`${base}/${canvas.id}/precheck`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_id:'consumer'})})).json()).data
  assert.doesNotMatch(preview.input.text,/第一段/)
  await page.screenshot({path:join(output,'prewire-published-unadopted.png'),animations:'disabled'})
  await details.getByRole('button',{name:'@文本1',exact:true}).click()
  await poll(value=>value.document.cards.find(card=>card.id==='consumer').input_bindings?.length===1)
  await execute('consumer')
  for(let i=0;i<80 && (await controls()).calls.length<2;i++)await delay(100)
  assert.equal((await controls()).calls.length,2)
  assert.match((await controls()).calls[1].text,/第一段第二段第三段/)
  await page.screenshot({path:join(output,'prewire-adopted-desktop.png'),animations:'disabled'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('dialog',{name:'文本模型卡',exact:true}).waitFor()
  assert.equal(await page.locator('.wb-details:visible').count(),1)
  await page.screenshot({path:join(output,'prewire-mobile.png'),animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  console.log('prewire, publish, explicit adoption and controlled request verified')
} finally { await cleanup() }
