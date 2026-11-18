import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const api = 'http://127.0.0.1:8452', base = `${api}/api/v1/studio/generation-canvases`
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
  const canvas = await createStoryboardCanvas(base, '表演与调度引用')
  const source = (id, port) => ({canvas_id:canvas.id, card_id:id, port_id:port, position:0})
  const edges = cases.flatMap(([id])=>['text','image'].map(port=>({id:id+port, source_card:port==='text'?'brief':'image', source_port:port, target_card:id, target_port:port})))
  edges.push({id:'legacy-image',source_card:'image',source_port:'image',target_card:'legacy',target_port:'image'})
  edges.push({id:'location',source_card:'location',source_port:'anchor',target_card:'blocking',target_port:'anchor'})
  edges.push({id:'adopt',source_card:'environment',source_port:'text',target_card:'model',target_port:'text'})
  const document = {...canvas.document, cards:[{id:'legacy',type:'direction.performance_rule',applicability:{state:'proposal',text:'旧文字 @图片1 /首帧参考'}},{id:'location',type:'direction.anchor',name:'吧台左侧',anchor_id:'location-stable',position:{state:'proposal',text:'东墙前两步'}},{id:'brief',type:'content.text',text:'吧台旁'}, {id:'image',type:'content.image',file_id:file.id}, ...cases.map(([id])=>({id,type:'direction.'+id,...(id==='anchor'?{name:'东侧位置',anchor_id:'stable'}:{})})), {id:'model',type:'model.image',model_id:'canvas-image-model',input_bindings:[{id:'adopt',input_port:'text',source:source('environment','text')}]}], edges, input_order:Object.fromEntries([...cases.map(([id])=>[id,{text:[id+'text'],image:[id+'image'],...(id==='blocking'?{anchor:['location']}:{})}]),['legacy',{image:['legacy-image']}],['model',{text:['adopt']}]])}
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document: withFixedSource(canvas, document)})})
  assert.ok(seeded.ok,await seeded.text())
  const read=async()=>(await(await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  const poll=async predicate=>{for(let i=0;i<100;i++){const value=await read();if(predicate(value))return value;await delay(120)}throw Error('save did not reach expected state')}
  await page.goto(`http://127.0.0.1:4452${storyboardCanvasPath(canvas)}`)
  const detail=page.locator('.wb-details:not([hidden])')
  const close=()=>detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  const open=async id=>{await page.locator(`[data-card-id="${id}"]`).press('Enter');await detail.waitFor()}
  await open('legacy')
  const original = (await read()).document.cards.find(card=>card.id==='legacy')
  await detail.getByRole('textbox',{name:'表演适用说明内容',exact:true}).focus()
  await close()
  await page.getByRole('button',{name:'保存画布',exact:true}).click()
  await page.getByRole('status',{name:'画布保存状态',exact:true}).filter({hasText:'已保存'}).waitFor()
  assert.deepEqual((await read()).document.cards.find(card=>card.id==='legacy'),original,'viewing legacy @ text must not create references')
  await open('legacy')
  const legacy = detail.getByRole('textbox',{name:'表演适用说明内容',exact:true})
  await legacy.press('End'); await legacy.press(' '); await legacy.pressSequentially('补充')
  await poll(s=>s.document.cards.find(card=>card.id==='legacy').applicability.document?.segments.some(part=>part.kind==='text'&&part.literal))
  await close(); await page.reload(); await open('legacy')
  await legacy.press('End'); await legacy.press(' '); await legacy.press('@')
  await page.getByRole('option',{name:'@图片1',exact:true}).click()
  await poll(s=>s.document.cards.find(card=>card.id==='legacy').applicability.document.segments.filter(part=>part.kind==='reference').length===1)
  await close()
  for(const [id,key,label,preset] of cases){
    const card = page.locator(`[data-card-id="${id}"]`)
    assert.deepEqual(await card.evaluate(node => [node.offsetWidth, node.offsetHeight]), [360, 128])
    assert.equal(await card.getByRole('img', { name: /用途示意/ }).count(), 0)
    await open(id)
    assert.equal(await detail.getByRole('tab').count(),0)
    if(preset){
      await detail.getByRole('button',{name:'预览 '+preset,exact:true}).click()
      await detail.getByRole('button',{name:'应用',exact:true}).click()
      await poll(s=>s.document.cards.find(c=>c.id===id)[key]?.text)
      assert.equal(await card.evaluate(node => node.offsetHeight), 128, id + ': applying a preset keeps the open card height')
      await close();await open(id)
      assert.equal(await detail.getByRole('button',{name:'预览 '+preset,exact:true}).getAttribute('aria-pressed'),'true')
      await detail.getByRole('button',{name:'高级设置',exact:true}).click()
    }else assert.equal(await detail.getByRole('button',{name:'高级设置',exact:true}).count(),0)
    const field=detail.getByRole('textbox',{name:label+'内容',exact:true})
    await field.fill(''); await field.press('@')
    await page.getByRole('option',{name:'@文本1',exact:true}).click()
    await field.press('End'); await field.press(' ')
    await detail.getByRole('region',{name:'关联来源',exact:true}).getByRole('button',{name:/候选.*图片.*候选/}).click()
    await page.getByRole('button',{name:'引用当前字段「'+label+'」',exact:true}).click()
    await poll(s=>s.document.cards.find(c=>c.id===id)[key]?.document?.segments.filter(x=>x.kind==='reference').length===2)
    if(id==='blocking') {
      await field.press('End'); await field.press(' '); await field.press('@')
      await page.getByRole('option',{name:'@吧台左侧',exact:true}).click()
      await poll(s=>s.document.cards.find(c=>c.id===id)[key].document.segments.some(x=>x.kind==='reference'&&x.source.card_id==='location'))
    }
    const saved=(await read()).document.cards.find(c=>c.id===id)
    assert.equal(saved.input_bindings.length,0,'field refs do not infer participant or other relationships')
    const published=(await(await fetch(storyboardCanvasApi(base, canvas.id, `/cards/${id}/outputs`))).json()).data.outputs.find(x=>x.source.port_id==='text')
    assert.match(published.text,/吧台旁/)
    if(id==='blocking')assert.match(published.text,/\[设计引用：location\]/)
    assert.equal(published.payload.material_references.length,1)
    assert.equal(await detail.getByRole('switch',{name:'显示状态与来源',exact:true}).count(),0)
    assert.equal((await read()).document.cards.find(c=>c.id===id)[key].state,'fact')
    assert.equal((await read()).document.cards.find(c=>c.id===id)[key].authorship,'user')
    if(id==='environment'){
      await detail.screenshot({path:join(output,'performance-advanced.png')})
    }
    await close()
    await card.getByRole('definition').filter({hasText:'@文本内容卡'}).waitFor({state:'attached'})
  }
  const compiled=(await(await fetch(storyboardCanvasApi(base, canvas.id, `/cards/model/compile`))).json()).data
  assert.deepEqual(compiled.media.map(item=>item.file_id),[file.id])
  assert.match(compiled.text,/image 1/)
  assert.deepEqual((await read()).document.edges.filter(edge=>edge.target_card==='model').map(edge=>edge.source_card),['environment'],'carried media requires no extra model connections')
  await page.reload();await open('performance')
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
    await observer.locator(`[data-card-id="${id}"]`).press('Enter')
    const readonly=observer.locator('.wb-details:not([hidden])')
    assert.equal(await readonly.getByRole('textbox',{name:label+'内容',exact:true}).isDisabled(),true)
    await readonly.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  assert.equal((await read()).revision,revision)
  await observer.close()
  console.log('Seven performance/staging designs: presets, refs, carry, inactive, reload and readonly passed:',output)
} catch(error) { for (const context of browser?.contexts() || []) for (const current of context.pages()) await current.screenshot({path:join(output, 'failure-'+context.pages().indexOf(current)+'.png')}).catch(()=>{}); throw error } finally { await cleanup() }
