import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { makeWorkspace, revision } from './directing-fixtures.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4188, strictPort: true, open: false } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const workspace = makeWorkspace()
  workspace.takes = []; workspace.cuts = []
  workspace.plans = [workspace.plans[0]]
  workspace.plans[0].content.units.push({ ...structuredClone(workspace.plans[0].content.units[0]), id: 'u2' })
  workspace.prompts = ['prompt1', 'prompt2'].map(id => revision(id, { plan_revision_id: 'p-old', unit_id: 'u1', text: `固定指令 ${id}`, decisions: [], sources: [], format_version: 'v4' }))
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  const packet = note => ({ mode: 'formal', roles, occurrences: [{ id: 'o1', prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1', coverage_item_id: 'cover1', shot_id: 'shot1', local_number: 1 }], rows: roles.map(role => ({ role, occurrence_id: 'o1', verdict: 'pass', rationale: note, findings: [] })), context: { state: 'unset' } })
  workspace.reviews = [revision('saved-review', packet('已保存的检查'))]
  const tasks = ['check1', 'check2'].map(task_id => ({ task_id, kind: 'directing_review', status: 'succeeded', error: null, review: packet(`本轮 ${task_id}`) }))
  workspace.task_ids = tasks.map(task => task.task_id)
  const writes = [], errors = []
  let saveAttempts = 0
  let delayedOperation
  let releaseLate, receiveLate
  const lateReceived = new Promise(resolve => { receiveLate = resolve })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { success: true, data: structuredClone(data) } })
    if (request.method() !== 'GET') writes.push(path)
    if (path.endsWith('/compile') || path.endsWith('/prompts/compiled-u2/review')) {
      await new Promise(resolve => { delayedOperation.release = resolve; delayedOperation.received() })
      if (path.endsWith('/compile')) {
        workspace.prompts.push(revision('compiled-u2', { plan_revision_id: 'p-old', unit_id: 'u2', text: '第二单元的编译结果', decisions: [], sources: [], format_version: 'v4' }))
        return respond({ ...workspace, compiled_prompt_revision_id: 'compiled-u2' })
      }
      tasks.push({ task_id: 'late-check', kind: 'directing_review', status: 'running', error: null })
      workspace.task_ids.push('late-check')
      return respond({ task_id: 'late-check' })
    }
    if (path.endsWith('/review/apply')) {
      saveAttempts++
      if (saveAttempts === 1) return route.fulfill({ status: 503, json: { detail: '隔离保存失败' } })
      const taskId = request.postDataJSON().task_id
      if (!workspace.reviews.some(row => row.source_task_id === taskId)) workspace.reviews.push({ ...revision(`applied-${taskId}`, tasks.find(row => row.task_id === taskId).review), source_task_id: taskId })
      if (saveAttempts === 2) return route.abort('failed')
      if (saveAttempts === 4) await new Promise(resolve => { releaseLate = resolve; receiveLate() })
      return respond(workspace)
    }
    if (path.endsWith('/s1')) return respond(workspace)
    if (path.includes('/directing/tasks/')) return respond(tasks.find(task => task.task_id === path.split('/').at(-1)))
    if (path.endsWith('/feedback')) return respond({ active_cut_revision_id: null, current_review_id: null, reviews: [], repairs: [], knowledge: [] })
    if (path.endsWith('/sources/resolve')) return respond([])
    if (path.endsWith('/models')) return respond({ items: [{ id: 'model1', name: '隔离模型', category: 'video', enabled: true }], total: 1 })
    if (path.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    if (/\/(assets|styles|batches|categories)$/.test(path)) return respond([])
    return respond({ items: [], total: 0 })
  })
  const base = 'http://127.0.0.1:4188/projects/p1/chapters/ch1/sequences/s1'
  await page.goto(`${base}?view=shoot&design=d1&plan=p-old&unit=u1&prompt=prompt1&review=saved-review&focus=review`)
  await page.getByRole('region', { name: '本次检查结论' }).getByText('结论已保存', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).count(), 0, '未选择的新检查不能覆盖已保存结论')
  const units = page.locator('.production-unit-list button')
  await units.nth(1).click()
  await page.waitForURL(url => url.searchParams.get('unit') === 'u2')
  assert.equal(new URL(page.url()).searchParams.get('prompt'), '')
  await units.nth(0).click()
  await page.waitForURL(url => url.searchParams.get('prompt') === 'prompt1' && url.searchParams.get('review') === 'saved-review')
  await page.reload()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('结论已保存', { exact: true }).waitFor()
  await page.goto(`${base}?view=shoot&design=d1&plan=p-old&unit=u1&prompt=prompt1&review=&focus=review`)
  await page.getByText('待选择检查记录', { exact: true }).waitFor()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'review')
  assert.equal(await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).count(), 0)
  await page.locator('[data-review-task=check1]').getByRole('button', { name: '选择此检查' }).click()
  await page.locator('.shoot-passed-summary > summary').click()
  await page.locator('.shoot-passed-summary .shoot-review-row > summary').first().click()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('本轮 check1', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).waitFor()
  await units.nth(1).click(); await units.nth(0).click()
  await page.locator('.shoot-passed-summary > summary').click()
  await page.locator('.shoot-passed-summary .shoot-review-row > summary').first().click()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('本轮 check1', { exact: true }).first().waitFor()
  await page.reload()
  await page.locator('.shoot-passed-summary > summary').click()
  await page.locator('.shoot-passed-summary .shoot-review-row > summary').first().click()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('本轮 check1', { exact: true }).first().waitFor()
  assert.equal(writes.filter(path => !path.endsWith('/sources/resolve')).length, 0, '恢复与选择结果不产生业务写入')
  await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).click()
  await page.getByText(/检查结论尚未核实，可重试保存同一结果/).waitFor()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('本轮 check1', { exact: true }).first().waitFor()
  await page.getByRole('button', { name: '确认结论，进入试拍', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('review') === 'applied-check1' && url.searchParams.get('focus') === 'shoot-confirm')
  assert.equal(saveAttempts, 2, '响应丢失后只读核实，不自动再次提交')
  assert.equal(workspace.reviews.filter(row => row.source_task_id === 'check1').length, 1)
  await page.getByRole('tab', { name: '试拍与候选', exact: true, selected: true }).waitFor()
  assert.equal(writes.filter(path => path.endsWith('/shoot')).length, 0, '恢复保存不会自动开拍')
  tasks[1].review.rows[0].verdict = 'revise'
  await page.reload()
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-workspace-target') === 'shoot-confirm')
  await page.getByRole('tab', { name: '指令检查', exact: true }).click()
  await page.getByRole('button', { name: /^检查记录 ·/ }).click()
  await page.locator('[data-review-task=check2]').getByRole('button', { name: '选择此检查' }).click()
  await page.getByRole('button', { name: '保存检查结论', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('review') === 'applied-check2' && url.searchParams.get('focus') === 'review')
  await page.getByRole('tab', { name: '指令检查', exact: true, selected: true }).waitFor()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('结论已保存', { exact: true }).waitFor()
  await page.getByRole('region', { name: '本次检查结论' }).getByText('5 项通过', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '开始试拍', exact: true }).count(), 0, '保存有问题的结论不能提示开拍')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: '查看本场任务与业务结果', exact: true }).click()
  await page.getByText(/完整任务记录 · 2 项/).click()
  await page.locator('[data-task-id="check2"]').getByRole('button', { name: '查看结果', exact: true }).click()
  await page.getByRole('button', { name: '保存审稿结论', exact: true }).click()
  await lateReceived
  const savingUrl = page.url()
  await page.goBack()
  assert.notEqual(page.url(), savingUrl, '回退确实改变了浏览上下文')
  const historyUrl = page.url()
  await page.getByRole('dialog', { name: '当前操作尚未完成' }).waitFor()
  await page.waitForURL(savingUrl)
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/review/apply'))
  releaseLate()
  await savedResponse
  await page.waitForFunction(() => !document.querySelector('fieldset[aria-busy="true"]'))
  await page.getByRole('dialog', { name: '当前操作已结束' }).getByRole('button', { name: /^继\s*续$/ }).click()
  await page.waitForURL(historyUrl)
  assert.equal(page.url(), historyUrl, '写入期间保护导航，完成后仍能继续用户原来的返回操作')
  assert.equal(workspace.reviews.filter(row => row.source_task_id === 'check2').length, 1, '历史任务重试不新增版本')
  workspace.prompts = workspace.prompts.filter(row => row.id !== 'prompt1')
  await page.reload()
  await page.waitForURL(url => url.searchParams.get('prompt') === '')
  await units.nth(1).click(); await units.nth(0).click()
  await page.getByRole('button', { name: '选择指令版本', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('prompt'), '', '失效的已选指令不会替换为较新版本')
  for (const operation of ['compile', 'check']) {
    await page.goto(`${base}?view=shoot&design=d1&plan=p-old&unit=u2&prompt=${operation === 'check' ? 'compiled-u2' : ''}&review=&focus=prompt-review`)
    await page.getByRole('tab', { name: '导演设计', exact: true }).click()
    await page.getByRole('tab', { name: '单元试拍', exact: true }).click()
    let received
    const started = new Promise(resolve => { received = resolve })
    delayedOperation = { received }
    await page.getByRole('button', { name: operation === 'compile' ? '生成试拍指令' : '检查这份指令', exact: true }).click()
    await started
    const saving = page.url()
    await page.goBack()
    const destination = page.url()
    assert.notEqual(destination, saving)
    await page.getByRole('dialog', { name: '当前操作尚未完成' }).waitFor()
    await page.waitForURL(saving)
    const response = page.waitForResponse(row => row.url().endsWith(operation === 'compile' ? '/compile' : '/prompts/compiled-u2/review'))
    delayedOperation.release()
    await response
    await page.waitForFunction(() => !document.querySelector('fieldset[aria-busy="true"]'))
    await page.getByRole('dialog', { name: '当前操作已结束' }).getByRole('button', { name: /^继\s*续$/ }).click()
    await page.waitForURL(destination)
    assert.equal(new URL(page.url()).searchParams.get('view'), 'design', `${operation}迟到结果不能覆盖用户返回的阶段`)
    assert.equal(new URL(page.url()).searchParams.get('prompt'), operation === 'check' ? 'compiled-u2' : '', `${operation}迟到结果不能替换历史选择`)
  }
  assert.equal(workspace.prompts.filter(row => row.id === 'compiled-u2').length, 1)
  assert.equal(writes.filter(path => path.endsWith('/compile')).length, 1)
  assert.equal(writes.filter(path => path.endsWith('/prompts/compiled-u2/review')).length, 1)
  assert.equal(writes.filter(path => path.endsWith('/shoot')).length, 0)
  assert.deepEqual(errors, [])
  console.log('通过：精确版本恢复、多个检查显式选择、失败原地重试、保存响应丢失后核实原版本且不自动开拍。')
} finally {
  await browser?.close()
  await server.close()
}
