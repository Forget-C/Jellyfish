import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-resource-editor-')
const server = await createServer({ root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4921, strictPort: true } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  let created
  const images = []
  let generationCalls = 0
  let candidateMode = false
  let publishedName
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const respond = data => route.fulfill({ json: { code: 200, message: 'success', data } })
    const list = items => respond({ items, pagination: { total: items.length, page: 1, page_size: 100 } })
    if (/\/files\/(generated|candidate)\/download$/.test(path)) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320"><rect width="100%" height="100%" fill="#7596b5"/></svg>' })
    if (path.endsWith('/llm/model-settings')) return respond({default_image_model_id:'image-model'})
    if (path.endsWith('/llm/models')) return list([{id:'image-model',name:'测试图片模型'}])
    if (path.endsWith('/style-options')) return respond({ visual_styles: ['现实', '动漫'], styles: ['真人都市'] })
    if (path.endsWith('/generation-prompts/assets/draft/render')) return respond({
      render_id: 'draft-render', execution_prompt: '预览柔光展示', variables_snapshot: {}, recommended_media: { references: [] },
    })
    if (path.endsWith('/entities/actor')) {
      if (route.request().method() === 'POST') {
        created = { ...route.request().postDataJSON(), project_id: null }
        return respond(created)
      }
      return list(created ? [created] : [])
    }
    if (created && path.endsWith(`/entities/actor/${created.id}`)) { if (route.request().method() === 'PATCH') Object.assign(created,route.request().postDataJSON()); return respond(created) }
    if (path.endsWith('/publish-to-library')) {
      publishedName = route.request().postDataJSON().name
      created.library_copy_id = 'library-copy'
      return respond({ id: 'library-copy', name: publishedName, project_id: null })
    }
    if (created && path.endsWith(`/entities/actor/${created.id}/images`)) {
      if (route.request().method() === 'POST') {
        const image = { id: images.length + 1, ...route.request().postDataJSON() }
        images.push(image)
        return respond(image)
      }
      return list(images)
    }
    if (path.includes('/generation-prompts/assets/actor/')) return respond({ render_id: 'saved-render', execution_prompt: '当前对象生成提示词', variables_snapshot: {}, recommended_media: { references: [] } })
    if (path.includes('/generation-tasks/actors/')) { generationCalls++; candidateMode = !!route.request().postDataJSON().operation_input.save_as_candidate; return respond({ task_id: 'generated-task' }) }
    if (path.endsWith('/film/tasks/outputs')) return respond({ items: [{ task_id: 'generated-task', ordinal: 1, file_id: 'candidate' }], next_cursor: null })
    if (path.endsWith('/film/tasks/generated-task/status')) {
      if (!candidateMode) Object.assign(images.at(-1), { file_id: generationCalls > 1 ? 'candidate' : 'generated', is_primary: images.length === 1, is_view_default: images.length === 1 })
      return respond({ task_id: 'generated-task', status: 'succeeded', progress: 100 })
    }
    return list([])
  })
  await page.goto('http://127.0.0.1:4921/assets?tab=actor')
  await page.getByRole('button', { name: '新建演员', exact: true }).first().click()
  await page.getByRole('button',{name:/^填写设定/}).click()
  const drawer = page.getByRole('dialog', { name: '新建演员' })
  await drawer.waitFor()
  for (const field of ['体型', '肤色', '五官特征', '发型发色']) assert.equal(await drawer.getByRole('textbox', { name: field, exact: true }).isVisible(), true, `${field} should be expanded`)
  assert.equal(await drawer.evaluate(node => node.classList.contains('ant-drawer-content')), true)
  assert.equal(await drawer.locator('.ant-drawer-footer').count(), 0)
  await drawer.getByRole('button', { name: '返回', exact: true }).waitFor()
  assert.equal(await drawer.locator('.actor-detail-layout > section').count(), 2, 'new object uses the detail two-column layout')
  await drawer.getByRole('button', { name: '保存设定', exact: true }).waitFor()
  const bounds = await drawer.boundingBox()
  assert.equal(bounds.x, 216)
  assert.equal(bounds.width, 1224)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await drawer.evaluate(node => node.querySelector('button').click())
  const exit = await page.locator('.resource-editor-drawer .ant-drawer-content-wrapper').evaluate(node => ({
    running: node.getAnimations().some(animation => animation.playState === 'running'),
    inert: node.querySelector('[role="dialog"]').inert,
  }))
  assert.equal(exit.running, true)
  assert.equal(exit.inert, true)
  await page.locator('.resource-editor-drawer').waitFor({ state: 'hidden' })
  await page.emulateMedia({ reducedMotion: 'reduce' })

  for (const [width, height, theme] of [[1440,900,'mist'],[1366,768,'solid'],[1024,768,'mist'],[1023,768,'solid'],[768,812,'mist'],[767,812,'solid'],[375,812,'solid']]) {
    await page.setViewportSize({width,height})
    await page.evaluate(value => { localStorage.setItem('jellyfish_appearance',value) },theme)
    await page.reload()
    await page.getByRole('button', { name: '新建演员', exact: true }).first().click()
    await page.getByRole('button',{name:/^填写设定/}).click()
    await drawer.waitFor()
    const layout = await drawer.evaluate(node => {
      const rect = node.getBoundingClientRect()
      const content = node.querySelector('.resource-editor-drawer-content').getBoundingClientRect()
      const header = node.querySelector('.resource-editor-page-heading').getBoundingClientRect()
      const backIcon = node.querySelector('.resource-editor-page-heading button .anticon').getBoundingClientRect()
      const toolbar = node.querySelector('.app-page-toolbar').getBoundingClientRect()
      return {overflow:node.scrollWidth > node.clientWidth + 1, width:rect.width,x:rect.x,y:rect.y,height:rect.height,toolbarBottom:toolbar.bottom,contentWidth:content.width,aligned:Math.abs(content.x-header.x)<1 && toolbar.y===rect.y,backIconInset:backIcon.left-content.left}
    })
    assert.equal(await drawer.locator('.ant-drawer-body').evaluate(node => getComputedStyle(node).paddingTop), width <= 767 ? '12px' : '16px')
    assert.equal(await drawer.locator('.resource-editor-page-heading > .ant-btn').evaluate(node => getComputedStyle(node).fontSize), '13px')
    assert.equal(layout.overflow,false)
    assert.equal(layout.width, width - (width >= 1024 ? 216 : 0))
    const region = await page.locator('.management-content').boundingBox()
    assert.equal(layout.y,region.y)
    assert.equal(layout.height,region.height)
    assert.ok(Math.abs(layout.contentWidth - (layout.width - (width < 768 ? 32 : 40))) <= 1)
    assert.equal(layout.aligned,true)
    assert.ok(Math.abs(layout.backIconInset) <= 2, `${width}px: back arrow aligns with the drawer content`)
    const surface = await drawer.evaluate(node => {
      const style = getComputedStyle(node)
      const shell = getComputedStyle(document.querySelector('.app-shell'))
      return {image:style.backgroundImage,color:style.backgroundColor,pageImage:shell.backgroundImage,pageColor:shell.backgroundColor,blur:style.backdropFilter,opacity:style.opacity,size:style.backgroundSize,position:style.backgroundPosition,shadow:getComputedStyle(node.closest('.ant-drawer-content-wrapper')).boxShadow}
    })
    assert.equal(surface.image,surface.pageImage)
    if (theme === 'solid') assert.equal(surface.color,surface.pageColor)
    assert.equal(surface.blur,'none')
    assert.equal(surface.opacity,'1')
    assert.equal(surface.size,`${width}px ${height}px`)
    assert.equal(surface.position,`100% -${layout.y}px`)
    assert.equal(surface.shadow,'none')
    const edge = await drawer.evaluate(node => { const style=getComputedStyle(node.closest('.resource-editor-drawer'),'::before'); return {background:style.backgroundImage,mask:style.maskImage,events:style.pointerEvents} })
    if (width >= 1024) { assert.match(edge.background,/linear-gradient/); assert.match(edge.mask,/linear-gradient/); assert.equal(edge.events,'none') }
    const action = await drawer.getByRole('button',{name:'保存设定',exact:true}).boundingBox()
    assert.ok(action.y + action.height <= layout.toolbarBottom)
    assert.ok(action.y + action.height <= height)
    await page.screenshot({path:output + `/create-${width}.png`,animations:'disabled'})
  }
  await page.setViewportSize({width:1440,height:900})
  await drawer.locator('.actor-detail-layout').waitFor()
  await drawer.getByRole('textbox', { name: '名称', exact: true }).fill('新建演员草稿')
  await drawer.getByRole('textbox', { name: '体型', exact: true }).fill('匀称')
  assert.equal(await drawer.getByRole('button', { name: /^生成设置/ }).count(), 0)
  assert.equal(await drawer.getByRole('button', { name: /^创建并生成/ }).count(), 0)
  const navBox = await page.getByRole('link',{name:'模型管理',exact:true}).boundingBox()
  await page.mouse.click(navBox.x + navBox.width / 2, navBox.y + navBox.height / 2)
  const routeGuard=page.getByRole('dialog',{name:'离开资产详情',exact:true})
  await routeGuard.getByRole('button',{name:'继续编辑',exact:true}).click()
  assert.equal(new URL(page.url()).pathname,'/assets')
  assert.equal(created,undefined)
  await drawer.getByRole('button', { name: '保存设定', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '新建演员草稿', exact: true })
  await detail.waitFor()
  assert.equal(created.name, '新建演员草稿')
  assert.equal(created.build, '匀称')
  assert.equal(await detail.locator('.actor-detail-layout > section').count(), 2)
  await detail.getByRole('button', { name: '生成图片', exact: true }).click()
  const config = page.getByRole('dialog', { name: '生成演员图片', exact: true })
  await config.getByRole('button', { name: '添加参考图片', exact: true }).click()
  await page.getByRole('menuitem', { name: '选择参考主体', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择主体参考', exact: true })
  await picker.getByRole('button', { name: '返回生成', exact: true }).click()
  await config.getByRole('textbox', { name: '本次附加要求', exact: true }).fill('柔光展示')
  await config.getByRole('button', { name: '预览提示词', exact: true }).click()
  await config.getByRole('textbox', { name: '最终提示词', exact: true }).waitFor()
  await config.getByRole('button', { name: '取消', exact: true }).click()
  await detail.getByRole('button', { name: '生成图片', exact: true }).click()
  assert.equal(await config.getByRole('textbox', { name: '本次附加要求', exact: true }).inputValue(), '柔光展示')
  await config.getByRole('button', { name: '生成', exact: true }).click()
  await config.waitFor({state:'hidden'})
  await detail.getByRole('img', { name: '正面图片 1', exact: true }).waitFor()
  assert.equal(generationCalls,1)
  await detail.getByRole('button', { name: '查看多角度图片', exact: true }).click()
  const gallery=page.getByRole('dialog',{name:'图片集合',exact:true})
  await gallery.getByRole('button', { name: '局部修改正面图片 1', exact: true }).click()
  const edit=page.getByRole('dialog',{name:'局部修改图片',exact:true})
  await edit.getByRole('textbox', { name: '修改要求', exact: true }).fill('将背景改为浅灰')
  await edit.getByRole('button', { name: '生成', exact: true }).click()
  await edit.waitFor({state:'hidden'})
  await detail.getByRole('button',{name:'预览正面图片 2',exact:true}).waitFor()
  assert.equal(images.length,2)
  assert.equal(candidateMode,false)
  assert.equal(images[1].view_angle,images[0].view_angle)
  await detail.getByRole('button', { name: '返回', exact: true }).click()
  await detail.waitFor({state:'hidden'})
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.goto(`http://127.0.0.1:4921/assets/actors/${created.id}/edit`)
  await page.getByRole('button', { name: 'Generate image', exact: true }).click()
  const englishConfig = page.getByRole('dialog', { name: 'Generate Actor image', exact: true })
  await englishConfig.getByRole('button', { name: 'Add reference image', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Select reference Subject', exact: true }).click()
  await page.getByRole('button', { name: 'Return to generation', exact: true }).click()
  await englishConfig.getByRole('button', { name: 'Cancel', exact: true }).click()
  await englishConfig.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '新建演员', exact: true }).first().click()
  await page.getByRole('button',{name:/^填写设定/}).click()
  await drawer.getByRole('textbox',{name:'名称',exact:true}).fill('直接生成草稿')
  await drawer.getByRole('button',{name:'生成图片',exact:true}).click()
  await config.getByRole('button',{name:'保存并生成',exact:true}).click()
  const generated=page.getByRole('dialog',{name:'直接生成草稿',exact:true})
  await generated.waitFor()
  assert.equal(created.name,'直接生成草稿')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: output + '/resource-editor-desktop.png' })
} finally {
  await cleanup()
}
