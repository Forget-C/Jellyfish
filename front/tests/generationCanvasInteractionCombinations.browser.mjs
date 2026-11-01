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
const api = 'http://127.0.0.1:8630', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8630' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4630, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1920, height: 790 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('console', message => { if (message.type() === 'error') console.log('BROWSER ERROR', message.text()) })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const request = async (path, body) => {
    const response = await fetch(api + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    assert.ok(response.ok, await response.clone().text()); return (await response.json()).data
  }


  const results=[]
  const probe=async(name,run)=>{
    const facts={}
    const fixture=await request('/api/v1/studio/generation-canvases/canvas-project',{name})
    const cards=[{id:'place',type:'reference.place',name:'场所',angle:'正面'}, {id:'other',type:'reference.place',name:'其他场所',angle:'正面'}, {id:'director',type:'direction.fact',scope:{},examples:[],input_bindings:[]}]
    const seeded=await fetch(`${base}/${fixture.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document:{...fixture.document,cards,edges:[]}})})
    assert.ok(seeded.ok,await seeded.text())
    const isolated=await browser.newContext({viewport:{width:1920,height:790}})
    page=await isolated.newPage();page.setDefaultTimeout(6000)
    await page.addInitScript(({key})=>{window.__ENV={BACKEND_URL:location.origin};localStorage.setItem(key,JSON.stringify({schema:1,positions:{place:{x:400,y:250},other:{x:1000,y:250},director:{x:1800,y:250}},sizes:{},transform:{x:0,y:0,scale:.8}}))},{key:`jellyfish:generation-layout:canvas-project:${fixture.id}:view:canvas`})
    await page.goto(`http://127.0.0.1:4630/projects/canvas-project/generation-canvas?canvas=${fixture.id}`)
    const card=page.locator('[data-card-id="place"]');await card.waitFor();await delay(100)
    const position=(target=card)=>target.evaluate(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}))
    const view=()=>page.locator('.generation-world').getAttribute('style')
    const scale=()=>page.getByLabel('画布缩放比例').textContent()
    const drag=async(target=card)=>{const box=await target.boundingBox();await page.mouse.move(box.x+60,box.y+80);await page.mouse.down();await page.mouse.move(box.x+140,box.y+100,{steps:6});await delay(70);return box}
    try{await run({card,position,view,scale,drag,facts});results.push({name,status:'passed',facts})}
    catch(error){await page.screenshot({path:join(output,`probe-${results.length+1}.png`)});results.push({name,status:'failed',error:error.message,facts})}
    await page.mouse.up();await page.keyboard.up('Space');await page.keyboard.press('Escape');await page.keyboard.press('Escape')
    console.log(JSON.stringify(results.at(-1)))
  }
  await probe('Q6 arrow during pointer drag must not unfreeze zoom',async({card,drag,scale,facts})=>{
    await drag();facts.initialScale=await scale()
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ControlOrMeta+z');await page.keyboard.press('ControlOrMeta+Shift+z');await page.keyboard.press('Space');await page.keyboard.press('0');await delay(70)
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    facts.scaleAfterArrowAndZero=await scale()
    assert.equal(facts.scaleAfterArrowAndZero,facts.initialScale)
  })
  await probe('Q9 drag plus arrow must redo final release position',async({card,drag,position,facts})=>{
    facts.initial=await position();const box=await drag()
    await page.keyboard.press('ArrowRight')
    await page.mouse.move(box.x+220,box.y+120,{steps:6});await page.mouse.up();await delay(70)
    facts.final=await position();await card.focus();await page.keyboard.press('ControlOrMeta+z');facts.undone=await position()
    await page.keyboard.press('ControlOrMeta+Shift+z');facts.redone=await position()
    assert.deepEqual(facts.undone,facts.initial);assert.deepEqual(facts.redone,facts.final)
  })
  await probe('Q7 press preserves menu and crossing drag threshold closes it before Escape',async({card,drag,position,facts})=>{
    await card.getByRole('button',{name:'卡片操作',exact:true}).click()
    facts.initial=await position();
    const box=await card.boundingBox();await page.mouse.move(box.x+60,box.y+80);await page.mouse.down()
    assert.equal(await card.getByRole('button',{name:'选择多个',exact:true}).isVisible(),true)
    await page.keyboard.press('Escape');await page.mouse.up()
    assert.equal(await card.getByRole('button',{name:'选择多个',exact:true}).isVisible(),false)
    await card.getByRole('button',{name:'卡片操作',exact:true}).click()
    await drag();facts.dragged=await position()
    facts.menuBefore=await card.getByRole('button',{name:'选择多个',exact:true}).isVisible(); assert.equal(facts.menuBefore,false)
    await page.keyboard.press('Escape');facts.afterEscape=await position()
    facts.menuAfter=await card.getByRole('button',{name:'选择多个',exact:true}).isVisible()
    assert.equal(facts.menuAfter,false);assert.deepEqual(facts.afterEscape,facts.initial)
  })
  await probe('Q7 dragging another card closes the existing menu',async({card,drag,position})=>{
    await card.getByRole('button',{name:'卡片操作',exact:true}).click()
    const other=page.locator('[data-card-id="other"]'), initial=await position(other)
    await drag(other)
    assert.equal(await card.getByRole('button',{name:'选择多个',exact:true}).isVisible(),false)
    await page.keyboard.press('Escape')
    assert.deepEqual(await position(other),initial)
  })
  await probe('Q5 multi-select keyboard Enter and Space must have equivalent selection behavior',async({card,facts})=>{
    await card.getByRole('button',{name:'卡片操作',exact:true}).click();await card.getByRole('button',{name:'选择多个',exact:true}).click()
    const other=page.locator('[data-card-id="other"]')
    const selected=()=>page.locator('[data-card-id][data-selected="true"]').evaluateAll(nodes=>nodes.map(n=>n.dataset.cardId))
    await other.press('Enter');facts.afterEnter={selected:await selected(),editors:await page.locator('.generation-card-editor:visible').count()}
    await other.press('Enter');await other.press('Space');facts.afterSpace={selected:await selected(),editors:await page.locator('.generation-card-editor:visible').count()}
    assert.deepEqual(facts.afterSpace,facts.afterEnter)
  })
  await probe('Q3 director Enter during edge drag must not open editor or leave pan active after release',async({view,drag,facts})=>{
    const director=page.locator('[data-card-id="director"]');const box=await drag(director)
    await page.mouse.move(1905,box.y+100,{steps:6});await delay(100)
    await page.keyboard.press('Enter');await delay(100)
    facts.editors=await page.locator('.generation-card-editor:visible').count()
    await page.mouse.up();await delay(80);facts.released=await view();await delay(200);facts.later=await view()
    assert.equal(facts.editors,0);assert.equal(facts.later,facts.released)
  })
  await probe('Q9 browser composing Enter must not activate director editor',async({facts})=>{
    const director=page.locator('[data-card-id="director"]');await director.focus()
    await director.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});await delay(80)
    facts.syntheticComposingSignal=true;facts.editors=await page.locator('.generation-card-editor:visible').count()
    assert.equal(facts.editors,0)
  })
  await probe('Q9 browser composing Space must not activate card editor',async({card,facts})=>{
    await card.focus();await card.dispatchEvent('keydown',{key:' ',code:'Space',isComposing:true});await card.dispatchEvent('keyup',{key:' ',code:'Space',isComposing:true});await delay(80)
    facts.syntheticComposingSignal=true;facts.editors=await page.locator('.generation-card-editor:visible').count()
    assert.equal(facts.editors,0)
  })
  await probe('Supplement 4 Space requires matching keydown and is cleared by Escape or focus change',async({card})=>{
    await card.focus()
    await card.dispatchEvent('keyup',{key:' ',code:'Space'})
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    await page.keyboard.down('Space');await page.keyboard.press('Escape');await page.keyboard.up('Space')
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    await card.focus();await page.keyboard.down('Space')
    await page.locator('[data-card-id="other"]').focus();await page.keyboard.up('Space')
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    await card.focus();await page.keyboard.down('Space');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Space')
    assert.equal(await page.locator('.generation-card-editor:visible').count(),0)
    await card.press('Space')
    await page.locator('.generation-card-editor:visible').waitFor()
    assert.equal(await page.locator('.generation-card-editor:visible').count(),1)
  })
  writeFileSync(join(output,'audit.json'),JSON.stringify({results},null,2))
  assert.equal(results.filter(result => result.status === 'failed').length, 0, JSON.stringify(results))
}finally{await cleanup()}
