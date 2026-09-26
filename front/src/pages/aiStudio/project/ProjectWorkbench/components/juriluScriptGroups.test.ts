/**
 * 巨日禄「脚本组选择 + 整组导入」的纯逻辑测试（`node --test`；仓库风格：测试挨着源码）。
 *
 * 只钉用户明确说过的那几条，因为每一条错了用户就会看到幻觉数据：
 * 1) 默认一组都不选 → 不发匹配请求、rows 为空；
 * 2) 只选一组 → 请求体 `script_ids` **只有一个** id（整组，不是前三条）；
 * 3) 换组 → 旧组 rows 先被清空，才允许发新请求；
 * 4) `likely_newest` 只是提示，不构成默认选中；
 * 5) **没有时间戳证据时页面上不出现「最新版本」字样**（升级要求）；
 * 6) 缺标题 / 缺时间时显示「未提供」，**不编造**；
 * 7) 后端说 `requires_script_selection=true` 却给了 rows → 那些 rows 一条都不用；
 * 8) 组内**全部**记录都进预览（不截断）；
 * 9) 镜头不足时**三个选项**都产出，且明确写出缺少数量；
 * 10) 保存按钮只显示当前勾选条数（**不再有「最多 3 条」**）；
 * 11) **状态不矛盾**（2026-09-20 页面复测）：未选组 / 选了组但没匹配 / 正在匹配 → 缺口面板与
 *     建镜头入口**一律不出现**；只有 matched（后端预览已返回）才出现，且只给**一个**创建按钮；
 * 12) 目标章节文案必须含 **名称 + ID 末段 + 真实镜头数**（匹配后才展示真实镜头数）；
 * 13) 换章节 / 换组 → 缺口、勾选、已匹配标记全部清空。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MISSING_TIME_TEXT,
  MISSING_TITLE_TEXT,
  NEWEST_DISCLAIMER,
  NEWEST_TAG_TEXT,
  NO_TIMESTAMP_EVIDENCE,
  activeGroupLabel,
  applyGroupSwitch,
  buildJuriluEntries,
  chapterIdTail,
  clearRowsBeforeMatch,
  countMatchedEntries,
  defaultScriptSelection,
  groupCoverageNotice,
  groupFieldTexts,
  normalizeScriptGroups,
  planCreateMissingShots,
  planGroupMatch,
  planShotShortage,
  rawKeysText,
  reasonHasTimestampEvidence,
  resolveJuriluFlow,
  resolveScriptSelection,
  sampleRows,
  sampleSectionTitle,
  saveButtonText,
  summarizeScriptGroups,
  targetChapterText,
  versionInfo,
  wholeGroupNotice,
  wholeGroupSaveNotice,
  type JuriluFlowInput,
  type JuriluMatch,
  type JuriluPreviewEntry,
} from './juriluScriptGroups.ts'
import type { JuriluScriptGroup } from '../../../../../services/llmPipelineApi'

/** 契约里的真实形状：109 条 = 41 + 37 + 31。 */
function group(overrides: Partial<JuriluScriptGroup> & { script_id: string }): JuriluScriptGroup {
  return {
    title: '',
    title_source: '',
    created_at: '',
    updated_at: '',
    record_count: 0,
    seq_min: '',
    seq_max: '',
    seq_field: '',
    sample_records: [],
    raw_keys: [],
    likely_newest: false,
    version_reasons: [],
    version_hint: '',
    ...overrides,
  }
}

const G1 = group({
  script_id: '2933350',
  title: '第1集',
  title_source: 'title',
  created_at: '2026-09-18 09:00:00',
  record_count: 37,
  seq_min: '1',
  seq_max: '37',
  seq_field: 'seqNum',
})
const G2 = group({
  script_id: '2933351',
  title: '第1集',
  title_source: 'title',
  created_at: '2026-09-18 12:00:00',
  record_count: 31,
  seq_min: '1',
  seq_max: '31',
  seq_field: 'seqNum',
})
const G_NEWEST = group({
  script_id: '2936083',
  title: '第1集',
  title_source: 'title',
  created_at: '2026-09-19 10:00:00',
  record_count: 41,
  seq_min: '1',
  seq_max: '41',
  seq_field: 'seqNum',
  likely_newest: true,
  version_reasons: ['与 2933351/2933350 标题相同', '内容重合度 82%'],
  version_hint: '疑似与 2933351/2933350 为同一脚本的不同版本；最可能是最新版',
})

