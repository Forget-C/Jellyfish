import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

let chapterIndex = 0

/** 在隔离测试后端建立可直接打开的场次画布及其固定原文。 */
export async function createStoryboardCanvas(base, name, project = 'canvas-project') {
  const studio = base.slice(0, -'/generation-canvases'.length)
  const chapter = randomUUID()
  const source = '测试场次的固定原文。'
  const post = async (url, body) => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  await post(`${studio}/chapters`, { id: chapter, project_id: project, index: chapterIndex++, title: name, raw_text: source })
  // 章节创建使用请求级提交，响应到达时新的独立请求可能还读不到记录。
  let chapterReady = false
  for (let attempt = 0; attempt < 30; attempt++) {
    if ((await fetch(`${studio}/chapters/${chapter}`)).ok) { chapterReady = true; break }
    await delay(100)
  }
  assert.ok(chapterReady, 'storyboard fixture chapter did not become visible')
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const scene = await post(scenes, {
    title: name, position: 0, source_version: createHash('sha256').update(source).digest('hex'),
    span: { start: 0, end: Array.from(source).length },
  })
  return post(`${scenes}/${scene.id}/canvases`, { name })
}

export function storyboardCanvasPath(canvas) {
  const { chapter_id, sequence_id } = canvas.scene
  return `/projects/${canvas.project_id}/chapters/${chapter_id}/sequences/${sequence_id}/canvas-workbench?canvas=${canvas.id}`
}

export function storyboardCanvasApi(base, id, suffix = '', project = 'canvas-project') {
  const url = new URL(`${base}/${id}${suffix}`)
  url.searchParams.set('project_id', project)
  return url.href
}

export function withFixedSource(canvas, document) {
  const source = canvas.document.cards.find(card => card.id === canvas.document.fixed_source.card_id)
  return { ...document, cards: [...document.cards, source] }
}

/** 沿用场次对象的资源选用流程，参考图取资源主图。 */
export async function selectPreparedCharacter(page, object, assetName) {
  await object.getByRole('button', { name: '选用', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选用项目资源', exact: true })
  await picker.getByRole('button', { name: '选择' + assetName, exact: true }).click()
  await picker.getByRole('button', { name: '确认选用', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await object.getByRole('img', { name: /已选参考图$/ }).waitFor()
}
