import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8599', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8599' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4599, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context=await browser.newContext({viewport:{width:1440,height:960}})
  page=await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = await createStoryboardCanvas(base, '多图与未完成成果')
  const texts=Array.from({length:5},(_,index)=>({id:`text-${index}`,type:'content.text',text:'已明确采用的创作依据'+index+'，保持自然光与人物动作关系。'.repeat(4)}))
  texts[0]={...texts[0],type:'content.character',object_id:'long-object',name:'清晨街道中人物与窗边光线的关系'.repeat(6)}
  const identity='11111111-1111-4111-8111-111111111111'
  const sources=[...texts,{id:'performance',type:'direction.performance',physical_action:{state:'proposal',text:'抬头望向街灯',purpose:'design'},input_bindings:[{id:'actor',input_port:'participant',source:{canvas_id:canvas.id,card_id:'person',port_id:'object',position:0,object_id:identity}}]}]
  const edges=sources.map(source=>({id:'edge-'+source.id,source_card:source.id,source_port:'text',target_card:'m',target_port:'text'}))
  const document={...canvas.document,cards:[{id:'m',type:'model.image',model_id:'canvas-image-model',prompt:{segments:[{id:'p',kind:'text',text:'保持清晨街道的气氛'}]},config:{count:3},input_bindings:sources.map(source=>({id:'use-'+source.id,input_port:'text',source:{canvas_id:canvas.id,card_id:source.id,port_id:'text',position:0}}))},...sources,{id:'person',type:'content.character',object_id:identity,name:'小雨',text:'不能跨级读取的外貌秘密'}],edges:[...edges,{id:'actor-edge',source_card:'person',source_port:'object',target_card:'performance',target_port:'participant'}],input_order:{m:{text:edges.map(edge=>edge.id)},performance:{participant:['actor-edge']}}}
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4599${storyboardCanvasPath(canvas)}`)
  const editor = await openCanvasCard(page, 'm')
  const basis = editor.getByRole('region', { name: '已保存直接输入', exact: true })
  const directSources = basis.locator('[data-reference-source]')
  await directSources.nth(sources.length - 1).waitFor()
  assert.equal(await directSources.count(), sources.length, 'all direct sources remain inspectable')
  const submit=await editor.getByRole('button',{name:'预检运行',exact:true}).boundingBox(), body=await editor.boundingBox()
  assert.ok(submit.y>=body.y&&submit.y+submit.height<=body.y+body.height,'multi-source composer keeps submit visible without scrolling the entire editor')
  assert.doesNotMatch(await editor.getByRole('region', { name: '关联来源', exact: true }).innerText(),new RegExp(identity),'default reference strip does not expose internal object identity')
  await editor.screenshot({path:join(output,'multi-source-default.png'),animations:'disabled'})
  await basis.getByText('抬头望向街灯', { exact: false }).first().waitFor()
  const saved = (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data.document
  assert.equal(saved.cards.find(card => card.id === 'performance').input_bindings[0].source.object_id, identity)
  await editor.screenshot({path:join(output,'multi-source-source-detail.png'),animations:'disabled'})
  await editor.getByLabel('管理候选与采用',{exact:true}).press('Escape')
  const prompt=editor.getByRole('textbox',{name:'模型正文',exact:true})
  const longText='这是用户亲自输入的长创作要求，保持文字与标点原样。'.repeat(40)
  await prompt.fill(longText)
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  assert.equal(await prompt.textContent(),longText)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await editor.screenshot({path:join(output,'model-long-input.png'),animations:'disabled'})
  let release,started
  const pending=new Promise(resolve=>{release=resolve}),arrived=new Promise(resolve=>{started=resolve})
  await page.route(`**/${canvas.id}/precheck?project_id=*`,async route=>{const response=await route.fetch();started();await pending;await route.fulfill({response})})
  await editor.getByRole('button',{name:'预检运行',exact:true}).click();await arrived
  assert.equal(await editor.getByRole('button',{name:'预检运行',exact:true}).isDisabled(),true)
  await editor.screenshot({path:join(output,'model-precheck-loading.png'),animations:'disabled'})
  release();await page.getByRole('dialog',{name:'运行预检',exact:true}).waitFor()
  await page.unroute(`**/${canvas.id}/precheck?project_id=*`)
  await fetch(`${api}/test/image-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fail_next:true})})
  await page.getByRole('button',{name:'确认执行',exact:true}).click()
  await editor.getByRole('alert').filter({hasText:/submission_failed|归档|失败/}).first().waitFor()
  await editor.screenshot({path:join(output,'model-error-summary.png'),animations:'disabled'})
  const observer=await page.context().newPage()
  await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  const readonly = await openCanvasCard(observer, 'm')
  assert.equal(await readonly.getByRole('button',{name:'预检运行',exact:true}).isDisabled(),true)
  const readonlySources=readonly.getByRole('region',{name:'已保存直接输入',exact:true})
  assert.equal(await readonlySources.getByRole('button',{name:/取消采用/}).first().isDisabled(),true)
  await readonlySources.getByText('抬头望向街灯',{exact:false}).first().waitFor()
  await readonly.screenshot({path:join(output,'model-readonly-disabled.png'),animations:'disabled'})
  await observer.close()
  console.log('PASS B multi-source surface, long names/input, loading/error/readonly',output)
} catch(error) { await page.screenshot({path:join(output,'failure.png')});throw error } finally { await cleanup() }
