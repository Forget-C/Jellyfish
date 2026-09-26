/**
 * `enumLabels.ts` 的回归测试（阶段 B ①）。
 *
 * 两类必须有的用例（用户点名）：
 *   1. **未知值不原样返回英文** —— 每条映射的兜底都必须是中文，不能是 `?? key`；
 *   2. **覆盖审计文档列出的全部原值** —— 文档里出现过的英文原值一个都不能漏，
 *      漏了就等于「某页渲染时会把英文上屏」。
 *
 * 另有两条结构性用例：
 *   - `values` 与 `labels` 的键必须一一对应（防止加了原值忘了加翻译）；
 *   - 中文标签里不许再出现英文原值（防止「翻译」写成 `成功(partial_failed)` 这种半吊子）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ALL_ENUM_SPECS,
  ASSET_OUTCOME,
  ENUM_RAW_VALUES,
  FRAME_TYPE,
  ASSET_OUTCOME_PARTIAL_FAILED_MAIN_TEXT,
  MODEL_RAW_NAMES,
  REFERENCE_MODE,
  VIDEO_READINESS_CHECK,
  countCoveredRawValues,
  imageModelBusinessName,
  isKnownValue,
  labelFor,
  lookupLabel,
  modelBusinessName,
  partialFailureHeadline,
  textModelBusinessName,
  videoModelBusinessName,
  videoPromptSourceLabel,
  type EnumSpec,
} from './enumLabels.ts'

/** `components/` → `src/`：别名守卫要扫全仓源码。 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * 只判**代码**、不判**注释**：历史沿革的注释里必然要提到旧写法（本仓库的规矩是
 * 「把踩过的坑写在注释里」），否则守卫会逼着后人删掉最有价值的那段说明。
 *
 * 实现是**逐行**的，不用「正则去块注释」那种写法：前几批实测过
 * `accept="…,image/*"` 这类字符串里的 `/*` 会让朴素实现吞掉几百行代码（假绿/假红）。
 * 逐行的代价是：**单行里的 `//` 之后会被当成注释截掉**（例如 URL 里带 `//`）。
 * 对本守卫无影响：要判的是「显示名有没有别名」，别名不会只出现在 URL 后半段。
 */
function stripCommentsForAliasScan(source: string): string {
  const out: string[] = []
  let inBlockComment = false
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      out.push('')
      continue
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      out.push('')
      continue
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
      out.push('')
      continue
    }
    out.push(line.replace(/\/\/.*$/, ''))
  }
  return out.join('\n')
}

/* ------------------------------------------- ② 覆盖文档列出的全部原值（用户点名） */

/**
 * 审计文档（`frontend-leak-audit-2026-09-26.md`）的 §4 / §5 / §6 里**出现过的英文原值**。
 *
 * 这份清单是**判据**：文档点名了它，本表就必须能翻译它。
 * 注意：这里只收「会上屏的枚举原值」，不含字段名（那些由 `maskInternalIds` 负责）。
 */
const DOC_LISTED_RAW_VALUES: readonly string[] = [
  // §6.3 outcome 一族 + §4.4 状态
  'partial_failed',
  'failed',
  'running',
  'pending',
  'ok',
  'dry_run',
  'unknown',
  'succeeded',
  'cancelled',
  'streaming',
  // §4.3 / §5.1 R7 视频准备度检查项 code（7 个）
  'extraction_ready',
  'duration_ready',
  'prompt_ready',
  'reference_frames_ready',
  'video_model_ready',
  'provider_ready',
  'no_active_video_task',
  // §4.3 参考方式
  'text_only',
  'first_last',
  'first_last_key',
  // §4.3 / §5.1 R10 帧类型
  'first',
  'last',
  'keyframe',
  'key',
  // §4.4 生成条件状态
  'ready',
  'not_configured',
  'missing_params',
  'conflict',
  'service_error',
  'loading',
  // §4.4 运行模式与出口
  'real',
  'real_unconfirmed',
  'llm',
  'image',
  'video',
  'oss',
  // §4.4 出站审计动作
  'blocked',
  'blocked_unconfirmed',
  'blocked_network',
  'allowed_real',
  'guard_installed',
  // §4.3 提示词来源
  'jurilu',
  'skill',
  'manual',
  'manual_workspace',
  'internal',
  'shot_description',
  // 关键帧出图来源
  'saved',
  'request',
  'empty',
  // §4.2 / R6 交付来源
  'external_import',
  // §4.3 画幅来源
  'shot',
  'project',
  'default',
  // §4.6 帧模式
  'single_frame',
  'first_last_frame',
  // §4.6 资产类型
  'character',
  'scene',
  'prop',
  'costume',
  // §4.4 模型 / 供应商状态
  'configured',
  'missing',
  'active',
  'testing',
  'disabled',
  // §4.4 任务类型（运行时实测漏出英文的三个）
  'script_merge',
  'script_variant',
  'image_generation',
  'video_generation',
]

