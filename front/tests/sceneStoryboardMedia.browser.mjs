import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closeCanvasDetails, closePrecheck, openCanvasCard, openReadyStoryboard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-media-')
const fixture = join(output, 'clip.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1',
  '-c:v', 'libx264', '-y', fixture])
const api = 'http://127.0.0.1:8328', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'storyboard-media-chapter', text = '前门的阿同拿着信封。后门的阿同等待。'
const base = studio + '/generation-canvases/' + project
const controls = api + '/test/runtime-controls'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE: fixture,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8328' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  const result = await response.json()
  return result.data ?? result
}

async function poll(read, predicate, description) {
  let current
  for (let attempt = 0; attempt < 160; attempt++) {
    current = await read()
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error(description + ' ' + JSON.stringify(current).slice(0, 1200))
}

try {
  await poll(async () => {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    return fetch(base).then(response => response.ok, () => false)
  }, Boolean, 'isolated backend did not start')
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: text })
  const chapterApi = `${studio}/projects/${project}/directing/chapters/${chapter}`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4328, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const projectUrl = `http://127.0.0.1:4328/projects/${project}`
  const chapters = projectUrl + '?tab=chapters'
  await page.goto(chapters)
  await page.getByRole('textbox', { name: '搜索章节' }).fill('候车')
  const chapterEntrance=page.locator(`[data-chapter-workbench="${chapter}"]`)
  await chapterEntrance.press('Enter')
  await page.getByRole('region', { name: '完整章节原文' }).waitFor()
  await page.getByRole('button', { name: '新建场次', exact: true }).click()
  await page.getByRole('textbox', { name: '新场次名称' }).fill('两人等候')
  await page.getByRole('radio', { name: '键盘／触屏选择', exact: true }).locator('xpath=ancestor::label').click()
  const selection=page.getByRole('textbox', { name: '键盘或触屏选择原文' })
  await selection.press('Home')
  await selection.press('Shift+End')
  await page.getByRole('button', { name: '创建场次', exact: true }).click()
  await page.getByRole('button', { name: '保存为新版本', exact: true }).click()
  const divisionPreview=page.getByRole('dialog', { name: '划分变更预览' })
  await divisionPreview.getByRole('button', { name: '保存本章划分', exact: true }).click()
  await divisionPreview.waitFor({ state: 'hidden' })
  const { sequences: [sequence] } = await request(chapterApi)
  const sceneApi = `${chapterApi}/sequences/${sequence.id}`
  assert.equal(sequence.source_text, text)
  const management = `${projectUrl}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  await page.goto(management.replace('step=storyboard','step=objects'))
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.locator('.ant-modal-confirm').filter({hasText:'确认提取对象？'}).getByRole('button',{name:'开始提取',exact:true}).click()
  const prepared = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const resourceImages=`${studio}/entities/character/object-browser-character/images`
  const originalImage=(await request(resourceImages)).items.find(image=>image.file_id==='object-browser-image')
  await request(`${resourceImages}/${originalImage.id}`,'PATCH',{is_primary:true})
  await prepared.getByRole('button',{name:'选用',exact:true}).click()
  const resourcePicker=page.getByRole('dialog',{name:'选用项目资源',exact:true})
  await resourcePicker.getByRole('button',{name:'选择已有角色',exact:true}).click()
  await resourcePicker.getByRole('button',{name:'确认选用',exact:true}).click()
  await prepared.getByRole('img',{name:'阿同已选参考图',exact:true}).waitFor()
  // 对象绑定整个资源；通过资源主图验证参考动态更新，再恢复原主图供媒体执行。
  const form=new FormData()
  form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'前门备用参考.png')
  form.append('project_id',project)
  const uploaded=await fetch(`${studio}/files/upload`,{method:'POST',body:form})
  assert.ok(uploaded.ok,await uploaded.clone().text())
  const uploadedFile=(await uploaded.json()).data
  const backup=await request(resourceImages,'POST',{file_id:uploadedFile.id,view_angle:'FRONT'})
  await request(`${resourceImages}/${backup.id}`,'PATCH',{is_primary:true})
  assert.equal((await request(sceneApi+'/objects')).objects[0].image_file_id,uploadedFile.id)
  await request(`${resourceImages}/${originalImage.id}`,'PATCH',{is_primary:true})
  await poll(() => request(sceneApi + '/objects'), result => result.objects[0].image_file_id === 'object-browser-image', 'resource primary reference did not update')

  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  const confirm = preview.getByRole('button', { name: '确认执行', exact: true })
  const warning = preview.getByRole('alert').filter({ hasText: 'CREATIVE_REFERENCE_IMAGE_MISSING' })
  const modelSettingsUrl = api + '/api/v1/llm/model-settings'
  const modelSettings = await request(modelSettingsUrl)
  let callCount = 0
  for (const [modality, modelName, outputTag, providerPath] of [
    ['image', '分镜测试图片模型', 'img', '/images/generations'],
    ['video', 'viduq2', 'video', '/text2video'],
  ]) {
    let defaultName
    if (modality === 'image') {
      defaultName = '已有图片分镜'
      await request(sceneApi + '/storyboards', 'POST', {
        request_id: 'existing-image-media', name: defaultName, mode: 'faithful', pending_modality: 'image',
      })
      await page.goto(management)
    } else {
      await page.goto(management)
      await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
      const config = page.getByRole('dialog', { name: '生成新分镜画布', exact: true })
      await config.getByText('忠实提取', { exact: true }).click()
      defaultName = await config.getByRole('textbox', { name: '画布名称' }).inputValue()
      assert.match(defaultName, /^分镜画布-\d{8}-\d{6}$/)
      await config.getByRole('button', { name: '下一步：确认生成', exact: true }).click()
      await config.getByRole('button', { name: '确认生成', exact: true }).click()
      await request(modelSettingsUrl, 'PUT', { ...modelSettings, default_video_model_id: 'story-video-model' })
    }
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: defaultName, exact: true }) })
    await card.getByText('分镜已就绪', { exact: true }).waitFor()
    assert.equal(page.url(), management)
    if (modality === 'image') {
      await page.getByRole('button', { name: '任务中心', exact: true }).click()
      await page.getByRole('button', { name: /^历\s*史$/ }).click()
      const taskRow = page.getByRole('row').filter({ hasText: '忠实提取分镜' })
      await taskRow.getByRole('button', { name: /查\s*看/ }).click()
      await page.getByRole('dialog', { name: '处理分镜提取结果', exact: true })
        .getByRole('button', { name: '应用并进入画布', exact: true }).click()
    } else await openReadyStoryboard(page, defaultName)
    await page.getByRole('region', { name: '生成画布工作台', exact: true }).waitFor()
    const canvas = base + '/' + new URL(page.url()).searchParams.get('canvas')
    const state = await poll(() => request(canvas), data => data.document.storyboard, 'storyboard was not saved')
    const { shots, objects } = state.document.storyboard
    if (modality === 'image') {
      const edited = '阿同继续拿着信封。'
      await openCanvasCard(page, shots[0].card_id)
      await page.getByRole('textbox', { name: '可见结果内容', exact: true }).fill(edited)
      await closeCanvasDetails(page)
      const noteSaved = row => row.document.cards.find(item => item.id === shots[0].card_id)?.visible_result?.text === edited
      await poll(() => request(canvas), noteSaved, 'edited storyboard did not auto-save')
      const opened = new URL(page.url())
      await page.getByRole('button', { name: '返回工作台管理', exact: true }).click()
      await card.getByText('当前定位', { exact: true }).waitFor()
      assert.equal(new URL(page.url()).searchParams.get('canvas'), opened.searchParams.get('canvas'))
      assert.equal(new URL(page.url()).searchParams.get('storyboardTask'), opened.searchParams.get('storyboardTask'))
      await card.getByRole('button', { name: defaultName, exact: true }).press('Enter')
      await page.getByRole('region', { name: '生成画布工作台', exact: true }).waitFor()
      assert.ok(noteSaved(await request(canvas)))
    }
    const assign = async (cardId, useDefault, beforeSave) => {
      const pending = state.document.cards.find(card => card.id === cardId)
      assert.equal(pending.type, 'model.' + modality)
      assert.equal(pending.model_id, null)
      const detail = await openCanvasCard(page, cardId)
      if (useDefault) {
        await detail.locator('.generation-material-model').getByText(modelName, { exact: true }).waitFor()
        if (modality === 'image') await detail.getByText('默认画幅', { exact: true }).waitFor()
      } else {
        const chooser = detail.getByRole('combobox', { name: '选择模型', exact: true })
        await chooser.click()
        const popupId = await chooser.getAttribute('aria-controls')
        assert.ok(popupId, 'the opened model chooser exposes its list ID')
        const popup = page.locator('.ant-select-dropdown').filter({ has: page.locator(`[id=${JSON.stringify(popupId)}]`) })
        await popup.locator('.ant-select-item-option').getByText(modelName, { exact: true }).click()
        assert.equal(await chooser.getAttribute('aria-expanded'), 'false')
      }
      await beforeSave?.()
      await poll(() => request(canvas), saved => {
        const model = saved.document.cards.find(card => card.id === cardId)
        return model?.model_id === `story-${modality}-model` && (modality !== 'video' || model.config?.ratio === '16:9')
      },
        'first model assignment was not saved')
    }
    const preparedModel = shots[0].model_card_ids[0]
    const shot = shots[1], cardId = shot.model_card_ids[0]
    if (modality === 'video') {
      const saveRoute = `**${new URL(canvas).pathname}`
      let allowSave
      const blockedSave = new Promise(resolve => { allowSave = resolve })
      const delaySave = async route => {
        if (route.request().method() === 'PUT') await blockedSave
        await route.continue()
      }
      await page.route(saveRoute, delaySave)
      try {
        await assign(cardId, true, async () => {
          assert.equal((await request(canvas)).document.cards.find(card => card.id === cardId).model_id, null)
          await closeCanvasDetails(page)
          assert.equal(await page.getByRole('button', { name: '重新提取', exact: true }).count(), 0)
          allowSave()
        })
      } finally {
        allowSave()
        await page.unroute(saveRoute, delaySave)
      }
      await request(modelSettingsUrl, 'PUT', modelSettings)
      await page.reload()
      await page.getByRole('region', { name: '生成画布工作台', exact: true }).waitFor()
    }
    await assign(preparedModel, modality === 'image')
    const preparedPreview = await request(canvas + '/precheck', 'POST', { card_id: preparedModel })
    assert.deepEqual(preparedPreview.input.media.map(media => media.file_id), ['object-browser-image'])
    if(modality==='image') {
      const frontReference=objects.find(item=>item.object_id===shots[0].object_ids[0]).reference_card_id
      const primarySourceKey=JSON.stringify([state.id,frontReference,'image',0])
      const primaryChoice=page.locator('.wb-details:visible').locator(`[data-reference-source=${JSON.stringify(primarySourceKey)}]`)
      await primaryChoice.getByRole('button',{name:/^取消采用 /}).click()
      await poll(()=>request(canvas),saved=>!saved.document.cards.find(card=>card.id===preparedModel).input_bindings.some(binding=>binding.source.card_id===frontReference),'valid reference was not unadopted')
      const withoutValidReference=await request(canvas+'/precheck','POST',{card_id:preparedModel})
      assert.equal(withoutValidReference.diagnostics.some(issue=>issue.code==='CREATIVE_REFERENCE_IMAGE_MISSING'&&issue.target.card_id===frontReference),false,'an available dynamic main image is not an empty placeholder')
      await primaryChoice.getByRole('button',{name:/^采用 /}).click()
      await poll(()=>request(canvas),saved=>saved.document.cards.find(card=>card.id===preparedModel).input_bindings.some(binding=>binding.source.card_id===frontReference),'valid reference was not restored')

    }
    const preparedEditor=page.locator('.wb-details:visible')
    const missingAttribute=modality==='video'?'data-input-binding-id':'data-reference-source'
    const cancelName=modality==='video'?/^取消主体图片 /:/^取消采用 /
    const missingRows=preparedEditor.locator(`[${missingAttribute}]`).filter({hasText:'来源输出缺失'}).filter({has:page.getByRole('button',{name:cancelName})})
    const missingCount=(await request(canvas+'/precheck','POST',{card_id:preparedModel})).diagnostics.filter(issue=>issue.code==='OUTPUT_MISSING').length
    for(let index=0;index<missingCount;index++) {
      await missingRows.first().waitFor()
      const identity=await missingRows.first().getAttribute(missingAttribute)
      const cancel=preparedEditor.locator(`[${missingAttribute}=${JSON.stringify(identity)}]`).getByRole('button',{name:cancelName})
      await cancel.click()
      await cancel.waitFor({state:'hidden'})
    }
    await poll(async()=>{const result=await request(canvas+'/precheck','POST',{card_id:preparedModel});return {can_run:result.can_run,diagnostics:result.diagnostics}},result=>result.can_run,'prepared shot still has an adopted empty input')
    await closeCanvasDetails(page)

    if (modality === 'image') {
      await assign(cardId, true)
      await closeCanvasDetails(page)
    }
    const { reference_card_id: referenceId } = objects.find(item => item.object_id === shot.object_ids[0])
    assert.equal(state.document.cards.find(card => card.id === referenceId).image_binding, null)
    // 动态对象出口保留已采用关系；空出口必须先显式取消采用，才能按无创作参考继续。
    const missingReference=state.document.cards.find(card=>card.id===referenceId)
    const missingPrecheck=await request(canvas+'/precheck','POST',{card_id:cardId})
    assert.ok(missingPrecheck.diagnostics.some(issue=>issue.code==='OUTPUT_MISSING'))
    const missingEditor=await openCanvasCard(page,cardId)
    if(modality==='video') {
      const missingBinding=(await request(canvas)).document.cards.find(card=>card.id===cardId).input_bindings.find(binding=>binding.source.card_id===referenceId)
      await missingEditor.locator(`[data-input-binding-id=${JSON.stringify(missingBinding.id)}]`).getByRole('button',{name:/^取消主体图片 /}).click()
    } else await missingEditor.locator('[data-reference-source]').filter({hasText:missingReference.name}).getByRole('button',{name:/^取消采用 /}).click()
    await poll(()=>request(canvas),saved=>!saved.document.cards.find(card=>card.id===cardId).input_bindings.some(binding=>binding.source.card_id===referenceId),'empty adopted reference was not removed')
    await closeCanvasDetails(page)

    const readRuntime = () => request(canvas + '/runtime')
    const videoAction = (id, name = '生成视频') => page.locator(`[data-card-id="${id}"]`).getByRole('button', { name, exact: true })
    if (modality === 'video') {
      const workbenchUrl = page.url()
      const ordinary = projectUrl + '/generation-canvas?canvas='
      const openOrdinary = async (id, modelId) => {
        await page.goto(ordinary + id)
        await page.locator(`[data-card-id="${modelId}"]`).waitFor()
        assert.equal(await videoAction(modelId).count(), 0, 'ordinary entrance has no storyboard card-face action')
        const detail = await openCanvasCard(page, modelId)
        await detail.getByRole('button', { name: '预检运行', exact: true }).click()
        await preview.waitFor()
        await closePrecheck(page)
        await closeCanvasDetails(page)
      }
      await openOrdinary(state.id, cardId)
      const free = await request(base, 'POST', { name: '独立视频画布' })
      free.document.cards = [{ id: 'free-video', type: 'model.video', model_id: 'story-video-model',
        config: { ratio: '16:9', seconds: 5 }, prompt: { segments: [{ id: 'text', kind: 'text', text: '独立视频' }] } }]
      await request(base + '/' + free.id, 'PUT', { request_id: 'configure-free-video',
        expected_revision: free.revision, document: free.document })
      await openOrdinary(free.id, 'free-video')
      await page.goto(workbenchUrl)
      await videoAction(cardId).press('Enter')
      await warning.waitFor()
      await closePrecheck(page)
      assert.deepEqual((await readRuntime()).runs, [])
      assert.equal((await request(controls)).media_calls.length, callCount)
    }
    const precheck = async (actionName = '生成视频') => {
      if (modality === 'video') {
        await closeCanvasDetails(page)
        await videoAction(cardId, actionName).press('Enter')
        await warning.waitFor()
        assert.equal(await page.locator('.wb-details:visible').count(), 0, 'the video action does not open the card editor')
        return
      }
      const detail = await openCanvasCard(page, cardId)
      await detail.getByRole('button', { name: '预检运行', exact: true }).click()
      await warning.waitFor()
      return detail
    }
    const detail = await precheck()
    assert.equal(await warning.count(), 1)
    assert.match(await warning.textContent(), /尚未选择创作参考图.*阻止：无/)
    assert.equal(await confirm.isEnabled(), true)
    await warning.getByRole('button', { name: '定位问题', exact: true }).click()
    await preview.waitFor({ state: 'hidden' })
    const badge = page.locator(`[data-card-id="${referenceId}"]`).getByRole('button', { name: '查看卡片问题', exact: true })
    await badge.press('Enter')
    const issues = page.getByRole('region', { name: '卡片问题', exact: true })
    await issues.getByText(/尚未选择创作参考图/).waitFor()
    await page.keyboard.press('Escape')
    await precheck()
    assert.deepEqual((await readRuntime()).runs, [])
    assert.equal((await request(controls)).media_calls.length, callCount)

    const submit = async () => {
      const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
      await confirm.click()
      const response = await accepted
      assert.ok(response.ok(), await response.text())
      const { run_id: id } = (await response.json()).data
      await closePrecheck(page)
      return id
    }
    const run = async (expected, afterSubmit) => {
      const id = await submit()
      await afterSubmit?.()
      const result = await poll(readRuntime, data => data.runs.some(item => item.id === id && item.lifecycle === 'finished'), 'media run did not finish')
      const { nodes } = result.runs.find(item => item.id === id)
      assert.equal(nodes.length, 1)
      const node = nodes[0]
      assert.equal(node.status, expected, JSON.stringify(node))
      assert.equal(node.card_id, cardId)
      assert.deepEqual(node.basis.input.media, [])
      const calls = (await request(controls)).media_calls
      assert.equal(calls.length, ++callCount)
      const call = calls.at(-1)
      assert.ok(call.path.endsWith(providerPath), call.path)
      assert.match(call.body.prompt, /后门的阿同等待/)
      assert.ok(!('images' in call.body) && !('subjects' in call.body))
      return { id, result, node }
    }

    const observeActiveVideoCards = async () => {
      const running = videoAction(cardId, '运行中')
      try {
        await running.waitFor({ timeout: 4000 })
        assert.equal(await running.isDisabled(), true)
        assert.equal(await videoAction(preparedModel).isEnabled(), true, 'an active run does not disable another card')
        await videoAction(preparedModel).press('Enter')
        const queuedId = await submit()
        const queued = videoAction(preparedModel, '排队中')
        await queued.waitFor()
        assert.equal(await queued.isDisabled(), true)
        assert.equal(await running.isDisabled(), true, 'another queued run does not change this card')
        const queuedRun = (await readRuntime()).runs.find(item => item.id === queuedId)
        assert.equal(queuedRun.nodes[0].status, 'queued')
        await request(`${canvas}/runs/${queuedId}/cancel`, 'POST')
      } finally {
        await request(controls, 'POST', { media_hold: false })
      }
    }
    if (modality === 'video') await request(controls, 'POST', { media_hold: true })
    const success = await run('succeeded', modality === 'video' ? observeActiveVideoCards : undefined)
    const file = success.node.outputs[0].file_id
    assert.ok(file)
    assert.deepEqual(Object.keys(success.result.current_outputs).filter(key => success.result.current_outputs[key].some(output => output.result_set_id)), [cardId])
    if (modality === 'video') await videoAction(cardId, '再次生成').waitFor({ timeout: 4000 })
    const resultDetail = detail || await openCanvasCard(page, cardId)
    const formal = resultDetail.getByRole('region', { name: '当前正式输出', exact: true })
    await formal.locator(outputTag).waitFor()
    if (modality === 'video') {
      await formal.locator('video').evaluate(async video => { video.muted = true; await video.play() })
    }
    await request(controls, 'POST', { media_fail_next: true })
    await precheck('再次生成')
    const failure = await run('failed')
    assert.equal(failure.result.current_outputs[cardId][0].file_id, file)
    if (modality === 'video') {
      await videoAction(cardId, '重试生成').waitFor({ timeout: 4000 })
      assert.equal(await page.locator(`[data-card-id="${cardId}"] video`).count(), 1, 'the last successful video stays on the card')
      await precheck('重试生成')
      assert.equal((await request(controls)).media_calls.length, callCount, 'retry waits for explicit confirmation')
      await run('succeeded')
    }
    await closeCanvasDetails(page)
    await page.getByRole('button', { name: '运行历史', exact: true }).click()
    const history = page.getByRole('region', { name: '画布运行历史', exact: true })
    for (const [result, label] of [[success, '完整成果'], [failure, '未完成成果，未替换原正式输出']]) {
      const record = history.locator(`[data-history-run="${result.id}"]`)
      await record.locator(':scope > summary').click()
      await record.getByText(label, { exact: label.startsWith('未完成') }).waitFor()
      await record.getByText('本次实际输入与模型参数', { exact: true }).click()
      assert.match(await record.getByRole('region', { name: '历史实际输入' }).textContent(), /后门的阿同等待/)
      if (result === failure) await record.getByRole('alert').waitFor()
    }

    if (modality === 'video') {
      const current = await request(canvas)
      const model = current.document.cards.find(card => card.id === cardId)
      model.prompt.segments.push({ id: 'required-frame', kind: 'instruction', command: '首帧参考', references: [] })
      await request(canvas, 'PUT', { request_id: 'explicit-required-frame', expected_revision: current.revision, document: current.document })
      await page.reload()
      await precheck('再次生成')
      await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_REFERENCE_REQUIRED' }).waitFor()
      assert.equal(await confirm.isDisabled(), true)
      assert.equal((await readRuntime()).runs.filter(item => item.nodes.some(node => node.card_id === cardId)).length, 3)
      assert.equal((await request(controls)).media_calls.length, callCount)
    }
  }
  await page.getByRole('button', { name: '返回工作台管理', exact: true }).click()
  await page.getByRole('button', { name: '返回章节列表', exact: true }).click()
  await page.waitForURL(chapters)
  assert.equal(await page.getByRole('textbox', { name: '搜索章节' }).inputValue(), '候车')
  await chapterEntrance.and(page.locator(':focus')).waitFor()
  console.log('scene storyboard media browser passed', output)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  if (backend.exitCode === null) await request(controls, 'POST', { disconnect: true }).catch(() => {})
  await cleanup()
}
