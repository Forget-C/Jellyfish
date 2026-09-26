/**
 * 「参考音频」页面口径的回归测试（Node 内置测试运行器）。
 *
 * 锁三件事：
 *   1. **绑了取不到**时，必须在提交**之前**就显示「已绑定，但当前服务取不到这条声音」
 *      + 后端给的真实原因 + 修法（不是等生成失败才说）；
 *   2. **不许夸大**：携带时只能说"会进请求（本轮仅请求计划层验证）"，
 *      不能宣称"已支持参考音频影响生成"；
 *   3. 未绑定 / 明确无需声音 / 已登记的素材引用 / 内网地址分别有各自的状态文案；
 *   4. **地址只进技术详情层**：主区（tag / title / detail / fix / terminology）不许出现
 *      完整 URL / `asset://` / `/files/...` / 本机内网地址（审计 §4.3 模式 4 / §3.4）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUDIO_NOT_REACHABLE_TITLE,
  REFERENCE_AUDIO_SCOPE_NOTE,
  REFERENCE_AUDIO_VS_FINAL_TRACK,
  audioStateTag,
  describeAudioAdmission,
  type AudioAudit,
} from './audioAdmissionCore.ts'

/**
 * 阶段 B ③（审计 §4.3 模式 5 / §7.3）：主区禁词。
 *
 * 这条断言是**新增**的（不是把旧期望放宽）：旧用例把「供应商」措辞**冻结**成了期望值，
 * 按审计口径「供应商」不许出现在主区 —— 所以期望改成同一个常量，
 * **同时**钉住这个常量本身不含禁词，防止有人改常量绕过去。
 */
const MAIN_SCREEN_FORBIDDEN_TERMS = ['供应商', 'provider', 'DRY_RUN', 'file_id'] as const

/**
 * 阶段 B 第 3 批收尾（审计 §4.3 模式 4 / §3.4）：**主区禁「地址形态」**。
 *
 * 与主区禁词表配套的第二张表 —— 完整 URL、存储形态（`asset://` / `data:`）、
 * 本地存储路径（`/files/...`）、本机 / 内网地址都属于第三层，只允许出现在
 * `technicalDetail`（技术详情层）。
 */
const MAIN_SCREEN_ADDRESS_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /asset:\/\//i,
  /data:[a-z]+\//i,
  /\/files\//i,
  /localhost|127\.0\.0\.1|192\.168\.|10\.\d+\.\d+\.\d+/i,
]

/**
 * 主区出口的合并文本（`tag` / `title` / `detail` / `fix` / `terminology`）。
 *
 * 这几项都是**默认展开、用户一进页面就看得到**的文案；
 * `technicalDetail` 是唯一允许带地址的字段（默认收起的「技术详情」）。
 */
function mainSurfaceOf(view: {
  tag: string
  title: string
  detail: string
  fix: string
  terminology: string
}): string {
  return [view.tag, view.title, view.detail, view.fix, view.terminology].join('｜')
}

function assertNoAddressInMainSurface(view: Parameters<typeof mainSurfaceOf>[0], label: string): void {
  const surface = mainSurfaceOf(view)
  MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
    assert.doesNotMatch(surface, pattern, `${label}：主区不许出现地址 / 存储形态（命中 ${pattern}）→ ${surface}`)
  })
}

function audit(overrides: Partial<AudioAudit> = {}): AudioAudit {
  return { included: false, file_id: 'file-audio-1', ...overrides }
}

test('本机相对路径 → 显示「已绑定，但当前服务取不到这条声音」并给原因与修法', () => {
  const view = describeAudioAdmission(
    audit({
      state: 'local_path',
      reason_code: 'local_path',
      declared_url: '/files/files/voice.mp3',
      excluded_reason: '已绑定声音「验收配音」，但它解析出的是本地/相对地址（/files/files/voice.mp3）：供应商抓不到。',
      how_to_fix: '把音频上传到公网（OSS 等），或登记一个公网音频地址后重新绑定。',
    }),
  )

  assert.equal(view.blocked, true)
  assert.equal(view.title, AUDIO_NOT_REACHABLE_TITLE)
  MAIN_SCREEN_FORBIDDEN_TERMS.forEach((term) => {
    assert.ok(!view.title.includes(term), `主区标题不许含禁词「${term}」：${view.title}`)
  })
  /* 旧期望是 `assert.match(view.detail, /本地\/相对地址/)` —— 那是**后端句子的改写结果**
     直接上主区（且带 `/files/files/voice.mp3`）。现在改成更强的两条：
     ①主区给产品自己写的中文结论（可据此行动）；②地址 / 存储形态只在技术详情层。 */
  assert.match(view.detail, /本机或只是相对路径/)
  assert.match(view.detail, /生成服务取不到它/)
  assertNoAddressInMainSurface(view, '本机相对路径')
  assert.match(view.technicalDetail, /\/files\/files\/voice\.mp3/)
  assert.match(view.fix, /公网/)
  assert.equal(view.tone, 'warning')
  // 本地路径不能出现在 tag 里当"可用"
  assert.match(view.tag, /本地/)
})