const GROUPS = [G1, G2, G_NEWEST]

function planRows(count: number, scriptId: string, matched = true) {
  return Array.from({ length: count }, (_, i) => ({
    order: i + 1,
    label: `S${i + 1}`,
    prompt: `【${scriptId}】第 ${i + 1} 条提示词正文`,
    shot_id: matched ? `shot${i + 1}` : '',
    reason: matched ? '' : '这条没有匹配到镜头',
  }))
}

test('默认一组都不选：不发匹配请求、rows 为空', () => {
  const selection = resolveScriptSelection({
    groups: GROUPS,
    selectedScriptIds: [],
    requiresScriptSelection: true,
    rowCount: 0,
  })
  assert.deepEqual(selection.requestScriptIds, [])
  assert.equal(selection.canMatch, false)
  assert.equal(selection.selectedId, '')
  assert.equal(selection.requiresSelection, true)
  assert.match(summarizeScriptGroups(GROUPS).notice, /默认不合并/)

  const plan = planGroupMatch({ previousSelectedId: '', selectedId: '', currentRowCount: 0 })
  assert.equal(plan.send, false)
  assert.deepEqual(plan.scriptIds, [])
  assert.match(plan.blockedReason, /还没选择脚本组/)
})

test('抬头说明的数字用真实数据算（3 组 / 109 条），不写死', () => {
  const summary = summarizeScriptGroups(GROUPS)
  assert.equal(summary.groupCount, 3)
  assert.equal(summary.recordTotal, 109)
  assert.match(summary.notice, /共 3 个脚本组/)
  assert.match(summary.notice, /合计 109 条分镜/)

  const other = summarizeScriptGroups([G_NEWEST])
  assert.equal(other.recordTotal, 41)
})

test('整组选中后请求体只有一个 script_id（U1：单数语义）', () => {
  for (const item of GROUPS) {
    const selection = resolveScriptSelection({
      groups: GROUPS,
      selectedScriptIds: [item.script_id],
      requiresScriptSelection: false,
      rowCount: item.record_count,
    })
    assert.deepEqual(selection.requestScriptIds, [item.script_id])
    assert.equal(selection.requestScriptIds.length, 1, '请求体只能有一个 script_id')

    const plan = planGroupMatch({ previousSelectedId: '', selectedId: item.script_id, currentRowCount: 0 })
    assert.deepEqual(plan.scriptIds, [item.script_id])
    assert.equal(plan.scriptIds.length, 1)
  }
})

test('组内全部记录都进预览（不截断、不抽样）', () => {
  for (const item of GROUPS) {
    const rows = planRows(item.record_count, item.script_id)
    const entries = buildJuriluEntries(rows, item.script_id)
    assert.equal(entries.length, item.record_count, '整组条数必须原样进表')
    assert.equal(entries[0].juriluSeq, '1')
    assert.equal(entries[entries.length - 1].juriluSeq, String(item.record_count))
    assert.ok(entries.every((entry) => entry.scriptId === item.script_id), '每条都要带上脚本组，不能混组')
    assert.equal(countMatchedEntries(entries), item.record_count)
  }

  // 把 41 条 + 31 条混在一起是**不可能**发生的：一次只映射一组
  const only = buildJuriluEntries(planRows(41, '2936083'), '2936083')
  assert.equal(new Set(only.map((entry) => entry.scriptId)).size, 1)

  // 未匹配的条目也要进表（带原因），而不是被悄悄丢掉
  const partial = buildJuriluEntries(planRows(3, '2933351', false), '2933351')
  assert.equal(partial.length, 3)
  assert.equal(partial[0].status, 'unmatched')
  assert.equal(partial[0].matched_by, 'none')
  assert.match(partial[0].message, /没有匹配到镜头/)
  assert.equal(countMatchedEntries(partial), 0)
})