test('覆盖审计文档里出现过的全部英文原值（一个都不能漏）', () => {
  const missing = DOC_LISTED_RAW_VALUES.filter((value) => !ENUM_RAW_VALUES.includes(value.toLowerCase()))
  assert.deepEqual(
    missing,
    [],
    `这些原值文档里点名了，但映射表没覆盖（渲染时会把英文上屏）：${missing.join('、')}`,
  )
})

test('词源表不是空表（防止「扫不到东西＝干净」的假绿）', () => {
  assert.ok(ENUM_RAW_VALUES.length >= 60, `词源表只有 ${ENUM_RAW_VALUES.length} 个原值，太少了，可能被清空了`)
  assert.ok(countCoveredRawValues() >= 80, `覆盖原值计数只有 ${countCoveredRawValues()}，与预期不符`)
  assert.equal(ENUM_RAW_VALUES.length, new Set(ENUM_RAW_VALUES).size, '词源表必须去重')
  assert.ok(MODEL_RAW_NAMES.length >= 3, '模型原名词源表不能为空')
})

/* ----------------------------------------------- ① 未知值不原样返回英文（用户点名） */

/** 造一批「肯定没登记过」的英文原值，验证兜底一定是中文。 */
const UNKNOWN_PROBE_VALUES: readonly string[] = [
  'brand_new_enum_value',
  'NOT_A_REAL_STATE',
  'someUnknownStatus',
  'zzz_unmapped',
]

const CJK_RE = /[\u4e00-\u9fff]/
/** 是否含有拉丁字母（用于判定「原值被原样返回」）。 */
const LATIN_RE = /[A-Za-z]/

test('未知值一律返回中文兜底，绝不原样返回英文原值', () => {
  const offenders: string[] = []
  ALL_ENUM_SPECS.forEach((spec: EnumSpec) => {
    UNKNOWN_PROBE_VALUES.forEach((probe) => {
      const label = labelFor(spec, probe)
      if (!CJK_RE.test(label)) offenders.push(`${spec.name}：「${probe}」→「${label}」（没有中文）`)
      if (label === probe) offenders.push(`${spec.name}：「${probe}」被原样返回`)
      if (label.toLowerCase() === probe.toLowerCase()) offenders.push(`${spec.name}：「${probe}」被原样返回（忽略大小写）`)
    })
  })
  assert.deepEqual(offenders, [], `未登记原值必须给中文兜底：\n${offenders.join('\n')}`)
})

test('未知值的兜底就是该枚举类声明的 unknown 文案（中文）', () => {
  ALL_ENUM_SPECS.forEach((spec) => {
    assert.ok(CJK_RE.test(spec.unknown), `${spec.name} 的 unknown 兜底必须是中文，实际是「${spec.unknown}」`)
    assert.ok(
      !spec.values.some((value) => value.toLowerCase() === spec.unknown.toLowerCase()),
      `${spec.name} 的 unknown 兜底不能是原值之一`,
    )
    assert.equal(labelFor(spec, 'brand_new_enum_value'), spec.unknown, `${spec.name} 的兜底不一致`)
  })
})

test('空值 / null / undefined 也走中文兜底（不回显空串）', () => {
  ALL_ENUM_SPECS.forEach((spec) => {
    const probes: Array<string | null | undefined> = [null, undefined, '', '   ']
    probes.forEach((raw) => {
      const label = labelFor(spec, raw as string | null | undefined)
      assert.equal(label, spec.unknown, `${spec.name} 的空值兜底应为「${spec.unknown}」`)
      assert.ok(CJK_RE.test(label), `${spec.name} 的空值兜底必须含中文`)
    })
  })
})