test('内网地址 → 同样显示不可访问（http:// 开头也不算可用）', () => {
  const view = describeAudioAdmission(
    audit({
      state: 'private_address',
      reason_code: 'private_address',
      declared_url: 'http://192.168.1.9:8000/voice.mp3',
      excluded_reason: '已绑定声音「验收配音」，但它指向本机/内网地址（192.168.1.9）：别人的服务器一定取不到。',
      how_to_fix: '请换成公网可访问的 http(s) 地址（OSS 等）。',
    }),
  )

  assert.equal(view.blocked, true)
  assert.equal(view.title, AUDIO_NOT_REACHABLE_TITLE)
  assert.match(view.detail, /内网/)
})

test('供应商不支持参考音频 → 也说清"绑了但用不上"', () => {
  const view = describeAudioAdmission(
    audit({
      state: 'vendor_unsupported',
      reason_code: 'vendor_unsupported',
      vendor_supports_reference_audio: false,
      excluded_reason: '已绑定声音「验收配音」，但当前视频供应商/模型不接受参考音频：本次生成请求不会携带它。',
    }),
  )

  assert.equal(view.blocked, true)
  assert.match(view.tag, /不接受参考音频/)
})

test('公网地址 → 已携带，但文案只承诺"会进请求"，不承诺影响结果', () => {
  const view = describeAudioAdmission(
    audit({ included: true, state: 'public_url', url: 'https://cdn.example.com/voice.mp3' }),
  )

  assert.equal(view.blocked, false)
  assert.equal(view.tone, 'success')
  assert.match(view.fix, /请求计划层/)
  assert.doesNotMatch(view.title, /影响生成/)
  assert.match(view.fix, /尚未有真实证据/)
  // 主区只说"公网可访问"，完整地址进技术详情
  assert.match(view.detail, /公网可访问的地址/)
  assertNoAddressInMainSurface(view, '公网地址')
  assert.match(view.technicalDetail, /https:\/\/cdn\.example\.com\/voice\.mp3/)
})