test('组覆盖率不一致时如实提示（少了几条 / 多了别的组）', () => {
  assert.equal(groupCoverageNotice(41, 41), '')
  assert.equal(groupCoverageNotice(0, 0), '')
  const less = groupCoverageNotice(41, 31)
  assert.match(less, /只返回了 31 条/)
  assert.match(less, /记录数是 41 条/)
  const more = groupCoverageNotice(31, 41)
  assert.match(more, /混入了别的剧本组/)
})

test('换组：旧组 rows 先被清空，才允许发新请求', () => {
  const plan = planGroupMatch({ previousSelectedId: '2936083', selectedId: '2933351', currentRowCount: 41 })
  assert.equal(plan.send, true, '换组后允许发请求')
  assert.deepEqual(plan.scriptIds, ['2933351'])
  assert.equal(plan.clearBefore, true, '必须先清空旧组结果')
  assert.equal(plan.clearCount, 41)
  /* 阶段 B 第 2 批（审计 §4.2 模式 1 / §6.1）：内部组编号不上主区，只说「新的一组」。 */
  assert.match(plan.notice, /已切换到新的一组/)
  assert.ok(!plan.notice.includes('2933351'), `组编号不许上屏：${plan.notice}`)

  const oldRows = Array.from({ length: 41 }, (_, index) => `row-${index}`)
  assert.deepEqual(clearRowsBeforeMatch(oldRows, plan), [])

  const outcome = applyGroupSwitch<{ key: string }>({
    previousSelectedId: '2936083',
    selectedId: '2933351',
    currentRowCount: 41,
  })
  assert.equal(outcome.changed, true)
  assert.equal(outcome.clearedCount, 41)
  assert.deepEqual(outcome.nextRows, [])
  assert.equal(outcome.resetMatched, true, '换了组就要清掉"已匹配组"标记')

  const same = planGroupMatch({ previousSelectedId: '2936083', selectedId: '2936083', currentRowCount: 41 })
  assert.equal(same.clearBefore, true)
  assert.equal(same.clearCount, 41)

  const fresh = planGroupMatch({ previousSelectedId: '', selectedId: '2933350', currentRowCount: 0 })
  assert.equal(fresh.clearBefore, false)
  assert.equal(fresh.clearCount, 0)
})

test('likely_newest 只是提示，不构成默认选中', () => {
  assert.deepEqual(defaultScriptSelection(GROUPS), [])
  const selection = resolveScriptSelection({
    groups: GROUPS,
    selectedScriptIds: defaultScriptSelection(GROUPS),
    requiresScriptSelection: true,
    rowCount: 0,
  })
  assert.equal(selection.selectedId, '')
  assert.deepEqual(selection.requestScriptIds, [])
})

test('没有时间戳证据时不出现「最新版本」字样（U2 升级要求）', () => {
  // 契约里的真实依据：标题相同 + 内容重合度 —— 都是客观事实，**不含时间戳** → 不标最新版
  const info = versionInfo(G_NEWEST)
  assert.equal(info.timestampEvidence, false)
  assert.equal(info.label, '')
  assert.equal(info.disclaimer, '')
  assert.equal(info.hint, '', '没有时间戳证据时不展示可能含"最可能是最新版"的后端提示语')
  assert.equal(info.factsTitle, '判断依据')
  assert.deepEqual(info.facts, ['与 2933351/2933350 标题相同', '内容重合度 82%'])
  assert.equal(info.noEvidenceNotice, NO_TIMESTAMP_EVIDENCE)
  assert.match(info.noEvidenceNotice, /不做版本新旧判断/)
  // 拼给页面看的整串里不能有「最新版本」四个字
  const shown = [info.label, info.hint, info.disclaimer, ...info.facts, info.noEvidenceNotice].join('\n')
  assert.ok(!shown.includes('最新版本'), `页面上不该出现「最新版本」：${shown}`)

  // 该组自己连时间都没有，更不可能有时间戳证据
  const noTime = versionInfo(group({ script_id: 'x', likely_newest: true, version_reasons: ['创建时间更晚'] }))
  assert.equal(noTime.timestampEvidence, false)
  assert.equal(noTime.label, '')
})

