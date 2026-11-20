import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const port = 4545
const origin = `http://127.0.0.1:${port}`
const server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, open: false } })
const output = await browserOutput('jellyfish-project-settings-')
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
let saved = { id:'settings-project',name:'原有项目',description:'原有简介',visual_style:'现实',style:'真人都市',seed:12,unify_style:true,default_video_ratio:'16:9' }
let pendingSave
let coverUploads = 0
const requests = [], errors = []
try {
  await server.listen()
  browser = await chromium.launch({ headless:true,channel:process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({viewport:{width:1440,height:900},locale:'zh-CN'})
  page.setDefaultTimeout(10000)
  await page.addInitScript(()=>{window.__ENV={BACKEND_URL:location.origin}})
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('**/api/**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    const respond=data=>route.fulfill({json:{success:true,data}})
    if (path.endsWith('/files')) {
      const params = new URL(request.url()).searchParams
      assert.equal(params.get('file_type'), 'image')
      assert.equal(params.has('project_id'), false)
      return respond({ items: [{ id: 'source-cover', name: '文件海报', type: 'image' }], pagination: { total: 1 } })
    }
    if (path.endsWith('/download')) return route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6aYAAAAASUVORK5CYII=', 'base64'),
    })
    if (path.endsWith('/cover-upload')) {
      coverUploads++
      const body = request.postData()
      assert.match(request.headers()['content-type'], /multipart\/form-data/)
      assert.match(body, /filename="cover.png"/)
      assert.match(body, /"name":"带上传封面的项目"/)
      saved = { ...saved, name: '带上传封面的项目', cover_file_id: 'uploaded-cover' }
      return respond(saved)
    }
    if(path.endsWith('/projects/settings-project') && request.method()==='PATCH') {
      requests.push(request.postDataJSON())
      return new Promise(resolve=>{pendingSave=async(fail)=>{
        if(fail) await route.fulfill({status:503,json:{detail:'保存暂不可用'}})
        else {
          const changes = request.postDataJSON()
          if (changes.cover_file_id === 'source-cover') changes.cover_file_id = 'cloned-cover'
          saved = { ...saved, ...changes }
          await respond(saved)
        }
        resolve()
      }})
    }
    if(path.endsWith('/projects/settings-project'))return respond(saved)
    if(path.endsWith('/studio/projects'))return respond({ items: [saved], pagination: { total: 1 } })
    if(path.endsWith('/chapters'))return respond({items:[],pagination:{total:0}})
    if(path.endsWith('/video-generation-options'))return respond({allowed_ratios:['16:9','9:16'],default_ratio:'16:9'})
    return respond({items:[]})
  })
  await page.goto(`${origin}/projects/settings-project?tab=settings`)
  const name=page.getByRole('textbox',{name:/项目名称/})
  await name.waitFor()
  await page.getByRole('heading',{name:'基本信息',exact:true}).waitFor()
  await page.getByRole('heading',{name:'生成默认设置',exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'项目设置',exact:true}).count(),1)
  assert.equal(await page.getByRole('button',{name:'更多',exact:true}).count(),0)
  const save=page.getByRole('button',{name:/保\s*存/}),cancel=page.getByRole('button',{name:/取\s*消/})
  assert.equal(await save.isDisabled(),true)
  await name.fill('未保存项目')
  await cancel.click()
  assert.equal(await name.inputValue(),'原有项目')
  await name.fill('重试后的项目')
  const firstSave=page.waitForRequest(request=>request.method()==='PATCH')
  await save.click()
  await firstSave
  assert.equal(requests.length,1)
  assert.equal(await name.isDisabled(),true)
  assert.equal(await save.isDisabled(),true)
  await pendingSave(true)
  await page.getByText('保存暂不可用',{exact:true}).waitFor()
  assert.equal(await name.inputValue(),'重试后的项目')
  assert.equal(await save.isEnabled(),true)
  const secondSave=page.waitForRequest(request=>request.method()==='PATCH')
  await save.click()
  await secondSave
  assert.equal(requests.length,2)
  assert.equal(requests[1].name,'重试后的项目')
  assert.equal(requests[1].default_video_ratio,'16:9')
  await pendingSave(false)
  await page.getByText('项目已更新',{exact:true}).waitFor()
  await name.fill('第二轮未保存')
  await cancel.click()
  assert.equal(await name.inputValue(),'重试后的项目')
  assert.equal(await save.isDisabled(),true)
  await name.fill('   ')
  await save.click()
  await page.getByText('请输入项目名称',{exact:true}).waitFor()
  assert.equal(requests.length,2)
  await cancel.click()
  for(const theme of ['mist','solid']) {
    await page.evaluate(value=>localStorage.setItem('jellyfish_appearance',value),theme)
    await page.reload()
    await name.waitFor()
    const description=page.getByRole('textbox',{name:/项目简介/})
    await description.fill('用于检查长简介在宽屏和窄屏均独占整行，并且底部保存取消可达。'.repeat(8))
    for(const viewport of [{width:1440,height:900},{width:1366,height:768},{width:1024,height:440},{width:1023,height:768},{width:768,height:768},{width:767,height:768},{width:375,height:812}]) {
      await page.setViewportSize(viewport)
      const form=page.getByRole('form',{name:'项目设置表单'})
      assert.ok((await form.boundingBox()).width<=801)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true)
      if(viewport.width>=1024) {
        const visual=await page.getByRole('combobox',{name:/视觉风格/}).boundingBox()
        const style=await page.getByRole('combobox',{name:/视频风格/}).boundingBox()
        assert.ok(Math.abs(visual.y-style.y)<2 && style.x>visual.x, 'short style fields share a row')
      }
      await save.scrollIntoViewIfNeeded()
      const box=await save.boundingBox()
      assert.ok(box.y+box.height<=viewport.height+1)
      await page.screenshot({path:join(output,`settings-${theme}-${viewport.width}-${viewport.height}.png`),animations:'disabled'})
      await name.focus()
      await name.press('Tab')
      assert.equal(await description.evaluate(input=>input===document.activeElement),true)
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await cancel.click()
  const chooseCover = async () => {
    await page.getByRole('button', { name: '设置封面' }).click()
    await page.getByRole('menuitem', { name: '从文件管理选择' }).click()
    await page.getByRole('dialog', { name: '从文件管理选择图片' }).getByRole('button', { name: '文件海报' }).click()
  }
  const preview = page.getByRole('img', { name: '项目封面预览' })
  await chooseCover()
  assert.match(await preview.getAttribute('src'), /source-cover/)
  await cancel.click()
  assert.equal(await preview.count(), 0)
  assert.equal(requests.length, 2)
  await chooseCover()
  const coverSave = page.waitForRequest(request => request.method() === 'PATCH')
  await save.click()
  await coverSave
  assert.equal(requests.at(-1).cover_file_id, 'source-cover')
  await pendingSave(false)
  await page.waitForFunction(() => document.querySelector('img[alt="项目封面预览"]')?.src.includes('cloned-cover'))
  await page.reload()
  assert.match(await preview.getAttribute('src'), /cloned-cover/)

  await page.getByLabel('上传项目封面').setInputFiles({ name: 'cover.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6aYAAAAASUVORK5CYII=', 'base64') })
  await page.waitForFunction(() => document.querySelector('img[alt="项目封面预览"]')?.src.startsWith('blob:'))
  assert.equal(coverUploads, 0)
  await name.fill('带上传封面的项目')
  await save.click()
  await page.waitForFunction(() => document.querySelector('img[alt="项目封面预览"]')?.src.includes('uploaded-cover'))
  assert.equal(coverUploads, 1)
  await page.goto(`${origin}/projects`)
  const card = page.getByRole('article').filter({ hasText: '带上传封面的项目' })
  assert.match(await card.locator('.project-lobby-cover img').getAttribute('src'), /uploaded-cover/)
  assert.deepEqual(errors,[])
  console.log('PASS project settings groups, scoped toolbar, failed-save recovery, saving lock and saved cancel baseline')
} finally { await cleanup() }
