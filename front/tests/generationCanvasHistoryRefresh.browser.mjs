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
const output = await browserOutput('jellyfish-generation-canvas-history-')
const api = 'http://127.0.0.1:8635', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8635' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4635, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '流式文本' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'm', type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: [{ id: 'prompt', kind: 'text', text: '刷新定位回归' }] } }], edges: [], input_order: {} }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  const clean=`http://127.0.0.1:4635/projects/canvas-project/generation-canvas?canvas=${canvas.id}&context=kept`
  const waitForCanvas=async()=>{await page.getByRole('status',{name:'画布保存状态',exact:true}).filter({hasText:'已保存'}).waitFor();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
  const request=async(path,body)=>{const response=await fetch(`${base}/${canvas.id}`+path,body&&{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return(await response.json()).data}
  const precheck=await request('/precheck',{card_id:'m'})
  const accepted=await request('/runs',{request_id:'history-refresh',preview_token:precheck.preview_token})
  let node
  for(let i=0;i<80;i++){node=(await request('/runtime')).runs.find(run=>run.id===accepted.run_id)?.nodes[0];if(node)break;await delay(50)}
  assert.ok(node,'real task has a historical node to locate')
  const target=clean+`&run=${accepted.run_id}&node=${node.id}`
  const history=page.getByRole('region',{name:'画布运行历史',exact:true}),toggle=page.getByRole('button',{name:'运行历史',exact:true})
  await page.goto(clean);await waitForCanvas();assert.equal(await history.isVisible(),false,'runtime snapshots alone do not open history')
  for(const close of ['details','toggle','escape','narrow']){
    await page.setViewportSize({width:close==='narrow'?390:1440,height:1000})
    await page.goto(target);await history.locator(`[data-history-node="${node.id}"]`).waitFor()
    await page.waitForFunction(id=>document.activeElement?.getAttribute('data-history-node')===id,node.id)
    if(close==='details'||close==='narrow')await page.getByRole(close==='narrow'?'dialog':'complementary',{name:'运行历史',exact:true}).getByRole('button',{name:'关闭详情',exact:true}).click()
    else if(close==='escape')await page.keyboard.press('Escape')
    else await toggle.click()
    await history.waitFor({state:'hidden'})
    await page.reload();await waitForCanvas()
    assert.equal(await history.isVisible(),false,`history dismissed by ${close} must stay closed after refresh`)
    const url=new URL(page.url());assert.equal(url.searchParams.has('run'),false);assert.equal(url.searchParams.has('node'),false)
    assert.equal(url.searchParams.get('canvas'),canvas.id);assert.equal(url.searchParams.get('context'),'kept')
    const dismissedUrl=page.url()
    await toggle.click();await history.waitFor()
    if(close==='narrow')await page.getByRole('dialog',{name:'运行历史',exact:true}).getByRole('button',{name:'关闭详情',exact:true}).click()
    else await toggle.click()
    await history.waitFor({state:'hidden'});assert.equal(page.url(),dismissedUrl,'manual history browsing does not change the address')
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto(target)
  await history.locator(`[data-history-node="${node.id}"]`).waitFor()
  await page.locator('[data-card-id="m"]').press('Enter');await history.waitFor({state:'hidden'})
  await page.reload();await waitForCanvas();assert.equal(await history.isVisible(),false,'switching to card details also dismisses the historical target')
  await page.goBack();await waitForCanvas();assert.equal(new URL(page.url()).searchParams.has('run'),false,'dismissal replaces the target instead of adding a history entry')
  assert.equal(await history.isVisible(),false)
  assert.equal((await(await fetch(`${api}/test/runtime-controls`)).json()).calls.length,1,'refresh never resubmits generation')
  console.log('PASS deep-link focus, both dismissal paths, reload stays closed, manual reopen and unrelated query preservation')
}finally{await cleanup()}
