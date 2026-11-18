import { checkReferencePurposes } from './referencePicker.assertions.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-project-resources-')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4546, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ timezoneId: 'Asia/Shanghai', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(10000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  for(const [kind,tab,label] of [['actor','actors','演员'],['character','roles','角色'],['scene','scenes','场所'],['prop','props','道具'],['costume','costumes','服装']]) {
    const assets=[{id:'one',name:`${label}长名称测试`,description:'真实简介',thumbnail:'/api/cover'}, {id:'missing',name:`无图${label}`}, {id:'new',name:`新增${label}`},{id:'broken',name:`失效${label}`,thumbnail:'/api/broken'}]
    for (const asset of assets) Object.assign(asset, {project_id: 'resources', visual_style: '现实', style: '真人都市', references: []})
    assets[0].references = Array.from({length:6}, (_, i) => ({file_id:'pic', role:'design', view_angle:['FRONT','LEFT','BACK','TOP','RIGHT','DETAIL'][i], source_kind:kind, source_id:'one'}))
    Object.assign(assets[0], {origin:'created',created_at:'2026-11-15T18:30:00Z'})
    Object.assign(assets[1], {origin:'library',library_copy_id:'library-copy'})
    Object.assign(assets[2], {origin:'project',source_character_id:kind==='actor'?'role-source':null})
    assets[3].description='需要截断的完整详情'.repeat(35)
    let failAssetSave=false, submittedModel, failList=false
    const imageRows=[{id:1,file_id:'pic',view_angle:'FRONT',is_primary:true,is_view_default:true}]
    let links=[assets[0],assets[1],assets[2],assets[3]].map((a,i)=>({id:i+1,project_id:'resources',[kind+'_id']:a.id})), attempts=0
    await page.route('**/api/**',async route=>{
      const req=route.request(), { pathname: path, searchParams } = new URL(req.url())
      const respond=data=>route.fulfill({json:{success:true,data}})
      if(path.endsWith('/files/pic/download'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="navy"/></svg>'})
      if(path.endsWith('/model-settings'))return respond({default_image_model_id:'m'})
      if(path.endsWith('/llm/models'))return respond({items:[{id:'m',name:'默认图片模型',category:'image'}],pagination:{total:1}})
      if(path.includes('/tasks/asset-images/'))return respond(null)
      if(/generation-tasks\/(assets\/)?(actor|actors|character|characters|scene|prop|costume)\/one\/slots\/\d+\/tasks$/.test(path)){ submittedModel=req.postDataJSON().model_id; return route.fulfill({status:503,json:{detail:'生成失败'}}) }
      if(/generation-prompts\/assets\/[^/]+\/one\/slots\/\d+\/render$/.test(path))return respond({render_id:'saved',execution_prompt:'项目生成',variables_snapshot:{},recommended_media:{references:[]}})
      if(path.endsWith('/generation-prompts/assets/draft/render'))return respond({render_id:'draft',execution_prompt:'项目提示词',variables_snapshot:{},recommended_media:{references:[]}})
      if(path==='/api/broken') return route.fulfill({status:404,body:'missing'})
      if(path==='/api/cover') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="navy"/></svg>'})
      if(path.endsWith('/projects/resources')) return respond({id:'resources',name:'资源测试项目',stats:{}})
      if(path.endsWith('/project-assets/'+kind)) {
        if(req.method()==='POST') {links.push({id:4,project_id:'resources',[kind+'_id']:req.postDataJSON().asset_id});return respond(links.at(-1))}
        return respond({items:links,pagination:{total:links.length}})
      }
      if(path.includes('/project-assets/'+kind+'/'))throw new Error('Legacy unlink API must not be called')
      if(path.endsWith('/entities/'+kind)) {
        if (failList && searchParams.get('project_id')) return route.fulfill({ status: 503 })
        const query = searchParams.get('q') ?? ''
        const sources = searchParams.getAll('source')
        const cover = searchParams.get('has_cover')
        const owner = searchParams.get('project_id')
        const items = assets.filter(asset => (owner === null || asset.project_id === owner) && !asset.deleted
          && (!query || `${asset.name} ${asset.description || ''}`.includes(query))
          && (!sources.length || sources.includes(asset.source_character_id ? 'role_conversion' : asset.origin ?? 'created'))
          && (cover === null || Boolean(asset.thumbnail) === (cover === 'true')))
        const page = Number(searchParams.get('page')) || 1
        const size = Number(searchParams.get('page_size')) || 100
        return respond({items:items.slice((page-1)*size,page*size),pagination:{total:items.length}})
      }
      const asset=assets.find(a=>path.endsWith('/entities/'+kind+'/'+a.id))
      if(asset){
        if(req.method()==='DELETE') { attempts++; if(attempts===1)return route.fulfill({status:503,json:{detail:'删除失败'}}); links=links.filter(l=>l[kind+'_id']!==asset.id);asset.deleted=true;return respond({}) }
        if(req.method()==='PATCH') { if(failAssetSave)return route.fulfill({status:503,json:{detail:'保存失败'}});Object.assign(asset,req.postDataJSON()) }
        return respond(asset)
      }
      if(path.endsWith('/images')) {
        if(req.method()==='POST'){ const row={id:imageRows.length+1,view_angle:req.postDataJSON().view_angle};imageRows.push(row);return respond(row) }
        return respond({items:imageRows,pagination:{total:imageRows.length}})
      }
      return respond({items:[],next_cursor:null})
    })
    await page.goto(`http://127.0.0.1:4546/projects/resources?tab=${tab}`)
    const preview=page.getByRole('button',{name:'预览'+assets[0].name,exact:true})
    await preview.waitFor()
    await page.getByRole('button', { name: '筛选', exact: true }).waitFor()
    const cards=page.getByRole('article')
    const firstCard=cards.first()
    await firstCard.getByLabel('创建日期 2026/11/16',{exact:true}).waitFor()
    await firstCard.getByText('设定创建',{exact:true}).waitFor()
    await cards.nth(1).getByText('资产库导入',{exact:true}).waitFor()
    await cards.nth(2).getByText(kind==='actor'?'从角色转化':'项目转化',{exact:true}).waitFor()
    assert.equal(await cards.getByRole('link',{name:'查看库中资产',exact:true}).count(),0)
    assert.equal(await cards.getByRole('button',{name:'进入资产库',exact:true}).count(),0)
    assert.equal(await firstCard.locator('.project-resource-card-body > *').count(),3)
    const descriptionBoxes=await cards.locator('.project-resource-description').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height))
    assert.deepEqual(descriptionBoxes,[40,40,40,40],'empty and long descriptions retain the same height')
    assert.equal(await preview.locator('img').evaluate(img=>getComputedStyle(img).objectFit),kind==='scene'?'cover':'contain')
    await preview.press('Enter')
    const image=page.getByRole('dialog',{name:assets[0].name,exact:true})
    await image.getByRole('button',{name:'Close'}).click({trial:true})
    await image.getByRole('button',{name:'Close'}).focus();await page.keyboard.press('Escape');await image.waitFor({state:'hidden'})
    await preview.and(page.locator(':focus')).waitFor()
    assert.equal(await page.getByRole('button',{name:'预览'+assets[1].name,exact:true}).count(),0)
    await page.getByText('未填写简介',{exact:true}).first().waitFor()
    await page.getByText('图片加载失败',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'预览'+assets[3].name,exact:true}).count(),0)
    const search = page.getByRole('textbox', { name: '搜索项目资源' })
    const filter = page.getByRole('button', { name: /^筛选/ })
    await filter.click()
    await page.getByRole('checkbox', { name: '资产库导入' }).press('Space')
    await page.getByRole('radio', { name: '待补封面' }).press('Space')
    assert.equal(await cards.count(), 4, 'filters take effect only after applying')
    await page.getByRole('button', { name: /^应\s*用$/ }).click()
    await page.getByText('匹配 1 项', { exact: true }).waitFor()
    await page.getByRole('button', { name: assets[1].name, exact: true }).waitFor()
    await search.fill('不存在')
    await search.press('Enter')
    await page.getByText('无匹配资源', { exact: true }).waitFor()
    await filter.click()
    await page.getByRole('button', { name: '清除筛选' }).click()
    assert.equal(await search.inputValue(), '不存在')
    await search.fill('')
    await search.press('Enter')
    await page.getByText('共 4 项', { exact: true }).waitFor()

    for(const appearance of ['雾蓝微渐变','雾蓝纯色']) {
      await page.getByRole('button',{name:'用户与语言设置'}).click()
      await page.getByRole('menuitemradio',{name:appearance}).click()
      await page.getByRole('menuitemradio',{name:appearance}).waitFor({state:'hidden'})
      for(const [width,height] of [[1440,900],[1366,768],[1024,440],[375,768]]) {
        await page.setViewportSize({width,height});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    assert.ok(await page.locator('.project-resource-grid').first().evaluate(node => {
      const style = getComputedStyle(node)
      const gutter = parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--app-page-gutter'))
      const sidebar = true && window.innerWidth >= 1024 ? 216 : 0
      const expectedWidth = document.documentElement.clientWidth - sidebar - 2 * gutter
      if (Math.abs(node.getBoundingClientRect().width - expectedWidth) > 17) return false
      const columns = style.gridTemplateColumns.split(' ').map(parseFloat)
      const used = columns.reduce((sum, size) => sum + size, 0) + (columns.length - 1) * parseFloat(style.columnGap)
      const remainder = node.getBoundingClientRect().width - used
      return Math.abs(remainder) < 1
    }), 'equal-width tracks fill the content area')
      const titleEdge = (await page.getByRole('heading', { name: kind === 'scene' ? '项目场景' : `项目${label}`, exact: true }).boundingBox()).x
      const cardEdge = (await page.getByRole('article').first().boundingBox()).x
      assert.ok(Math.abs(cardEdge - titleEdge) <= 1, 'resource cards align with the content title and share one page gutter')
        await page.screenshot({path:join(output,`${kind}-${appearance}-${width}.png`),animations:'disabled'})
      }
    }
    await page.setViewportSize({width:1440,height:900})
    const originalUrl=page.url()
    await page.getByRole('button',{name:assets[0].name,exact:true}).click()
    const field=page.getByRole('textbox',{name:'名称',exact:true})
    await field.waitFor()
    await page.locator(".actor-feature-image").waitFor()
    if(kind==='character') {
      await page.getByRole('textbox',{name:'角色设定',exact:true}).waitFor()
      assert.equal(await page.getByRole('textbox',{name:'外观年龄',exact:true}).count(),0)
      assert.equal(await page.getByRole('button',{name:'智能检测与结果',exact:true}).count(),0)
    }
    await page.getByRole('button',{name:'生成图片',exact:true}).click()
    const generation=page.getByRole('dialog',{name:`生成${kind==='scene'?'场景':label}图片`,exact:true})
    await generation.waitFor()
    assert.equal(await generation.getByRole('textbox', { name: '最终提示词', exact: true }).count(), 0)
    await generation.locator('.asset-reference-item').nth(5).waitFor()
    await generation.getByRole('button', {name:/移除参考：/}).first().click()
    assert.equal(await generation.locator('.asset-reference-item').count(), 5)
    await generation.getByRole('button', {name:'重置',exact:true}).click()
    assert.equal(await generation.locator('.asset-reference-item').count(), 6)
    assert.equal(await generation.getByRole('button', {name:'重置',exact:true}).isDisabled(), true)
    for (const [modalWidth, modalHeight] of [[1440,900],[1024,440],[375,768]]) {
      await page.setViewportSize({ width: modalWidth, height: modalHeight })
      await generation.getByRole('button', { name: '预览提示词', exact: true }).click()
      await generation.getByRole('button', { name: '收起提示词预览', exact: true }).waitFor()
      const geometry = await generation.evaluate(node => {
        const content = node.querySelector('.ant-modal-content')
        const body = node.querySelector('.ant-modal-body')
        const footer = node.querySelector('.ant-modal-footer').getBoundingClientRect()
        const strip = node.querySelector('.asset-reference-strip')
        const add = node.querySelector('.asset-reference-add').getBoundingClientRect()
        if (body.scrollWidth > body.clientWidth + 1) throw new Error('弹窗正文横向溢出')
        if (Math.abs(add.width - 88) > 1 || Math.abs(add.height - 88) > 1 || getComputedStyle(strip).overflowX !== 'auto') throw new Error('参考带尺寸或滚动不符合规范')
        body.scrollTop = body.scrollHeight
        return { height: content.getBoundingClientRect().height, footerBottom: footer.bottom, bodyOverflow: getComputedStyle(body).overflowY, pageOverflow: document.documentElement.scrollHeight > innerHeight + 1 }
      })
      assert.ok(geometry.height <= modalHeight - 31)
      assert.ok(geometry.footerBottom <= modalHeight)
      assert.equal(geometry.bodyOverflow, 'auto')
      assert.equal(geometry.pageOverflow, false)
      await page.screenshot({ path: join(output, `${kind}-generation-${modalWidth}-${modalHeight}.png`), animations: 'disabled' })
      await generation.getByRole('button', { name: '收起提示词预览', exact: true }).click()
    }
    await page.setViewportSize({ width: 1440, height: 900 })

    if(kind==='actor') {
      await generation.getByRole('button',{name:'添加参考图片',exact:true}).click()
      await page.getByRole('menuitem',{name:'选择参考主体',exact:true}).click()
      const picker=page.getByRole('dialog',{name:'选择主体参考',exact:true})
      for (const [width,height] of [[1440,900],[1024,440],[375,768]]) {
        await page.setViewportSize({width,height})
        await picker.getByRole('button',{name:`选择参考资源 ${assets[0].name}`,exact:true}).waitFor()
        const fit=await picker.evaluate(node=>{const body=node.querySelector('.ant-modal-body');return body.scrollWidth<=body.clientWidth+1 && document.documentElement.scrollHeight<=innerHeight+1})
        assert.equal(fit,true)
        await page.screenshot({path:join(output,`reference-picker-${width}-${height}.png`),animations:'disabled'})
      }
      await page.setViewportSize({width:1440,height:900})
      await picker.getByRole('button',{name:`选择参考资源 ${assets[0].name}`,exact:true}).click()
      await picker.getByRole('button',{name:'查看已选',exact:true}).click()
      await picker.getByRole('button',{name:'移除',exact:true}).first().waitFor()
      await picker.getByRole('button',{name:'移除',exact:true}).first().click()
      await picker.getByRole('button',{name:'应用参考',exact:true}).click()
      assert.equal(await generation.locator('.asset-reference-item').count(),0)
      await generation.getByRole('button',{name:'重置',exact:true}).click()
      await generation.getByRole('button',{name:'添加参考图片',exact:true}).click()
      await page.getByRole('menuitem',{name:'选择参考主体',exact:true}).click()
      await picker.waitFor()
      let releaseUpload
      const uploadGate=new Promise(resolve=>{releaseUpload=resolve})
      await page.route('**/files/upload',async route=>{await uploadGate;await route.fulfill({status:503,json:{detail:'upload failed'}})})
      await picker.locator('input[type=file]').setInputFiles({name:'参考.png',mimeType:'image/png',buffer:Buffer.from('test')})
      await picker.locator('button:disabled').filter({hasText:'应用参考'}).waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await picker.isVisible(),true)
      releaseUpload()
      await picker.getByText('上传参考图失败，请重新上传',{exact:true}).waitFor()
      await page.unroute('**/files/upload')
      await page.keyboard.press('Escape')
      await generation.getByRole('button',{name:'生成',exact:true}).waitFor()
    }
    if(kind==='character') {
      await checkReferencePurposes(page,generation,output)
      await generation.getByRole('button',{name:'添加参考图片',exact:true}).click()
      for(const purpose of ['主体','服装','道具']) await page.getByRole('menuitem',{name:`选择参考${purpose}`,exact:true}).waitFor()
      await generation.getByRole('heading',{name:/本次参考/}).click()
    }
    await generation.getByRole('textbox',{name:'本次附加要求',exact:true}).fill('项目临时要求')
    await generation.getByRole('button',{name:'取消',exact:true}).click()
    await generation.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'生成图片',exact:true}).click()
    assert.equal(await generation.getByRole('textbox',{name:'本次附加要求',exact:true}).inputValue(),'项目临时要求')
    await generation.getByRole('button',{name:'生成',exact:true}).click()
    await generation.getByText(/生成提交失败/).first().waitFor()
    assert.equal(submittedModel,'m')
    assert.equal(await generation.getByRole('textbox',{name:'本次附加要求',exact:true}).inputValue(),'项目临时要求')
    await generation.getByRole('button',{name:'取消',exact:true}).click()
    await generation.waitFor({state:'hidden'})
    for(const [width,height] of [[1440,900],[1366,768],[1024,440],[375,768]]) {
      await page.setViewportSize({width,height})
      if (width <= 1024) await page.getByRole('tab', { name: '图片', exact: true }).click()
      await page.getByRole('button',{name:/^查看全部/}).waitFor()
      assert.equal(await page.locator('.project-workbench-content').evaluate(panel => {
        const body = panel.querySelector('.resource-editor-body')
        const content = body.firstElementChild
        return Math.abs(content.getBoundingClientRect().top + panel.scrollTop + body.scrollTop - panel.getBoundingClientRect().top - parseFloat(getComputedStyle(panel).paddingTop)) < 1
      }), true, `${kind} detail uses only the project content top spacing at ${width}px`)
      assert.equal(await page.locator('.resource-editor-page-heading > .ant-btn').evaluate(node => getComputedStyle(node).fontSize), '13px')
      assert.equal(await page.locator('.resource-editor-page-heading .app-page-title').evaluate(node => getComputedStyle(node).fontSize), '16px')
      assert.equal(await page.locator('.resource-editor-page-actions .ant-btn').first().evaluate(node => getComputedStyle(node).fontSize), '13px')
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false)
      if(width===1440)assert.equal(await page.locator('.resource-editor-body').evaluate(node=>node.scrollHeight<=node.clientHeight+1),true,`${kind} desktop body fits vertically`)
      if(width===1440)assert.equal(await page.locator('.project-workbench-content').evaluate(node=>node.scrollHeight<=node.clientHeight+1),true,`${kind} desktop outer panel fits vertically`)
      await page.screenshot({path:join(output,`${kind}-detail-${width}-${height}.png`),animations:'disabled'})
    }
    await page.setViewportSize({width:1440,height:900})
    await page.locator('.actor-detail-layout').waitFor()
    await field.waitFor()

    await page.getByRole('navigation',{name:'项目导航',exact:true}).getByText('资源测试项目',{exact:true}).waitFor()
    await page.screenshot({path:join(output,`${kind}-project-detail.png`),animations:'disabled'})
    assert.equal(page.url(),originalUrl)
    const back=page.getByRole('button',{name:'返回',exact:true})
    await field.fill(assets[0].name+'修改')
    await back.click()
    const leave=page.getByRole('dialog',{name:'离开资产详情',exact:true})
    await leave.getByRole('button',{name:'继续编辑',exact:true}).click()
    await leave.waitFor({state:'hidden'})
    assert.equal(await field.inputValue(),assets[0].name+'修改')
    failAssetSave=true
    await page.getByRole('button',{name:'保存设定',exact:true}).click()
    await page.getByText('保存失败',{exact:true}).waitFor()
    failAssetSave=false
    await page.getByRole('button',{name:'保存设定',exact:true}).click()
    await page.waitForFunction(() => !document.querySelector('.resource-editor-drawer .ant-btn-loading'))
    await back.click()
    const title=page.getByRole('button',{name:assets[0].name,exact:true})
    await title.and(page.locator(':focus')).waitFor()
    assert.equal(page.url(),originalUrl)

    if(kind==='character') {
      await page.goto('http://127.0.0.1:4546/projects/resources/roles/one/edit')
      await page.getByRole('textbox',{name:'角色设定',exact:true}).waitFor()
      await page.locator('.actor-feature-image').waitFor()
      await page.getByRole('button',{name:'进入资产库',exact:true}).click()
      await page.getByRole('heading',{name:'进入资产库 · 独立副本',exact:true}).waitFor()
      await page.getByRole('button',{name:'返回对象',exact:true}).click()
      await page.getByRole('textbox',{name:'角色设定',exact:true}).waitFor()
      await page.unroute('**/api/**'); continue
    }
    await page.getByRole('button',{name:assets[1].name+'更多操作',exact:true}).click()
    await page.getByRole('menuitem',{name:'删除项目对象',exact:true}).click()
    const confirm=page.getByRole('dialog').filter({hasText:'删除此项目对象'})
    await confirm.getByRole('button',{name:'删除项目对象',exact:true}).click()
    await page.getByText('删除失败',{exact:true}).waitFor();assert.equal(await confirm.isVisible(),true)
    await confirm.getByRole('button',{name:'删除项目对象',exact:true}).click();await confirm.waitFor({state:'hidden'});await page.getByRole('button',{name:assets[1].name,exact:true}).waitFor({state:'hidden'})
    assert.equal(attempts,2)
    assets[2].project_id=null
    await page.getByRole('button',{name:assets[2].name,exact:true}).click()
    await page.getByText('请先导入独立项目副本',{exact:true}).waitFor()
    assert.equal(await page.getByRole('link',{name:'在资产库编辑 ↗',exact:true}).count(),0)
    assert.equal(await page.getByRole('textbox',{name:'名称',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'生成图片',exact:true}).isDisabled(),true)
    await page.getByRole('button',{name:'返回',exact:true}).click()
    assets[2].project_id='resources'
    if(kind==='prop') {
      assets.push(...Array.from({length:14},(_,i)=>({id:`extra-${i}`,name:`道具分页${i}`,description:'分页资源', project_id:'resources',visual_style:'现实',style:'真人都市'})))
      await search.fill('分页资源')
      await search.press('Enter')
      await page.getByText('匹配 14 项', { exact: true }).waitFor()
      const pagination = page.getByRole('navigation', { name: '项目道具分页' })
      await pagination.getByTitle('2', { exact: true }).click()
      const restored = page.getByRole('button', { name: '道具分页12', exact: true })
      await restored.waitFor()
      await page.reload()
      await restored.waitFor()
      assert.equal(await search.inputValue(), '分页资源')
      await restored.click()
      await page.getByRole('textbox', { name: '名称', exact: true }).waitFor()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await restored.and(page.locator(':focus')).waitFor()
      failList = true
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await page.getByText('读取项目资源失败，仍显示上一次结果', { exact: true }).waitFor()
      await restored.waitFor()
      failList = false
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await page.getByText('读取项目资源失败，仍显示上一次结果', { exact: true }).waitFor({state:'hidden'})
      failList = true
      await search.fill('失败的查询')
      await search.press('Enter')
      await page.getByText('读取项目资源失败，仍显示上一次结果', { exact: true }).waitFor()
      failList = false
      await restored.click()
      await page.getByRole('textbox', { name: '名称', exact: true }).waitFor()
      await page.getByRole('button', { name: '生成图片', exact: true }).and(page.locator(':enabled')).waitFor()
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await restored.and(page.locator(':focus')).waitFor()
      assert.equal(await search.inputValue(), '分页资源')
      await page.setViewportSize({ width:375,height:440 })
      await pagination.getByText('13 / 14', { exact: true }).waitFor()
      await restored.waitFor()
      await page.setViewportSize({ width:1440,height:900 })
      await pagination.getByTitle('2', { exact: true }).waitFor()
      for (const index of [12, 13]) {
        await page.getByRole('button', { name: `道具分页${index}更多操作`, exact: true }).click()
        await page.getByRole('menuitem', { name: '删除项目对象', exact: true }).click()
        const confirm = page.getByRole('dialog').filter({ hasText: '删除此项目对象' })
        await confirm.getByRole('button', { name: '删除项目对象', exact: true }).click()
        await confirm.waitFor({ state: 'hidden' })
      }
      await page.getByRole('button', { name: '道具分页0', exact: true }).waitFor()
      assert.equal(await pagination.count(), 0, 'removing the last page returns to the first page')
      await search.fill('')
      await search.press('Enter')
      await page.getByText('共 15 项', { exact: true }).waitFor()
    }
    assets.forEach(asset => { asset.deleted = true })
    await page.goto(`http://127.0.0.1:4546/projects/resources?tab=${tab}`)
    await page.getByText(/暂无项目/).waitFor()
    await page.getByRole('button',{name:/新建/}).click()
    await page.getByRole('button',{name:/^填写设定/}).click()
    const create=page.getByRole('dialog',{name:kind==='scene'?'新建场景':`新建${label}`,exact:true})
    await create.waitFor()
    assert.equal(await create.locator('.actor-fields').count(),1)
    assert.equal(await create.getByText(/^详细设定/).count(),0)
    assert.equal(await create.getByRole('button',{name:'选择参考主体',exact:true}).count(),0)
    for (const field of await create.getByRole('textbox').all()) assert.equal(await field.isVisible(),true)
    for (const [width,height] of [[1440,900],[1023,768],[375,768]]) {
      await page.setViewportSize({width,height})
      await page.waitForFunction(() => {
        const panel=document.querySelector('.resource-editor-drawer .ant-drawer-content')?.getBoundingClientRect()
        const toolbar=document.querySelector('.project-content-toolbar')?.getBoundingClientRect()
        return panel && toolbar && Math.abs(panel.y-toolbar.y)<1 && Math.abs(panel.width-toolbar.width)<1
      })
      const rect=await create.boundingBox()
      const toolbar=await page.locator('.project-content-toolbar').boundingBox()
      assert.ok(Math.abs(rect.x-toolbar.x)<1)
      assert.ok(Math.abs(rect.y+rect.height-height)<1)
    }
    await page.setViewportSize({width:1440,height:900})
    await create.getByRole('button',{name:'返回',exact:true}).click()
    await create.waitFor({state:'hidden'})
    await page.unroute('**/api/**')
  }
  console.log(JSON.stringify({output,passed:true}))
} catch (error) {
  console.log('Browser evidence:', output)
  throw error
} finally {await cleanup()}
