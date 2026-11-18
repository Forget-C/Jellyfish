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
const output = await browserOutput('jellyfish-sound-reference-')
const api = 'http://127.0.0.1:8289', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8289' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4289, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = await createStoryboardCanvas(base, '命名图片参考')

  const bytes = Buffer.alloc(44 + 160000)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(8000,24); bytes.writeUInt32LE(16000,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(160000,40)
  const upload = new FormData(); upload.append('project_id','canvas-project'); upload.append('usage_kind','generation_upload'); upload.append('file',new Blob([bytes],{type:'audio/wav'}),'reference.wav')
  const response = await fetch(`${api}/api/v1/studio/files/upload`,{method:'POST',body:upload}); assert.ok(response.ok,await response.clone().text()); const file=(await response.json()).data
  const document={...canvas.document,cards:[{id:'audio',type:'content.audio',file_id:file.id},{id:'dialogue',type:'direction.dialogue',dialogue_id:'line',content:{text:'等等',authorship:'user'}}],edges:[{id:'audio-edge',source_card:'audio',source_port:'audio',target_card:'dialogue',target_port:'audio_example'}],input_order:{dialogue:{audio_example:['audio-edge']}}}
  const seeded=await fetch(storyboardCanvasApi(base, canvas.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document: withFixedSource(canvas, document)})}); assert.ok(seeded.ok,await seeded.text())
  await page.goto(`http://127.0.0.1:4289${storyboardCanvasPath(canvas)}`)
  await openCanvasCard(page,'dialogue')
  const detail=page.locator('.wb-details:not([hidden])')
  assert.equal(await detail.getByText('对白版本',{exact:true}).count(),0)
  assert.equal(await detail.getByText('直接素材参考',{exact:true}).count(),0)
  await detail.locator('[data-design-source]').first().click()
  const popup=page.locator('.design-source-inspect:visible')
  await popup.getByRole('button',{name:'设为本地参考',exact:true}).click()
  const read=async()=> (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  const poll=async predicate=>{for(let i=0;i<100;i++){const state=await read();if(predicate(state))return state;await delay(150)}throw Error('save timeout')}
  const references=state=>state.document.cards.find(card=>card.id==='dialogue').examples
  await poll(state=>references(state).length===1)
  await popup.getByRole('spinbutton',{name:'参考起点秒',exact:true}).fill('3')
  await popup.getByRole('spinbutton',{name:'参考终点秒',exact:true}).fill('8')
  assert.equal(references(await read())[0].start_ms,null)
  await popup.getByRole('button',{name:'应用区间',exact:true}).click()
  await poll(state=>references(state)[0].start_ms===3000&&references(state)[0].end_ms===8000)
  await detail.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(state=>references(state)[0].start_ms==null)
  if (!await popup.isVisible()) await detail.locator('[data-design-source]').first().click()
  await page.waitForFunction(() => document.querySelector('input[aria-label="参考起点秒"]')?.value === '')
  await popup.getByRole('button',{name:'新增一份参考',exact:true}).click()
  await poll(state=>references(state).length===2)
  await popup.getByRole('button',{name:'取消本地参考',exact:true}).click()
  await poll(state=>references(state).length===1)
  await popup.getByRole('button',{name:'设为本地参考',exact:true}).click()
  assert.equal(references(await read()).length,1)
  await popup.getByRole('button',{name:'取消本地参考',exact:true}).click()
  await poll(state=>references(state).length===0)
  assert.equal((await read()).document.edges.length,1)
  await popup.getByRole('button',{name:'设为本地参考',exact:true}).click()
  await poll(state=>references(state).length===1)
  assert.equal(references(await read())[0].start_ms,null)
  await page.screenshot({path:join(output,'sound-reference-desktop.png')})
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:join(output,'sound-reference-mobile.png')})
  await page.setViewportSize({width:1440,height:1000})
  await page.reload()
  await openCanvasCard(page,'dialogue')
  const relation = detail.getByRole('textbox',{name:'声画关系说明内容',exact:true})
  const note = '画外说话，画面保持在听者身上'
  const savedRelation = state => state.document.cards.find(card=>card.id==='dialogue').audiovisual_relation
  await relation.fill(note)
  await poll(state=>savedRelation(state)?.text===note)
  await page.reload()
  await openCanvasCard(page,'dialogue')
  await relation.getByText(note,{exact:true}).waitFor()
  await relation.fill('')
  await poll(state=>savedRelation(state)?.state==='empty' && !savedRelation(state).text?.trim())
  console.log('Sound reference adoption and dialogue audiovisual relation save, reopen and clear passed:',output)
} finally { await cleanup() }