test('只有后端给出基于时间戳的依据时才显示「最新版本」（并带"仍请你确认"）', () => {
  const withTime = group({
    script_id: '2936083',
    created_at: '2026-09-19 10:00:00',
    record_count: 41,
    likely_newest: true,
    version_reasons: ['创建时间 2026-09-19 10:00:00 晚于 2933350 的 2026-09-18 09:00:00'],
    version_hint: '按时间戳判断，本组最新',
  })
  const info = versionInfo(withTime)
  assert.equal(info.timestampEvidence, true)
  assert.equal(info.label, NEWEST_TAG_TEXT)
  assert.match(info.label, /时间戳/)
  assert.equal(info.disclaimer, NEWEST_DISCLAIMER)
  assert.match(info.disclaimer, /仍需你确认/)
  assert.equal(info.noEvidenceNotice, '')

  // 只有关键词、没有该组自身时间戳 → 仍不算证据
  assert.equal(reasonHasTimestampEvidence('updated_at 最晚'), true)
  const noOwnTime = versionInfo(
    group({ script_id: 'y', likely_newest: true, version_reasons: ['更新时间最晚'] }),
  )
  assert.equal(noOwnTime.timestampEvidence, false)
  assert.equal(noOwnTime.label, '')
})

test('缺标题 / 缺时间：显示「未提供」，不编造', () => {
  const texts = groupFieldTexts(G_NEWEST)
  assert.equal(texts.titleText, '第1集')
  assert.equal(texts.titleMissing, false)
  assert.equal(texts.createdAtText, '创建时间：2026-09-19 10:00:00')
  assert.equal(texts.updatedAtText, `更新时间：${MISSING_TIME_TEXT}`)
  assert.equal(texts.recordCountText, '41 条分镜')
  assert.equal(texts.seqRangeText, '分镜序号 1–41')
  assert.equal(texts.missingMetaNotice, '这一组缺少标题/时间信息，不影响选组')

  const empty = groupFieldTexts(group({ script_id: '1' }))
  assert.equal(empty.titleText, MISSING_TITLE_TEXT)
  assert.equal(empty.titleMissing, true)
  assert.match(empty.createdAtText, new RegExp(MISSING_TIME_TEXT))
  assert.match(empty.updatedAtText, new RegExp(MISSING_TIME_TEXT))
  assert.equal(empty.recordCountText, '0 条分镜')
  assert.equal(empty.seqRangeText, '未提供分镜序号范围')
  assert.equal(empty.missingMetaNotice, '这一组缺少标题/时间信息，不影响选组')

  const noField = groupFieldTexts(group({ script_id: '2', seq_min: '1', seq_max: '5' }))
  assert.equal(noField.seqRangeText, '分镜序号 1–5')
  assert.match(rawKeysText(group({ script_id: '3' })), /这次没有读到可用信息项/)
})

test('解析自检：前几条样例 + 正文截断 + 字数如实显示', () => {
  const sample = group({
    script_id: '2936083',
    sample_records: [
      { seq: '1', sbid: 'S1', prompt_head: '前 60 字'.repeat(20), prompt_length: 120, summary_head: '摘要'.repeat(30) },
      { seq: '2', sbid: '', prompt_head: '', prompt_length: 0, summary_head: '' },
    ],
  })
  const rows = sampleRows(sample)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].seqText, '#1')
  assert.equal(rows[0].sbidText, 'S1')
  assert.equal(rows[0].promptLengthText, '120 字')
  assert.ok(rows[0].promptHeadText.length <= 61)
  assert.ok(rows[0].summaryHeadText.length <= 41)
  assert.equal(rows[1].sbidText, '未提供 sbid')
  assert.equal(rows[1].promptHeadText, '（空）')
  assert.match(sampleSectionTitle(sample), /msgpack 解析自检（正文 \/ 序号 \/ 提示词）/)
  assert.match(sampleSectionTitle(sample), /前 2 条/)
})

