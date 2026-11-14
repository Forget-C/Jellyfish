import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-asset-detail-')
const origin = 'http://127.0.0.1:4810'
const server = await createServer({ root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4810, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
const types = [['actor', 'actors', '演员'], ['scene', 'scenes', '场景'], ['prop', 'props', '道具'], ['costume', 'costumes', '服装']]
const assets = Object.fromEntries(types.map(([type, , label]) => [type, { id: 'a1', name: label + '档案', supplementary_info: '原始描述', tags: [], view_count: 1, visual_style: '现实', style: '真人都市' }]))
const slots = Object.fromEntries(types.map(([type]) => [type, [{ id: 1, view_angle: 'FRONT', file_id: type === 'scene' ? 'landscape' : 'portrait' }]]))
assets.character = { id:'a1', name:'项目角色档案', description:'角色简介', visual_style:'现实', style:'真人都市' }
slots.character = [{id:1,view_angle:'FRONT',file_id:'portrait'}]
let failSave = false, failSlot = false, failImages = false, failAsset = false, missingAsset = false
let failDefault = false, completeEdit = false, editTarget
let adoptions = 0
let generationStatus, statusReads = 0, generationCalls = 0
let submittedModel, submittedReferences
  const submittedAngles=[]
  let partialGeneration=false
let parameterMode='none'
let patches = 0
let detectionStatus, cancelFails = true, cancelRequested = false, cancelCalls = 0
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', error => {errors.push(error.message); console.error(error.message)})
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data } })
    const list = items => respond({ items, pagination: { total: items.length, page: 1, page_size: 100 } })
    const fail = () => route.fulfill({ status: 503, json: { detail: '测试失败' } })
    if (path.endsWith('/files/broken/download')) return route.fulfill({ status: 404 })
    if (/\/files\/(portrait|new-portrait|history|landscape)\/download$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${path.includes('landscape') ? 960 : 240}" height="480"><rect width="100%" height="100%" fill="#6f91b5"/></svg>` })
    if (path.endsWith('/analyze-character-portrait-async')) {
      detectionStatus = 'running'
      cancelRequested = false
      return respond({ task_id: 'detect', status: detectionStatus })
    }
    if (path.endsWith('/film/tasks/detect/status')) return respond({ task_id: 'detect', status: detectionStatus, stage: '', progress: 0, cancel_requested: cancelRequested })
    if (path.endsWith('/film/tasks/detect/cancel')) {
      cancelCalls++
      if (cancelFails) return fail()
      cancelRequested = true
      return respond({ task_id: 'detect', status: detectionStatus, cancel_requested: true, effective_immediately: false })
    }
    if (path.endsWith('/film/tasks/detect/result')) return respond({ status: detectionStatus })
    if (path.endsWith('/generation-prompts/assets/actor/a1/slots/1/render')) return respond({ render_id: 'render-1', execution_prompt: '生成演员测试图', variables_snapshot: {}, recommended_media: { references: [] } })
    if (path.endsWith('/generation-tasks/actors/a1/slots/1/tasks')) {
      generationCalls++
      generationStatus = 'running'
      return respond({ task_id: 'generated' })
    }
    if (path.endsWith('/film/tasks/generated/status')) { statusReads++; return fail() }
    if (path.endsWith('/film/tasks')) {
      const target = new URL(request.url()).searchParams.get('target_type')
      if (target?.includes('analysis')) return respond({ items: [], next_cursor: null })
      if (generationStatus === 'succeeded') slots.actor[0].file_id = 'new-portrait'
      return respond({ items: generationStatus ? [{ task_id: 'generated', status: generationStatus, stage: '', task_kind: 'image', title: '图片生成', source: { kind: 'actor', id: 'a1', title: '演员' }, target_type: 'actor_image_slot', target_id: '1', created_at_ts: 1, updated_at_ts: 2 }] : [], next_cursor: null })
    }
    if (path.endsWith('/model-settings')) return respond({default_image_model_id:'default-image'})
    if (path.endsWith('/llm/models')) return list([{id:'default-image',name:'默认图片模型',category:'image'}, {id:'alternate-image',name:'备选图片模型',category:'image'}])
    if (path.endsWith('/llm/models/default-image')) return respond({id:'default-image',name:'默认图片模型'})
    if (path.endsWith('/generation-prompts/assets/draft/render')) return respond({render_id:'draft', execution_prompt:'演员草稿预览',variables_snapshot:{},recommended_media:{references:[]}})
    if (/generation-tasks\/actors\/a1\/slots\/\d+\/tasks$/.test(path)) { submittedModel=request.postDataJSON().model_id; submittedReferences=request.postDataJSON().asset_references; const slot=slots.actor.find(row=>String(row.id)===path.split('/').at(-2)); submittedAngles.push(slot.view_angle); if(completeEdit) { editTarget=slot; assert.equal(request.postDataJSON().operation_input.save_as_candidate,false); slot.file_id='history'; return respond({task_id:'edited'}) }; return partialGeneration && slot.view_angle==='FRONT' ? respond({task_id:'partial-front'}) : fail() }
    if (path.endsWith('/film/tasks/partial-front/status')) return respond({task_id:'partial-front',status:'succeeded'})
    if (/generation-prompts\/assets\/actor\/a1\/slots\/\d+\/render$/.test(path)) return respond({render_id:'final',execution_prompt:'演员生成提示词',variables_snapshot:{},recommended_media:{references:[]}})
    if (path.includes('/tasks/actor-images/')) {
      if(parameterMode==='failure') return fail()
      if(parameterMode==='none') return respond(null)
      const id=Number(path.split('/').at(-2))
      if(id===1) await new Promise(resolve=>setTimeout(resolve,250))
      return respond({task_id:'history-'+id,created_at_ts:1700000000,model_name:'历史模型 '+id,view_angle:'正面',reference_count:2,parameters:{lighting_instruction:'当时柔光'},execution_prompt:'历史提示词 '+id})
    }
    if (path.endsWith('/film/tasks/edited/status')) return respond({task_id:'edited', status:'succeeded'})
    if (path.endsWith('/style-options')) return respond({ visual_styles: ['现实', '动漫'], styles: ['真人都市'] })
    if (/\/entities\/actor\/a1\/images\/\d+$/.test(path) && request.method() === 'PATCH' && request.postDataJSON().is_view_default) {
      if(failDefault) return fail()
      const row=slots.actor.find(image=>String(image.id)===path.split('/').at(-1))
      slots.actor.filter(image=>image.view_angle===row.view_angle).forEach(image=>image.is_view_default=image.id===row.id)
      return respond(row)
    }
    if (path.endsWith('/entities/actor/a1/images/1') && request.method() === 'PATCH') {
      adoptions++
      Object.assign(slots.actor[0], request.postDataJSON())
      return respond(slots.actor[0])
    }
    const match = path.match(/\/entities\/(actor|scene|prop|costume|character)\/a1(\/images)?$/)
    if (match) {
      const [, type, images] = match
      if (images) {
        if (request.method() === 'POST') {
          if (failSlot) return fail()
          const row = { id: slots[type].length + 1, ...request.postDataJSON() }
          slots[type].push(row)
          return respond(row)
        }
        return failImages ? fail() : list(slots[type])
      }
      if (request.method() === 'PATCH') {
        patches++
        if (failSave) return fail()
        Object.assign(assets[type], request.postDataJSON())
        return respond(assets[type])
      }
      if (failAsset) return fail()
      if (missingAsset) return route.fulfill({ status: 404, json: { detail: '资产不存在' } })
      return respond(assets[type])
    }
    if (path.endsWith('/film/tasks/outputs')) return respond({ items: [{ task_id: 'old', ordinal: 1, file_id: 'history' }], next_cursor: null })
    return list([])
  })
  await page.goto(origin + '/assets/actors/a1/edit')
  const name = page.getByRole('textbox', { name: '名称', exact: true })
  await name.waitFor()
  assert.equal(await page.locator('.actor-feature-image').count(), 1)
  const save = page.getByRole('button', { name: '保存设定', exact: true })
  await page.getByRole('button',{name:'查看多角度图片',exact:true}).click()
  await page.getByRole('dialog',{name:'图片集合',exact:true}).waitFor()
  await page.getByRole('dialog',{name:'图片集合',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
  await name.fill('修改后的演员')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  const leave = page.getByRole('dialog', { name: '离开资产详情', exact: true })
  await leave.getByRole('button', { name: '继续编辑', exact: true }).and(page.locator(':focus')).waitFor()
  await page.keyboard.press('Escape')
  await leave.waitFor({ state: 'hidden' })
  assert.equal(await name.inputValue(), '修改后的演员')
  failSave = true
  await save.click()
  await page.getByRole('alert').filter({ hasText: '测试失败' }).waitFor()
  assert.equal(await name.inputValue(), '修改后的演员')
  failSave = false
  await save.click()
  await page.waitForFunction(() => !document.querySelector('.resource-editor-page .ant-btn-loading'))
  assert.equal(assets.actor.name, '修改后的演员')
  assert.equal(await page.getByRole('button',{name:'预览侧面图片 1',exact:true}).count(),0)
  // Cancellation acknowledgement is not terminal, and failed cancellation remains retryable.
  await name.fill('检测时未保存的名称')
  await page.getByRole('button', { name: '智能检测与结果', exact: true }).click()
  await page.getByRole('dialog',{name:'智能检测',exact:true}).getByRole('button',{name:'智能检测',exact:true}).click()
  await page.setViewportSize({width:1024,height:768})
  await page.setViewportSize({width:1440,height:900})
  await page.getByRole('dialog',{name:'智能检测',exact:true}).getByRole('button',{name:'完成',exact:true}).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  const detecting = page.getByRole('dialog', { name: '智能检测进行中', exact: true })
  await detecting.getByRole('button', { name: '取消检测', exact: true }).click()
  await detecting.getByText('取消检测失败，请重试或继续等待。', { exact: true }).waitFor()
  cancelFails = false
  await detecting.getByRole('button', { name: '取消检测', exact: true }).click()
  await detecting.getByRole('button', { name: '等待取消确认', exact: true }).waitFor()
  assert.equal(await name.inputValue(), '检测时未保存的名称')
  detectionStatus = 'cancelled'
  await leave.waitFor()
  await leave.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(cancelCalls, 2)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await leave.getByRole('button', { name: '放弃修改并离开', exact: true }).click()
  await page.goto(origin + '/assets/actors/a1/edit')
  await name.waitFor()
  slots.actor.push({id:2,view_angle:'FRONT',file_id:'history'})
  await page.reload()
  await name.and(page.locator(':enabled')).waitFor()
  await page.getByRole('button',{name:'预览正面图片 1',exact:true}).click()
  await page.getByRole('button', { name: /^查看全部/  }).click()
  const imagesDialog = page.getByRole('dialog',{name:'图片集合',exact:true})
  assert.equal(await imagesDialog.getByRole('button',{name:/查看图片.*的候选/}).count(),0,'图片集合移除逐图候选入口')
  await imagesDialog.getByRole('button',{name:'关闭',exact:true}).click()
  const adoptionsBeforePreview=adoptions
  const primaryFlagsBeforePreview=slots.actor.map(image=>image.is_primary)
  await page.getByRole('button',{name:'预览正面图片 2',exact:true}).click()
  assert.equal(adoptions,adoptionsBeforePreview,'preview selection never persists primary identity')
  assert.deepEqual(slots.actor.map(image=>image.is_primary),primaryFlagsBeforePreview)
  await page.getByRole('button',{name:/^查看全部/}).click()

  await page.getByRole('dialog',{name:'图片集合'}).getByRole('button',{name:'关闭',exact:true}).click()
  await page.getByRole('button',{name:'预览正面图片 2',exact:true}).click()
  await page.getByRole('button',{name:/^查看全部/}).click()
  await page.getByRole('dialog',{name:'图片集合'}).getByRole('button',{name:'设为主图正面图片 2',exact:true}).click()
  await page.getByRole('dialog',{name:'图片集合'}).getByText('主图',{exact:true}).waitFor()
  await page.getByRole('dialog',{name:'图片集合'}).getByRole('button',{name:'关闭',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'预览正面图片 1',exact:true}).getAttribute('aria-pressed'),'true','explicit primary update selects the new primary')
  parameterMode='present'
  await page.reload()
  await name.and(page.locator(':enabled')).waitFor()
  await page.getByRole('button',{name:'预览正面图片 2',exact:true}).click()
  await page.getByText('模型：历史模型 2',{exact:true}).waitFor()
  await Promise.all([page.waitForRequest(request=>request.url().endsWith('/actor-images/a1/1/parameters')), page.getByRole('button',{name:'预览正面图片 1',exact:true}).click()])
  await page.getByRole('button',{name:'预览正面图片 2',exact:true}).click()
  await page.getByText('模型：历史模型 2',{exact:true}).waitFor()
  await page.waitForTimeout(300)
  assert.equal(await page.getByText('模型：历史模型 1',{exact:true}).count(),0,'late response from previous image never replaces selected image metadata')
  await page.getByRole('button',{name:'查看参数',exact:true}).click()
  assert.equal(await page.getByRole('textbox',{name:'历史提示词',exact:true}).inputValue(),'历史提示词 2')
  await page.getByRole('dialog',{name:'本图已保存的生成参数',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
  parameterMode='failure'
  await page.getByRole('button',{name:'预览正面图片 1',exact:true}).click()
  await page.getByText('读取本图生成记录失败',{exact:true}).waitFor()
  parameterMode='present'
  await page.getByRole('button',{name:'重试记录',exact:true}).click()
  await page.getByText('模型：历史模型 1',{exact:true}).waitFor()
  parameterMode='none'
  await page.getByRole('button',{name:'预览正面图片 2',exact:true}).click()
  await page.getByText('模型：历史模型 1',{exact:true}).waitFor({state:'hidden'})
  const layoutSize=await page.locator('.resource-editor-body').evaluate(node=>({height:node.clientHeight,scroll:node.scrollHeight}))
  assert.ok(layoutSize.scroll<=layoutSize.height+1,'standard desktop actor content fits without scrolling')
  assert.equal(await page.getByText('共享资产',{exact:true}).count(),0)
  await page.getByRole('button',{name:'生成图片',exact:true}).click()
  const generationModal=page.getByRole('dialog',{name:'生成演员图片',exact:true})
  await generationModal.getByRole('combobox',{name:'图片模型'}).press('ArrowDown')
  await page.getByText('备选图片模型',{exact:true}).click()
  await generationModal.getByRole('textbox',{name:'本次附加要求'}).fill('仅本次柔光')
  await generationModal.getByRole('button',{name:'取消',exact:true}).click()
  await page.getByRole('button',{name:'生成图片',exact:true}).click()
  assert.equal(await generationModal.getByRole('textbox',{name:'本次附加要求'}).inputValue(),'仅本次柔光')
  await generationModal.getByText('备选图片模型',{exact:true}).waitFor()
  await generationModal.getByRole('checkbox',{name:'正面',exact:true}).evaluate(node => { if (node.checked) node.click() })
  await generationModal.getByRole('button',{name:'生成',exact:true}).click()
  await generationModal.getByText(/生成提交失败/).waitFor()
  assert.deepEqual(submittedAngles,['FRONT'],'empty selection generates front')
  assert.equal(submittedModel,'alternate-image')
  assert.deepEqual(submittedReferences,[])
  assert.equal(assets.actor.additional_instruction,undefined,'generation configuration never writes to actor facts')
  partialGeneration=true
  submittedAngles.length=0
  await generationModal.getByRole('checkbox',{name:'正面',exact:true}).evaluate(node => { if (!node.checked) node.click() })
  await generationModal.getByRole('checkbox',{name:'背面',exact:true}).evaluate(node => { if (!node.checked) node.click() })
  await generationModal.getByRole('button',{name:'生成',exact:true}).click()
  await generationModal.getByRole('alert').filter({hasText:'背面：'}).waitFor()
  await generationModal.getByRole('button',{name:'生成',exact:true}).and(page.locator(':enabled')).waitFor()
  await Promise.all([page.waitForResponse(response=>response.url().includes('/generation-tasks/actors/') && response.status()===503), generationModal.getByRole('button',{name:'生成',exact:true}).click()])
  assert.deepEqual(submittedAngles,['FRONT','BACK','BACK'],'retry never duplicates accepted front')

  await generationModal.getByRole('button',{name:'取消',exact:true}).click()

  await page.reload()
  await name.and(page.locator(':enabled')).waitFor()
  await page.getByRole('button',{name:'生成图片',exact:true}).click()
  assert.equal(await generationModal.getByRole('textbox',{name:'本次附加要求'}).inputValue(),'')
  await generationModal.getByText('默认图片模型',{exact:true}).waitFor()
  await generationModal.getByRole('button',{name:'取消',exact:true}).click()
  // Initial read failure is explicit and recoverable.
  failAsset = true
  await page.goto(origin + '/assets/props/a1/edit')
  await page.getByRole('button', { name: '重试读取对象', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '保存设定', exact: true }).isDisabled(), true)
  failAsset = false
  await page.getByRole('button', { name: '重试读取对象', exact: true }).click()
  await name.and(page.locator(':enabled')).waitFor()
  for (const [type, path] of types) {
    if (type === 'actor') {
      const firstId=Math.max(...slots.actor.map(image=>image.id))+1
      slots.actor.push(...Array.from({length:8},(_,index)=>({id:firstId+index,view_angle:'LEFT',file_id:'portrait'})))
    }
    for (const [width, height, theme] of [[1440, 900, 'mist'], [1366,768,'solid'], [1200,740,'solid'], [1366, 600, 'solid'], [1024, 768, 'solid'], [600, 812, 'mist'], [375, 812, 'solid']]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(value => localStorage.setItem('jellyfish_appearance', value), theme)
      await page.goto(origin + '/assets/' + path + '/a1/edit')
      await name.and(page.locator(':enabled')).waitFor()
      const dialog = page.getByRole('region', { name: assets[type].name, exact: true })
      const layout = await dialog.evaluate(node => ({
        x: node.getBoundingClientRect().x,
        overflow: node.scrollWidth > node.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
        titleSize: getComputedStyle(document.querySelector('.resource-editor-page-heading .app-page-title')).fontSize,
      }))
      assert.equal(layout.overflow, false, type + ' horizontal overflow')
      if(type==='actor' && width>=1200 && height>=740) assert.ok(await dialog.locator('.resource-editor-body').evaluate(node=>node.scrollHeight<=node.clientHeight+1),'actor desktop fits vertically')
      assert.equal(await page.locator('.resource-editor-drawer').count(),0,'详情在页面正文，无抽屉及遮罩')
      assert.equal(layout.titleSize, '16px')
      if (width < 768 || type === 'actor' && (width < 1200 || height < 740)) await dialog.getByRole('tab', { name: '图片', exact: true }).click()
      if(type==='actor') {
        const viewAll = dialog.getByRole('button',{name:/^查看全部/})
        assert.equal(await viewAll.textContent(),`查看全部（${slots.actor.filter(image=>image.file_id).length}）`)
        const row = dialog.locator('.actor-thumbnail-row')
        await dialog.locator('.actor-feature-image img').evaluate(image=>image.decode())
        const before = await viewAll.boundingBox()
        await row.locator('.actor-thumbnails').evaluate(node=>{node.scrollLeft=node.scrollWidth})
        assert.equal((await viewAll.boundingBox()).x,before.x,'查看全部不随缩略图横向滚动')
        assert.equal(await row.evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'缩略图与固定入口不横向溢出')
        await viewAll.click()
        await page.getByRole('dialog',{name:'图片集合',exact:true}).waitFor()
        await page.getByRole('dialog',{name:'图片集合',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
      }
      if(type==='actor') await dialog.getByRole('button',{name:/^预览正面图片/}).first().click()
      await dialog.getByRole('img', { name: '正面图片 1', exact: true }).waitFor()
      await dialog.getByRole('img', { name: '正面图片 1', exact: true }).evaluate(image => image.decode())
      await page.screenshot({ path: output + '/' + type + '-' + width + '.png' })
      await dialog.getByRole('button', { name: '返回', exact: true }).scrollIntoViewIfNeeded()
      assert.equal(await dialog.getByRole('button', { name: '返回', exact: true }).isVisible(), true)
    }
  }
  await page.setViewportSize({width:1440,height:900})
  await page.goto(origin + '/assets/actors/a1/edit')
  await name.and(page.locator(':enabled')).waitFor()
  const initialPreview = await page.getByRole('button',{name:/^预览.*图片/}).filter({has: page.locator('img')}).evaluateAll(nodes=>nodes.find(node=>node.getAttribute('aria-pressed')==='true')?.getAttribute('aria-label'))
  await page.getByRole('button',{name:/^查看全部/}).click()
  const collection=page.getByRole('dialog',{name:'图片集合',exact:true})
  await collection.getByRole('tab',{name:'正面',exact:true}).click()
  failDefault=true
  await collection.getByRole('button',{name:'设为正面默认图 2',exact:true}).click()
  await collection.getByText('设置视角默认图未能确认，请重新读取图片后重试',{exact:true}).waitFor()
  failDefault=false
  await collection.getByRole('button',{name:'设为正面默认图 2',exact:true}).click()
  await collection.getByText('视角默认',{exact:true}).waitFor()
  assert.equal(await collection.locator('.actor-picture-actions').evaluateAll(rows=>rows.every(row=>row.scrollWidth<=row.clientWidth+1)),true,'image state and icon actions fit the card')
  await collection.screenshot({path:output+'/actor-view-default.png'})
  await collection.getByRole('button',{name:'关闭',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:/^预览.*图片/}).first().getAttribute('aria-label'),'预览正面图片 2')
  assert.equal(await page.getByRole('button',{name:initialPreview,exact:true}).getAttribute('aria-pressed'),'true','default setting preserves preview')
  await page.getByRole('button',{name:/^查看全部/}).click()
  const beforeEdit=slots.actor.map(image=>({...image}))
  await collection.getByRole('button',{name:'局部修改正面图片 1',exact:true}).click()
  const editModal=page.getByRole('dialog',{name:'局部修改图片',exact:true})
  await editModal.getByRole('textbox',{name:'修改要求',exact:true}).fill('调整背景')
  completeEdit=true
  await editModal.getByRole('button',{name:'生成',exact:true}).click()
  await editModal.waitFor({state:'hidden'})
  assert.equal(slots.actor.length,beforeEdit.length+1,'local edit creates exactly one new record')
  assert.equal(editTarget.view_angle,'FRONT')
  assert.deepEqual(slots.actor.slice(0,beforeEdit.length),beforeEdit,'local edit preserves all source records and defaults')
  await page.getByRole('button',{name:`预览正面图片 ${editTarget.id}`,exact:true}).waitFor()
  assets.actor.source_character_id = 'converted-role'
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/assets/actors/a1/edit')
  await page.getByText('从角色转化 · 只读', { exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '名称', exact: true }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '生成图片', exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS page detail, save/leave recovery, analysis cancellation, removed candidate controls, readonly and responsive layout')
} finally { await cleanup() }
