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
const api = 'http://127.0.0.1:8631', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8631' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4631, strictPort: true, open: false, proxy: { '/api': api } } })
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
  const probe=async(name,run,documentOverrides={},contextOptions={})=>{
    const facts={}
    const fixture=await createStoryboardCanvas(base, name)
    const cards=[{id:'place',type:'reference.place',name:'场所',angle:'正面'}, {id:'other',type:'reference.place',name:'其他场所',angle:'正面'}, {id:'director',type:'direction.fact',scope:{},examples:[],input_bindings:[]}]
    const seeded=await fetch(storyboardCanvasApi(base, fixture.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document: withFixedSource(fixture, { ...fixture.document, cards, edges: [], ...documentOverrides })})})
    assert.ok(seeded.ok,await seeded.text())
    const isolated=await browser.newContext({viewport:{width:1920,height:790},...contextOptions})
    page=await isolated.newPage();page.setDefaultTimeout(6000)
    await page.addInitScript(({key})=>{window.__ENV={BACKEND_URL:location.origin};if(!sessionStorage.getItem(key)){sessionStorage.setItem(key,'seeded');localStorage.setItem(key,JSON.stringify({schema:1,positions:{place:{x:innerWidth<700?120:400,y:innerWidth<700?300:250},other:{x:1000,y:250},director:{x:1800,y:250}},sizes:{},transform:{x:0,y:0,scale:.8}}))}},{key:`jellyfish:generation-layout:canvas-project:${fixture.id}:view:canvas`})
    await page.goto(`http://127.0.0.1:4631${storyboardCanvasPath(fixture)}`)
    const card=page.locator('[data-card-id="place"]');await page.locator('[data-card-id], [data-stack-id]').first().waitFor();await delay(100)
    const position=(target=card)=>target.evaluate(e=>({x:parseFloat(e.style.left),y:parseFloat(e.style.top)}))
    const view=()=>page.locator('.generation-world').getAttribute('style')
    const scale=()=>page.getByLabel('画布缩放比例').textContent()
    const drag=async(target=card)=>{const box=await target.boundingBox();await page.mouse.move(box.x+60,box.y+80);await page.mouse.down();await page.mouse.move(box.x+140,box.y+100,{steps:6});await delay(70);return box}
    try{await run({card,position,view,scale,drag,facts});results.push({name,status:'passed',facts})}
    catch(error){await page.screenshot({path:join(output,`probe-${results.length+1}.png`)});results.push({name,status:'failed',error:error.message,facts})}
    await page.mouse.up();await page.keyboard.up('Space');await page.keyboard.press('Escape');await page.keyboard.press('Escape')
    console.log(JSON.stringify(results.at(-1)))
  }
  await probe('opening pans briefly through intermediate positions and closing retains the final viewport',async({card,view})=>{
    const before=await view()
    await page.evaluate(()=>{window.observedViews=[];const start=performance.now();const tick=()=>{window.observedViews.push(document.querySelector('.generation-world').style.transform);if(performance.now()-start<400)requestAnimationFrame(tick)};requestAnimationFrame(tick)})
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(450)
    const positions=await page.evaluate(()=>[...new Set(window.observedViews)])
    assert.ok(positions.length>=3,`opening should animate through intermediate positions: ${JSON.stringify(positions)}`)
    const after=await view();assert.notEqual(after,before)
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'})
    assert.equal(await view(),after,'close retains the revealed viewport')
  })
  await probe('reduced motion opens below immediately without zoom or card coordinate changes',async({card,position,view})=>{
    const origin=await position();await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(50)
    const a=await card.boundingBox(),b=await panel.boundingBox()
    assert.ok(Math.abs(b.x-a.x)<1&&Math.abs(b.y-a.y-a.height-16)<1)
    assert.equal(await panel.getAttribute('data-expanded'),'false');assert.deepEqual(await position(),origin)
    const settled=await view();await delay(220);assert.equal(await view(),settled)
    await card.press('Enter');await delay(220);assert.equal(await view(),settled,'repeated opening does not recenter')
    const picker=panel.getByRole('combobox',{name:'参考名称',exact:true});await picker.fill('保留名称');await picker.press('Enter');await delay(220)
    assert.equal(await view(),settled,'editing and save do not move viewport')
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'})
    await card.press('Enter');await panel.waitFor();assert.equal(await panel.locator('.ant-select-selection-item').filter({hasText:'保留名称'}).count(),1)
  },{}, {reducedMotion:'reduce'})
  await probe('editor follows card movement zoom and manual pan without recentering or hiding',async({card,view})=>{
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(220)
    const font=await panel.locator('input').first().evaluate(node=>getComputedStyle(node).fontSize)
    await card.focus();await page.keyboard.press('Shift+ArrowUp')
    const before=await view();await page.getByLabel('生成画布视口',{exact:true}).focus()
    for(let i=0;i<8;i++)await page.keyboard.press('ArrowDown')
    assert.notEqual(await view(),before);await delay(220)
    let a=await card.boundingBox(),b=await panel.boundingBox()
    assert.ok(a.y<0,'card can move above viewport');assert.equal(await panel.isVisible(),true)
    assert.ok(Math.abs(b.y-a.y-a.height-16)<1,'offscreen card does not hide its editor')
    const manual=await view();await delay(220);assert.equal(await view(),manual,'manual browsing is respected')
    await page.getByRole('button',{name:'放大',exact:true}).click();await delay(50)
    a=await card.boundingBox();b=await panel.boundingBox()
    assert.ok(Math.abs(b.y-a.y-a.height-16)<1);assert.equal(await panel.locator('input').first().evaluate(node=>getComputedStyle(node).fontSize),font)
    const origin=await card.boundingBox();await page.mouse.move(origin.x+60,Math.max(2,origin.y+80))
  },{}, {reducedMotion:'reduce'})
  for(const input of ['pointer','wheel','navigation','composition']) await probe(`user ${input} interrupts reveal and it never resumes`,async({card,view})=>{
    await card.focus();for(let i=0;i<3;i++)await page.keyboard.press('Shift+ArrowDown')
    const initial=await page.locator('.generation-world').evaluate(node=>new DOMMatrix(getComputedStyle(node).transform).f)
    await card.press('Enter')
    await page.waitForFunction(y=>new DOMMatrix(getComputedStyle(document.querySelector('.generation-world')).transform).f<y-1,initial,{polling:'raf'})
    if(input==='pointer'){await page.mouse.move(1400,600);await page.mouse.down()}
    else if(input==='wheel'){await page.mouse.move(1400,600);await page.mouse.wheel(0,20)}
    else if(input==='composition'){await page.getByLabel('生成画布视口',{exact:true}).dispatchEvent('keydown',{key:'Process',keyCode:229,isComposing:true})}
    else {await page.getByLabel('生成画布视口',{exact:true}).focus();await page.keyboard.press('ArrowRight')}
    const interrupted=await view();await delay(250);assert.equal(await view(),interrupted,'user input owns the final viewport')
    await page.mouse.up()
  })
  await probe('window shrinking reveals editor again while growing retains viewport and editor dimensions',async({card,view})=>{
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(50)
    const normal=await panel.boundingBox()
    await page.setViewportSize({width:1920,height:600});await delay(80)
    const small=await panel.boundingBox(),a=await card.boundingBox()
    assert.ok(small.y+small.height<=(await page.locator('.generation-view-tools').boundingBox()).y-9)
    assert.ok(Math.abs(small.height-normal.height)<1,'normal editor height is retained when editor alone fits')
    assert.ok(Math.abs(small.y-a.y-a.height-16)<1)
    const shrunk=await view();await page.setViewportSize({width:1920,height:1000});await delay(100)
    assert.equal(await view(),shrunk,'growing does not restore or refit viewport')
  },{}, {reducedMotion:'reduce'})
  await probe('explicit expansion collapses below and reveals again without losing draft',async({card,view})=>{
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(50)
    await card.focus();for(let i=0;i<4;i++)await page.keyboard.press('Shift+ArrowDown')
    const manual=await view()
    await panel.getByRole('button',{name:'展开详情',exact:true}).press('Enter')
    assert.equal(await panel.getAttribute('data-expanded'),'true');await page.keyboard.press('Escape');await delay(100)
    assert.equal(await panel.getAttribute('data-expanded'),'false');assert.notEqual(await view(),manual)
    const a=await card.boundingBox(),b=await panel.boundingBox();assert.ok(Math.abs(b.y-a.y-a.height-16)<1)
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.equal(await card.getAttribute('data-selected'),'true')
  },{}, {reducedMotion:'reduce'})
  await probe('drag cancellation restores the post-opening viewport and reveal adds no undo item',async({card,position,view,drag})=>{
    const initial=await position();await card.focus();await page.keyboard.press('ArrowRight')
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(50)
    const revealed=await view(),moved=await position()
    await drag();await page.keyboard.press('Escape');await page.mouse.up()
    assert.deepEqual(await position(),moved);assert.equal(await view(),revealed)
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'})
    await card.focus();await page.keyboard.press('ControlOrMeta+z')
    assert.deepEqual(await position(),initial,'undo reaches movement across reveal and browsing')
    assert.equal(await view(),revealed,'undo preserves revealed view')
  },{}, {reducedMotion:'reduce'})
  await probe('cancelling an inner connection restores retained editor without a second reveal',async({card,view})=>{
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(50)
    await card.focus();for(let i=0;i<3;i++)await page.keyboard.press('Shift+ArrowDown')
    const manual=await view(),point=card.locator('.generation-connection-point').first()
    await point.press('Enter');await panel.waitFor({state:'hidden'})
    await page.keyboard.press('Escape');await panel.waitFor();await delay(100)
    assert.equal(await view(),manual,'inner connection cancellation cannot recenter an already open editor')
    const a=await card.boundingBox(),b=await panel.boundingBox();assert.ok(Math.abs(b.y-a.y-a.height-16)<1)
  },{}, {reducedMotion:'reduce'})
  await probe('closing and reloading preserve revealed viewport and every card position',async({card,position,view})=>{
    const before=await Promise.all((await page.locator('[data-card-id]').all()).map(node=>position(node)))
    await card.press('Enter');const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(50)
    const revealed=await view();await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await delay(400)
    await page.reload();await card.waitFor();await delay(100)
    assert.equal(await view(),revealed,'reload retains opening pan')
    assert.deepEqual(await Promise.all((await page.locator('[data-card-id]').all()).map(node=>position(node))),before,'reveal does not rearrange any cards')
  },{}, {reducedMotion:'reduce'})
  await probe('dropping a new card reveals its editor correctly with reduced motion',async()=>{
    await page.getByRole('toolbar',{name:'卡片分类',exact:true}).getByRole('button',{name:'基础卡',exact:true}).click()
    const list=page.getByRole('navigation',{name:'添加卡片',exact:true})
    await list.getByRole('button',{name:'图片卡',exact:true}).dragTo(page.getByLabel('生成画布视口',{exact:true}),{targetPosition:{x:1400,y:600}})
    const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(100)
    const box=await panel.boundingBox()
    assert.ok(box.x>=16&&box.x+box.width<=1920-16,'new editor fits horizontal viewport')
    assert.ok(box.y>=80&&box.y+box.height<=(await page.locator('.generation-view-tools').boundingBox()).y-9,'new editor fits vertical viewport')
  },{}, {reducedMotion:'reduce'})
  const p2TextModel=await request('/api/v1/llm/models',{id:'p2-text-model',name:'text-model',category:'text',provider_id:'canvas-image-provider'})
  for(const motion of ['reduce','no-preference']) for(const kind of ['reference','text-model']) await probe(`${kind} ${motion} editor compressed close grow move reopen reveals its restored final height`,async({card,position,view,facts})=>{
    await page.setViewportSize({width:1920,height:450});await card.press('Enter')
    const panel=page.locator('.generation-card-editor:visible');await panel.waitFor();await delay(220)
    facts.compressed=await panel.boundingBox();assert.ok(facts.compressed.height<320,'initial window really constrains editor')
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'})
    await page.setViewportSize({width:1920,height:900});await card.focus()
    for(let i=0;i<30&&(await card.boundingBox()).y<480;i++)await page.keyboard.press('Shift+ArrowDown')
    const worldPosition=await position();await card.press('Enter');await panel.waitFor();await delay(220)
    const a=await card.boundingBox(),b=await panel.boundingBox(),tools=await page.locator('.generation-view-tools').boundingBox()
    facts.reopened=b;facts.tools=tools
    assert.equal(b.height,320,'reopening restores the normal editor height')
    assert.ok(b.y>=80&&b.y+b.height<=tools.y-9,'final restored editor fits the usable viewport')
    assert.ok(Math.abs(b.x-a.x)<1&&Math.abs(b.y-a.y-a.height-16)<1,'reopened editor retains the left edge and gap')
    assert.deepEqual(await position(),worldPosition,'revealing does not move card world coordinates')
    if(kind==='text-model') {
      assert.match(await panel.getByRole('textbox',{name:'模型正文',exact:true}).innerText(),/重开后保持预检可用/)
      const precheck=panel.getByRole('button',{name:'预检运行',exact:true})
      const action=await precheck.boundingBox();facts.precheck=action
      assert.ok(action.y>=b.y&&action.y+action.height<=tools.y-9,'precheck action is fully inside the usable viewport')
      await precheck.click()
      const dialog=page.getByRole('dialog',{name:'运行预检',exact:true});await dialog.waitFor()
      await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'})
    }
    const revealed=await view();await delay(220);assert.equal(await view(),revealed,'final size does not trigger repeated fitting')
  },kind==='text-model'?{cards:[{id:'place',type:'model.text',model_id:p2TextModel.id,prompt:{segments:[{id:'p2-prompt',kind:'text',text:'重开后保持预检可用'}]},config:{}}]}:{}, {reducedMotion:motion})
  writeFileSync(join(output,'audit.json'),JSON.stringify({results},null,2))
  assert.equal(results.filter(result=>result.status==='failed').length,0,JSON.stringify(results))
}finally{await cleanup()}