test('后端要求先选组却给了 rows：一条都不用（109 条不是一集的连续镜头）', () => {
  const selection = resolveScriptSelection({
    groups: GROUPS,
    selectedScriptIds: [],
    requiresScriptSelection: true,
    rowCount: 109,
  })
  assert.equal(selection.dropRows, true)
  assert.deepEqual(selection.requestScriptIds, [])
  assert.ok(selection.notices.some((item) => /必须重新选组/.test(item)))

  const ok = resolveScriptSelection({
    groups: GROUPS,
    selectedScriptIds: ['2936083'],
    requiresScriptSelection: false,
    rowCount: 41,
  })
  assert.equal(ok.dropRows, false)
  assert.deepEqual(ok.requestScriptIds, ['2936083'])
})

test('一次性收到多个 script_id：按"未选择"处理，绝不自动合并', () => {
  const selection = resolveScriptSelection({
    groups: GROUPS,
    selectedScriptIds: ['2936083', '2933351'],
    requiresScriptSelection: false,
    rowCount: 68,
  })
  assert.equal(selection.selectedId, '')
  assert.deepEqual(selection.requestScriptIds, [])
  assert.ok(selection.notices.some((item) => /一次只能选一组/.test(item)))
})

test('选了不存在的组 → 不发请求并明确提示重选', () => {
  const selection = resolveScriptSelection({
    groups: GROUPS,
    selectedScriptIds: ['9999999'],
    requiresScriptSelection: false,
    rowCount: 0,
  })
  assert.equal(selection.selectedId, '')
  assert.deepEqual(selection.requestScriptIds, [])
  assert.ok(selection.notices.some((item) => /不在本次返回的脚本组里/.test(item)))
})

test('镜头不足：明确写出缺少数量，并给出三个选项', () => {
  // 本集 0 镜 + 该组 31 条（还没匹配，用户直接点"创建缺失镜头"）
  const empty = planShotShortage({ shotCount: 0, entryCount: 0, matchedCount: 0, groupRecordCount: 31 })
  assert.equal(empty.show, true)
  assert.equal(empty.targetCount, 31)
  assert.equal(empty.missingCount, 31)
  assert.match(empty.message, /缺少 31 个/)
  assert.deepEqual(
    empty.options.map((item) => item.key),
    ['create_missing', 'save_matched_only', 'back_to_adjust'],
  )
  assert.match(empty.options[0].label, /创建缺失镜头（31 个）并重新匹配/)
  assert.match(empty.options[1].label, /仅保存已经匹配的条目（0 条）/)
  assert.match(empty.options[1].label, /仅保存/)
  assert.match(empty.options[2].label, /返回调整/)
  assert.equal(empty.options[0].disabled, false)
  assert.equal(empty.options[1].disabled, true, '一条都没匹配上时"仅保存已匹配"没有意义')
  assert.equal(empty.options[2].disabled, false)

  // 已匹配 20 条、本集 25 镜、该组 31 条 → 缺 6 个
  const partial = planShotShortage({ shotCount: 25, entryCount: 31, matchedCount: 20, groupRecordCount: 31 })
  assert.equal(partial.missingCount, 6)
  assert.match(partial.message, /现有 25 个镜头/)
  assert.match(partial.message, /缺少 6 个/)
  assert.equal(partial.options[0].disabled, false)
  assert.equal(partial.options[1].disabled, false)
  assert.match(partial.options[1].label, /（20 条）/)

  // 数量一致 → 不显示这套选项
  const aligned = planShotShortage({ shotCount: 31, entryCount: 31, matchedCount: 31, groupRecordCount: 31 })
  assert.equal(aligned.show, false)
  assert.equal(aligned.missingCount, 0)
})

test('预览表抬头必须写出当前是哪一组（防止看错表）', () => {
  assert.equal(activeGroupLabel(GROUPS, '2936083'), '当前脚本组（第1集） · 41 条分镜')
  assert.match(activeGroupLabel(GROUPS, ''), /尚未选择脚本组/)
  assert.match(activeGroupLabel(GROUPS, '888'), /不在本次返回的清单里/)
})

