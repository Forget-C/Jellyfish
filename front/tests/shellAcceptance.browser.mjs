import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = process.env.SHELL_EVIDENCE_DIR || '/tmp/jellyfish-shell-acceptance'
await mkdir(output, { recursive: true })
process.chdir(root)
const workspace = makeWorkspace()
workspace.sequence.title = '旧信重逢'
const project = { id: 'p1', name: '旧信', description: '布局验收项目', style: '现实主义', visual_style: '现实', progress: 25, stats: { chapters: 1, roles: 1, updated_at: '2026-09-15 10:00' } }
const chapter = { id: 'ch1', project_id: 'p1', index: 2, title: '第二章', raw_text: '他递出旧信，她认出了他。', status: 'draft', sequence_count: 1 }
const asset = { id: 'a1', name: '旧信档案', description: '用于检查长表单和工作区滚动。'.repeat(20), tags: ['验收'], visual_style: '现实', style: '现实主义', view_count: 1 }
const agent = { id: 'agent1', name: '剧情提取', description: '检查 Agent 编辑与保存入口', type: 'plot', createdBy: '布局验收', updatedAt: '2026-09-15', enabled: true, version: '1.0' }
const list = items => ({ items, total: items.length, page: 1, page_size: 100, pagination: { total: items.length, page: 1, page_size: 100, total_pages: 1 } })
const provider = { id: 'provider1', name: 'openai', base_url: 'https://example.invalid', description: '布局验收供应商', status: 'active' }
const model = { id: 'model1', name: '验收文本模型', category: 'text', provider_id: 'provider1', params: {}, description: '隔离测试模型，不发起生成' }
const sessions = ['text', 'image', 'video'].map(lab_type => ({ id: `session-${lab_type}`, title: `${lab_type} 历史会话`, lab_type, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }))
let taskRows = [], failProject = false
const results = [], errors = [], requests = [], interactions = []
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4184, strictPort: true, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN' })
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => { errors.push({ url: page.url(), error: error.message }); console.log('PAGE ERROR', error.stack) })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    requests.push({ method: request.method(), path })
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (path.includes('/test-image/')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="288"><rect width="192" height="288" fill="#eaf3ff"/><rect x="32" y="64" width="128" height="160" rx="6" fill="white" stroke="#1677ff"/><path d="M48 96h96M48 120h96M48 144h64" stroke="#1677ff" stroke-width="4"/></svg>' })
    if (path === '/api/agents') return route.fulfill({ json: [agent] })
    if (path === '/api/agents/agent1') return route.fulfill({ json: agent })
    if (path === '/api/v1/studio/files') return respond(list([]))
    if (path.endsWith('/film/tasks')) return respond({ items: taskRows, next_cursor: null })
    if (path.endsWith('/film/tasks/task1/cancel')) { taskRows[0].cancel_requested = true; return respond({ task_id: 'task1', cancel_requested: true }) }
    if (path.endsWith('/providers')) return respond(list([provider]))
    if (path.endsWith('/models')) return respond(list([model]))
    if (path.endsWith('/projects')) return respond(list([project]))
    if (path.endsWith('/projects/p2')) return respond({ ...project, id: 'p2', name: '第二个项目' })
    if (path.endsWith('/projects/p1')) return failProject ? route.fulfill({ status: 503, json: { detail: '测试加载失败' } }) : respond(project)
    if (path.endsWith('/chapters/ch1') && !path.includes('/directing/')) return respond(chapter)
    if (path.endsWith('/chapters')) return respond(list([chapter]))
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.endsWith('/directing/chapters/ch1/assembly')) return respond({ chapter_id: 'ch1', title: chapter.title, sequences: [], transitions: [], gaps: [] })
    if (path.endsWith('/directing/chapters/ch1/overview')) return respond({ chapter_id: 'ch1', title: chapter.title, raw_text: chapter.raw_text, source_version: 1, sequences: [workspace.sequence], task_ids: [] })
    if (path.endsWith('/directing/chapters/ch1')) return respond({ chapter_id: 'ch1', title: chapter.title, raw_text: chapter.raw_text, source_version: 1, sequences: [workspace.sequence], task_ids: [] })
    if (path.endsWith('/s1/feedback')) return respond({ active_cut_revision_id: 'c-active', current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/s1/continuity')) return respond({ active_cut_revision_id: 'c-active', frames: [], seams: [], units: [] })
    if (/\/entities\/[^/]+\/a1$/.test(path)) { if (request.method() === 'PATCH') Object.assign(asset, request.postDataJSON()); return respond(asset) }
    if (/\/entities\/[^/]+$/.test(path)) return respond(list([asset]))
    if (path.endsWith('/images')) return respond(list([{ id: 1, view_angle: 'FRONT', file_id: 'test-image', width: 192, height: 288, format: 'svg' }]))
    if (path.endsWith('/style-options')) return respond({ visual_styles: ['现实', '动漫'], styles: ['现实主义'] })
    if (path.endsWith('/experiment-sessions')) return respond(sessions.filter(item => item.lab_type === url.searchParams.get('lab_type')))
    if (path.endsWith('/messages')) return respond(Array.from({ length: 12 }, (_, index) => ({ id: `message-${index}`, session_id: path.split('/').at(-2), role: 'user', sequence: index, content: `第 ${index + 1} 条历史提示词，用于检查长历史与输入区的独立滚动。`, payload: {}, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' })))
    if (path.endsWith('/providers/supported')) return respond([])
    if (path.endsWith('/model-settings')) return respond({ id: 1, api_timeout: 60, log_level: 'INFO' })
    if (/\/(styles|assets|batches|categories)$/.test(path)) return respond([])
    return respond(list([]))
  })
  const routes = [
    ['home', '/'], ['projects', '/projects'], ['project', '/projects/p1'],
    ['role', '/projects/p1/roles/a1/edit'], ['chapter', '/projects/p1/chapters/ch1/sequences'],
    ['assets', '/assets'], ...['actors', 'scenes', 'props', 'costumes'].map(type => [type, `/assets/${type}/a1/edit`]),
    ['prompts', '/prompts'], ['files', '/files'], ['models', '/models'],
    ['models-models', '/models'], ['agents', '/agents'], ['agent', '/agents/agent1/edit'],
    ...['text', 'image', 'video'].map(mode => [`lab-${mode}`, `/lab?mode=${mode}`]),
    ['settings', '/settings'], ['not-found', '/unknown-page'],
  ]
  for (const [width, height] of (process.env.SHELL_INTERACTIONS_ONLY ? [] : [[1586, 992], [1440, 900], [1024, 768], [768, 1024], [375, 812]])) {
    await page.setViewportSize({ width, height })
    const representatives = ['home', 'projects', 'project', 'actors', 'models', 'models-models', 'agent', 'lab-text', 'settings']
    for (const [name, path] of routes.filter(([name]) => width === 1586 || representatives.includes(name))) {
      console.log(`Shell ${width} ${name}`)
      await page.goto(`http://127.0.0.1:4184${path}`)
      await page.locator('.app-topbar').waitFor()
      if (name === 'models-models') await page.getByRole('tab', { name: '模型', exact: true }).click()
      // Wait for layout transitions and fixture reads to settle before taking measurements.
      await page.waitForTimeout(500)
      const geometry = await page.evaluate(() => {
        const box = selector => { const element = document.querySelector(selector); if (!element) return null; const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height } }
        const viewport = document.querySelector('.app-route-viewport'); if (!viewport) return null
        return { header: box('.app-topbar'), navigation: box('.app-primary-navigation'), brand: box('.app-brand'), actions: box('.app-global-actions'), sidebar: box('.app-context-sidebar, .app-management-sidebar'), inspector: box('.app-editor-properties'), content: box('.app-route-viewport'), documentWidth: document.documentElement.scrollWidth, contentWidth: viewport.scrollWidth,
          overflow: [...viewport.querySelectorAll('*')].filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > innerWidth + 2 && getComputedStyle(el).position !== 'fixed' }).slice(0, 8).map(el => `${el.tagName}.${el.className}`), breadcrumb: document.querySelector('.app-breadcrumb')?.textContent ?? '' }
      })
      assert.ok(geometry, `${name}: application shell missing; ${JSON.stringify(errors)}`)
      if (width >= 768) {
        assert.equal(geometry.header.height, 56)
        assert.equal(geometry.navigation.x + geometry.navigation.width / 2, width / 2)
        assert.ok(geometry.brand.x + geometry.brand.width <= geometry.navigation.x)
        assert.ok(geometry.navigation.x + geometry.navigation.width <= geometry.actions.x)
      } else {
        assert.ok(geometry.navigation.y >= geometry.brand.y + geometry.brand.height)
        assert.ok(geometry.navigation.y >= geometry.actions.y + geometry.actions.height)
      }
      assert.equal(await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link').count(), 4)
      if (width >= 1280 && geometry.inspector) assert.equal(geometry.inspector.width, 344)
      await page.screenshot({ animations: 'disabled', path: `${output}/${width}-${name}.png` })
      results.push({ name, path, width, height, ...geometry })
    }
  }
  if (!process.env.SHELL_INTERACTIONS_ONLY) await writeFile(`${output}/geometry.json`, JSON.stringify({ results, errors }, null, 2))
  const visit = async path => {
    await page.goto(`http://127.0.0.1:4184${path}`)
    await page.locator('.app-topbar').waitFor()
    await page.waitForTimeout(500)
  }
  const snapshot = async name => {
    await page.waitForTimeout(400)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true, `${name}: document overflow`)
    await page.screenshot({ animations: 'disabled', path: `${output}/interaction-${name}.png` })
    interactions.push(name)
  }
  const closeDialog = async name => { const dialog = name ? page.getByRole('dialog', { name, exact: true }) : page.getByRole('dialog'); await dialog.locator('.ant-modal-close, .ant-drawer-close').click(); await dialog.waitFor({ state: 'hidden' }) }
  await page.setViewportSize({ width: 1586, height: 992 })
  await visit('/')
  await page.waitForURL(url => url.pathname === '/')
  await visit('/unknown-page')
  await page.getByRole('button', { name: /返回/ }).click()
  await page.waitForURL(url => url.pathname === '/')
  interactions.push('root-and-not-found-return')
  await visit('/projects/p1')
  const projectNavigation = page.getByRole('navigation', { name: '项目导航', exact: true })
  await projectNavigation.getByRole('link', { name: '项目概览', exact: true }).waitFor()
  assert.deepEqual(await projectNavigation.getByRole('link').allTextContents(), [
    '项目概览', '画布生成', '章节', '演员', '角色', '场景', '道具', '服装', '文件', '项目设置',
  ])
  await projectNavigation.getByText('旧信', { exact: true }).waitFor()
  for (const label of ['章节', '演员', '角色', '场景', '道具', '服装', '文件', '项目设置', '项目概览']) {
    const item = projectNavigation.getByRole('link', { name: label, exact: true })
    await item.click()
    assert.equal(await item.getAttribute('aria-current'), 'page')
    await snapshot(`project-${label}`)
  }
  await page.goBack()
  const settingsLink = projectNavigation.getByRole('link', { name: '项目设置', exact: true })
  await page.waitForURL('**?tab=settings')
  assert.equal(await settingsLink.getAttribute('aria-current'), 'page')
  await page.goForward()
  await page.waitForURL('**?tab=dashboard')
  await page.reload()
  await projectNavigation.getByRole('link', { name: '项目概览', exact: true }).waitFor()
  assert.equal(await projectNavigation.getByRole('link', { name: '项目概览', exact: true }).getAttribute('aria-current'), 'page')
  await page.getByRole('navigation',{name:'主导航'}).getByRole('link',{name:'项目',exact:true}).click()
  await page.waitForURL('**/projects')
  assert.equal(await projectNavigation.count(), 0)
  await visit('/projects/p2?tab=roles')
  await projectNavigation.getByText('第二个项目', { exact: true }).waitFor()
  assert.equal(await projectNavigation.getByText('旧信', { exact: true }).count(), 0)
  assert.equal(await projectNavigation.getByRole('link', { name: '角色', exact: true }).getAttribute('aria-current'), 'page')
  await visit('/assets')
  for (const label of ['演员', '场景', '道具', '服装']) {
    console.log('Tab', label)
    await page.getByRole('tab', { name: new RegExp(`${label}$`) }).click()
    await snapshot(`assets-${label}`)
  }
  for (const path of ['/projects/p1/roles/a1/edit', ...['actors', 'scenes', 'props', 'costumes'].map(type => `/assets/${type}/a1/edit`)]) {
    await visit(path)
    console.log('Asset save', path)
    const name = page.getByRole('textbox', { name: '名称', exact: true })
    await name.fill('保存后的档案名称')
    await page.getByRole('button', { name: '保存资产', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    const generation = page.getByRole('button', { name: /重新生成|生成图片/ }).first()
    await generation.scrollIntoViewIfNeeded()
    assert.equal(await generation.evaluate(element => {
      const box = element.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return box.left >= 0 && box.right <= innerWidth && box.top >= 48 && box.bottom <= innerHeight && !!hit && element.contains(hit)
    }), true, 'Asset generation control must remain reachable below the long form')
    await snapshot(`save-${path.includes('/roles/') ? 'role' : path.split('/')[2]}`)
    asset.name = '旧信档案'
  }
  await visit('/assets/actors/a1/edit')
  await page.getByRole('button', { name: '放大当前视角图片', exact: true }).click()
  await page.getByRole('dialog', { name: '旧信档案 · 正面', exact: true }).waitFor()
  await snapshot('asset-image-preview')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: '旧信档案 · 正面', exact: true }).waitFor({ state: 'hidden' })
  await visit('/models')
  await page.getByRole('cell', { name: 'openai', exact: true }).click()
  await snapshot('provider-details')
  for (const label of ['模型', '运行设置']) {
    console.log('Tab', label)
    await page.getByRole('tab', { name: new RegExp(`${label}$`) }).click()
    await page.waitForTimeout(300)
    await snapshot(`models-${label}`)
  }
  await visit('/prompts')
  await page.getByRole('button', { name: /添加|新建/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await snapshot('prompt-editor')
  await closeDialog()
  await visit('/files')
  await page.getByRole('textbox').first().fill('旧信')
  await snapshot('file-search')
  await visit('/agents')
  await page.getByRole('button', { name: /创建新 Agent$/ }).first().click()
  await page.getByRole('dialog').waitFor()
  await snapshot('agent-create')
  await closeDialog()
  await visit('/agents/agent1/edit')
  await page.getByRole('button', { name: /保存/ }).first().click()
  await page.getByText('保存成功', { exact: true }).waitFor()
  await snapshot('agent-save')
  for (const mode of ['text', 'image', 'video']) {
    await visit(`/lab?session=session-${mode}`)
    await page.getByRole('textbox').first().fill('保留的实验输入')
    const composer = page.getByRole('textbox').first()
    const before = await composer.boundingBox()
    await page.locator('.app-lab-history').evaluate(element => { element.scrollTop = 0 })
    assert.deepEqual(await composer.boundingBox(), before, 'History scroll must not move the composer')
    await snapshot(`lab-${mode}-history`)
  }
  for (const mode of ['text', 'image', 'video']) {
    await visit(`/${mode}-lab?mode=${mode}&keep=1`)
    await page.waitForURL(url => url.pathname === '/lab')
    assert.equal(new URL(page.url()).searchParams.get('keep'), '1')
    assert.equal(new URL(page.url()).searchParams.get('mode'), mode)
    interactions.push(`legacy-${mode}`)
  }
  if (!process.env.SHELL_LAB_REGRESSION_ONLY) {
    const rolePath = '/projects/p1/roles/a1/edit'
    await visit(rolePath)
    assert.equal(await projectNavigation.getByRole('link', { name: '角色', exact: true }).getAttribute('aria-current'), 'page')
    const breadcrumbs = page.getByRole('navigation', { name: '当前位置' })
    await breadcrumbs.getByRole('link', { name: '角色', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/projects/p1' && url.searchParams.get('tab') === 'roles')
    await page.goBack()
    await page.waitForURL(url => url.pathname === rolePath)
    await page.goForward()
    await page.waitForURL(url => url.pathname === '/projects/p1' && url.searchParams.get('tab') === 'roles')
    interactions.push('breadcrumbs-back-forward')
    project.name = '一个需要保留完整名称并允许查看上级路径的长项目标题'.repeat(3)
    await visit(rolePath)
    await page.getByRole('button', { name: '查看上级页面' }).click()
    await page.getByRole('menu').waitFor()
    await snapshot('long-breadcrumbs')
    await page.keyboard.press('Escape')
    failProject = true
    await page.setViewportSize({ width: 768, height: 1024 })
    await visit(rolePath)
    await page.getByRole('button', { name: '查看上级页面' }).click()
    await page.getByRole('menuitem', { name: '项目名称暂不可用', exact: true }).waitFor()
    assert.ok(!(await page.getByRole('menu').innerText()).includes(project.name))
    await snapshot('failed-parent-read')
    await page.keyboard.press('Escape')
    failProject = false
    project.name = '旧信'
    await page.setViewportSize({ width: 1586, height: 992 })
    taskRows = ['running', 'succeeded'].map((status, index) => ({ task_id: `task${index + 1}`, task_kind: 'directing_design', title: `设计任务 ${index + 1}`, status, stage: '设计', progress: index === 0 ? 25 : 100, cancel_requested: false, project_id: 'p1', target_type: 'directing_sequence', target_id: 's1', created_at_ts: 1789430400, updated_at_ts: Math.floor(Date.now() / 1000), source: { kind: 'sequence', id: 's1', project_id: 'p1', chapter_id: 'ch1', title: '旧信重逢' } }))
    await visit('/settings')
    await page.getByLabel('运行中任务 1').waitFor()
    const pollStart = requests.filter(request => request.path.endsWith('/film/tasks')).length
    for (const name of ['首页', '项目', '管理']) await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name, exact: true }).click()
    await page.waitForTimeout(4500)
    const pollEnd = requests.filter(request => request.path.endsWith('/film/tasks')).length
    assert.ok(pollEnd - pollStart >= 1 && pollEnd - pollStart <= 2, 'Route changes must preserve a single task polling loop')
    await page.getByRole('button', { name: '任务中心', exact: true }).click()
    const taskDialog = page.getByRole('dialog')
    await taskDialog.getByText('全部', { exact: true }).click()
    await taskDialog.getByText('设计任务 2', { exact: true }).waitFor()
    await snapshot('task-drawer')
    await taskDialog.getByRole('button', { name: /取消$/ }).click()
    await taskDialog.getByRole('button', { name: /正在取消$/ }).waitFor()
    await page.getByRole('button', { name: /历\s*史/ }).click()
    await page.getByRole('dialog', { name: '任务历史' }).waitFor()
    await snapshot('task-history')
    await closeDialog('任务历史')
    assert.equal(requests.filter(request => request.method === 'POST' && request.path.endsWith('/cancel')).length, 1)
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    await page.getByRole('menuitem', { name: '个人中心', exact: true }).click()
    await page.waitForURL('**/settings')
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    await page.getByRole('menu').waitFor()
    await snapshot('account-menu')
    await page.getByRole('menuitem', { name: 'English', exact: true }).click()
    await page.getByRole('heading', { name: 'System Settings', exact: true }).waitFor()
    await page.reload()
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    assert.ok((await page.getByRole('menuitem', { name: 'English', exact: true }).getAttribute('class')).includes('selected'))
    await page.getByRole('menuitem', { name: '简体中文', exact: true }).focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: '系统设置', exact: true }).waitFor()
    interactions.push('language-switch-and-reload')
    await page.setViewportSize({ width: 375, height: 812 })
    await visit('/projects/p1?tab=chapters')
    const projectNavTrigger = page.getByRole('button', { name: '打开项目导航', exact: true })
    assert.equal(await projectNavigation.count(), 0)
    await projectNavTrigger.focus()
    await page.keyboard.press('Enter')
    const projectDrawer = page.getByRole('dialog').filter({ has: projectNavigation })
    await projectDrawer.waitFor()
    assert.equal(await projectDrawer.getByRole('link', { name: '章节', exact: true }).getAttribute('aria-current'), 'page')
    await page.keyboard.press('Escape')
    await projectDrawer.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开项目导航')
    await page.keyboard.press('Enter')
    await projectDrawer.getByRole('link', { name: '角色', exact: true }).click()
    await projectDrawer.waitFor({ state: 'hidden' })
    await page.waitForURL('**?tab=roles')
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '打开项目导航')
    await snapshot('mobile-project-navigation')
    await visit('/models')
    await page.getByRole('tab', { name: '模型', exact: true }).click()
    await page.getByRole('button', { name: /筛选$/ }).click()
    await page.getByRole('dialog').filter({ hasText: '筛选' }).waitFor()
    await snapshot('mobile-filter')
    await closeDialog()
    await page.getByRole('tab', { name: '供应商', exact: true }).click()
    await page.getByRole('cell', { name: 'openai', exact: true }).click()
    await page.getByRole('dialog').filter({ hasText: '详情' }).waitFor()
    await snapshot('mobile-provider-details')
    await closeDialog()
    await visit('/lab?session=session-text')
    await page.getByRole('button', { name: /会话导航$/ }).click()
    await page.getByRole('dialog').filter({ hasText: '会话导航' }).waitFor()
    await snapshot('mobile-sessions')
    await closeDialog()
    await page.getByRole('button', { name: '用户与语言设置' }).click()
    await page.getByRole('menuitem', { name: '个人中心', exact: true }).click()
    await page.waitForURL(url => url.pathname === '/settings')
    await page.getByRole('button', { name: /保\s*存/ }).click()
    await snapshot('mobile-settings-save')

  }
  await writeFile(`${output}/${process.env.SHELL_INTERACTIONS_ONLY ? 'interactions' : 'results'}.json`, JSON.stringify({ environment: { scope: process.env.SHELL_LAB_REGRESSION_ONLY ? 'project/assets/labs interactions; scene workbench excluded' : 'full shell', node: process.version, chromium: browser.version(), recordedAt: new Date().toISOString(), data: 'isolated API fixtures; no production writes or paid generation' }, results, errors, requests, interactions }, null, 2))
  console.log(JSON.stringify({ output, errors, overflow: results.filter(row => row.contentWidth > row.content.width + 2 || row.documentWidth > row.width + 2).map(row => ({ name: row.name, width: row.width, overflow: row.overflow })) }, null, 2))
  assert.deepEqual(errors, [])
  assert.ok(results.every(row => row.contentWidth <= row.content.width + 2 && row.documentWidth <= row.width + 2), 'Page overflow: inspect screenshots and results.json')
} finally {
  await browser?.close()
  await server.close()
}
