/**
 * 服务端草稿的纯逻辑测试（`node --test`；仓库风格：测试挨着源码）。
 *
 * 重点只在"钱"上：**已完成的不重发、正在生成的不重发、只重试失败/缺失**。
 * 这些判定一旦错了，用户会为同一镜付两次费，肉眼点页面看不出来。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildShotDraftStatuses,
  describeDraftStatus,
  draftRestoreNotice,
  formatBusyNotice,
  hadDraftRow,
  includedShotConflicts,
  needsGeneration,
  orphanPlaceholderShotIds,
  restoredRowsFromDrafts,
  resolveSaveOrigin,
  restorePlanFor,
  retryTargets,
  selectGenerationTargets,
  shouldDropClaimPlaceholder,
  sourceLabel,
  type ShotDraftStatus,
} from './promptBoardDrafts.ts'
import type { PromptBoardDraft, PromptBoardShot } from '../../../../../services/llmPipelineApi'

function shot(id: string, code: string, hasPrompt = false): PromptBoardShot {
  return {
    shot_id: id,
    index: Number(code.replace(/\D/g, '')) || 1,
    code,
    title: `镜头 ${code}`,
    script_excerpt: '剧本摘录',
    video_prompt: hasPrompt ? '已保存的提示词' : '',
    video_prompt_source: hasPrompt ? 'llm' : '',
    has_prompt: hasPrompt,
  }
}

function draft(over: Partial<PromptBoardDraft> & { shot_id: string }): PromptBoardDraft {
  return {
    code: '',
    index: 0,
    title: '',
    status: 'pending',
    stored_status: '',
    interrupted: false,
    has_draft: false,
    prompt: '',
    source: '',
    error: '',
    model: '',
    meta: {},
    draft_token: '',
    saveable: false,
    claim_expires_at: null,
    updated_at: null,
    ...over,
  }
}

const okDraft = (shotId: string, prompt = '大模型写的提示词') =>
  draft({
    shot_id: shotId,
    status: 'ok',
    stored_status: 'ok',
    has_draft: true,
    prompt,
    source: 'llm',
    draft_token: `tok-${shotId}`,
    saveable: true,
    updated_at: '2026-09-19T02:00:00Z',
  })

test('逐镜状态：没有草稿行的镜头也出现，且是「未开始」', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('s1', 'S001'), shot('s2', 'S002'), shot('s3', 'S003', true)],
    drafts: [okDraft('s1')],
  })
  assert.equal(statuses.length, 3)
  assert.deepEqual(
    statuses.map((item) => item.phase),
    ['draft_ok', 'pending', 'pending'],
  )
  assert.equal(statuses[2].saved, true)
})

test('逐镜状态：running 但租约过期 → 已中断（不是永远生成中）', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('s1', 'S001')],
    drafts: [
      draft({
        shot_id: 's1',
        status: 'pending',
        stored_status: 'running',
        interrupted: true,
      }),
    ],
  })
  assert.equal(statuses[0].phase, 'interrupted')
  assert.equal(statuses[0].interrupted, true)
})

test('逐镜状态：租约还活着的 running → 生成中', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('s1', 'S001')],
    drafts: [draft({ shot_id: 's1', status: 'running', stored_status: 'running', claim_expires_at: '2026-09-19T02:05:00Z' })],
  })
  assert.equal(statuses[0].phase, 'running')
})

test('逐镜状态：草稿里有、镜头列表里没有的镜头也要看得见', () => {
  const statuses = buildShotDraftStatuses({ shots: [shot('s1', 'S001')], drafts: [okDraft('ghost', '幽灵草稿')] })
  assert.equal(statuses.length, 2)
  const ghost = statuses.find((item) => item.shotId === 'ghost')
  assert.ok(ghost)
  assert.match(ghost!.title, /不在本集镜头列表/)
  assert.equal(ghost!.phase, 'draft_ok')
})

test('needsGeneration：只有失败/已中断/未开始需要生成', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001'), shot('b', 'S002'), shot('c', 'S003'), shot('d', 'S004'), shot('e', 'S005')],
    drafts: [
      okDraft('a'),
      draft({ shot_id: 'b', status: 'failed', stored_status: 'failed', error: '超时' }),
      draft({ shot_id: 'c', status: 'running', stored_status: 'running' }),
      draft({ shot_id: 'd', status: 'pending', stored_status: 'running', interrupted: true }),
    ],
  })
  const byId = new Map(statuses.map((item) => [item.shotId, item]))
  assert.equal(needsGeneration(byId.get('a')!), false, '已完成草稿不能重发')
  assert.equal(needsGeneration(byId.get('b')!), true)
  assert.equal(needsGeneration(byId.get('c')!), false, '生成中不能重发')
  assert.equal(needsGeneration(byId.get('d')!), true)
  assert.equal(needsGeneration(byId.get('e')!), true)
})

test('「重试失败项」严格只挑失败/已中断/未开始，已完成的绝不重发', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001'), shot('b', 'S002'), shot('c', 'S003'), shot('d', 'S004')],
    drafts: [
      okDraft('a'),
      draft({ shot_id: 'b', status: 'failed', stored_status: 'failed', error: '超时' }),
      draft({ shot_id: 'c', status: 'running', stored_status: 'running' }),
    ],
  })
  assert.deepEqual(retryTargets({ statuses, mode: 'overwrite_selected' }), ['b', 'd'])
})

test('批量生成：fill_empty 跳过正式列已有内容的镜头', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001', true), shot('b', 'S002', true)],
    drafts: [draft({ shot_id: 'b', status: 'failed', stored_status: 'failed' })],
  })
  assert.deepEqual(selectGenerationTargets({ statuses, mode: 'fill_empty' }), [])
  // 覆盖模式下才允许对已有正式内容的镜头重发（a 未开始、b 失败，两者都在内）
  assert.deepEqual(selectGenerationTargets({ statuses, mode: 'overwrite_selected' }), ['a', 'b'])
})

test('勾选范围为空 = 本集全部；勾选后只在这个范围内挑', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001'), shot('b', 'S002'), shot('c', 'S003')],
    drafts: [],
  })
  assert.deepEqual(selectGenerationTargets({ statuses, mode: 'fill_empty' }), ['a', 'b', 'c'])
  assert.deepEqual(selectGenerationTargets({ statuses, mode: 'fill_empty', selectedShotIds: ['b'] }), ['b'])
})

test('单镜「重新生成」可以重发已完成的草稿（includeDone），批量口径不允许', () => {
  const statuses = buildShotDraftStatuses({ shots: [shot('a', 'S001')], drafts: [okDraft('a')] })
  assert.deepEqual(selectGenerationTargets({ statuses, mode: 'fill_empty', includeDone: true }), ['a'])
  assert.deepEqual(selectGenerationTargets({ statuses, mode: 'fill_empty' }), [])
})

test('恢复草稿：ok → 大模型草稿行、默认勾选、带令牌', () => {
  const statuses = buildShotDraftStatuses({ shots: [shot('a', 'S001')], drafts: [okDraft('a', '正文 A')] })
  const rows = restoredRowsFromDrafts(statuses)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].prompt, '正文 A')
  assert.equal(rows[0].origin, 'llm_draft')
  assert.equal(rows[0].status, 'draft')
  assert.equal(rows[0].include, true)
  assert.equal(rows[0].draftToken, 'tok-a')
  assert.equal(rows[0].saveable, true)
})

test('恢复草稿：没有服务端令牌的正文只能按人工内容恢复（不能冒充大模型）', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001')],
    drafts: [
      draft({
        shot_id: 'a',
        status: 'ok',
        stored_status: 'ok',
        has_draft: true,
        prompt: '客户端自己塞进来的正文',
        saveable: false,
        draft_token: '',
      }),
    ],
  })
  const rows = restoredRowsFromDrafts(statuses)
  assert.equal(rows[0].origin, 'manual')
  assert.equal(rows[0].saveable, false)
  assert.match(rows[0].message, /没有大模型令牌/)
  assert.equal(resolveSaveOrigin({ origin: rows[0].origin, edited: false, draftToken: '' }), 'manual')
})

test('恢复草稿：失败项保留已有正文且默认不勾选（重试失败不抹掉已付费正文）', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001')],
    drafts: [
      draft({
        shot_id: 'a',
        status: 'failed',
        stored_status: 'failed',
        has_draft: true,
        prompt: '上一版真金白银的正文',
        error: '模型超时',
        draft_token: 'tok-a',
        saveable: true,
      }),
    ],
  })
  const rows = restoredRowsFromDrafts(statuses)
  assert.equal(rows[0].status, 'failed')
  assert.equal(rows[0].prompt, '上一版真金白银的正文')
  assert.equal(rows[0].message, '模型超时')
  assert.equal(rows[0].include, false)
})

test('恢复草稿：生成中的镜头只做占位，不可勾选也不可重发', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001')],
    drafts: [draft({ shot_id: 'a', status: 'running', stored_status: 'running' })],
  })
  const rows = restoredRowsFromDrafts(statuses)
  assert.equal(rows[0].status, 'skipped')
  assert.equal(rows[0].include, false)
  assert.match(rows[0].message, /正在生成中/)
  assert.deepEqual(retryTargets({ statuses, mode: 'overwrite_selected' }), [])
})

test('恢复草稿：中断项提示可重试，未开始不进行', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001'), shot('b', 'S002')],
    drafts: [draft({ shot_id: 'a', status: 'pending', stored_status: 'running', interrupted: true })],
  })
  const rows = restoredRowsFromDrafts(statuses)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'interrupted')
  assert.match(rows[0].message, /上次生成被中断/)
  assert.equal(rows.some((row) => row.shotId === 'b'), false)
})

test('整表唯一性：同一镜头两条勾选记录会被识别为冲突（恢复行让位）', () => {
  const conflicts = includedShotConflicts([
    { shotId: 'a', include: true },
    { shotId: 'a', include: true },
    { shotId: 'b', include: true },
  ])
  assert.deepEqual([...conflicts], ['a'])
})

test('保存来源：改过正文或没有令牌一律降到 manual', () => {
  assert.equal(resolveSaveOrigin({ origin: 'llm_draft', edited: false, draftToken: 'tok' }), 'llm_draft')
  assert.equal(resolveSaveOrigin({ origin: 'llm_draft', edited: true, draftToken: 'tok' }), 'manual')
  assert.equal(resolveSaveOrigin({ origin: 'llm_draft', edited: false, draftToken: '' }), 'manual')
  assert.equal(resolveSaveOrigin({ origin: 'jurilu_import', edited: true, draftToken: '' }), 'jurilu_import')
})

test('租约 busy 的中文提示带上镜头编号与中文原因（后端原文过管道，且不回显机器码）', () => {
  const text = formatBusyNotice('S003', '该镜头正在生成中（120 秒后租约自动释放；同一镜不允许并发生成，避免重复付费）。')
  assert.match(text, /^S003 正在生成中，已跳过/)
  assert.match(text, /同一镜不允许并发生成/)
  assert.equal(formatBusyNotice('S004', ''), 'S004 正在生成中，已跳过')
  // 审计 §4.5 模式 6：后端原文里夹内部标识时必须被掩码，不许原样上屏
  const masked = formatBusyNotice('S005', '该镜头正在生成中（shot_id=9f3c1a2b-0000-4000-8000-000000000001）。')
  assert.ok(!masked.includes('9f3c1a2b-0000-4000-8000-000000000001'), `内部编号漏上屏：${masked}`)
  assert.ok(!/shot_id=/.test(masked), `内部字段名漏上屏：${masked}`)
})

test('非生成结果收尾：原状态是失败/已完成就写回去，claim 不改动它的观感', () => {
  const failed = buildShotDraftStatuses({
    shots: [shot('b', 'S002')],
    drafts: [draft({ shot_id: 'b', status: 'failed', stored_status: 'failed', error: '模型超时', source: 'llm' })],
  })[0]
  const planFailed = restorePlanFor(failed)
  assert.equal(planFailed.action, 'failed')
  assert.equal(planFailed.error, '模型超时')
  assert.equal(planFailed.prompt, '', '不传正文 = 服务端保留已存正文')

  const ok = buildShotDraftStatuses({ shots: [shot('a', 'S001')], drafts: [okDraft('a', '已完成的正文')] })[0]
  const planOk = restorePlanFor(ok)
  assert.equal(planOk.action, 'ok')
  assert.equal(planOk.prompt, '已完成的正文')
  assert.equal(planOk.source, 'llm')

  // 未开始 / 已中断：不用动，释放租约后本来就回到原样
  const interrupted = buildShotDraftStatuses({
    shots: [shot('d', 'S004')],
    drafts: [draft({ shot_id: 'd', status: 'pending', stored_status: 'running', interrupted: true })],
  })[0]
  assert.equal(restorePlanFor(interrupted).action, 'none')
  const fresh = buildShotDraftStatuses({ shots: [shot('e', 'S005')], drafts: [] })[0]
  assert.equal(restorePlanFor(fresh).action, 'none')
  assert.equal(restorePlanFor(undefined).action, 'none')
})

test('兜底清扫：只删"没产出内容却留下空 running 行"的镜头', () => {
  const drafts = [
    draft({ shot_id: 'a', status: 'pending', stored_status: 'running', interrupted: true }), // 我们占的空行
    draft({ shot_id: 'b', status: 'running', stored_status: 'running' }), // 租约还活着 → 不动
    draft({ shot_id: 'c', status: 'ok', stored_status: 'ok', has_draft: true, prompt: '正文' }), // 有正文 → 不动
    draft({ shot_id: 'd', status: 'failed', stored_status: 'failed', error: '超时' }), // 失败状态 → 不动
  ]
  const outcomes = [
    { shotId: 'a', status: 'dry_run' },
    { shotId: 'b', status: 'dry_run' },
    { shotId: 'c', status: 'draft' },
    { shotId: 'd', status: 'failed' },
    { shotId: 'e', status: 'skipped' }, // 服务端没有行 → 没什么可删
  ]
  assert.deepEqual(orphanPlaceholderShotIds({ outcomes, drafts }), ['a'])
  // busy 说明是别人的租约，绝不代它清理
  assert.deepEqual(orphanPlaceholderShotIds({ outcomes: [{ shotId: 'a', status: 'busy' }], drafts }), [])
})

test('租约占位行只在"完全是这次新建的空行"时才清掉', () => {
  // 演练/跳过/并发：服务端原本没有这一行 → 可以整行删掉，别显示成"已中断"
  // （演练响应里也会回一段占位正文，但 persisted 不为真，所以照样要清）
  assert.equal(shouldDropClaimPlaceholder({ preHadRow: false, status: 'dry_run', persisted: false }), true)
  assert.equal(shouldDropClaimPlaceholder({ preHadRow: false, status: 'skipped', persisted: false }), true)
  assert.equal(shouldDropClaimPlaceholder({ preHadRow: false, status: 'busy', persisted: false }), true)
  // 生成失败要留在服务端：用户才能看到"上次失败在哪一步"
  assert.equal(shouldDropClaimPlaceholder({ preHadRow: false, status: 'failed', persisted: false }), false)
  // 原本就有草稿行（哪怕只是失败原因）→ 绝不能删
  assert.equal(shouldDropClaimPlaceholder({ preHadRow: true, status: 'skipped', persisted: false }), false)
  // 本次真的产出了正文（persisted=true）→ 保留
  assert.equal(shouldDropClaimPlaceholder({ preHadRow: false, status: 'draft', persisted: true }), false)
})

test('hadDraftRow：靠 stored_status 判"服务端有没有这一行"', () => {
  const withRow: ShotDraftStatus = buildShotDraftStatuses({
    shots: [shot('a', 'S001')],
    drafts: [draft({ shot_id: 'a', status: 'pending', stored_status: 'running', interrupted: true })],
  })[0]
  const without: ShotDraftStatus = buildShotDraftStatuses({ shots: [shot('b', 'S002')], drafts: [] })[0]
  assert.equal(hadDraftRow(withRow), true)
  assert.equal(hadDraftRow(without), false)
  assert.equal(hadDraftRow(undefined), false)
})

test('「上次生成到哪了」摘要口径：已完成/失败/已中断/生成中/未开始都在里面', () => {
  const statuses = buildShotDraftStatuses({
    shots: [shot('a', 'S001'), shot('b', 'S002'), shot('c', 'S003', true), shot('d', 'S004')],
    drafts: [
      okDraft('a'),
      draft({ shot_id: 'b', status: 'failed', stored_status: 'failed', error: '超时' }),
      draft({ shot_id: 'd', status: 'running', stored_status: 'running' }),
    ],
  })
  const text = draftRestoreNotice(statuses)
  assert.match(text, /已完成草稿 1 镜/)
  assert.match(text, /失败 1 镜/)
  assert.match(text, /生成中 1 镜/)
  assert.match(text, /已保存到镜头 1 镜/)
  // 缺失 = 失败 1 + 未开始 1（已保存的 c 没有草稿行，属于"未开始"）
  assert.match(text, /可重试 2 镜/)
})

test('状态中文文案：已中断与未开始分开，不混淆', () => {
  assert.equal(describeDraftStatus('pending', true), '已中断')
  assert.equal(describeDraftStatus('pending', false), '未开始')
  assert.equal(describeDraftStatus('ok'), '已完成（草稿未保存）')
  assert.equal(describeDraftStatus('failed'), '失败')
  assert.equal(describeDraftStatus('running'), '生成中')
  assert.equal(sourceLabel('skill'), '一键技能生成')
  assert.equal(sourceLabel(''), '来源未标记')
  /* 审计 §4.5 模式 3（`:502`）：旧期望是 `sourceLabel('weird_source') === 'weird_source'`
     （钉住「未登记就回显原值」）；新口径是**绝不回显原值**，统一中文兜底。 */
  assert.equal(sourceLabel('weird_source'), '来源未标记')
})
