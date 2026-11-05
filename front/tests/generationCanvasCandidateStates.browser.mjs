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
const output = await browserOutput('jellyfish-generation-canvas-candidate-states-')
const api = 'http://127.0.0.1:8693', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8693' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4693, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'候选采用状态'})})).json()).data
  const source=(card_id,port_id,object_id)=>({canvas_id:canvas.id,card_id,port_id,position:0,...(object_id?{object_id}:{})})
  const document={...canvas.document,cards:[
    {id:'person',type:'content.character',object_id:'person-id',name:'张三',text:'窗边人物'},
    {id:'dialogue',type:'direction.dialogue',dialogue_id:'dialogue-id',content:{state:'fact',text:'人物台词',document:{segments:[{id:'ref',kind:'reference',source:source('person','text')}] }},input_bindings:[{id:'speaker',input_port:'speaker',source:source('person','object','person-id')}]},
    {id:'empty',type:'direction.style'},
    {id:'movement',type:'direction.focus',fields:{depth_focus:{state:'fact',text:'清晰主体'}},input_bindings:[{id:'focus',input_port:'focus_object',source:source('person','object','person-id')},{id:'attention',input_port:'attention_object',source:source('person','object','person-id')}]},
    {id:'inactive',type:'direction.style',fields:{notes:{state:'not_applicable',document:{segments:[{id:'inactive-ref',kind:'reference',source:source('person','text')}]}}}},
  ],edges:[{id:'speaker',source_card:'person',source_port:'object',target_card:'dialogue',target_port:'speaker'},{id:'text',source_card:'person',source_port:'text',target_card:'dialogue',target_port:'text'}],input_order:{dialogue:{speaker:['speaker'],text:['text']}}}
  for(const port of ['focus_object','attention_object']) document.edges.push({id:port,source_card:'person',source_port:'object',target_card:'movement',target_port:port})
  document.edges.push({id:'inactive-text',source_card:'person',source_port:'text',target_card:'inactive',target_port:'text'})
  for(const edge of document.edges){document.input_order[edge.target_card] ||= {};document.input_order[edge.target_card][edge.target_port] ||= [edge.id]}
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})});assert.ok(seeded.ok,await seeded.text())
  const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  await page.goto(`http://127.0.0.1:4693/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:visible')
  await page.locator('[data-card-id="dialogue"]').getByRole('button',{name:/设计/}).press('Enter')
  await detail.getByRole('button',{name:/候选 张三 · 已用作说话对象/}).waitFor()
  await detail.getByRole('button',{name:/候选 张三 · 已引用于对白正文/}).waitFor()
  const before=await read()
  await detail.getByRole('button',{name:/候选 张三 · 已用作说话对象/}).click()
  await page.locator('.ant-popover:visible').getByText(/已用作说话对象/).waitFor()
  await page.keyboard.press('Escape')
  assert.equal((await read()).revision,before.revision)
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.locator('[data-card-id="empty"]').getByRole('button',{name:/设计/}).press('Enter')
  await detail.getByText('0 个候选 · 0 个使用中',{exact:true}).waitFor()
  assert.equal(await detail.getByText('暂无候选来源，请先连接来源或添加素材。',{exact:true}).count(),0)
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.locator('[data-card-id="movement"]').getByRole('button',{name:/设计/}).press('Enter')
  await detail.getByRole('button',{name:/候选 张三 · 已用作焦点对象；已用作关注对象/}).waitFor()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('button',{name:'取消关注对象 张三',exact:true}).click()
  await detail.getByRole('button',{name:/候选 张三 · 已用作焦点对象$/}).waitFor()
  await detail.screenshot({path:join(output,'candidate-roles-desktop.png'),animations:'disabled'})
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await detail.screenshot({path:join(output,'candidate-roles-mobile.png'),animations:'disabled'})
  await page.setViewportSize({width:1440,height:960})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.locator('[data-card-id="inactive"]').getByRole('button',{name:/设计/}).press('Enter')
  await detail.getByRole('button',{name:/已引用于自定义说明 · 未生效/}).waitFor()
  await detail.getByText('1 个候选 · 0 个使用中',{exact:true}).waitFor()
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  const observer=await context.newPage();await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}});await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  await observer.locator('[data-card-id="dialogue"]').getByRole('button',{name:/设计/}).press('Enter')
  const readonly=observer.locator('.wb-details:visible')
  await readonly.getByRole('button',{name:/候选 张三 · 已用作说话对象/}).click()
  await observer.locator('.ant-popover:visible').getByText(/已用作说话对象/).waitFor()
  const observerState=await read();await delay(200);assert.equal((await read()).revision,observerState.revision)
  await observer.close()
  await page.route('**/cards/dialogue/outputs',async route=>{await delay(1200);await route.continue()})
  await page.reload()
  await page.locator('[data-card-id="dialogue"]').getByRole('button',{name:/设计/}).press('Enter')
  await detail.getByText('正在读取候选来源…',{exact:true}).waitFor()
  await detail.getByRole('button',{name:/候选 张三 · 已用作说话对象/}).waitFor()
  await page.unroute('**/cards/dialogue/outputs')
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.route('**/cards/dialogue/outputs',route=>route.fulfill({status:503,contentType:'application/json',body:'{}'}))
  await page.reload()
  await page.locator('[data-card-id="dialogue"]').getByRole('button',{name:/设计/}).press('Enter')
  await detail.getByText('候选来源读取失败，请保存或重开后重试。',{exact:true}).waitFor()
  console.log('Candidate role, field, empty, loading, failure and preview-only states passed:',output)
} finally { await cleanup() }
