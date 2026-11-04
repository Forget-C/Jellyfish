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
const output = await browserOutput('jellyfish-sound-constraints-')
const api = 'http://127.0.0.1:8463', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8463' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4463, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const cases = [['dialogue','content','对白正文',null],['sound','environment','环境声','对白优先'],['space_rule','axis','轴线','保持轴线'],['continuity','before','前态','变化后延续'],['fact','fact','不可改事实',null],['creative_control','freedom','创作控制程度','有限发挥'],['guidance','priority','编译优先级','动作可读优先'],['criterion','standard','可观察判断标准','动作结果可辨']]
  const canvas=(await (await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'声音约束验收'})})).json()).data
  const edges=cases.map(([id])=>({id,source_card:'brief',source_port:'text',target_card:id,target_port:'text'}))
  const document={...canvas.document,cards:[{id:'brief',type:'content.text',text:'明确的文本依据'},...cases.map(([id])=>({id,type:'direction.'+id,...(id==='dialogue'?{dialogue_id:'stable-dialogue',version:3}:{})}))],edges,input_order:Object.fromEntries(cases.map(([id])=>[id,{text:[id]}]))}
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seeded.ok,await seeded.text())
  await page.goto(`http://127.0.0.1:4463/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<100;i++){const state=await read();if(predicate(state))return state;await delay(150)}throw Error('save timeout')}
  for(const[id,key,label,preset]of cases){
    await openCanvasCard(page,id)
    if(preset){await detail.getByRole('button',{name:'预览 '+preset,exact:true}).click();await detail.getByRole('button',{name:'应用',exact:true}).click();await detail.getByRole('button',{name:'高级设置',exact:true}).click()}
    const field=detail.getByRole('textbox',{name:label+'内容',exact:true})
    await field.fill('');await field.press('@');await page.getByRole('option',{name:'@文本1',exact:true}).click()
    await poll(state=>state.document.cards.find(card=>card.id===id)[key]?.document?.segments?.some(segment=>segment.kind==='reference'))
    if(id==='dialogue')assert.equal((await read()).document.cards.find(card=>card.id===id).version,3)
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  }
  await page.reload();await openCanvasCard(page,'continuity');await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:join(output,'sound-constraints-mobile.png'),fullPage:true})
  console.log('Eight sound/constraint cards: entry modes, preset application, references, version and mobile passed:',output)
} finally { await cleanup() }
