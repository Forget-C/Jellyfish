import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-multipath-protection-')
const api = 'http://127.0.0.1:8758', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8758' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4758, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = await createStoryboardCanvas(base, '批量删除引用保护')
  const source={canvas_id:canvas.id,card_id:'source',port_id:'text',position:0}
  const field=state=>({state,text:'共享来源',document:{segments:[{id:'ref',kind:'reference',source}]}})
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'共享来源'},
    {id:'consumer',type:'direction.criterion',criterion_id:'criterion',name:'清晰可见',standard:field('fact')},
    {id:'outside',type:'direction.guidance',name:'外部消费者',priority:field('not_applicable')}],
    edges:['consumer','outside'].map(id=>({id:'edge-'+id,source_card:'source',source_port:'text',target_card:id,target_port:'text'})),
    input_order:{consumer:{text:['edge-consumer']},outside:{text:['edge-outside']}}}
  const save=await fetch(storyboardCanvasApi(base, canvas.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document: withFixedSource(canvas, document)})});assert.ok(save.ok,await save.text())
  const read=async()=>(await(await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  const editableCards = document => document.cards.filter(card => card.id !== canvas.document.fixed_source.card_id)
  const poll=async predicate=>{for(let i=0;i<80;i++){const s=await read();if(predicate(s.document))return s;await delay(100)}throw Error('batch deletion not saved')}
  await page.goto(`http://127.0.0.1:4758${storyboardCanvasPath(canvas)}`)
  const card=id=>page.locator(`[data-card-id="${id}"]`)
  await card('source').waitFor();await page.getByRole('button',{name:'适应全部',exact:true}).click()
  const modifier=await page.evaluate(()=>navigator.platform.includes('Mac')?'Meta':'Control')
  const choose=async ids=>{await page.keyboard.press('Escape');for(const id of ids)await card(id).click({modifiers:[modifier],position:{x:50,y:20}})}
  const remove=async()=>{await card('source').focus();await page.keyboard.press('Delete')}
  await choose(['source','consumer']);await remove()
  await page.getByText(/请先清理 outside 的参数引用 priority/).waitFor()
  assert.equal(editableCards((await read()).document).length,3,'retained inactive reference protects source')
  await page.keyboard.press('Escape')
  // Select all three after clearing the existing selection; references internal to the set must not block.
  const close=page.getByRole('button',{name:'关闭详情',exact:true});if(await close.isVisible())await close.click();await card('outside').click({modifiers:[modifier],position:{x:50,y:20}})
  await remove()
  await page.getByRole('button',{name:'确认删除',exact:true}).click()
  await poll(doc=>editableCards(doc).length===0)
  await page.getByRole('button',{name:'撤销操作',exact:true}).click()
  const restored=await poll(doc=>editableCards(doc).length===3)
  assert.equal(restored.document.edges.length,2)
  assert.equal(restored.document.cards.find(c=>c.id==='outside').priority.document.segments[0].source.card_id,'source')
  await page.getByRole('button',{name:'重做操作',exact:true}).click();await poll(doc=>editableCards(doc).length===0)
  await page.getByRole('button',{name:'撤销操作',exact:true}).click();await poll(doc=>editableCards(doc).length===3)
  await page.reload();await card('source').waitFor()
  await page.screenshot({path:join(output,'batch-deletion-restored.png'),animations:'disabled'})
  process.stdout.write(JSON.stringify({output,passed:true})+'\n')
} finally { await cleanup() }