test('lookupLabel 对未登记值返回 null（给调用方自己决定业务话术的机会）', () => {
  assert.equal(lookupLabel(ASSET_OUTCOME, 'partial_failed'), '部分失败')
  assert.equal(lookupLabel(ASSET_OUTCOME, 'brand_new_enum_value'), null)
  assert.equal(lookupLabel(ASSET_OUTCOME, ''), null)
  assert.equal(isKnownValue(ASSET_OUTCOME, 'partial_failed'), true)
  assert.equal(isKnownValue(ASSET_OUTCOME, 'brand_new_enum_value'), false)
})

test('大小写不敏感（后端有的枚举大写、有的小写）', () => {
  assert.equal(labelFor(FRAME_TYPE, 'FIRST'), '首帧')
  assert.equal(labelFor(ASSET_OUTCOME, 'Partial_Failed'), '部分失败')
})

/* -------------------------------------------------------------- 结构性用例 */

test('每个枚举类的 values 与 labels 键一一对应（加了原值就必须加翻译）', () => {
  const offenders: string[] = []
  ALL_ENUM_SPECS.forEach((spec) => {
    spec.values.forEach((value) => {
      if (!(value in spec.labels)) offenders.push(`${spec.name}：原值「${value}」没有中文标签`)
    })
    Object.keys(spec.labels).forEach((key) => {
      if (!spec.values.includes(key)) offenders.push(`${spec.name}：标签键「${key}」不在 values 里`)
    })
  })
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

test('中文标签里不许再出现英文原值（防止「成功(partial_failed)」这种半吊子翻译）', () => {
  const offenders: string[] = []
  ALL_ENUM_SPECS.forEach((spec) => {
    Object.entries(spec.labels).forEach(([value, label]) => {
      const withoutCode = label.replace(/[（(][^）)]*[A-Za-z][^）)]*[）)]/g, '')
      if (LATIN_RE.test(withoutCode)) offenders.push(`${spec.name}：${value} → 「${label}」仍含拉丁字母`)
      assert.ok(CJK_RE.test(label), `${spec.name}：${value} → 「${label}」不是中文`)
    })
  })
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

/* -------------------------------------------------- 三个边界项的固定模板（§6.3） */

test('partial_failed 的主区口径是固定模板，不会把枚举原值拼进句子', () => {
  assert.equal(ASSET_OUTCOME.labels.partial_failed, '部分失败')
  assert.match(ASSET_OUTCOME_PARTIAL_FAILED_MAIN_TEXT, /图片没成功保存/)
  assert.ok(!ASSET_OUTCOME_PARTIAL_FAILED_MAIN_TEXT.includes('partial_failed'), '模板里不许出现枚举原值')
  const headline = partialFailureHeadline(3, 5)
  assert.equal(headline, '部分失败（成功 3/共 5）')
  assert.ok(!headline.includes('partial_failed'))
  assert.ok(!headline.includes('失败 2'), '不许再输出「成功 X / 失败 Y」这种旧口径')
})

test('未知检查项 code 不回显原值（视频准备度）', () => {
  assert.equal(labelFor(VIDEO_READINESS_CHECK, 'extraction_ready'), '已提取分镜')
  assert.equal(labelFor(VIDEO_READINESS_CHECK, 'some_future_check'), '其它前置条件')
})

test('参考方式的未登记兜底不是原值', () => {
  assert.equal(labelFor(REFERENCE_MODE, 'text_only'), '纯文本（不用参考帧）')
  assert.equal(labelFor(REFERENCE_MODE, 'brand_new_mode'), '未识别的参考方式')
})

/* ------------------------------------------------- §6.2 模型方案业务名 */

test('模型方案名：已登记给出业务说法，未登记给「当前 XXX 方案」而不是模型原名', () => {
  assert.equal(videoModelBusinessName('seedance-2.0-mini'), '短视频标准方案')
  assert.equal(textModelBusinessName('deepseek-chat'), '文本标准方案')
  assert.equal(imageModelBusinessName('gpt-image-2'), '图片标准方案')
  // 未登记：绝不能回显原始模型名
  assert.equal(videoModelBusinessName('seedance-9.9-turbo'), '当前视频方案')
  assert.equal(textModelBusinessName('some-new-llm'), '当前文本方案')
  assert.equal(imageModelBusinessName('flux-pro-99'), '当前图片方案')
  assert.equal(modelBusinessName('video', ''), '当前视频方案')
  assert.equal(modelBusinessName('image', null), '当前图片方案')
})

test('模型方案名绝不含「供应商」这类主区禁词', () => {
  const samples = ['seedance-2.0-mini', 'deepseek-chat', 'gpt-image-2', 'unmapped-model']
  ;(['video', 'text', 'image'] as const).forEach((outlet) => {
    samples.forEach((sample) => {
      const label = modelBusinessName(outlet, sample)
      assert.ok(!label.includes('供应商'), `${outlet}/${sample} → 「${label}」含禁词「供应商」`)
      assert.ok(!label.includes('provider'), `${outlet}/${sample} → 「${label}」含 provider`)
    })
  })
})

test('模型原始名不得出现在业务说法里（原始名只进技术详情）', () => {
  const offenders: string[] = []
  ;(['video', 'text', 'image'] as const).forEach((outlet) => {
    MODEL_RAW_NAMES.forEach((raw) => {
      const label = modelBusinessName(outlet, raw)
      if (label.toLowerCase().includes(raw)) offenders.push(`${outlet}：${raw} → 「${label}」仍含原始名`)
    })
  })
  assert.deepEqual(offenders, [], offenders.join('\n'))
})

/* ------------------------------------------------ 外部工具显示名的「别名漂移」守卫 */

/**
 * 用户 2026-09-26 拍板：外部导入工具名全站统一用「巨日禄导入」，**不许再起别名**。
 *
 * 为什么要有这条守卫（真实发生过）：同一条文案在三个阶段里出现过**三种**写法 ——
 * `ProjectStudioStepPanel` 曾写「巨量导入」、本文件曾写「剧立方导入」、其余位置写「巨日禄导入」。
 * 结果**同一屏**里来源行与说明句互相打架，用户会以为自己在看两个不同的来源。
 *
 * 判定口径（只判**显示名**，不判枚举原值 `jurilu` —— 原值照旧只在技术详情层出现）：
 *   1. 非测试源码里，两种历史别名一个字都不许出现；
 *   2. 「巨日禄」这个工具名本身必须真实存在于源码里（防止守卫因为「词没了」而变成空跑）；
 *   3. 纯函数口径：`videoPromptSourceLabel('jurilu')` 必须等于统一显示名。
 */
test('外部工具显示名不许再起别名（全站只能有一种写法）', () => {
  const display = '巨日禄导入'
  /* 历史别名：字符串按字符拼，避免本守卫文件自己命中扫描（本文件是测试文件，本来也不在扫描面里，
     但拼出来更稳：以后有人改扫描面也不会因为守卫自身而假红）。 */
  const staleAliases = [`巨${'量'}导入`, `剧${'立方'}导入`]

  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'generated' || entry.name === 'node_modules') continue
        walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  walk(SRC_ROOT)
  /* 扫描面守卫：文件数下限 + **关键目录必须都被走到**（只判下限会因为遍历被收窄而假绿）。 */
  assert.ok(files.length >= 150, `扫描面太小（${files.length} 个文件），守卫可能没在正确目录上跑`)
  const visited = files.map((file) => relative(SRC_ROOT, file).replace(/\\/g, '/'))
  for (const dir of ['pages/aiStudio/chapter/', 'pages/aiStudio/project/', 'pages/aiStudio/components/', 'pages/aiStudio/promptFlow/']) {
    assert.ok(
      visited.some((file) => file.includes(dir)),
      `扫描面没覆盖 ${dir} —— 遍历被收窄了，守卫会变成空跑`,
    )
  }

  const offenders: string[] = []
  let unifiedCount = 0
  for (const file of files) {
    const text = stripCommentsForAliasScan(readFileSync(file, 'utf8'))
    const rel = relative(SRC_ROOT, file)
    for (const alias of staleAliases) {
      if (text.includes(alias)) offenders.push(`${rel} ｜ 出现了历史别名「${alias}」`)
    }
    const hits = text.split(display).length - 1
    unifiedCount += hits
  }
  assert.deepEqual(offenders, [], `显示名别名漂移（只允许「${display}」）：\n${offenders.join('\n')}`)
  assert.ok(
    unifiedCount >= 8,
    `全仓只找到 ${unifiedCount} 处「${display}」—— 少于预期，可能工具名被改掉了或守卫扫错了目录`,
  )

  assert.equal(videoPromptSourceLabel('jurilu'), display, '来源显示名必须与全站统一写法一致')
  assert.doesNotMatch(videoPromptSourceLabel('jurilu'), /jurilu/, '显示名里不许带枚举原值')
})
