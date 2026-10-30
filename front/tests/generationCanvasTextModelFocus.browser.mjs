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
const root = fileURLToPath(new URL('..', import.meta.url)), output = await browserOutput('jellyfish-c58-text-model-')
const api = 'http://127.0.0.1:8558', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8558' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, body, method = 'POST') => {
  const response = await fetch(url, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  assert.ok(response.ok, await response.clone().text()); return response.json()
}
try {
  for (let i=0;i<80;i++) { try { if ((await fetch(base)).ok) break } catch {} await delay(250) }
  server = await createServer({ root, cacheDir: join(output,'vite-cache'), server: { host: '127.0.0.1', port: 4558, strictPort: true, proxy: { '/api': api } } }); await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context=await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage(); page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await request(base, { name: 'C文本模型逐类验收' })).data
  const binding = id => ({ id:`b-${id}`, input_port:'text',source:{canvas_id:canvas.id,card_id:'source',port_id:'text',position:0} })
  const model = (id, prompt='', adopt=false, selected=true) => ({id,type:'model.text',model_id:selected?'canvas-runtime-text':null,prompt:{segments:prompt?[{id:'p',kind:'text',text:prompt}]:[]},config:{},input_bindings:adopt?[binding(id)]:[]})
  const document = {...canvas.document,cards:[{id:'source',type:'content.text',text:'清晨，人物走过安静的街道。'},model('m','保持自然步态、柔和侧光与人物身份。',true),model('empty'),model('adopted','',true),model('unselected','尚未选择模型的独立状态',false,false)],edges:['m','adopted'].map(id=>({id:`edge-${id}`,source_card:'source',source_port:'text',target_card:id,target_port:'text'})),input_order:{m:{text:['edge-m']},adopted:{text:['edge-adopted']}}}
  await request(`${base}/${canvas.id}`,{request_id:'seed',expected_revision:0,document},'PUT')
  await page.goto(`http://127.0.0.1:4558/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const editor=page.locator('.wb-details:not([hidden])'), material=editor.getByLabel('管理候选与采用',{exact:true})
  const close=async()=>{if(await editor.isVisible()){if(await editor.getAttribute('data-expanded')==='true'&&await editor.getByRole('button',{name:'收起详情',exact:true}).count())await editor.getByRole('button',{name:'收起详情',exact:true}).click();await editor.getByRole('button',{name:'关闭详情',exact:true}).click()}}
  const open=async id=>{await close(); await page.locator(`[data-card-id="${id}"]`).press('Enter'); await editor.waitFor();await editor.getByRole('textbox',{name:'模型正文',exact:true}).waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
  await open('m')
  assert.equal(await editor.getByText('＠ 引用与指令',{exact:true}).isVisible(),false,'reference controls are on demand, not a permanent prompt row')
  assert.equal(await editor.getByText('运行状态与正式输出',{exact:true}).isVisible(),false,'output history does not occupy the default prompt')
  assert.equal(await editor.getByRole('button',{name:'添加模型来源',exact:true}).isVisible(),false,'one material entry replaces the separate square add button')
  await material.click()
  await editor.getByRole('button',{name:'添加模型来源',exact:true}).waitFor()
  const refs=editor.locator('summary').filter({hasText:'＠ 引用与指令'})
  await refs.click(); await editor.getByRole('combobox',{name:'引用分类',exact:true}).waitFor()
  await material.press('Escape'); assert.equal(await editor.isVisible(),true)
  assert.equal(await material.evaluate(e=>e===document.activeElement),true)
  await request(`${api}/test/runtime-controls`,{release:2})
  await editor.getByRole('button',{name:'预检运行',exact:true}).click()
  const preview=page.getByRole('dialog',{name:'运行预检',exact:true})
  await preview.getByRole('button',{name:'确认执行',exact:true}).click()
  for(let i=0;i<100;i++){const data=(await request(`${base}/${canvas.id}/runtime`)).data;if(data.current_outputs.m?.length)break;await delay(100)}
  await page.locator('[data-card-id="m"]').getByText('第一段第二段第三段',{exact:true}).waitFor()
  const manifest=[]
  for(const [width,height] of [[1440,960],[390,844],[3830,1688]]){
    await page.setViewportSize({width,height});await delay(200)
    for(const [id,f,state] of [['m','F07','default'],['m','F08','expanded'],['empty','F09','empty']]){
      await open(id)
      if(state==='expanded'&&await editor.getAttribute('data-expanded')!=='true')await editor.getByRole('button',{name:'展开详情',exact:true}).click()
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      await delay(100)
      const prefix=`${f}-text-model-${width}-${state}`
      await page.screenshot({path:join(output,`${prefix}-page.png`),fullPage:true})
      await page.waitForFunction(()=>document.querySelector('.wb-details:not([hidden])')?.getBoundingClientRect().height>200)
      await page.screenshot({path:join(output,`${prefix}-editor.png`),clip:await editor.boundingBox()})
      if(width>700)await page.locator(`[data-card-id="${id}"]`).screenshot({path:join(output,`${prefix}-card.png`)})
      manifest.push({f,width,height,state,prefix})
      assert.ok(await editor.getByRole('button',{name:'预检运行',exact:true}).evaluate(e=>{const b=e.getBoundingClientRect();return b.width>=32&&b.right<=innerWidth&&b.bottom<=innerHeight}))
      if(id==='empty'){assert.equal(await editor.getByRole('button',{name:'预检运行',exact:true}).isDisabled(),true);await editor.getByText('创作描述',{exact:true}).waitFor()}
    }
  }
  await page.setViewportSize({width:1440,height:960})
  for(const id of ['adopted','unselected']){await open(id);await editor.screenshot({path:join(output,`${id}-distinct-editor.png`)})}
  await open('m')
  await editor.getByRole('region',{name:'本次创作依据',exact:true}).getByText('查看来源',{exact:true}).click()
  await editor.getByRole('region',{name:'本次创作依据',exact:true}).getByText('清晨，人物走过安静的街道。',{exact:true}).last().waitFor()
  await material.click();await refs.click();await editor.getByRole('button',{name:'@文本1',exact:true}).click()
  await material.press('Escape')
  const body=editor.getByRole('textbox',{name:'模型正文',exact:true})
  await body.press('ControlOrMeta+End');await body.press('ArrowRight');await body.pressSequentially('编辑后保留中文正文与来源。')
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  const saved=(await request(`${base}/${canvas.id}`)).data
  assert.equal(saved.document.cards.find(c=>c.id==='m').input_bindings.length,1)
  const run=(await request(`${base}/${canvas.id}/runtime`)).data
  assert.ok(run.runs.every(r=>r.nodes.every(n=>n.card_id==='m')),'only current model runs')
  await page.reload(); await open('m'); assert.match(await body.textContent(),/编辑后保留中文正文与来源。/)
  const observer=await context.newPage()
  await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  await observer.locator('[data-card-id="m"]').press('Enter')
  const readonly=observer.locator('.wb-details:not([hidden])')
  await readonly.getByRole('textbox',{name:'模型正文',exact:true}).waitFor()
  assert.equal(await readonly.getByRole('textbox',{name:'模型正文',exact:true}).getAttribute('contenteditable'),'false')
  assert.equal(await readonly.getByRole('button',{name:'预检运行',exact:true}).isDisabled(),true)
  await observer.screenshot({path:join(output,'text-model-readonly.png'),fullPage:true});await observer.close()
  await editor.getByRole('region',{name:'本次创作依据',exact:true}).getByRole('button',{name:/取消采用/}).click()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  assert.equal((await request(`${base}/${canvas.id}`)).data.document.cards.find(c=>c.id==='m').input_bindings.length,0)
  const basisBefore=await editor.getByRole('region',{name:'本次创作依据',exact:true}).boundingBox()
  await body.fill('长正文阅读。\n'.repeat(80));await body.press('ControlOrMeta+End')
  assert.ok(await body.evaluate(e=>e.scrollHeight>e.clientHeight),'long creation text scrolls inside its own editor')
  const basisAfter=await editor.getByRole('region',{name:'本次创作依据',exact:true}).boundingBox()
  assert.equal(basisAfter.y,basisBefore.y,'scrolling creation text does not move the independent basis')
  await page.screenshot({path:join(output,'text-model-long-independent-scroll.png'),fullPage:true})
  await close();await page.getByRole('button',{name:'运行历史',exact:true}).click();await page.getByRole('region',{name:'画布运行历史',exact:true}).waitFor()
  assert.equal((await request(`${api}/test/runtime-controls`)).calls.length,1,'viewing and editing never auto-runs')
  writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2));console.log('PASS C58 public page+HTTP, actual text Worker and F07–F09 threeviewports',output)
} catch(error){if(page)await page.screenshot({path:join(output,'failure.png'),fullPage:true});throw error} finally {await cleanup()}
