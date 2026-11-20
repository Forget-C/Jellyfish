import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
const root=fileURLToPath(new URL('..',import.meta.url))
const output=await browserOutput('jellyfish-image-source-')
const server=await createServer({root,cacheDir:output+'/cache',server:{host:'127.0.0.1',port:4933,strictPort:true}})
let browser
const cleanup=browserCleanup(()=>({browser,server}))
const kinds=[['actor','actors','演员'],['scene','scenes','场景'],['prop','props','道具'],['costume','costumes','服装']]
try {
 await server.listen()
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL})
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'})
 await page.addInitScript(()=>{window.__ENV={BACKEND_URL:location.origin}})
 page.setDefaultTimeout(7000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 const assets={}, images={}, requests=[]
 let uploads=0, failUpload=true, failCreate=true, lastPatch
 let importMode=false, failSources=true, failSourcePictures=true
 const librarySources=[{id:'library-one',name:'可导入资源',thumbnail:'library-file'},{id:'library-empty',name:'无图片资源'},...Array.from({length:11},(_,index)=>({id:'library-'+(index+3),name:'图库资源'+(index+3),thumbnail:'library-file'}))]
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname
  const respond=data=>route.fulfill({json:{success:true,data}})
  const list=items=>respond({items,pagination:{total:items.length,page:1,page_size:100}})
  if(path.endsWith('/projects/p'))return respond({id:'p',name:'项目',style:'真人科幻',visual_style:'现实'})
  if(path.endsWith('/model-settings'))return respond({default_image_model_id:'model'})
  if(path.endsWith('/llm/models'))return list([{id:'model',name:'默认图片模型',category:'image'}])
  if(path.endsWith('/generation-prompts/assets/draft/render'))return respond({render_id:'preview',execution_prompt:'图片来源提示词',variables_snapshot:{},recommended_media:{references:[]}})
  if(path.includes('/tasks/asset-images/'))return respond(null)
  if(path.endsWith('/files/upload')) {
   if(failUpload){failUpload=false;return route.fulfill({status:503,json:{detail:'上传失败'}})}
   return respond({id:'upload-'+(++uploads)})
  }
  if(/\/files\/[^/]+\/download$/.test(path))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="#718ba7"/></svg>'})
  const create=path.match(/\/entities\/(actor|character|scene|prop|costume)\/image-source$/)
  if(create) {
   requests.push(req.postDataJSON())
   if(failCreate){failCreate=false;return route.fulfill({status:503,json:{detail:'创建失败'}})}
   const kind=create[1],body=req.postDataJSON()
   assets[kind]={...body,origin:body.source_id?'library':'upload',style:'真人都市',visual_style:'现实',references:[]}
   images[kind]=(body.images??[{file_id:'imported',view_angle:'LEFT'}]).map((image,index)=>({id:index+1,...image,is_primary:index===0,is_view_default:index===0||image.view_angle==='FRONT'}))
   return respond(assets[kind])
  }
  const entity=path.match(/\/entities\/(actor|character|scene|prop|costume)(?:\/([^/]+))?(\/images)?$/)
  if(entity){const[,kind,id,pictures]=entity
   if(pictures){
    if(importMode && id==='library-one' && failSourcePictures){failSourcePictures=false;return route.fulfill({status:503,json:{detail:'成员图片读取失败'}})}
    return list(id==='library-empty'?[]:id==='library-one'?[{id:1,file_id:'library-file',view_angle:'FRONT',is_primary:true,is_view_default:true},{id:2,file_id:'library-side',view_angle:'LEFT'}]:images[kind]??[])
   }
   if(!id){
    const params=new URL(req.url()).searchParams, project=params.get('project_id')
    if(importMode && !project){
     if(failSources)return route.fulfill({status:503,json:{detail:'来源列表读取失败'}})
     const currentPage=Number(params.get('page')??1), size=Number(params.get('page_size')??12), query=params.get('q')??''
     const matches=librarySources.filter(source=>source.name.includes(query))
     return respond({items:matches.slice((currentPage-1)*size,currentPage*size),pagination:{total:matches.length,page:currentPage,page_size:size}})
    }
    return list(project?(assets[kind]?.project_id?[assets[kind]]:[]):[{id:'library-one',name:'可导入资源',project_id:null,style:'真人都市',visual_style:'现实'},...(assets[kind]&&!assets[kind].project_id?[assets[kind]]:[])])
   }
   if(req.method()==='PATCH'){lastPatch=req.postDataJSON();Object.assign(assets[kind],lastPatch)}
   return respond(assets[kind]??{id,name:'可导入资源',project_id:null,style:'真人都市',visual_style:'现实'})
  }
  if(path.includes('/project-assets/')){const kind=path.split('/').at(-1);return list(assets[kind]?.project_id?[{id:1,project_id:'p',[kind+'_id']:assets[kind].id}]:[])}
  return list([])
 })
 for(const[kind,plural,label]of kinds) {
  await page.goto(`http://127.0.0.1:4933/assets?tab=${kind}`)
  const create=page.getByRole('button',{name:`新建${label}`,exact:true}).first()
  await create.click()
  await page.getByRole('button',{name:/^上传图片/}).waitFor()
  assert.equal(await page.getByRole('dialog').count(),0)
  if(kind==='actor')await page.screenshot({path:output+'/creation-choices.png',animations:'disabled'})
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:/^上传图片/}).waitFor({state:'hidden'})
  await create.click();await page.getByRole('button',{name:/^上传图片/}).click()
  const form=page.getByRole('dialog',{name:'上传图片创建',exact:true})
  await form.waitFor()
  assert.ok((await form.boundingBox()).width<=600,'upload form uses a compact drawer')
  await form.getByText('点击选择或将图片拖到这里',{exact:true}).waitFor()
  assert.equal(await form.getByRole('button',{name:'创建',exact:true}).isDisabled(),true)
  if(kind==='actor')await page.screenshot({path:output+'/upload-empty-desktop.png',animations:'disabled'})
  await form.getByRole('textbox',{name:'名称',exact:true}).fill(`上传${label}`)
  if(kind==='actor'){await form.getByRole('button',{name:'返回',exact:true}).click();const guard=page.getByRole('dialog',{name:'离开资产详情',exact:true});await guard.getByRole('button',{name:'继续编辑',exact:true}).click();await guard.waitFor({state:'hidden'});assert.equal(await form.getByRole('textbox',{name:'名称',exact:true}).inputValue(),'上传演员')}
  if(kind==='actor') {
   await form.locator('input[type=file]').setInputFiles({name:'invalid.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')})
   await page.getByText('仅支持上传图片文件',{exact:true}).waitFor()
   assert.equal(await form.locator('.resource-upload-item').count(),0)
   const [chooser]=await Promise.all([page.waitForEvent('filechooser'),form.locator('.ant-upload-drag .ant-upload-btn').press('Enter')])
   await chooser.setFiles([{name:'first.png',mimeType:'image/png',buffer:Buffer.from('one')},{name:'second.png',mimeType:'image/png',buffer:Buffer.from('two')}])
  } else if(kind==='scene') {
   const files=await page.evaluateHandle(()=>{const data=new DataTransfer();data.items.add(new File(['one'],'first.png',{type:'image/png'}));data.items.add(new File(['two'],'second.png',{type:'image/png'}));return data})
   await form.locator('.ant-upload-drag .ant-upload-btn').dispatchEvent('drop',{dataTransfer:files})
   await files.dispose()
  } else {
   await form.locator('input[type=file]').setInputFiles([{name:'first.png',mimeType:'image/png',buffer:Buffer.from('one')},{name:'second.png',mimeType:'image/png',buffer:Buffer.from('two')}])
  }
  if(kind==='actor')await form.getByRole('button',{name:'重试上传',exact:true}).click()
  await form.getByRole('img',{name:'first.png',exact:true}).waitFor()
  await form.getByRole('img',{name:'second.png',exact:true}).waitFor()
  if(kind==='actor') {
   await form.getByRole('img',{name:'first.png',exact:true}).click()
   await page.locator('.ant-image-preview-wrap').waitFor({state:'visible'})
   await page.keyboard.press('Escape')
   await page.locator('.ant-image-preview-wrap').waitFor({state:'hidden'})
   assert.equal(await form.isVisible(),true,'closing the preview keeps the upload draft')
   await form.locator('input[type=file]').setInputFiles({name:'remove.png',mimeType:'image/png',buffer:Buffer.from('three')})
   await form.getByRole('img',{name:'remove.png',exact:true}).waitFor()
   await form.locator('.resource-upload-item').filter({hasText:'remove.png'}).getByRole('button',{name:'移除',exact:true}).click()
   await form.getByRole('img',{name:'remove.png',exact:true}).waitFor({state:'hidden'})
   assert.equal(await form.locator('.resource-upload-item').count(),2)
   await page.screenshot({path:output+'/upload-files-desktop.png',animations:'disabled'})
   await page.setViewportSize({width:375,height:812})
   await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1)
   await page.waitForFunction(()=>{const panel=document.querySelector('[role="dialog"][aria-label="上传图片创建"]').getBoundingClientRect();return panel.left>=0 && panel.right<=innerWidth+1})
   const panel=await form.boundingBox()
   assert.ok(panel.x>=0 && panel.x+panel.width<=375,'upload drawer fits the mobile viewport')
   assert.equal(await form.evaluate(node=>node.scrollWidth>node.clientWidth),false)
   await page.screenshot({path:output+'/upload-files-mobile.png',animations:'disabled'})
   await page.setViewportSize({width:1440,height:900})
  }
  await form.getByRole('combobox',{name:'图片1视角',exact:true}).press('ArrowDown')
  await page.getByText('侧面',{exact:true}).last().click()
  const before=requests.length
  await form.getByRole('button',{name:'创建',exact:true}).click()
  if(kind==='actor') {
   await form.getByText('创建失败',{exact:false}).waitFor()
   assert.equal(await form.getByRole('textbox',{name:'名称',exact:true}).inputValue(),`上传${label}`)
   await form.getByRole('button',{name:'创建',exact:true}).click()
   assert.equal(requests[before].id,requests[before+1].id)
  }
  await form.waitFor({state:'hidden'})
  assert.deepEqual(requests.at(-1).images.map(image=>image.view_angle),['LEFT','FRONT'])
  await page.goto(`http://127.0.0.1:4933/assets/${plural}/${assets[kind].id}/edit`)
  await page.getByText('上传',{exact:true}).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'补充信息',exact:true}).isDisabled(),true)
  const name=page.getByRole('textbox',{name:'名称',exact:true})
  assert.equal(await name.isDisabled(),true)
  assert.equal(await page.getByRole('button',{name:'保存设定',exact:true}).count(),0)
  await page.getByRole('button',{name:'添加详情',exact:true}).click()
  await page.getByText(`为此${label}添加详情？`,{exact:true}).waitFor()
  await page.getByRole('button',{name:/^取\s*消$/}).click()
  await page.locator('.ant-modal-mask').waitFor({state:'hidden'})
  assert.equal(await name.isDisabled(),true)
  if(kind==='actor')await page.screenshot({path:output+'/uploaded-detail.png',animations:'disabled'})
  await page.getByRole('button',{name:'生成图片',exact:true}).click()
  const modal=page.getByRole('dialog',{name:`生成${label}图片`,exact:true})
  await modal.getByRole('combobox',{name:'视觉风格',exact:true}).waitFor()
  await modal.getByRole('combobox',{name:'图片模型',exact:true}).waitFor()
  assert.equal(await modal.getByRole('img').count()>0,true,'生成默认显示主图参考')
  if(kind==='actor')await page.screenshot({path:output+'/image-generation-config.png',animations:'disabled'})
  await modal.getByRole('textbox',{name:'本次附加要求',exact:true}).fill('保留会话')
  await modal.getByRole('button',{name:'取消',exact:true}).click();await modal.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'生成图片',exact:true}).click()
  assert.equal(await modal.getByRole('textbox',{name:'本次附加要求',exact:true}).inputValue(),'保留会话')
  await modal.getByRole('button',{name:'取消',exact:true}).click();await modal.waitFor({state:'hidden'})
  await page.getByRole('button',{name:'添加详情',exact:true}).click()
  await page.getByText(`为此${label}添加详情？`,{exact:true}).waitFor()
  await page.getByRole('button',{name:'继续编辑',exact:true}).click()
  await name.fill(`改名${label}`)
  await page.getByRole('textbox',{name:'补充信息',exact:true}).fill('手动补充详情')
  assert.equal(assets[kind].details_editable,undefined,'confirmation alone never persists permission')
  assert.equal(await page.getByRole('button',{name:'生成图片',exact:true}).isDisabled(),true)
  await page.getByRole('button',{name:'保存设定',exact:true}).click()
  await page.getByRole('heading',{name:`改名${label}`,exact:true}).waitFor()
  assert.equal(lastPatch.details_editable,true)
  assert.equal(lastPatch.supplementary_info,'手动补充详情')
  await page.reload()
  await page.getByRole('textbox',{name:'补充信息',exact:true}).and(page.locator(':enabled')).waitFor()
  assert.equal(await page.getByRole('textbox',{name:'补充信息',exact:true}).inputValue(),'手动补充详情')
  await page.getByText('上传',{exact:true}).waitFor()
  await page.getByRole('button',{name:'生成图片',exact:true}).click()
  await modal.waitFor()
  assert.equal(await modal.getByRole('img').count()>0,true,'opened uploads keep main image as default reference')
  await modal.getByRole('button',{name:'取消',exact:true}).click();await modal.waitFor({state:'hidden'})
 }
 for(const[kind,tab,label]of [...kinds.map(([kind,plural,label])=>[kind,plural,label]),['character','roles','角色']]) {
  importMode=false
  await page.goto(`http://127.0.0.1:4933/projects/p?tab=${tab}`)
  await page.getByRole('button',{name:kind==='character'?'新建角色':'新建',exact:true}).first().click()
  importMode=true
  await page.getByRole('button',{name:/^从资产库导入/}).click()
  const form=page.getByRole('dialog',{name:'从资产库导入',exact:true})
  await form.waitFor()
  assert.ok((await form.boundingBox()).width<=720,'imports use a compact visual picker')
  assert.equal(await form.getByRole('combobox',{name:'来源资产',exact:true}).count(),0,'text select is removed')
  if(kind==='actor'){
   await form.getByRole('button',{name:'重试来源',exact:true}).waitFor()
   failSources=false
   await form.getByRole('button',{name:'重试来源',exact:true}).click()
  }
  await form.getByRole('button',{name:'选择可导入资源',exact:true}).waitFor()
  if(kind==='actor'){
   await page.waitForFunction(()=>{const cover=document.querySelector('[aria-label="选择可导入资源"] img');return cover?.complete && cover.naturalWidth>0})
   assert.equal(await form.getByRole('button',{name:'导入',exact:true}).isDisabled(),true)
   assert.equal(await form.getByRole('button',{name:'选择可导入资源',exact:true}).locator('.resource-card-metadata').count(),1)
   for(const width of [1440,375]){
    await page.setViewportSize({width,height:812})
    await page.waitForFunction(()=>{const panel=document.querySelector('[role="dialog"][aria-label="从资产库导入"]').getBoundingClientRect();return panel.left>=0 && panel.right<=innerWidth+1})
    const searchBox=form.getByRole('textbox',{name:'搜索来源资产',exact:true})
    await form.evaluate(element=>Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))))
    const before=await searchBox.boundingBox()
    const scroll=form.locator('.resource-import-content')
    assert.ok(await scroll.evaluate(node=>node.scrollHeight>node.clientHeight),'source cards overflow in the content region')
    await scroll.evaluate(node=>{node.scrollTop=node.scrollHeight})
    assert.ok(await scroll.evaluate(node=>node.scrollTop>0))
    assert.deepEqual(await searchBox.boundingBox(),before,'search stays fixed while candidates scroll')
    assert.ok(await form.locator('.ant-drawer-body').evaluate(node=>node.scrollHeight<=node.clientHeight+1),'drawer has no second scroll region')
    await page.screenshot({path:output+`/import-scroll-${width}.png`,animations:'disabled'})
    await scroll.evaluate(node=>{node.scrollTop=0})
   }
   await page.setViewportSize({width:1440,height:900})
   await page.screenshot({path:output+'/import-picker-desktop.png',animations:'disabled'})
   await form.getByTitle('2',{exact:true}).click()
   await form.getByRole('button',{name:'选择图库资源13',exact:true}).waitFor()
   const search=form.getByRole('textbox',{name:'搜索来源资产',exact:true})
   await search.fill('不存在');await search.press('Enter')
   await form.getByText('未找到匹配的资产',{exact:true}).waitFor()
   await search.fill('');await search.press('Enter')
   await form.getByRole('button',{name:'选择无图片资源',exact:true}).click()
   await form.getByText('来源没有有效图片，暂时不能导入。',{exact:true}).waitFor()
   assert.equal(await form.getByRole('button',{name:'导入',exact:true}).isDisabled(),true)
  }
  await form.getByRole('button',{name:'选择可导入资源',exact:true}).press('Enter')
  if(kind==='actor')await form.getByRole('button',{name:'重试图片',exact:true}).click()
  await form.getByRole('img',{name:'来源图片 1',exact:true}).waitFor()
  await form.getByRole('img',{name:'来源图片 2',exact:true}).waitFor()
  assert.ok((await form.locator('.resource-import-pictures .ant-image').first().boundingBox()).height<=100,'member thumbnails stay compact regardless of image aspect ratio')
  if(kind==='actor'){
   await form.locator('.resource-import-pictures .ant-image').nth(1).click()
   await page.locator('.ant-image-preview-wrap').waitFor({state:'visible'})
   await page.keyboard.press('Escape')
   await page.locator('.ant-image-preview-wrap').waitFor({state:'hidden'})
   assert.equal(await form.isVisible(),true,'closing member preview keeps the import selection')
  }
  await form.getByRole('textbox',{name:'名称',exact:true}).fill(`导入${label}`)
  if(kind==='actor'){
   const search=form.getByRole('textbox',{name:'搜索来源资产',exact:true})
   await search.fill('不存在');await search.press('Enter')
   await form.getByText('未找到匹配的资产',{exact:true}).waitFor()
   assert.equal(await form.getByRole('textbox',{name:'名称',exact:true}).inputValue(),'导入演员','search keeps the selected source and custom copy name')
   await search.fill('可导入');await search.press('Enter')
   await form.getByRole('button',{name:'选择可导入资源',exact:true}).waitFor()
   assert.equal(await form.getByRole('button',{name:'选择可导入资源',exact:true}).getAttribute('aria-pressed'),'true')
   await page.screenshot({path:output+'/import-selection-desktop.png',animations:'disabled'})
  }
  await page.setViewportSize({width:375,height:812})
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1)
  await page.waitForFunction(()=>{const panel=document.querySelector('[role="dialog"][aria-label="从资产库导入"]').getBoundingClientRect();return panel.left>=0 && panel.right<=innerWidth+1})
  assert.equal(await form.evaluate(node=>node.scrollWidth>node.clientWidth),false,'visual picker has no mobile overflow')
  await page.screenshot({path:output+`/import-${kind}-mobile.png`,animations:'disabled'})
  await form.getByRole('button',{name:'导入',exact:true}).click();await form.waitFor({state:'hidden'})
  assert.equal(requests.at(-1).project_id,'p');assert.equal(requests.at(-1).source_id,'library-one')
  await page.getByRole('button',{name:`导入${label}`,exact:true}).click()
  await page.getByText('资产库导入',{exact:true}).waitFor()
  assert.equal(await page.getByRole('textbox',{name:kind==='character'?'角色设定':'补充信息',exact:true}).isDisabled(),true)
  await page.screenshot({path:output+`/imported-${kind}-mobile.png`,animations:'disabled'})
  await page.getByRole('button',{name:'返回',exact:true}).click()
  await page.setViewportSize({width:1440,height:900})
 }
 assert.deepEqual(errors,[])
 console.log('PASS library uploads, source fields, model/configuration and five project import entries',output)
} catch(error) {
 console.log('EVIDENCE',output)
 for(const p of browser.contexts()[0].pages()){console.log((await p.locator('body').innerText()).slice(-9000));await p.screenshot({path:output+'/failure.png'})}
 throw error
} finally {await cleanup()}
