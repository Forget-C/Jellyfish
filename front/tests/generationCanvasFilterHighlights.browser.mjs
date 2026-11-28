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
const api = 'http://127.0.0.1:8462'
const base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8462' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4462, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { localStorage.setItem('jellyfish_canvas_appearance', 'dark');  window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas=(await(await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'筛选高亮与组织'})})).json()).data
  const source={canvas_id:canvas.id,card_id:'source',port_id:'text',position:0}
  const document={...canvas.document,cards:[
    {id:'source',type:'content.text',text:'独立采用内容'},
    {id:'image',type:'content.image',file_id:null},
    {id:'model',type:'model.text',model_id:'canvas-runtime-text',input_bindings:[{id:'source',input_port:'text',source}],prompt:{segments:[{id:'reference',kind:'reference',binding_id:'source'}]},config:{}},
    {id:'stacktext',type:'content.text',text:'堆叠内说明'},
    {id:'audio',type:'content.audio',file_id:null},
  ],
    edges:[{id:'candidate',source_card:'source',source_port:'text',target_card:'model',target_port:'text'}],input_order:{model:{text:['candidate']}}}
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seeded.ok,await seeded.text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  await page.goto(`http://127.0.0.1:4462/canvases/${canvas.id}`)
  const card=id=>page.locator(`[data-card-id="${id}"]`)
  await card('source').waitFor()
  const modifier=await page.evaluate(()=>navigator.platform.includes('Mac')?'Meta':'Control')
  for(const id of ['source','image']) await card(id).click({modifiers:[modifier]})
  await page.getByRole('toolbar',{name:'所选卡片操作',exact:true}).getByRole('button',{name:'编组',exact:true}).click()
  for(const id of ['model','stacktext']) await card(id).click({modifiers:[modifier]})
  await page.getByRole('toolbar',{name:'所选卡片操作',exact:true}).getByRole('button',{name:'堆叠',exact:true}).click()
  const stack=page.locator('[data-stack-id]')
  await stack.waitFor()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const before=await read()
  const filter=async(name,label)=>{
    const input=page.getByRole('combobox',{name,exact:true})
    await input.press('ArrowDown')
    const popup=await input.getAttribute('aria-controls')
    const dropdown=page.locator('.ant-select-dropdown').filter({has:page.locator(`[id="${popup}"]`)})
    await dropdown.waitFor({state:'visible'})
    await dropdown.locator('.ant-select-item-option').filter({hasText:new RegExp(`^${label}$`)}).click()
    await dropdown.waitFor({state:'hidden'})
    await page.waitForFunction(([id,label])=>document.getElementById(id)?.closest('.ant-select')?.querySelector('.ant-select-content-value')?.textContent===label,[await input.getAttribute('id'),label])
  }
  const world=()=>page.locator('.generation-world').getAttribute('style')
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  const view=await world(), positions=await page.locator('[data-card-id], [data-group-id], [data-stack-id]').evaluateAll(items=>items.map(item=>item.getAttribute('style')))
  await card('source').press('Enter')
  const editor=page.locator('.wb-details:visible')
  await editor.waitFor()
  const viewWithEditor=await world()
  await filter('卡片分类','模型生成')
  assert.equal(await card('source').getAttribute('data-selected'),'true')
  assert.equal(await editor.count(),1,'filter does not close editor')
  assert.equal(await card('source').getAttribute('data-filter-match'),'false')
  assert.equal(await stack.getAttribute('data-filter-match'),'true')
  await stack.getByText('匹配 1／2',{exact:true}).waitFor()
  assert.equal(await page.locator('[data-card-id]').count(),3,'all nonstack cards retained')
  assert.equal(await page.locator('[data-edge-active]').count(),1,'external candidate retained')
  assert.equal(await world(),viewWithEditor)
  await editor.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  const stackBox=await stack.boundingBox()
  await stack.click({position:{x:stackBox.width-30,y:stackBox.height-30}})
  const reading=page.getByRole('dialog',{name:'堆叠内容（只读）',exact:true})
  await reading.waitFor()
  assert.equal(await reading.getByRole('article').count(),2,'readonly view keeps every member')
  assert.equal(await reading.getByRole('article',{name:/只读成员 文本模型卡 · model/}).getAttribute('data-filter-match'),'true')
  assert.equal(await reading.getByRole('article',{name:/只读成员 文本内容卡 · stacktex/}).getAttribute('data-filter-match'),'false')
  await page.waitForFunction(()=>{const dialog=[...document.querySelectorAll('[role="dialog"]')].find(item=>item.textContent.includes('堆叠内容')&&item.getClientRects().length);return dialog && getComputedStyle(dialog.closest('.ant-modal')).opacity==='1'})
  await page.screenshot({path:join(output,'filter-stack-reading.png'),animations:'disabled'})
  await page.keyboard.press('Escape')
  await reading.waitFor({state:'hidden'})
  await filter('卡片分类','全部分类')
  await filter('卡片模态','图片')
  assert.equal(await card('image').getAttribute('data-filter-match'),'true')
  assert.equal(await card('image').locator('.generation-card-body').evaluate(node=>getComputedStyle(node).borderTopColor),'rgb(133, 129, 255)')
  assert.equal(await stack.getAttribute('data-filter-match'),'false')
  await stack.getByText('匹配 0／2',{exact:true}).waitFor()
  assert.equal(await page.locator('[data-card-id]').count(),3)
  assert.equal(await page.locator('[data-group-id]').count(),1)
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  assert.equal(await world(),view,'fit includes unmatched content and original stack bounds')
  assert.deepEqual(await page.locator('[data-card-id], [data-group-id], [data-stack-id]').evaluateAll(items=>items.map(item=>item.getAttribute('style'))),positions)
  await page.keyboard.press('Escape')
  for(const id of ['source','image']) await card(id).click({modifiers:[modifier]})
  const menu=page.getByRole('toolbar',{name:'所选卡片操作',exact:true})
  await menu.waitFor()
  await filter('卡片模态','全部模态')
  assert.equal(await page.locator('[data-card-id][data-selected="true"]').count(),2,'clearing filter keeps multiselection')
  assert.equal(await page.locator('[data-card-id][data-filter-match="true"]').count(),0)
  await page.getByRole('switch',{name:'高亮问题卡片',exact:true}).click()
  assert.equal(await page.locator('[data-card-id][data-filter-match="true"]').count(),0,'no invented semantic problems')
  assert.equal(await page.locator('[data-card-id]').count(),3)
  await page.getByRole('switch',{name:'高亮问题卡片',exact:true}).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await page.getByRole('combobox',{name:'选择连线',exact:true}).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click()
  await page.getByRole('button',{name:'布局',exact:true}).click()
  await filter('卡片分类','基础内容')
  assert.equal(await page.locator('.generation-edge-inspector').count(),1,'filter preserves selected wire')
  assert.equal(await page.locator('[data-edge-active="true"]').count(),1)
  await page.screenshot({path:join(output,'filter-groups-desktop.png'),animations:'disabled'})
  assert.deepEqual((await read()).document,before.document)
  assert.equal((await read()).revision,before.revision)
  await page.getByRole('button',{name:'收起筛选',exact:true}).click()
  await page.getByLabel('筛选已生效',{exact:true}).waitFor()
  await page.reload()
  await page.getByRole('button',{name:'展开筛选',exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'展开筛选',exact:true}).click()
  await filter('卡片模态','图片')
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  assert.equal(await page.locator('[data-card-id]').count(),3)
  assert.equal(await page.locator('[data-edge-active]').count(),1)
  assert.equal(await card('image').getAttribute('data-filter-match'),'true')
  await page.screenshot({path:join(output,'filter-groups-mobile.png'),animations:'disabled'})
  await filter('卡片模态','全部模态')
  await filter('卡片分类','模型生成')
  const mobileStack=await stack.boundingBox()
  await stack.click({position:{x:mobileStack.width-10,y:mobileStack.height-10}})
  await reading.waitFor()
  await page.waitForFunction(()=>{const dialog=[...document.querySelectorAll('[role="dialog"]')].find(item=>item.textContent.includes('堆叠内容')&&item.getClientRects().length);return dialog && getComputedStyle(dialog.closest('.ant-modal')).opacity==='1'})
  await page.screenshot({path:join(output,'filter-stack-mobile.png'),animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.deepEqual((await read()).document,before.document)
  console.log('PASS filter matches only highlight; groups, stack members, editor, selection, edges, fit and saved input remain unchanged')
} finally { await cleanup() }