test('保存按钮只显示当前勾选条数，不再出现「最多 3 条」（U2 升级要求）', () => {
  assert.equal(saveButtonText(31), '确认保存（31 条）')
  assert.equal(saveButtonText(0), '确认保存（0 条）')
  assert.equal(saveButtonText(109), '确认保存（109 条）')
  assert.ok(!saveButtonText(41).includes('最多'), '不该再有"最多 N 条"的限制文案')
  assert.ok(!saveButtonText(41).includes('临时章节'))

  const notice = wholeGroupSaveNotice(31, '2933350', 31)
  // 组编号是内部标识：这行文案只允许出现"这一组 / 本组"，不许回显 script_id
  assert.ok(!notice.includes('2933350'), '整组保存说明不许上屏脚本组编号')
  assert.match(notice, /本组共 31 条记录/)
  assert.match(notice, /31 条/)
  assert.match(notice, /本次只保存这一组/)
  assert.match(notice, /不与其他剧本组混合/)

  const whole = wholeGroupNotice(G2)
  assert.match(whole, /31 条记录会全部进入统一预览与匹配/)
  assert.match(whole, /不截断/)
  assert.match(whole, /不与其他剧本组混合/)
  assert.match(wholeGroupNotice(null), /还没选择脚本组/)
})

test('归一化：缺字段就留空（交给展示层说"未提供"），没有 script_id 的组丢掉', () => {
  const normalized = normalizeScriptGroups([
    { script_id: '2936083', record_count: '41', likely_newest: true, version_reasons: ['重合 82%', ''] },
    { script_id: '', title: '野组' },
    null,
    { script_id: 'x', record_count: '不是数字' },
  ])
  assert.equal(normalized.length, 2)
  assert.equal(normalized[0].record_count, 41)
  assert.equal(normalized[0].title, '')
  assert.deepEqual(normalized[0].version_reasons, ['重合 82%'])
  assert.equal(normalized[0].likely_newest, true)
  assert.equal(normalized[1].record_count, 0)
  assert.equal(normalized[1].likely_newest, false)
  assert.deepEqual(normalizeScriptGroups(undefined), [])
})

test('条目类型带脚本组与巨日禄序号（页面预览表两列的数据来源）', () => {
  const entries: JuriluPreviewEntry[] = buildJuriluEntries(
    [{ order: 7, prompt: '正文', shot_id: 'shot7' }, { prompt: '正文2' }],
    '2933351',
  )
  assert.equal(entries[0].scriptId, '2933351')
  assert.equal(entries[0].juriluSeq, '7')
  assert.equal(entries[1].juriluSeq, '未提供序号')
  assert.equal(entries[1].shot_id, '')
})

/* ------------------------------------- 状态一致性（2026-09-20 页面复测的缺陷） */

const ACC_CHAPTER = 'acc_jurilu_group_204035'
const ACC_LABEL = '第100集 · 验收·巨日禄整组导入（临时）'

/** 用户复测时的真实场景：目标章节 0 镜、选中 31 条的组。 */
function flowInput(overrides: Partial<JuriluFlowInput> = {}): JuriluFlowInput {
  return {
    scriptGroups: GROUPS,
    selectedScriptId: '',
    match: null,
    matching: false,
    chapterId: ACC_CHAPTER,
    chapterLabel: ACC_LABEL,
    entryCount: 0,
    matchedRowCount: 0,
    ...overrides,
  }
}

function matchedWith(overrides: Partial<JuriluMatch> = {}): JuriluMatch {
  return {
    scriptId: '2933350',
    chapterId: ACC_CHAPTER,
    entryCount: 31,
    matchedCount: 31,
    groupRecordCount: 31,
    chapterShotCount: 31,
    ...overrides,
  }
}

test('未选组：缺口面板不可见、没有任何创建入口（复测缺陷 1 的核心）', () => {
  const flow = resolveJuriluFlow(flowInput())
  assert.equal(flow.stage, 'idle')
  assert.equal(flow.canShowShortage, false)
  assert.equal(flow.shortage, null, '未选组时不许算出任何缺口')
  assert.equal(flow.matchedScriptId, '')
  assert.equal(flow.targetCount, 0)
  assert.match(flow.statusText, /尚未选择脚本组/)
  // 状态文案里不许出现"缺少 N 个"
  assert.ok(!flow.statusText.includes('缺少'), `未选组时不该提缺口：${flow.statusText}`)
  // 底部通用按钮在 idle 时仍归"其他平台导入"链路使用
  assert.equal(flow.showBottomCreateButton, true)
})