test('asset:// → 算携带；主区不出现地址与存储形态，地址只进技术详情层（审计 §4.3 模式 4）', () => {
  const view = describeAudioAdmission(
    audit({ included: true, state: 'asset_ref', url: 'asset://project-1/voice-asset-1' }),
  )
  assert.equal(view.blocked, false)
  // 旧期望是 `assert.match(view.tag, /asset:\/\//)` —— 那等于把「存储形态印在主区」冻结成正确行为。
  // 现在改成同时钉住两件事，断言**更强**：①主区一处都没有；②地址确实在技术详情层。
  assertNoAddressInMainSurface(view, 'asset:// 素材')
  assert.match(view.tag, /素材引用/)
  assert.doesNotMatch(view.tag, /asset:\/\//)
  assert.doesNotMatch(view.detail, /asset:\/\//)
  assert.match(view.technicalDetail, /asset:\/\/project-1\/voice-asset-1/)
})

test('本地 / 相对地址被当成"会携带"时，主区也只说形态（不出 `/files/...`）', () => {
  const view = describeAudioAdmission(
    audit({ included: true, state: 'public_url', url: '/files/files/voice.mp3' }),
  )
  assertNoAddressInMainSurface(view, '相对地址')
  assert.match(view.detail, /本机或相对地址/)
  assert.match(view.technicalDetail, /\/files\/files\/voice\.mp3/)
})

test('内网地址 → 主区不说"公网可访问"（本机 / 内网形态单独判定）', () => {
  const view = describeAudioAdmission(
    audit({ included: true, state: 'public_url', url: 'http://192.168.1.9:8000/voice.mp3' }),
  )
  assertNoAddressInMainSurface(view, '内网地址')
  assert.doesNotMatch(view.detail, /公网可访问/)
  assert.match(view.technicalDetail, /192\.168\.1\.9/)
})

test('未绑定 → 明确说未绑定，不冒充"已绑定"', () => {
  const view = describeAudioAdmission({ included: false, file_id: '', state: 'not_bound', reason_code: 'not_bound' })
  assert.equal(view.blocked, false)
  assert.equal(view.tag, '声音未绑定')
  assert.match(view.title, /还没有绑定声音/)
})

test('明确标记无需声音 → 是表态，不是漏绑，也不报警', () => {
  const view = describeAudioAdmission(audit({ file_id: '', state: 'opt_out', reason_code: 'opt_out', excluded_reason: '本镜已明确标记「无需声音」。' }))
  assert.equal(view.blocked, false)
  assert.equal(view.tag, '本镜明确无需声音')
  assert.equal(view.tone, 'default')
})

test('计划还没加载 → 状态未知，不猜', () => {
  const view = describeAudioAdmission(null)
  assert.equal(view.blocked, false)
  assert.match(view.tag, /未知/)
})

test('术语澄清：参考音频 ≠ 最终成片音轨（每个状态都带上）', () => {
  const states = [
    null,
    audit({ included: true, state: 'public_url', url: 'https://cdn.example.com/a.mp3' }),
    audit({ state: 'local_path', reason_code: 'local_path' }),
    { state: 'opt_out' } as AudioAudit,
  ]
  for (const item of states) {
    assert.equal(describeAudioAdmission(item).terminology, REFERENCE_AUDIO_VS_FINAL_TRACK)
  }
  assert.match(REFERENCE_AUDIO_VS_FINAL_TRACK, /最终成片的音轨/)
  assert.match(REFERENCE_AUDIO_SCOPE_NOTE, /请求计划层/)
})

test('阶段B③：标题常量与后端原文出口都不含主区禁词（审计 §4.3 模式 5 / 模式 6）', () => {
  MAIN_SCREEN_FORBIDDEN_TERMS.forEach((term) => {
    assert.ok(!AUDIO_NOT_REACHABLE_TITLE.includes(term), `标题常量含禁词「${term}」`)
  })
  // 后端 `excluded_reason` 原文里带「供应商」时，出口必须先过管道再上屏
  const view = describeAudioAdmission(
    audit({
      state: 'local_path',
      reason_code: 'local_path',
      excluded_reason: '已绑定声音「验收配音」，但它解析出的是本地/相对地址（/files/files/voice.mp3）：供应商抓不到。',
      how_to_fix: '把音频上传到公网（OSS 等），或登记一个公网音频地址后重新绑定。',
    }),
  )
  const surface = `${view.title}｜${view.detail}｜${view.fix}｜${view.tag}`
  MAIN_SCREEN_FORBIDDEN_TERMS.forEach((term) => {
    assert.ok(!surface.includes(term), `主区出口仍含禁词「${term}」：${surface}`)
  })
  // 后端原文里的存储路径同样不许顺着 `detail` 上主区（审计 §4.3 模式 4）
  assertNoAddressInMainSurface(view, '后端原文带 /files/ 路径')
})

test('阶段B第3批收尾：**所有**分支的主区都不含地址，且地址只出现在技术详情层', () => {
  const cases: Array<{ label: string; input: AudioAudit | null }> = [
    { label: '无审计', input: null },
    { label: '未绑定', input: { included: false, file_id: '', state: 'not_bound', reason_code: 'not_bound' } },
    { label: '明确无需声音', input: audit({ state: 'opt_out', reason_code: 'opt_out' }) },
    {
      label: '取不到（本机路径）',
      input: audit({
        state: 'local_path',
        reason_code: 'local_path',
        declared_url: '/files/files/voice.mp3',
        excluded_reason: '已绑定声音，但它解析出的是本地/相对地址（/files/files/voice.mp3）：生成服务抓不到。',
      }),
    },
    { label: '携带（公网）', input: audit({ included: true, state: 'public_url', url: 'https://cdn.example.com/a.mp3' }) },
    { label: '携带（素材引用）', input: audit({ included: true, state: 'asset_ref', url: 'asset://project-1/voice-asset-1' }) },
    { label: '携带（内嵌）', input: audit({ included: true, state: 'data_url_inline', url: 'data:audio/mpeg;base64,AAAA' }) },
  ]
  const offenders: string[] = []
  cases.forEach(({ label, input }) => {
    const view = describeAudioAdmission(input)
    const surface = mainSurfaceOf(view)
    MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
      if (pattern.test(surface)) offenders.push(`${label}：主区命中 ${pattern} → ${surface}`)
    })
    // 技术详情层是**唯一**允许带地址的字段：它自己不许含主区禁词
    MAIN_SCREEN_FORBIDDEN_TERMS.forEach((term) => {
      if (view.technicalDetail.includes(term)) offenders.push(`${label}：技术详情层含禁词「${term}」`)
    })
  })
  assert.deepEqual(offenders, [], `主区仍漏出地址 / 存储形态：\n${offenders.join('\n')}`)
  // 反向断言（防过度屏蔽）：没有地址时，技术详情层必须是空串，而不是编造内容
  assert.equal(describeAudioAdmission(null).technicalDetail, '')
  assert.equal(
    describeAudioAdmission({ included: false, file_id: '', state: 'not_bound' }).technicalDetail,
    '',
  )
})

test('计划面板短标签：有审计用审计，没有审计时退回旧字段文案', () => {
  assert.match(audioStateTag({ included: true, state: 'public_url' }), /会携带/)
  assert.equal(audioStateTag(null, 'bound_not_public'), AUDIO_NOT_REACHABLE_TITLE)
  assert.equal(audioStateTag(null, 'bound'), '声音已绑定（公网可用）')
  assert.equal(audioStateTag(null, 'opt_out'), '本镜明确无需声音')
  assert.equal(audioStateTag(null, 'missing'), '声音未绑定')
  assert.match(audioStateTag(null, 'whatever'), /未知/)
})
