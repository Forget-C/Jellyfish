import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-performance-designs-')
const api = 'http://127.0.0.1:8452', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8452' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4452, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const cases = [['situation','situation','当前处境','等待回应'], ['performance','physical_action','身体动作','克制回应'], ['performance_rule','applicability','表演适用说明','减少多余动作'], ['anchor','position','位置',null], ['blocking','path','路径','靠近后停下'], ['activity','task','持续任务','持续整理'], ['environment','activity','环境活动','轻微环境活动']]
  const image = new FormData()
  image.append('project_id', 'canvas-project'); image.append('usage_kind', 'generation_upload')
  image.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')], {type:'image/png'}), 'reference.png')
  const file = (await (await fetch(`${api}/api/v1/studio/files/upload`, {method:'POST', body:image})).json()).data
  const canvas = (await (await fetch(base, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:'表演与调度引用'})})).json()).data
  const source = (id, port) => ({canvas_id:canvas.id, card_id:id, port_id:port, position:0})
  const edges = cases.flatMap(([id])=>['text','image'].map(port=>({id:id+port, source_card:port==='text'?'brief':'image', source_port:port, target_card:id, target_port:port})))
  edges.push({id:'location',source_card:'location',source_port:'anchor',target_card:'blocking',target_port:'anchor'})
  edges.push({id:'adopt',source_card:'environment',source_port:'text',target_card:'model',target_port:'text'})
  const document = {...canvas.document, cards:[{id:'location',type:'direction.anchor',name:'吧台左侧',anchor_id:'location-stable',position:{state:'proposal',text:'东墙前两步'}},{id:'brief',type:'content.text',text:'吧台旁'}, {id:'image',type:'content.image',file_id:file.id}, ...cases.map(([id])=>({id,type:'direction.'+id,...(id==='anchor'?{name:'东侧位置',anchor_id:'stable'}:{})})), {id:'model',type:'model.image',model_id:'canvas-image-model',input_bindings:[{id:'adopt',input_port:'text',source:source('environment','text')}]}], edges, input_order:Object.fromEntries([...cases.map(([id])=>[id,{text:[id+'text'],image:[id+'image'],...(id==='blocking'?{anchor:['location']}:{})}]),['model',{text:['adopt']}]])}
  const seeded = await fetch(`${base}/${canvas.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seeded.ok,await seeded.text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<100;i++){const value=await read();if(predicate(value))return value;await delay(120)}throw Error('save did not reach expected state')}
  await page.goto(`http://127.0.0.1:4452/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  const close=()=>detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  const open=async id=>{await page.locator(`[data-card-id="${id}"]`).press('Enter');await detail.waitFor()}
  for(const [id,key,label,preset] of cases){
    await page.locator(`[data-card-id="${id}"] .visual-design-card .design-purpose svg`).waitFor({state:'attached'})
    await open(id)
    assert.equal(await detail.getByRole('tab').count(),0)
    if(preset){
      await detail.getByRole('button',{name:'预览 '+preset,exact:true}).click()
      await detail.getByRole('button',{name:'应用',exact:true}).click()
      await poll(s=>s.document.cards.find(c=>c.id===id)[key]?.text)
      await close();await open(id)
      assert.equal(await detail.getByRole('button',{name:'预览 '+preset,exact:true}).getAttribute('aria-pressed'),'true')
      await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    }else assert.equal(await detail.getByRole('button',{name:'高级设置',exact:true}).count(),0)
    const field=detail.getByRole('textbox',{name:label+'内容',exact:true})
    await field.fill(''); await field.press('@')
    await page.getByRole('option',{name:'@文本1',exact:true}).click()
    await field.press('End'); await field.press(' ')
    await detail.locator('.design-field-candidates').getByRole('button',{name:/候选.*图片.*候选/}).click()
    await poll(s=>s.document.cards.find(c=>c.id===id)[key]?.document?.segments.filter(x=>x.kind==='reference').length===2)
    if(id==='blocking') {
      await field.press('End'); await field.press(' '); await field.press('@')
      await page.getByRole('option',{name:'@吧台左侧',exact:true}).click()
      await poll(s=>s.document.cards.find(c=>c.id===id)[key].document.segments.some(x=>x.kind==='reference'&&x.source.card_id==='location'))
    }
    const saved=(await read()).document.cards.find(c=>c.id===id)
    assert.equal(saved.input_bindings.length,0,'field refs do not infer participant or other relationships')
    const published=(await(await fetch(`${base}/${canvas.id}/cards/${id}/outputs`)).json()).data.outputs.find(x=>x.source.port_id==='text')
    assert.match(published.text,/吧台旁/)
    if(id==='blocking')assert.match(published.text,/吧台左侧（位置：东墙前两步）/)
    assert.equal(published.payload.material_references.length,1)
    await detail.getByRole('switch',{name:'显示状态与来源',exact:true}).click()
    await detail.getByRole('combobox',{name:label+'状态',exact:true}).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click()
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('不适用',{exact:true}).click()
    await poll(s=>s.document.cards.find(c=>c.id===id)[key].state==='not_applicable')
    const inactive=(await(await fetch(`${base}/${canvas.id}/cards/${id}/outputs`)).json()).data.outputs.find(x=>x.source.port_id==='text')
    assert.equal(inactive?.payload.material_references?.length||0,0)
    await detail.getByRole('combobox',{name:label+'状态',exact:true}).locator('xpath=ancestor::div[contains(@class,"ant-select-selector")]').click()
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('提议',{exact:true}).click()
    await poll(s=>s.document.cards.find(c=>c.id===id)[key].state==='proposal')
    if(id==='environment'){
      await detail.screenshot({path:join(output,'performance-advanced.png')})
    }
    await close()
  }
  const compiled=(await(await fetch(`${base}/${canvas.id}/cards/model/compile`)).json()).data
  assert.deepEqual(compiled.media.map(item=>item.file_id),[file.id])
  assert.match(compiled.text,/image 1/)
  assert.equal((await read()).document.edges.length,16,'no extra model-to-media edges')
  await page.reload();await open('performance')
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('textbox',{name:'身体动作内容',exact:true}).locator('.generation-prompt-token').filter({hasText:'@图片1'}).waitFor()
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await detail.screenshot({path:join(output,'performance-mobile.png')})
  await close()
  const observer=await page.context().newPage()
  await observer.setViewportSize({width:1440,height:960})
  await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url());await observer.getByText('此画布当前只读',{exact:true}).waitFor()
  const revision=(await read()).revision
  for(const[id,,label,preset]of cases){
    await observer.locator(`[data-card-id="${id}"]`).waitFor({state:'attached'})
    assert.match(await observer.locator(`[data-card-id="${id}"]`).textContent(), /查看设计/)
    await observer.locator(`[data-card-id="${id}"]`).press('Enter')
    const readonly=observer.locator('.wb-details:not([hidden])')
    if(preset)await readonly.getByRole('button',{name:'高级设置',exact:true}).click()
    assert.equal(await readonly.getByRole('textbox',{name:label+'内容',exact:true}).isDisabled(),true)
    await readonly.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  assert.equal((await read()).revision,revision)
  await observer.close()
  console.log('Seven performance/staging designs: presets, refs, carry, inactive, reload and readonly passed:',output)
} catch(error) { for (const context of browser?.contexts() || []) for (const current of context.pages()) await current.screenshot({path:join(output, 'failure-'+context.pages().indexOf(current)+'.png')}).catch(()=>{}); throw error } finally { await cleanup() }
