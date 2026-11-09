import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')

/** 退役旧摄影用例沿用真实HTTP/DB页面，分别验证清理、六类编辑及卡面。 */
export async function verifyIndependentDesigns(scenario, port) {
  const root=fileURLToPath(new URL('..',import.meta.url)), output=await browserOutput('jellyfish-independent-designs-')
  const api=`http://127.0.0.1:${port+4000}`, base=`${api}/api/v1/studio/generation-canvases/canvas-project`
  const backend=spawn('uv',['run','--no-sync','python','-m','tests.generation_canvas_images_browser_server'],{cwd:join(root,'../backend'),env:{...process.env,PYTHONPATH:join(root,'../backend'),UV_CACHE_DIR:'/tmp/jellyfish-uv-cache',CANVAS_BROWSER_PORT:String(port+4000),CANVAS_BROWSER_DATABASE:join(output,'browser.sqlite'),CANVAS_BROWSER_MEDIA_STORAGE:join(output,'media')},stdio:['ignore','pipe','pipe']})
  captureBackend(backend,output)
  let browser,server
  const cleanup=browserCleanup(()=>({browser,server,backend}))
  try {
    for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await delay(250)}
    server=await createServer({root,cacheDir:join(output,'vite-cache'),server:{host:'127.0.0.1',port,strictPort:true,proxy:{'/api':api}}});await server.listen()
    browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL})
    const context=await browser.newContext({viewport:{width:1440,height:960}}), page=await context.newPage()
    await page.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
    const canvas=(await (await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'六类设计'})})).json()).data
    const types=['style','composition','camera','movement','lighting','focus']
    const compactExamples = {
      criterion: ['standard', '检查钥匙仍在人物左手。'.repeat(45)],
      fact: ['fact', '门朝里打开'],
      dialogue: ['content', '别让她发现我们已经来过'],
      event: ['action_change', '门铃响起'],
      performance_rule: ['applicability', '等待门铃停止后再起身'],
    }
    const longResult = '人物看向门口并抬起右手。'.repeat(30)
    const longAction = '先松开杯沿，再抬眼看向门口，等待对方说完才起身。'.repeat(25)
    const structuredExamples = {
      creative_control: { keep: '保留左手钥匙', allowed_range: '允许调整门的位置', freedom: '颜色自由发挥' },
      guidance: { priority: '优先交代方向', prohibitions: '不要跨轴', reference_requirements: '使用门口全景参考' },
      narrative: { information_change: '发现出口', relationship_change: '信任开始动摇', turning_point: '脚步声突然停止' },
      beat: { objective: '拿到钥匙', obstacle: '被守卫拦住', expected_change: '取得主动权' },
      shot: { visible_result: longResult, narrative_role: '揭示人物看见门口时的反应，保留等待守卫转身的停顿。'.repeat(4), estimated_duration: '约五秒，等待人物抬手并完成视线转移后切换。'.repeat(4) },
      situation: { situation: '等待来客回应', relationship: '两人刚恢复合作' },
      performance: { physical_action: longAction, reaction_order: '先听见门铃，再松开杯沿', exit_state: '起身后站定' },
      blocking: { position: '站在吧台外侧', path: '沿墙靠近门口', transition_reason: '让开门前通道' },
      activity: { task: '持续整理杯子', path: '从吧台右端移向左端', entry_exit: '由画面左侧进入' },
      environment: { activity: '窗外偶有车辆经过', empty_space: '门口区域保持安静', reason: '给主动作留出空间' },
      anchor: { position: '门口右侧，距离石柱两步。'.repeat(15), orientation: '朝向大厅', spatial_relation: '与柜台相邻' },
      space_rule: { shootable_area: '仅拍摄大厅内侧。'.repeat(15), axis: '沿门口至柜台的轴线', scale: '保留两人并排的宽度' },
      sound: { source_description: '门外传来脚步声。'.repeat(15), environment: '窗外雨声', action_sound: '钥匙碰到桌面', hierarchy: '对白优先' },
      continuity: { before: '钥匙留在桌面。'.repeat(15), change: '左手拾起钥匙', after: '左手握住钥匙', following_constraints: '下一镜维持同一只手' },
    }
    const groupedSummary = {
      sound: [structuredExamples.sound.source_description, '环境声：窗外雨声\n动作声：钥匙碰到桌面', '对白优先'],
      continuity: ['手部与道具', `前态：${structuredExamples.continuity.before}\n变化：待确定\n后态：左手握住钥匙`, '下一镜维持同一只手'],
    }
    const fieldKeys=['direction','composition','viewpoint','movement_path','light_sources','depth_focus']
    const fieldLabels=['风格方向','构图重心','观察视点','运动路径','光源','景深与焦点']
    const cards=types.map((kind,i)=>({id:kind,type:'direction.'+kind,fields:{[fieldKeys[i]]:{text:`独立设计${i}`,state:'fact'}}}))
    const movementStart = '先从门外远处沿着走廊看向被门框遮挡的人物。'.repeat(10)
    if(scenario==='summaries') {
      cards[0].fields.visual_features = { text: '用柔和窗光与深色墙面分开人物轮廓。'.repeat(12), authorship: 'user' }
      cards[1].fields.shot_size = { size: 'medium', state: 'fact' }
      cards[1].frame_target = { card_id: 'movement', state_id: 'phase:pause' }
      cards[2].fields.height_angle = { text: '视线高度保持水平', authorship: 'user' }
      Object.assign(cards[3].fields, {
        movement_start: { text: movementStart, authorship: 'user' },
        end_frame: { text: '停在窗边人物的反应', authorship: 'user' },
        movement_trigger: { text: '人物抬手后开始移动', authorship: 'user' },
      })
      cards[3].phases = [{ id: 'pause', name: '门框停顿', frame: { text: '门框左侧保持一半留白', authorship: 'user' } }]
      cards[4].fields.light_direction = { text: '窗外从左后方补光', authorship: 'user' }
      cards[5].fields.focus_change = { text: '由近处钥匙转向人物', authorship: 'user' }
    }
    if(scenario==='summaries')cards.push(
      ...types.map(kind=>({id:'empty-'+kind,type:'direction.'+kind})),
      {id:'stage-only',type:'direction.movement',phases:[{id:'draft',name:'待定落幅'.repeat(30),frame:{state:'empty'}}]},
      {id:'size-only',type:'direction.composition',fields:{shot_size:{state:'fact',size:'close_up'}}},
      {id:'scope-only',type:'direction.style',scope:{description:'整场黄昏'}},
      {id:'fact-only',type:'direction.focus',fields:{depth_focus:{state:'fact'}}},
      {id:'state-only',type:'direction.camera',fields:{viewpoint:{state:'not_applicable'}}},
      {id:'doc-only',type:'direction.lighting',fields:{light_sources:{state:'proposal',document:{segments:[{id:'literal',kind:'text',text:'窗外斜射光'}]}}}},
      {id:'person',type:'content.character',object_id:'person-id',name:'张三'},
      {id:'relation-only',type:'direction.focus',input_bindings:[{id:'person-use',input_port:'focus_object',source:{canvas_id:canvas.id,card_id:'person',port_id:'object',position:0,object_id:'person-id'}}]}
    )
    if(scenario==='summaries') {
      const catalog=(await (await fetch(`${base}/${canvas.id}/catalog`)).json()).data.cards
      const otherDesigns=catalog.filter(card=>card.type.startsWith('direction.') && !types.includes(card.type.slice('direction.'.length)))
      assert.equal(otherDesigns.length,19)
      cards.push(...otherDesigns.map(card => {
        const kind = card.type.slice('direction.'.length)
        const sample = compactExamples[kind]
        return { id: kind, type: card.type, ...(kind === 'dialogue' ? { dialogue_id: 'geometry-dialogue' } : {}),
          ...(sample ? { [sample[0]]: { state: 'fact', text: sample[1] } } : {}),
          ...Object.fromEntries(Object.entries(structuredExamples[kind] || {}).reverse().map(([key, value]) => [key, { authorship: 'user', text: value }])) }
      }))
      cards.push(...Object.keys(compactExamples).filter(kind => kind !== 'criterion').map(kind => ({
        id: 'empty-' + kind, type: 'direction.' + kind, ...(kind === 'dialogue' ? { dialogue_id: 'empty-dialogue' } : {})
      })))
      cards.push({ id: 'middle-fact', type: 'direction.fact', fact: { state: 'fact', text: '门朝里打开再把钥匙放回桌面。'.repeat(4) } })
      cards.find(card => card.id === 'criterion').name = '道具连续性验收'
      cards.find(card => card.id === 'criterion').scope = { description: '只核对镜头末尾' }
      cards.find(card => card.id === 'guidance').sound_strategy = { authorship: 'user', text: '仅保留脚步声' }
      cards.find(card => card.id === 'narrative').viewpoint = { authorship: 'user', text: '从门外观察' }
      cards.find(card => card.id === 'beat').audience_must_see = { authorship: 'user', text: '必须看到手里的钥匙' }
      cards.find(card => card.id === 'shot').name = '门口反应镜头'
      cards.find(card => card.id === 'performance').avoid = { authorship: 'user', text: '避免提前抬头' }
      cards.find(card => card.id === 'anchor').name = '厅门旁'
      cards.find(card => card.id === 'space_rule').spatial_basis = { authorship: 'user', text: '以大厅参考图为准' }
      cards.find(card => card.id === 'sound').music = { authorship: 'user', text: '不铺设额外音乐' }
      Object.assign(cards.find(card => card.id === 'continuity'), { category: 'hands_props', change: { state: 'undecided' } })
      cards.push(
        { id: 'empty-criterion', type: 'direction.criterion' },
        { id: 'scope-only-criterion', type: 'direction.criterion', scope: { condition: '当钥匙入画时' } },
        { id: 'scope-only-guidance', type: 'direction.guidance', scope: { description: '仅用于门厅' } },
        { id: 'empty-creative-control', type: 'direction.creative_control' },
        { id: 'state-only-beat', type: 'direction.beat', obstacle: { state: 'absent' } },
        { id: 'empty-continuity', type: 'direction.continuity' },
        { id: 'music-only-sound', type: 'direction.sound', music: { authorship: 'user', text: '仅保留尾声音乐' } },
      )
    }
    if(scenario==='retirement')cards.push({id:'old',type:'direction.photography'},{id:'model',type:'model.text',input_bindings:[{id:'old-use',input_port:'text',source:{canvas_id:canvas.id,card_id:'old',port_id:'text',position:0},photography_scope:['whole']}]})
    const document={...canvas.document,cards,edges:scenario==='retirement'?[{id:'retired',source_card:'old',source_port:'text',target_card:'model',target_port:'text'}]:[],input_order:{}}
    const compactLayoutKey = `jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
    const compactPositions = { criterion: { x: 200, y: 220 }, fact: { x: 620, y: 220 }, movement: { x: 1020, y: 100 }, style: { x: 1440, y: 100 }, shot: { x: 200, y: 540 }, guidance: { x: 620, y: 540 }, performance: { x: 1020, y: 540 }, blocking: { x: 1440, y: 540 }, sound: { x: 200, y: 865 }, continuity: { x: 620, y: 865 } }
    if (scenario === 'summaries') {
      document.edges.push(
        { id: 'movement-composition', source_card: 'movement', source_port: 'text', target_card: 'composition', target_port: 'text' },
        { id: 'person-focus', source_card: 'person', source_port: 'object', target_card: 'relation-only', target_port: 'focus_object' },
        { id: 'style-criterion', source_card: 'style', source_port: 'text', target_card: 'criterion', target_port: 'text' },
        { id: 'shot-criterion', source_card: 'shot', source_port: 'text', target_card: 'criterion', target_port: 'text' },
        { id: 'performance-criterion', source_card: 'performance', source_port: 'text', target_card: 'criterion', target_port: 'text' },
      )
      document.input_order['relation-only'] = { focus_object: ['person-focus'] }
      document.input_order.composition = { text: ['movement-composition'] }
      document.input_order.criterion = { text: ['style-criterion', 'shot-criterion', 'performance-criterion'] }
      document.groups = [
        { id: 'existing-group', name: '验收依据', card_ids: ['criterion', 'fact'] },
        { id: 'existing-shot-group', name: '镜头依据', card_ids: ['shot', 'guidance'] },
        { id: 'existing-performance-group', name: '表演与走位', card_ids: ['performance', 'blocking'] },
      ]
      await page.addInitScript(({ key, positions }) => {
        if (sessionStorage.getItem('compact-layout-seeded')) return
        localStorage.setItem(key, JSON.stringify({ schema: 1, positions, sizes: { criterion: { width: 360, height: 368 }, shot: { width: 360, height: 368 }, performance: { width: 360, height: 368 } },
          transform: { x: 24, y: 32, scale: 1 }, manuallyPlaced: Object.keys(positions) }))
        sessionStorage.setItem('compact-layout-seeded', 'true')
      }, { key: compactLayoutKey, positions: compactPositions })
    }
    const saved=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})});assert.ok(saved.ok,await saved.text())
    const read=async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
    const poll=async predicate=>{for(let i=0;i<80;i++){if(predicate(await read()))return;await delay(100)}throw Error('save timeout')}
    await page.goto(`http://127.0.0.1:${port}/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
    const detail=page.locator('.wb-details:visible')
    if(scenario==='retirement'){
      assert.equal(await page.locator('[data-card-type="direction.photography"]').count(),0)
      await page.locator('[data-card-id="model"]').press('Enter')
      const inspection=detail.getByRole('button',{name:'打开模型配置与检查',exact:true});if(await inspection.count())await inspection.click()
      await detail.getByText('旧摄影设计已移除，需要补充设计依据',{exact:true}).waitFor()
      await page.screenshot({path:join(output,'missing-design.png')})
      assert.ok((await (await fetch(`${base}/${canvas.id}/cards/model/compile`)).json()).data.diagnostics.some(item=>item.code==='DESIGN_BASIS_MISSING'))
      await detail.getByRole('button',{name:'已处理缺失设计',exact:true}).click();await poll(s=>s.document.cards.find(c=>c.id==='model').missing_designs.length===0)
      await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'})
    }
    const assertDesignGeometry = async target => {
      await target.locator('[data-card-id="criterion"]').waitFor({ state: 'attached' })
      const boxes = await target.locator('[data-card-type^="direction."]').evaluateAll(cards => cards.map(card => {
        const body = card.querySelector('.generation-card-body')
        return { id: card.dataset.cardId, type: card.dataset.cardType, width: card.offsetWidth, height: card.offsetHeight,
          extra: (body.getBoundingClientRect().bottom - body.querySelector('.visual-design-card').getBoundingClientRect().bottom)
            * card.offsetHeight / card.getBoundingClientRect().height
            - parseFloat(getComputedStyle(body).paddingBottom) - body.offsetHeight + body.clientHeight,
          overflow: body.scrollHeight - body.clientHeight }
      }))
      assert.equal(boxes.length, cards.length - 1)
      for (const { id, type, width, height, extra, overflow } of boxes) {
        const kind = type.slice('direction.'.length)
        const heightByType = Object.hasOwn(compactExamples, kind) ? (id === 'criterion' ? 192 : id === 'middle-fact' ? 160 : 128) : Object.hasOwn(structuredExamples, kind) ? 304 : 368
        assert.deepEqual({ width, height }, { width: 360, height: heightByType }, id)
        assert.ok(overflow <= 1, id + ': card body contains its full summary')
        if (Object.hasOwn(compactExamples, kind) && height > 128) assert.ok(extra >= -1 && extra < 32, id + ': compact summary uses the smallest fitting band')
      }
    }
    if(scenario==='summaries') {
      const names=['画面风格','景别与构图','机位与视角','运镜','光影与色彩','焦点与成像']
      await assertDesignGeometry(page)
      for (const [id, fields] of Object.entries(structuredExamples)) {
        const card = page.locator(`[data-card-id="${id}"]`)
        assert.deepEqual(await card.getByRole('definition').allInnerTexts(), groupedSummary[id] || Object.values(fields), id + ': author content follows summary priorities')
        assert.equal(await card.getByRole('img', { name: /用途示意/ }).count(), 0, id + ': structured card omits the generic illustration')
      }
      await page.locator('[data-card-id="empty-continuity"]').getByText('尚未填写连续性设计', { exact: true }).waitFor({ state: 'attached' })
      await page.setViewportSize({ width: 1440, height: 1240 })
      const continuity = page.locator('[data-card-id="continuity"]')
      const firstState = await continuity.getByText('前态：' + structuredExamples.continuity.before, { exact: true }).evaluate(node => ({ width: node.clientWidth, content: node.scrollWidth }))
      assert.ok(firstState.content > firstState.width, 'long before text is truncated on its own line: ' + JSON.stringify(firstState))
      const stateOffsets = await Promise.all(['变化：待确定', '后态：左手握住钥匙'].map(text =>
        continuity.getByText(text, { exact: true }).evaluate(node => node.getBoundingClientRect().top)))
      assert.ok(stateOffsets[1] > stateOffsets[0], 'later continuity states retain their own visible lines')
      const musicOnly = page.locator('[data-card-id="music-only-sound"]')
      await musicOnly.getByText('尚未填写声音安排', { exact: true }).waitFor({ state: 'attached' })
      await musicOnly.getByText('仅保留尾声音乐', { exact: true }).waitFor({ state: 'attached' })
      const soundCard = page.locator('[data-card-id="sound"]')
      assert.equal(await soundCard.getByText('不铺设额外音乐', { exact: true }).count(), 0)
      await soundCard.screenshot({ path: join(output, 'structured-sound-desktop.png'), animations: 'disabled' })
      await page.setViewportSize({ width: 1440, height: 960 })
      await soundCard.press('Enter')
      const soundAdvanced = detail.getByRole('button', { name: '高级设置', exact: true })
      if (await soundAdvanced.count()) await soundAdvanced.click()
      assert.equal(await detail.getByRole('textbox', { name: '音乐约束内容', exact: true }).innerText(), '不铺设额外音乐')
      await detail.getByRole('button', { name: '关闭详情', exact: true }).click()
      const shot = page.locator('[data-card-id="shot"]')
      assert.equal(await shot.getByText('门口反应镜头', { exact: true }).count(), 1)
      assert.deepEqual(await shot.evaluate(card => [card.style.left, card.style.top]), ['200px', '540px'])
      const lineBoxes = await shot.getByRole('definition').evaluateAll(nodes => nodes.map(node => ({ visible: node.clientHeight, content: node.scrollHeight, lineHeight: parseFloat(getComputedStyle(node).lineHeight) })))
      for (const box of lineBoxes) {
        assert.ok(box.content > box.visible && Math.abs(box.visible - box.lineHeight * 2) <= 1, 'each long structured value uses at most two lines')
      }
      assert.equal(await page.locator('[data-group-id="existing-shot-group"]').evaluate(node => node.offsetHeight), 368, 'group fits the new structured height')
      assert.equal(await page.locator('[data-group-id="existing-performance-group"]').evaluate(node => node.offsetHeight), 368, 'existing performance group fits the structured height')
      for (const id of ['shot', 'performance']) {
        const endpoint = await page.locator(`[data-generation-edge-id="${id}-criterion"] .canvas-edge-line`).evaluate((path, sourceId) => {
          const point = path.getPointAtLength(0).matrixTransform(path.getScreenCTM())
          const box = document.querySelector(`[data-card-id="${sourceId}"]`).getBoundingClientRect()
          return { x: point.x, y: point.y, left: box.left, right: box.right, center: box.top + box.height / 2 }
        }, id)
        assert.ok(Math.min(Math.abs(endpoint.x - endpoint.left), Math.abs(endpoint.x - endpoint.right)) < 1 && Math.abs(endpoint.y - endpoint.center) < 1, id + ': connected edge follows the structured card')
      }
      await page.getByRole('button', { name: '布局', exact: true }).click()
      await page.getByRole('button', { name: '展开小地图', exact: true }).click()
      assert.equal(await page.getByRole('img', { name: '小地图导航' }).locator('[data-minimap-node="shot"]').getAttribute('height'), '304')
      assert.equal(await page.getByRole('img', { name: '小地图导航' }).locator('[data-minimap-node="performance"]').getAttribute('height'), '304')
      await page.getByRole('button', { name: '关闭小地图', exact: true }).click()
      const scopeOnlyGuidance = page.locator('[data-card-id="scope-only-guidance"]')
      await scopeOnlyGuidance.getByText('尚未填写生成指导', { exact: true }).waitFor({ state: 'attached' })
      await scopeOnlyGuidance.getByText('仅用于门厅', { exact: true }).waitFor({ state: 'attached' })
      await page.locator('[data-card-id="empty-creative-control"]').getByText('尚未填写创作控制', { exact: true }).waitFor({ state: 'attached' })
      await page.locator('[data-card-id="state-only-beat"]').getByRole('definition').filter({ hasText: '明确没有' }).waitFor({ state: 'attached' })
      await shot.screenshot({ path: join(output, 'structured-shot-desktop.png'), animations: 'disabled' })
      await shot.press('Enter')
      const advanced = detail.getByRole('button', { name: '高级设置', exact: true })
      if (await advanced.count()) await advanced.click()
      assert.equal(await detail.getByRole('textbox', { name: '可见结果内容', exact: true }).innerText(), longResult)
      await detail.getByRole('button', { name: '关闭详情', exact: true }).click()
      const performance = page.locator('[data-card-id="performance"]')
      const actionBox = await performance.getByRole('definition').first().evaluate(node => ({ visible: node.clientHeight, content: node.scrollHeight, lineHeight: parseFloat(getComputedStyle(node).lineHeight) }))
      assert.ok(actionBox.content > actionBox.visible && Math.abs(actionBox.visible - actionBox.lineHeight * 2) <= 1, 'long performance action is shown in two lines')
      assert.deepEqual(await performance.evaluate(card => [card.style.left, card.style.top]), ['1020px', '540px'], 'performance retains its historical position')
      await performance.screenshot({ path: join(output, 'structured-performance-desktop.png'), animations: 'disabled' })
      await performance.press('Enter')
      if (await advanced.count()) await advanced.click()
      assert.equal(await detail.getByRole('textbox', { name: '身体动作内容', exact: true }).innerText(), longAction)
      await detail.getByRole('tab', { name: /表现细节/ }).click()
      assert.equal(await detail.getByRole('textbox', { name: '避免的表现内容', exact: true }).innerText(), '避免提前抬头')
      await detail.getByRole('button', { name: '关闭详情', exact: true }).click()
      for (const [id, [, text]] of Object.entries(compactExamples)) {
        const card = page.locator(`[data-card-id="${id}"]`)
        await card.getByRole('definition').filter({ hasText: text }).waitFor({ state: 'attached' })
        assert.equal(await card.getByRole('img', { name: /用途示意/ }).count(), 0, id + ': compact card omits a purpose illustration')
      }
      const criterion = page.locator('[data-card-id="criterion"]')
      assert.equal(await criterion.getByText('道具连续性验收', { exact: true }).count(), 1, 'name appears only in the title')
      await criterion.getByText('只核对镜头末尾', { exact: true }).waitFor({ state: 'attached' })
      await page.locator('[data-card-id="empty-criterion"]').getByText('尚未填写验收要求', { exact: true }).waitFor({ state: 'attached' })
      const scopeOnly = page.locator('[data-card-id="scope-only-criterion"]')
      await scopeOnly.getByText('尚未填写验收要求', { exact: true }).waitFor({ state: 'attached' })
      await scopeOnly.getByText('当钥匙入画时', { exact: true }).waitFor({ state: 'attached' })
      const core = criterion.getByRole('definition').filter({ hasText: compactExamples.criterion[1] })
      const coreGeometry = await core.evaluate(node => ({ visible: node.clientHeight, content: node.scrollHeight, lineHeight: parseFloat(getComputedStyle(node).lineHeight) }))
      assert.ok(coreGeometry.content > coreGeometry.visible, 'the long criterion is visibly truncated')
      assert.ok(coreGeometry.visible <= coreGeometry.lineHeight * 4 + 1, 'the core fits four lines')
      const before = await criterion.evaluate(card => [card.style.left, card.style.top])
      assert.deepEqual(before, ['200px', '220px'], 'old cache position is retained')
      assert.equal(await page.locator('[data-group-id="existing-group"]').evaluate(node => node.offsetHeight), 256, 'group fits the new compact card height')
      const endpoint = await page.locator('[data-generation-edge-id="style-criterion"] .canvas-edge-line').evaluate(path => {
        const point = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM())
        const box = document.querySelector('[data-card-id="criterion"]').getBoundingClientRect()
        return { x: point.x, y: point.y, right: box.right, center: box.top + box.height / 2 }
      })
      assert.ok(Math.abs(endpoint.x - endpoint.right) < 1 && Math.abs(endpoint.y - endpoint.center) < 1, 'connected edge follows the compact card')
      const cache = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), compactLayoutKey)
      assert.deepEqual(cache.transform, { x: 24, y: 32, scale: 1 })
      assert.deepEqual(cache.sizes.criterion, { width: 360, height: 192 })
      assert.deepEqual(cache.sizes.shot, { width: 360, height: 304 })
      assert.deepEqual(cache.sizes.performance, { width: 360, height: 304 })
      await criterion.screenshot({ path: join(output, 'compact-criterion-desktop.png'), animations: 'disabled' })
      await page.getByRole('button', { name: '布局', exact: true }).click()
      await page.getByRole('button', { name: '展开小地图', exact: true }).click()
      await criterion.locator('.generation-card-body').click()
      await detail.waitFor()
      const standard = detail.getByRole('textbox', { name: '可观察判断标准内容', exact: true })
      assert.equal(await standard.innerText(), compactExamples.criterion[1])
      const shortStandard = '确认钥匙在左手'
      const expectCriterionHeight = async height => {
        await page.waitForFunction(height => document.querySelector('[data-card-id="criterion"]').offsetHeight === height, height)
        assert.equal(await page.locator('[data-minimap-node="criterion"]').getAttribute('height'), String(height))
        const edgeOffset = await page.locator('[data-generation-edge-id="style-criterion"] .canvas-edge-line').evaluate(path => {
          const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(path.getScreenCTM())
          const box = document.querySelector('[data-card-id="criterion"]').getBoundingClientRect()
          return Math.abs(end.y - box.top - box.height / 2)
        })
        assert.ok(edgeOffset < 1, 'edge follows the actual locked or unlocked height')
      }
      await standard.fill(shortStandard)
      await criterion.getByRole('definition').filter({ hasText: shortStandard }).waitFor({ state: 'attached' })
      await expectCriterionHeight(192)
      await detail.getByRole('button', { name: '关闭详情', exact: true }).click()
      await expectCriterionHeight(128)
      await criterion.screenshot({ path: join(output, 'compact-criterion-short.png'), animations: 'disabled' })
      await criterion.press('Enter')
      await standard.fill(compactExamples.criterion[1])
      const latestCore = criterion.getByRole('definition').filter({ hasText: compactExamples.criterion[1] })
      await latestCore.waitFor({ state: 'attached' })
      await expectCriterionHeight(128)
      const lockedLines = await latestCore.evaluate(node => node.clientHeight / parseFloat(getComputedStyle(node).lineHeight))
      assert.ok(lockedLines >= 1 && lockedLines < 4, 'locked card shows only complete lines of the latest core')
      await criterion.screenshot({ path: join(output, 'compact-criterion-locked.png'), animations: 'disabled', style: '.ant-modal-root { visibility: hidden }' })
      await detail.getByRole('button', { name: '关闭详情', exact: true }).click()
      await expectCriterionHeight(192)
      await page.getByRole('button', { name: '关闭小地图', exact: true }).click()
      await poll(state => (state.document.cards.find(card => card.id === 'criterion').standard?.text || '') === compactExamples.criterion[1])
      assert.deepEqual(await criterion.evaluate(card => [card.style.left, card.style.top]), before)
      await page.reload()
      await criterion.waitFor({ state: 'attached' })
      assert.deepEqual(await criterion.evaluate(card => [card.style.left, card.style.top]), before)
      assert.equal(await page.getByRole('button', { name: /^(开始设计|编辑设计|查看设计|编辑卡片)$/ }).count(), 0)
      assert.equal(await page.getByText(/^另有 .* 项配置$/).count(), 0)
      for(let i=0;i<types.length;i++) {
        const card=page.locator(`[data-card-id="${types[i]}"]`)
        await card.getByRole('img',{name:names[i]+'用途示意',exact:true}).waitFor({state:'attached'})
        const empty=page.locator(`[data-card-id="empty-${types[i]}"]`)
        await empty.getByText('尚未填写'+names[i],{exact:true}).waitFor({state:'attached'})
      }
      const visualLabels = {
        style: ['风格方向', '视觉特征'],
        composition: ['景别', '构图重心', '画面目标'],
        camera: ['观察视点', '高度与角度'],
        movement: ['起始画面', '结束画面', '运动路径'],
        lighting: ['光源', '光线方向'],
        focus: ['景深与焦点', '焦点变化'],
      }
      for (const [id, labels] of Object.entries(visualLabels)) {
        const card = page.locator(`[data-card-id="${id}"]`)
        assert.deepEqual(await card.locator('dt').allTextContents(), labels, id + ': actual design priorities')
        const lines = await card.getByRole('definition').evaluateAll(rows => rows.map(row => ({
          visible: row.clientHeight, full: row.scrollHeight, lineHeight: parseFloat(getComputedStyle(row).lineHeight),
        })))
        const visibleLines = lines.reduce((sum, row) => sum + Math.round(row.visible / row.lineHeight), 0)
        assert.ok(visibleLines <= 4, id + ': at most four visible summary lines')
        if (id === 'movement') assert.equal(visibleLines, 4, 'long start and two short movement fields use the available four lines')
        if (id === 'style' || id === 'movement') assert.ok(lines.some(row => row.full > row.visible), id + ': long parameter is truncated')
      }
      await page.locator('[data-card-id="composition"]').getByRole('definition').filter({hasText:'运镜阶段 · 门框停顿'}).waitFor({state:'attached'})
      await page.locator('[data-card-id="scope-only"]').getByText('尚未填写画面风格',{exact:true}).waitFor({state:'attached'})
      const visualMovement = page.locator('[data-card-id="movement"]')
      const movementBox = await visualMovement.boundingBox()
      assert.equal(await page.evaluate(({x,y,width,height}) => document.elementFromPoint(x+width/2,y+height/2)?.closest('[data-card-id]')?.dataset.cardId,movementBox),'movement')
      await visualMovement.screenshot({path:join(output,'visual-movement-desktop.png'),animations:'disabled'})
      for(const [id,text] of [['stage-only','阶段待填写'],['size-only','特写'],['scope-only','整场黄昏'],['state-only','不适用'],['fact-only','事实'],['doc-only','提议：窗外斜射光'],['relation-only','张三']]) {
        const card=page.locator(`[data-card-id="${id}"]`)
        await card.getByRole('definition').filter({hasText:text}).waitFor({state:'attached'})
      }
      const figures=await page.locator('.visual-design-card .design-purpose svg').evaluateAll(nodes=>nodes.map(node=>Math.round(node.getBoundingClientRect().height)))
      assert.equal(figures.length,cards.length-1-Object.keys(compactExamples).length-2-Object.keys(structuredExamples).length-5,'only designs using the illustration layout have purpose illustrations')
      assert.equal(new Set(figures).size,1,'type-specific illustrations keep the same visible height')
      assert.equal(await page.locator('.visual-design-card dl').evaluateAll(nodes=>nodes.every(node=>node.children.length<=3)),true,'cards keep at most three labelled summary rows')
      assert.equal(await page.locator('.visual-design-card dl > div').evaluateAll(nodes=>nodes.every(node=>{const row=node.getBoundingClientRect();return [...node.children].every(child=>{const r=child.getBoundingClientRect();return r.left>=row.left-1&&r.right<=row.right+1})})),true,'long stage labels and values remain inside the summary')
      await assertDesignGeometry(page)
      await page.screenshot({path:join(output,'unified-design-cards-desktop.png'),animations:'disabled'})
    }
    for(let i=0;i<types.length;i++){
      const kind=types[i], card=page.locator(`[data-card-id="${kind}"]`)
      await card.press('Enter')
      await detail.getByRole('button',{name:'返回预设',exact:true}).waitFor()
      await detail.getByRole('button',{name:'返回预设',exact:true}).click()
      assert.equal(await detail.getByRole('tab').count(),0)
      await detail.getByRole('button',{name:'高级设置',exact:true}).click()
      const field=detail.getByRole('textbox',{name:fieldLabels[i]+'内容',exact:true});assert.equal(await field.evaluate(element => 'value' in element ? element.value : element.innerText),`独立设计${i}`)
      if(scenario==='editor'){
        await field.fill(`已编辑${kind}`);await poll(s=>s.document.cards.find(c=>c.id===kind).fields[fieldKeys[i]].text===`已编辑${kind}`)
        assert.equal(await detail.getByRole('switch',{name:'显示状态与来源',exact:true}).count(),0);assert.equal(await detail.getByRole('combobox',{name:fieldLabels[i]+'状态',exact:true}).count(),0)
        await detail.getByRole('button',{name:'返回预设',exact:true}).click();await detail.getByRole('button',{name:/预览 /}).first().click()
        await detail.getByRole('button',{name:'高级设置',exact:true}).click();assert.equal(await field.evaluate(element => 'value' in element ? element.value : element.innerText),`已编辑${kind}`)
      }
      await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
    }
    await page.setViewportSize({width:390,height:844});await page.locator('[data-card-id="composition"]').press('Enter');await detail.getByRole('button',{name:'返回预设',exact:true}).waitFor()
    await page.screenshot({path:join(output,`${scenario}-mobile.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    if(scenario==='summaries') {
      const observer=await context.newPage()
      await observer.setViewportSize({width:390,height:844})
      const touch=await context.newCDPSession(observer)
      await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1})
      await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}});await observer.goto(page.url())
      await observer.getByText('此画布当前只读',{exact:true}).waitFor()
      assert.equal(await observer.evaluate(()=>matchMedia('(pointer: coarse)').matches),true)
      await assertDesignGeometry(observer)
      await observer.getByRole('button',{name:'适应全部',exact:true}).click()
      await observer.screenshot({path:join(output,'unified-design-cards-readonly-touch.png'),animations:'disabled'})
      const target = observer.locator('[data-card-id="criterion"] .generation-card-body')
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox()
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await observer.locator('.wb-details:visible').waitFor()
      await observer.close()
    }
    const catalog=(await (await fetch(`${base}/${canvas.id}/catalog`)).json()).data.cards.filter(c=>c.category==='画面设计');assert.equal(catalog.length,6);assert.ok(catalog.every(c=>c.outputs[0].adoption==='whole_card'&&c.entries.length===0))
    console.log(`PASS ${scenario}: six independent designs, no legacy navigation, saved fields, narrow layout`)
  } finally {await cleanup()}
}