test('已选组但没点匹配：缺口面板仍不可见、无创建入口（不许用"选过组"冒充"已匹配"）', () => {
  const flow = resolveJuriluFlow(flowInput({ selectedScriptId: '2933350' }))
  assert.equal(flow.stage, 'selected')
  assert.equal(flow.canShowShortage, false, '只选组不能显示缺口')
  assert.equal(flow.shortage, null)
  assert.equal(flow.matchedScriptId, '')
  assert.equal(flow.targetCount, 0)
  assert.match(flow.statusText, /已经选好一组了/)
  assert.ok(!flow.statusText.includes('2933350'), `组编号不许上屏：${flow.statusText}`)
  assert.match(flow.statusText, /还没点「用这一组匹配镜头」/)
  assert.ok(!flow.statusText.includes('缺少'), `只是选组时不该提缺口：${flow.statusText}`)
  // 状态文案与"尚未选择"必须互斥：同一时刻只能出现一个
  assert.ok(!flow.statusText.includes('尚未选择脚本组'))
  // 巨日禄链路已经开始了 → 底部那条通用创建按钮必须让位（只留缺口面板里的那个）
  assert.equal(flow.showBottomCreateButton, false)
})

test('正在匹配（后端预览还没返回）：缺口面板与创建入口一律隐藏', () => {
  const flow = resolveJuriluFlow(flowInput({ selectedScriptId: '2933350', matching: true, match: matchedWith() }))
  assert.equal(flow.stage, 'matching')
  assert.equal(flow.canShowShortage, false)
  assert.equal(flow.shortage, null)
  assert.equal(flow.showBottomCreateButton, false)
  assert.match(flow.statusText, /正在用这一组匹配镜头/)
  assert.ok(!flow.statusText.includes('2933350'), `组编号不许上屏：${flow.statusText}`)
  assert.match(flow.statusText, /拿到结果之前不显示镜头数与缺口/)
})

test('已匹配：缺口可见，且**只给一个**创建按钮；镜头数用后端真实值', () => {
  const flow = resolveJuriluFlow(
    flowInput({ selectedScriptId: '2933350', match: matchedWith({ chapterShotCount: 3 }), entryCount: 31, matchedRowCount: 31 }),
  )
  assert.equal(flow.stage, 'matched')
  assert.equal(flow.canShowShortage, true)
  assert.equal(flow.matchedScriptId, '2933350')
  assert.equal(flow.shotCount, 3, '镜头数取自后端 chapter_shot_count，不是前端推断')
  assert.equal(flow.targetCount, 31)
  assert.equal(flow.shortage?.show, true)
  assert.equal(flow.shortage?.missingCount, 28)
  // 只有一个创建入口：缺口面板里的 create_missing；底部那条隐藏
  const createOptions = (flow.shortage?.options ?? []).filter((item) => item.key === 'create_missing')
  assert.equal(createOptions.length, 1, '缺口面板里只能有一个创建按钮')
  assert.match(createOptions[0].label, /创建缺失镜头（28 个）并重新匹配/)
  assert.equal(flow.showBottomCreateButton, false, '巨日禄整组导入时底部按钮必须隐藏')
  assert.match(flow.statusText, /现有 3 个镜头，缺少 28 个/)

  // 数量一致 → 面板不出现（缺口 0）且没有创建按钮
  const aligned = resolveJuriluFlow(
    flowInput({ selectedScriptId: '2933350', match: matchedWith({ chapterShotCount: 31 }), entryCount: 31, matchedRowCount: 31 }),
  )
  assert.equal(aligned.shortage?.show, false)
  assert.match(aligned.statusText, /数量一致/)
})

