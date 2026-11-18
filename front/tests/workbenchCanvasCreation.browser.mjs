import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-workbench-create-')
const api = 'http://127.0.0.1:8386', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'workbench-create'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8386' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const data = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(`${studio}/generation-canvases`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await data(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '创建画布', raw_text: raw })
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const source = await data(chapterApi)
  const scene = await data(chapterApi + '/sequences', 'POST', {
    title: '候车', position: 0, source_version: source.source_version, span: { start: 0, end: raw.length },
  })
  const sceneApi = chapterApi + '/sequences/' + scene.id
  await data(sceneApi + '/objects/extractions', 'POST', { request_id: 'creation-objects' })
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = await data(sceneApi + '/objects')
    if (result.task?.status === 'succeeded') break
    await delay(100)
  }
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4386, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(13000)
  const location = 'http://127.0.0.1:4386/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + scene.id + '&step=storyboard'
  const probe=await context.newPage()
  let analysisCalls=0
  await probe.route('**/analyze',async route=>{analysisCalls++;await route.fulfill({status:503,json:{detail:'隔离确认测试'}})})
  await probe.goto(location.replace('step=storyboard','step=division'))
  await probe.getByRole('button',{name:'智能划分',exact:true}).click()
  const analysisConfirmation=probe.locator('.ant-modal-confirm').filter({hasText:'确认智能划分？'})
  await analysisConfirmation.getByRole('button',{name:/^取\s*消$/}).click()
  assert.equal(analysisCalls,0)
  await probe.getByRole('button',{name:'智能划分',exact:true}).click()
  await analysisConfirmation.getByRole('button',{name:'开始划分',exact:true}).click()
  await probe.getByText('隔离确认测试',{exact:true}).waitFor()
  assert.equal(analysisCalls,1)
  await probe.close()
  const start = page.getByRole('button', { name: '生成新分镜画布', exact: true })
  const form = page.getByRole('dialog', { name: '生成新分镜画布', exact: true })
  const name = form.getByRole('textbox', { name: '画布名称' })
  const openDivision = page.getByRole('navigation', { name: '制作步骤' }).getByRole('button', { name: /场次划分/ })
  const returnToProduction = page.getByRole('navigation', { name: '制作步骤' }).getByRole('button', { name: /分镜画布/ })
  const list = page.getByRole('list', { name: '本场画布' })

  await page.goto(location)
  assert.equal(await page.getByRole('button', { name: '新建空白画布', exact: true }).count(), 0)
  await page.getByRole('button', { name: '画布更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建空白画布', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.route('**/storyboards/basis',async route=>{const response=await route.fetch();const body=await response.json();body.data.source_text=body.data.source_text.repeat(100);body.data.objects=['ready','missing','unassociated','unavailable'].map((state,index)=>({id:String(index),name:'状态对象'+index,kind:'character',excerpt:'测试',asset_id:index<2?'asset':null,asset_name:index<2?'资源':null,reference_state:state,reference_unavailable:state==='unavailable'}));await route.fulfill({json:body})},{times:1})
  await start.click()
  await form.getByText('后门的阿同等待。', { exact: false }).waitFor()
  await form.getByText('本次采用的对象（4）',{exact:true}).click()
  for (const state of ['主图可用','缺少可用主图','未选用资源','已选用资源不可用']) assert.ok((await form.locator('li').filter({hasText:state}).count())>0)
  assert.equal(await form.locator('.management-storyboard-basis img').count(),0)
  await form.getByRole('button',{name:'查看对象参考',exact:true}).waitFor()
  await form.getByText('本次采用的对象（4）',{exact:true}).click()
  assert.match(await name.inputValue(), /^分镜画布-\d{8}-\d{6}$/)
  assert.ok(await form.getByRole('radio', { name: '自动产出完整分镜' }).isChecked())
  assert.equal(await form.getByRole('radio', { name: /^(图片|视频)模型卡$/ }).count(), 0)
  assert.equal(await form.getByRole('combobox', { name: '生产模型' }).count(), 0)
  await page.setViewportSize({width:375,height:768})
  await form.evaluate(node=>Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))))
  await form.getByText('展开全文',{exact:true}).click()
  const longFit=await form.evaluate(node=>{const body=node.querySelector('.ant-modal-body'),header=node.querySelector('.ant-modal-header'),footer=node.querySelector('.ant-modal-footer');const top=header.getBoundingClientRect().top,bottom=footer.getBoundingClientRect().bottom;body.scrollTop=body.scrollHeight;return body.scrollTop>0&&header.getBoundingClientRect().top===top&&footer.getBoundingClientRect().bottom===bottom&&document.documentElement.scrollHeight<=innerHeight+1})
  assert.equal(longFit,true)
  await page.screenshot({path:join(output,'configuration-long-mobile.png'),animations:'disabled'})
  const visibleEdges=await form.evaluate(node=>({top:node.querySelector('.ant-modal-header').getBoundingClientRect().top,bottom:node.querySelector('.ant-modal-footer').getBoundingClientRect().bottom}))
  assert.ok(visibleEdges.top>=15)
  assert.ok(visibleEdges.bottom<=768,JSON.stringify(visibleEdges))
  await page.setViewportSize({width:1366,height:900})
  await form.getByRole('button',{name:'取消',exact:true}).click()
  await openDivision.click()
  await page.waitForURL(url => url.searchParams.get('step') === 'division')
  await returnToProduction.click()
  await start.click()
  await name.fill('更改后可保留')
  await form.getByRole('button',{name:'取消',exact:true}).click()
  const discard = page.getByRole('dialog', { name: '有未提交的配置' })
  await discard.getByRole('button', { name: '继续填写' }).click()
  await discard.waitFor({state:'hidden'})
  assert.equal(await name.inputValue(), '更改后可保留')
  await form.getByRole('button',{name:'取消',exact:true}).focus()
  await page.keyboard.press('Escape')
  await discard.getByRole('button', { name: '放弃配置' }).click()
  await start.click()
  const defaultName = await name.inputValue()
  const productionLocation = page.url()
  await form.getByText('后门的阿同等待。', { exact: false }).waitFor()
  await page.screenshot({ path: join(output, 'configuration.png') })
  for(const [width,height] of [[1366,900],[1024,440],[375,768]]) {
    await page.setViewportSize({width,height})
    const fit=await form.evaluate(node=>{const body=node.querySelector('.ant-modal-body'),footer=node.querySelector('.ant-modal-footer').getBoundingClientRect();return getComputedStyle(body).overflowY==='auto'&&body.scrollWidth<=body.clientWidth+1&&footer.bottom<=innerHeight&&document.documentElement.scrollHeight<=innerHeight+1})
    assert.equal(fit,true)
    await page.screenshot({path:join(output,`configuration-${width}-${height}.png`),animations:'disabled'})
  }
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await form.isVisible(),true)
  await page.screenshot({ path: join(output, 'configuration-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1366, height: 900 })
  let original
  await page.route('**/storyboards', async route => {
    original = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await form.getByRole('button',{name:'下一步：确认生成',exact:true}).click()
  await form.getByRole('button',{name:'返回配置',exact:true}).click()
  assert.equal(await name.inputValue(),defaultName)
  assert.equal(original,undefined)
  await form.getByRole('button',{name:'下一步：确认生成',exact:true}).click()
  await form.getByRole('button',{name:'确认生成',exact:true}).click()
  const verify = page.getByRole('button', { name: '核实提交' })
  await verify.waitFor()
  await page.reload()
  await verify.waitFor()
  const replay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/storyboards'))
  await verify.click()
  assert.deepEqual((await replay).postDataJSON(), original)
  await list.getByRole('heading', { name: defaultName }).waitFor()
  assert.equal((await data(sceneApi + '/canvases')).canvases.length, 1)
  assert.equal(original.mode, 'complete')
  assert.equal(original.production_model_id, undefined)
  assert.equal(original.pending_modality, 'video')
  assert.equal(page.url(), productionLocation)

  await start.click()
  await name.fill('忠实方案')
  await form.getByRole('radio', { name: '忠实提取' }).check()
  await form.getByRole('button',{name:'下一步：确认生成',exact:true}).click()
  let subsequentBasisReads = 0
  await page.route('**/storyboards/basis',async route=>{subsequentBasisReads++;await route.continue()})
  await page.route('**/storyboards',route=>route.fulfill({status:409,json:{detail:'依据已变'}}),{times:1})
  await form.getByRole('button',{name:'确认生成',exact:true}).click()
  await form.getByText('依据已变化，请关闭后重新打开核对。',{exact:true}).waitFor()
  assert.equal(await name.inputValue(),'忠实方案')
  assert.equal(await form.getByRole('radio',{name:'忠实提取'}).isChecked(),true)
  assert.equal(subsequentBasisReads,0)
  assert.equal(await form.getByRole('button',{name:'重新读取依据',exact:true}).count(),0)
  await form.getByRole('button',{name:'取消',exact:true}).click()
  await discard.getByRole('button',{name:'放弃配置',exact:true}).click()
  await start.click()
  await name.fill('忠实方案')
  await form.getByRole('radio',{name:'忠实提取'}).check()
  await form.getByRole('button',{name:'下一步：确认生成',exact:true}).click()
  assert.equal(subsequentBasisReads,1)
  await page.route('**/storyboards',route=>route.fulfill({status:422,json:{detail:'配置验证失败'}}),{times:1})
  await form.getByRole('button',{name:'确认生成',exact:true}).click()
  await form.getByText('配置验证失败',{exact:true}).waitFor()
  await form.getByRole('button',{name:'返回配置',exact:true}).click()
  assert.equal(await name.inputValue(),'忠实方案')
  const faithful = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/storyboards'))
  await form.getByRole('button',{name:'下一步：确认生成',exact:true}).click()
  await form.getByRole('button',{name:'确认生成',exact:true}).click()
  const payload = (await faithful).postDataJSON()
  assert.equal(payload.mode, 'faithful')
  assert.equal(payload.production_model_id, undefined)
  assert.equal(payload.pending_modality, 'video')
  await list.getByRole('heading', { name: '忠实方案' }).waitFor()
  await data(api + '/test/runtime-controls', 'POST', { storyboard_release: 2 })
  for (const canvasName of [defaultName, '忠实方案']) {
    const card = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: canvasName, exact: true }) })
    await card.getByText('分镜已就绪', { exact: true }).waitFor()
  }
  const tasks = await data(sceneApi + '/storyboards')
  assert.equal(tasks.length, 2)
  for (const task of tasks) {
    const result = await data(sceneApi + '/storyboards/' + task.task_id)
    const modelCards = result.candidate.document.cards.filter(card => card.type.startsWith('model.'))
    assert.ok(modelCards.length > 0)
    assert.ok(modelCards.every(card => card.type === 'model.video' && card.model_id === null))
  }
  await start.click()
  await name.fill('恢复冲突配置')
  await form.getByRole('radio',{name:'忠实提取'}).check()
  await form.getByRole('button',{name:'下一步：确认生成',exact:true}).click()
  await page.route('**/storyboards',route=>route.abort('failed'),{times:1})
  await form.getByRole('button',{name:'确认生成',exact:true}).click()
  await verify.waitFor()
  await page.reload()
  await verify.waitFor()
  await page.route('**/storyboards',route=>route.fulfill({status:409,json:{detail:'依据已变'}}),{times:1})
  await verify.click()
  await name.waitFor()
  assert.equal(await name.inputValue(),'恢复冲突配置')
  assert.equal(await form.getByRole('radio',{name:'忠实提取'}).isChecked(),true)
  await form.getByRole('button',{name:'取消',exact:true}).click()
  await discard.getByRole('button',{name:'放弃配置',exact:true}).click()
  await page.getByRole('button', { name: '画布更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建空白画布', exact: true }).click()
  const blank = page.getByRole('dialog', { name: '新建空白画布', exact: true })
  await blank.getByRole('textbox', { name: '画布名称' }).fill('空白方案')
  await blank.getByRole('button', { name: '创建画布' }).click()
  await list.getByRole('heading', { name: '空白方案' }).waitFor()
  const summaries = (await data(sceneApi + '/canvases')).canvases
  assert.equal(summaries.length, 3)
  const row = summaries.find(item => item.name === '空白方案')
  const document = (await data(`${studio}/generation-canvases/${row.id}?project_id=${project}`)).document
  assert.deepEqual(document.cards.map(card => card.type), ['content.basis'])
  assert.equal(page.url(), productionLocation)
  await openDivision.click()
  await page.waitForURL(url => url.searchParams.get('step') === 'division')
} finally {
  if (backend.exitCode === null) {
    await data(api + '/test/runtime-controls', 'POST', { disconnect: true, storyboard_release: 100 }).catch(() => {})
  }
  await cleanup()
}
