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
const output = await browserOutput('jellyfish-generation-canvas-design-relations-')
const api = 'http://127.0.0.1:8670', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8670' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4670, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const source = (card_id,port_id,object_id) => ({canvas_id:canvas.id,card_id,port_id,position:0,...(object_id?{object_id}:{})})
  const document={...canvas.document,cards:[
    {id:'person',type:'content.character',object_id:'person-id',name:'张三',text:'人物描述'},
    {id:'shot',type:'direction.shot',shot_id:'shot-id',name:'反应镜头'},
    {id:'criterion',type:'direction.criterion',criterion_id:'criterion-id',name:'手部可见'},
    {id:'brief',type:'content.text',text:'站在窗边'},
    {id:'movement',type:'direction.movement',phases:[{id:'end',name:'落幅',frame:{state:'proposal',document:{segments:[{id:'ref',kind:'reference',source:source('brief','text')}]}}}]},
    {id:'composition',type:'direction.composition',fields:{composition:{state:'proposal',text:'左侧构图'}}}],edges:[],input_order:{}}
  for(const target of ['composition','movement']) {
    document.input_order[target]={}
    for(const [card,port,target_port] of [['person','object','effect_object'],['shot','shot','shot'],['criterion','criterion','acceptance_basis'],...(target==='movement'?[['person','object','attention_object'],['brief','text','text']]:[])]) {
      const id=target+'-'+target_port
      document.edges.push({id,source_card:card,source_port:port,target_card:target,target_port})
      document.input_order[target][target_port]=[id]
    }
  }
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})});assert.ok(seed.ok,await seed.text())
  const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('design relation save did not arrive')}
  await page.goto(`http://127.0.0.1:4670/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:visible')
  for(const kind of ['composition','movement']) {
    await page.locator(`[data-card-id="${kind}"]`).getByRole('button',{name:/设计/}).click()
    await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    await detail.getByRole('button',{name:'选择作用对象 张三',exact:true}).click()
    await poll(state=>state.document.cards.find(c=>c.id===kind).input_bindings?.some(b=>b.input_port==='effect_object'))
    await detail.getByRole('button',{name:'选择所属镜头 反应镜头',exact:true}).click()
    await poll(state=>state.document.cards.find(c=>c.id===kind).input_bindings?.some(b=>b.input_port==='shot'))
    await detail.getByRole('button',{name:'关联验收要求 手部可见',exact:true}).click()
    await detail.getByRole('region',{name:'关联的验收要求',exact:true}).getByText('手部可见',{exact:true}).waitFor()
    await poll(state=>state.document.cards.find(c=>c.id===kind).input_bindings?.some(b=>b.input_port==='acceptance_basis'))
    if(kind==='composition') {
      await detail.getByRole('textbox',{name:'设计适用范围',exact:true}).fill('窗边画面')
      await detail.getByRole('textbox',{name:'设计来源',exact:true}).fill('导演说明')
      await poll(state=>state.document.cards.find(c=>c.id===kind).source_locator==='导演说明')
      await detail.getByRole('combobox',{name:'关联运镜卡',exact:true}).locator('xpath=../..').click()
      await page.getByTitle('运镜卡 · movement',{exact:true}).click()
      await detail.getByRole('combobox',{name:'构图目标阶段',exact:true}).locator('xpath=../..').click()
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option[title="落幅"]').click()
      await poll(state=>state.document.cards.find(c=>c.id===kind).frame_target?.state_id==='phase:end')
    } else {
      await detail.getByRole('button',{name:'选择关注对象 张三',exact:true}).click()
      await poll(state=>state.document.cards.find(c=>c.id===kind).input_bindings?.some(b=>b.input_port==='attention_object'))
    }
    const payload=(await (await fetch(`${base}/${canvas.id}/cards/${kind}/outputs`)).json()).data.outputs[0].payload
    assert.equal(payload.objects[0].name,'张三');assert.equal(payload.references[0].name,'反应镜头');assert.equal(payload.acceptance_basis[0].name,'手部可见')
    await detail.screenshot({path:join(output,kind+'-relations-desktop.png'),animations:'disabled'})
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await detail.screenshot({path:join(output,kind+'-relations-mobile.png'),animations:'disabled'})
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click();await page.setViewportSize({width:1440,height:960})
  }
  await page.reload();await page.locator('[data-card-id="composition"]').getByRole('button',{name:/设计/}).press('Enter');await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  assert.equal(await detail.getByRole('textbox',{name:'设计来源',exact:true}).inputValue(),'导演说明')
  await detail.getByRole('button',{name:'取消作用对象 张三',exact:true}).waitFor()
  const observer=await context.newPage();await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}});await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  await observer.locator('[data-card-id="composition"]').getByRole('button',{name:/设计/}).press('Enter');const readonly=observer.locator('.wb-details:visible');await readonly.getByRole('button',{name:'高级设置',exact:true}).click()
  assert.equal(await readonly.getByRole('button',{name:'取消作用对象 张三',exact:true}).isDisabled(),true)
  assert.equal(await readonly.getByRole('textbox',{name:'设计来源',exact:true}).isDisabled(),true)
  await observer.close()
  console.log('Retained design relationships, scope/source and reference-only target picker passed:',output)
} finally { await cleanup() }
