/**
 * 「确认保存」请求体形状的回归（纯函数测试）。
 *
 * 要锁死的事（2026-09-20 口径修正：页面保存的真实路径必须有后端可校验的脚本组）：
 * 1. 巨日禄路径的请求体里**只有单数** `script_id`，且每一条 entry 的 `script_id` 与它一致；
 * 2. 复数 `script_ids` **一个字符都不再出现**（后端会明确 400，不是静默忽略）；
 * 3. 镜头不是巨日禄来源（manual / external_import / llm_draft）时，
 *    `script_id` 与 `entries[].script_id` **两个键都不传**（不是传空串）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPromptBoardSaveBody, juriluScriptScopeError } from './promptBoardSaveBody.ts'

const SCRIPT_A = '2933350'
const SCRIPT_B = '2933351'

function juriluRows() {
  return [
    { shotId: 'shot-1', prompt: '第1镜提示词', scriptId: SCRIPT_A },
    { shotId: 'shot-2', prompt: '第2镜提示词', scriptId: SCRIPT_A },
  ]
}

test('巨日禄保存体：只有单数 script_id，且每条 entry 与之一致', () => {
  const body = buildPromptBoardSaveBody({
    rows: juriluRows(),
    mode: 'fill_empty',
    origin: 'jurilu_import',
    matchedScriptId: SCRIPT_A,
    selectedShotIds: ['shot-1', 'shot-2'],
    allowPartial: true,
  })

  assert.equal(body.script_id, SCRIPT_A)
  assert.equal(body.entries.length, 2)
  assert.deepEqual(
    body.entries.map((entry) => entry.script_id),
    [SCRIPT_A, SCRIPT_A],
  )
  // 复数写法必须彻底消失（对象上没有这个键，序列化后的文本里也一个字都没有）
  assert.equal('script_ids' in body, false)
  assert.equal(JSON.stringify(body).includes('script_ids'), false)
  assert.deepEqual(Object.keys(body).sort(), [
    'allow_partial',
    'entries',
    'mode',
    'origin',
    'script_id',
    'selected_shot_ids',
  ])
})

test('巨日禄条目自身没带 scriptId 时用请求级补齐（绝不允许有的带、有的不带）', () => {
  const body = buildPromptBoardSaveBody({
    rows: [
      { shotId: 'shot-1', prompt: '第1镜提示词', scriptId: SCRIPT_A },
      { shotId: 'shot-2', prompt: '第2镜提示词' },
    ],
    mode: 'fill_empty',
    origin: 'jurilu_import',
    matchedScriptId: SCRIPT_A,
    selectedShotIds: [],
    allowPartial: true,
  })

  assert.deepEqual(
    body.entries.map((entry) => entry.script_id),
    [SCRIPT_A, SCRIPT_A],
  )
})

test('非巨日禄来源：script_id 与 entries[].script_id 两个键都不传', () => {
  for (const origin of ['manual', 'external_import'] as const) {
    const body = buildPromptBoardSaveBody({
      rows: [
        { shotId: 'shot-1', prompt: '人工内容', scriptId: SCRIPT_A },
        { shotId: 'shot-2', prompt: '人工内容2', scriptId: SCRIPT_B },
      ],
      mode: 'fill_empty',
      origin,
      matchedScriptId: SCRIPT_A,
      selectedShotIds: ['shot-1'],
      allowPartial: true,
    })

    assert.equal('script_id' in body, false, origin)
    assert.equal(JSON.stringify(body).includes('script_id'), false, origin)
    for (const entry of body.entries) {
      assert.equal('script_id' in entry, false, origin)
    }
    assert.equal('script_ids' in body, false, origin)
  }
})

test('llm_draft 来源：不带 script_id，但保留既有的单数 draft_token 口径', () => {
  const body = buildPromptBoardSaveBody({
    rows: [
      { shotId: 'shot-1', prompt: '模型生成的正文', draftToken: 'token-1', scriptId: SCRIPT_A },
      // 没有令牌的行（用户改过正文）：不带 draft_token，也**不带** script_id
      { shotId: 'shot-2', prompt: '我改过的正文', scriptId: SCRIPT_A },
    ],
    mode: 'fill_empty',
    origin: 'llm_draft',
    matchedScriptId: SCRIPT_A,
    selectedShotIds: [],
    allowPartial: false,
  })

  assert.equal('script_id' in body, false)
  assert.equal(body.entries[0].draft_token, 'token-1')
  assert.equal('draft_token' in body.entries[1], false)
  assert.equal('script_id' in body.entries[0], false)
  assert.equal(body.allow_partial, false)
})

test('巨日禄自检：一组都没有 / 某条没组 / 某条是别的组 → 全部拦下不发', () => {
  /* 阶段 B 第 2 批（审计 §4.2）：主区文案里不许再出现 `script_id` / `scriptId`
     这类字段名与内部组编号，所以期望值同批改成用户语言（需求文档授权）。 */
  assert.match(String(juriluScriptScopeError(juriluRows(), '')), /没有可用的组/)
  assert.match(
    String(juriluScriptScopeError([{ shotId: 'shot-1', prompt: 'x' }], SCRIPT_A)),
    /第 1 条没有所属组/,
  )
  const mismatch = juriluScriptScopeError(
    [
      { shotId: 'shot-1', prompt: 'x', scriptId: SCRIPT_A },
      { shotId: 'shot-2', prompt: 'y', scriptId: SCRIPT_B },
    ],
    SCRIPT_A,
  )
  assert.match(String(mismatch), /第 2 条/)
  assert.match(String(mismatch), /属于另一组/)
  // 内部组编号既不上屏也不进拦截文案（审计 §4.2 模式 1）
  assert.doesNotMatch(String(mismatch), new RegExp(SCRIPT_B))
  assert.doesNotMatch(String(mismatch), new RegExp(SCRIPT_A))
})

test('巨日禄自检：每组一致（含空批）→ 放行', () => {
  assert.equal(juriluScriptScopeError(juriluRows(), SCRIPT_A), null)
  assert.equal(juriluScriptScopeError([], SCRIPT_A), null)
})