test('换章节 / 换组 → 旧匹配自动作废，缺口与已匹配标记一律清空', () => {
  const match = matchedWith()
  // 换章节（匹配记录里是旧章节）
  const otherChapter = resolveJuriluFlow(
    flowInput({ selectedScriptId: '2933350', match, chapterId: 'acc_jurilu_173939', chapterLabel: '第1集 · 老章节' }),
  )
  assert.equal(otherChapter.stage, 'stale')
  assert.equal(otherChapter.canShowShortage, false)
  assert.equal(otherChapter.shortage, null)
  assert.equal(otherChapter.matchedScriptId, '')
  assert.equal(otherChapter.targetCount, 0)
  assert.match(otherChapter.statusText, /已经作废/)

  // 换组（匹配记录里是另一组）
  const otherGroup = resolveJuriluFlow(flowInput({ selectedScriptId: '2936083', match }))
  assert.equal(otherGroup.stage, 'stale')
  assert.equal(otherGroup.canShowShortage, false)
  assert.equal(otherGroup.matchedScriptId, '')

  // 页面动作侧同样要清干净：换组清 rows、换章节也清 rows（同一套口径）
  const switchGroup = applyGroupSwitch<{ key: string }>({
    previousSelectedId: '2933350',
    selectedId: '2936083',
    currentRowCount: 31,
  })
  assert.deepEqual(switchGroup.nextRows, [])
  assert.equal(switchGroup.resetMatched, true)
})

test('目标章节文案包含：名称 + ID 末段 + 真实镜头数（匹配后才给真实值）', () => {
  assert.equal(chapterIdTail(ACC_CHAPTER), '…204035')
  assert.equal(chapterIdTail(''), '（未选择章节）')

  const before = targetChapterText({ label: ACC_LABEL, chapterId: ACC_CHAPTER, shotCount: 0, matched: false })
  assert.match(before.text, /当前目标章节：第100集 · 验收·巨日禄整组导入（临时）/)
  assert.match(before.text, /ID …204035/)
  assert.match(before.text, /点「用这一组匹配镜头」后显示/)
  assert.ok(!before.text.includes('后端真实值'), `主区不写「后端真实值」这种开发说法：${before.text}`)
  assert.ok(!before.text.includes('本集镜头 0 个'), '匹配前不许把镜头数当真实值展示')

  const after = targetChapterText({ label: ACC_LABEL, chapterId: ACC_CHAPTER, shotCount: 3, matched: true })
  assert.match(after.text, /第100集 · 验收·巨日禄整组导入（临时）/)
  assert.match(after.text, /ID …204035/)
  assert.match(after.text, /本集镜头 3 个/)

  // 页面用的 flow.chapterText 与它是同一份（不会出现"页面上写 0、面板里写 3"）
  const flow = resolveJuriluFlow(
    flowInput({ selectedScriptId: '2933350', match: matchedWith({ chapterShotCount: 3 }), entryCount: 31, matchedRowCount: 31 }),
  )
  assert.equal(flow.chapterText, after.text)
  assert.equal(flow.chapterIdTail, '…204035')
  const flowBefore = resolveJuriluFlow(flowInput())
  assert.equal(flowBefore.chapterText, before.text)
})

test('建镜头：一次点击只算一轮，且用后端最新镜头数（不许因为"有 3 个"就补 28 个）', () => {
  const ok = planCreateMissingShots({ latestShotCount: 3, targetCount: 31, inFlight: false })
  assert.equal(ok.allowed, true)
  assert.equal(ok.count, 28)
  assert.match(ok.reason, /3 → 31/)

  // 连点：还有一轮在飞 → 直接拒绝，不重复创建
  const inflight = planCreateMissingShots({ latestShotCount: 3, targetCount: 31, inFlight: true })
  assert.equal(inflight.allowed, false)
  assert.equal(inflight.count, 0)
  assert.match(inflight.reason, /不会重复创建/)

  // 后端最新数据说已经够了 → 不创建
  const enough = planCreateMissingShots({ latestShotCount: 31, targetCount: 31, inFlight: false })
  assert.equal(enough.allowed, false)
  assert.equal(enough.count, 0)
  assert.match(enough.reason, /无需创建/)

  // 0 镜的新章节 → 一次补满
  const empty = planCreateMissingShots({ latestShotCount: 0, targetCount: 31, inFlight: false })
  assert.equal(empty.count, 31)
})
