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
    if (created && path.endsWith(`/entities/actor/${created.id}`)) return respond(created)
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
      if (!candidateMode) Object.assign(images.at(-1), { file_id: 'generated', is_primary: true })
      return respond({ task_id: 'generated-task', status: 'succeeded', progress: 100 })
    }
    return list([])
  })
  await page.goto('http://127.0.0.1:4921/assets?tab=actor')
  await page.getByRole('button', { name: '新建演员', exact: true }).first().click()
  const drawer = page.getByRole('dialog', { name: '新建演员' })
  await drawer.waitFor()
  assert.equal(await drawer.evaluate(node => node.classList.contains('ant-drawer-content')), true)
  assert.equal(await drawer.locator('.ant-drawer-footer').count(), 0)
  await drawer.getByRole('button', { name: '返回', exact: true }).waitFor()
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
    await drawer.waitFor()
    const layout = await drawer.evaluate(node => {
      const rect = node.getBoundingClientRect()
      const content = node.querySelector('.resource-editor-drawer-content').getBoundingClientRect()
      const header = node.querySelector('.resource-editor-page-heading').getBoundingClientRect()
      const toolbar = node.querySelector('.app-page-toolbar').getBoundingClientRect()
      return {overflow:node.scrollWidth > node.clientWidth + 1, width:rect.width,x:rect.x,y:rect.y,height:rect.height,toolbarBottom:toolbar.bottom,contentWidth:content.width,aligned:Math.abs(content.x-header.x)<1 && toolbar.y===rect.y}
    })
    assert.equal(layout.overflow,false)
    assert.equal(layout.width, width - (width >= 1024 ? 216 : 0))
    const region = await page.locator('.management-content').boundingBox()
    assert.equal(layout.y,region.y)
    assert.equal(layout.height,region.height)
    assert.ok(layout.contentWidth <= 880)
    assert.equal(layout.aligned,true)
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
    const action = await drawer.getByRole('button',{name:'仅创建',exact:true}).boundingBox()
    assert.ok(action.y + action.height <= layout.toolbarBottom)
    assert.ok(action.y + action.height <= height)
    await page.screenshot({path:output + `/create-${width}.png`,animations:'disabled'})
  }
  await page.setViewportSize({width:375,height:440})
  await drawer.getByText('详细设定 · 0 项已填写', {exact:true}).click()
  await drawer.evaluate(node => Promise.all(node.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {}))))
  const scrollBody = drawer.locator('.ant-drawer-body')
  await page.waitForFunction(() => document.querySelector('.resource-editor-more'))
  await scrollBody.evaluate(node => { node.scrollTop = 100 })
  await page.waitForFunction(() => document.querySelector('.resource-editor-scrolled'))
  await scrollBody.evaluate(node => { node.scrollTop = node.scrollHeight })
  await page.waitForFunction(() => !document.querySelector('.resource-editor-more'))
  await page.setViewportSize({width:1440,height:900})
  await scrollBody.evaluate(node => { node.scrollTop = 0 })
  await drawer.getByText('详细设定 · 0 项已填写', {exact:true}).click()
  await page.waitForFunction(() => !document.querySelector('.resource-editor-scrolled'))
  await drawer.getByRole('textbox', { name: '名称', exact: true }).fill('新建演员草稿')
  await drawer.getByRole('button', { name: /^创建并生成/ }).focus()
  let navigationReached = false
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press('Tab')
    if (await page.locator('.app-topbar :focus').count()) { navigationReached = true; break }
  }
  assert.ok(navigationReached, 'Tab can leave the panel and reach global navigation')
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitemradio', { name: '雾蓝微渐变' }).click()
  await drawer.waitFor()
  assert.equal(await drawer.getAttribute('aria-modal'), 'false')
  assert.equal(await drawer.getByRole('textbox', { name: '名称', exact: true }).inputValue(), '新建演员草稿')
  await drawer.getByText('参考图片 · 未选择' , { exact: true }).click()
  await page.getByRole('link',{name:'模型管理',exact:true}).click()
  const routeGuard=page.getByRole('dialog',{name:'离开资产详情',exact:true})
  await routeGuard.getByRole('button',{name:'继续编辑',exact:true}).click()
  assert.equal(new URL(page.url()).pathname,'/assets')
  assert.equal(created,undefined)
  await drawer.getByRole('button', { name: '选择参考主体', exact: true }).click()
  await drawer.getByRole('button', { name: '返回对象', exact: true }).click()
  assert.equal(created, undefined)
  await drawer.getByRole('button', { name: /^生成设置/ }).click()
  const backAngle=drawer.getByRole('checkbox', { name: '背面', exact: true })
  await backAngle.click()
  await page.waitForFunction(() => [...document.querySelectorAll('input[value=BACK]')].some(input=>input.checked))
  await drawer.getByRole('button', { name: '返回对象', exact: true }).click()
  assert.equal(await drawer.getByRole('button', { name: '生成设置 · 正面', exact: true }).count(), 1)
  await drawer.getByRole('button', { name: /^生成设置/ }).click()
  await drawer.getByRole('textbox', { name: '本次附加要求', exact: true }).fill('柔光展示')
  await drawer.getByRole('button', { name: '预览提示词', exact: true }).click()
  await page.getByRole('textbox', { name: '最终提示词', exact: true }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: '最终提示词', exact: true }).inputValue(), '预览柔光展示')
  assert.equal(created, undefined)
  await drawer.getByRole('button', { name: '应用并返回', exact: true }).click()
  await drawer.getByRole('button', { name: '仅创建', exact: true }).click()
  await drawer.waitFor({ state: 'hidden' })
  assert.equal(created.name, '新建演员草稿')
  await page.getByRole('button', { name: '新建演员', exact: true }).first().click()
  const newDraft = page.getByRole('dialog', { name: '新建演员', exact: true })
  await newDraft.getByRole('textbox', { name: '名称', exact: true }).fill('新建演员草稿')
  await newDraft.getByRole('button', { name: /^创建并生成/ }).click()
  const detail = page.getByRole('dialog', { name: '新建演员草稿', exact: true })
  await detail.getByRole('img', { name: '正面图片 1', exact: true }).waitFor()
  assert.equal(generationCalls, 1)
  assert.equal(images.length, 1)
  await detail.getByRole('button', { name: '局部修改正面图片 1', exact: true }).click()
  await detail.getByRole('textbox', { name: '修改要求', exact: true }).fill('将背景改为浅灰')
  await detail.getByRole('button', { name: '应用并返回', exact: true }).click()
  await detail.getByRole('button', { name: '生成修改候选', exact: true }).click()
  await detail.getByRole('button', { name: '加入视角文件夹', exact: true }).waitFor()
  assert.equal(images.length, 1)
  await detail.getByRole('button', { name: '加入视角文件夹', exact: true }).click()
  await detail.getByRole('img', { name: '正面图片 2', exact: true }).waitFor()
  assert.equal(images[0].file_id, 'generated')
  assert.equal(images[0].is_primary, true)
  await detail.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '新建演员', exact: true }).first().click()
  const secondDraft = page.getByRole('dialog', { name: '新建演员', exact: true })
  await secondDraft.getByRole('textbox', { name: '名称', exact: true }).fill('采用主体的演员')
  await secondDraft.getByText('参考图片 · 未选择', { exact: true }).click()
  await secondDraft.getByRole('button', { name: '选择参考主体', exact: true }).click()
  await secondDraft.getByRole('button', { name: '选择参考演员 新建演员草稿', exact: true }).click()
  await secondDraft.getByRole('button', { name: '使用所选图片', exact: true }).click()
  await secondDraft.getByRole('button', { name: '仅创建', exact: true }).click()
  await secondDraft.getByRole('button', { name: '采用并创建', exact: true }).waitFor()
  assert.equal(created.name, '新建演员草稿')
  await secondDraft.getByRole('button', { name: '采用并创建', exact: true }).click()
  await secondDraft.waitFor({ state: 'hidden' })
  assert.equal(created.adopt_reference.file_id, 'generated')
  created.project_id = 'project-a'
  await page.goto(`http://127.0.0.1:4921/assets/actors/${created.id}/edit`)
  const privateDetail = page.getByRole('region', { name: '采用主体的演员', exact: true })
  assert.equal(await page.locator('.resource-editor-drawer').count(),0)
  await privateDetail.getByRole('button', { name: '进入资产库', exact: true }).click()
  await privateDetail.getByRole('textbox', { name: '副本名称', exact: true }).fill('独立库中演员')
  await privateDetail.getByRole('button', { name: '确认入库', exact: true }).click()
  await privateDetail.getByRole('link', { name: '查看库中资产', exact: true }).waitFor()
  assert.equal(publishedName, '独立库中演员')
  assert.equal(created.name, '采用主体的演员')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: output + '/resource-editor-desktop.png' })
} finally {
  await cleanup()
}
