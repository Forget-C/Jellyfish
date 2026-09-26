/**
 * 巨日禄失败诊断文案测试（`node --test`）。
 *
 * 锁死真实踩过的那个坑：第二步 getStoryboardPage 三个请求全 200、只是记录没解析出来，
 * 页面却报成「第一步的环节｜HTTP 200」——环节报错会把人带偏到凭证排查上。
 *
 * ⚠️ 阶段 B 第 7 批同步更新（审计 §4.7 服务层 537-539）：**上屏话术一律换用户语言** ——
 * 内部环节名（`getScriptPage`）→「脚本接口」、`scriptId` →「脚本编号」、
 * `Cookie` →「登录凭证」、`Authorization` →「授权头」、`编码 / 载荷 / 解析器 / 2xx` 换说法。
 * 原始环节名仍由 `resolveJuriluFailureStage` 返回（**技术字段**，分支判断与断言都用它）。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeStoryboardZeroRecords,
  extractJuriluDiagnostics,
  findFailedStoryboardAttempt,
  resolveJuriluFailureStage,
} from './juriluDiagnostics.ts'

function err(diagnostics: Record<string, unknown>) {
  return { diagnostics }
}

test('第一步 401 → 环节就是脚本接口（原始值仍是 getScriptPage 这个技术字段）', () => {
  const text = extractJuriluDiagnostics(
    err({ getScriptPage_url: 'https://video.jurilu.com/api/x', script_status: 401, has_cookie: true, has_auth: false, auth_header_mode: 'none' }),
  )
  /* 审计 §4.7-537/539：环节名 / 请求头名换成用户语言，原始环节名只作技术字段返回。 */
  assert.match(text, /所在环节 脚本接口/)
  assert.doesNotMatch(text, /getScriptPage/)
  assert.match(text, /HTTP 401/)
  assert.match(text, /已带登录凭证：是/)
  assert.match(text, /已附授权头：否/)
  assert.doesNotMatch(text, /Cookie/)
  assert.doesNotMatch(text, /Authorization/)
})

test('第一步 200 + 第二步解析 0 条 → 环节必须报分镜接口，不能再说脚本接口', () => {
  const text = extractJuriluDiagnostics(
    err({
      getScriptPage_url: 'https://video.jurilu.com/api/x',
      script_status: 200,
      script_records_count: 3,
      has_cookie: true,
      has_auth: false,
      auth_header_mode: 'none',
      storyboard_attempts: [
        { script_id: '2936083', status: 200, parsed_count: 0, payload_shape: { encodings: ['json', 'msgpack'], record_counts: { msgpack: 41 } } },
      ],
    }),
  )
  assert.match(text, /所在环节 分镜接口/)
  assert.doesNotMatch(text, /getStoryboardPage/)
  assert.doesNotMatch(text, /脚本接口/)
  assert.match(text, /41 条/)
})

test('第二步 401 → 报第二步的 401，而不是第一步的 200（环节是分镜接口）', () => {
  const text = extractJuriluDiagnostics(
    err({
      script_status: 200,
      script_records_count: 1,
      storyboard_attempts: [{ script_id: '9', status: 401, error: 'HTTP 401', parsed_count: 0 }],
    }),
  )
  assert.match(text, /所在环节 分镜接口/)
  assert.match(text, /HTTP 401/)
})

test('第一步拿到 0 个脚本编号 → 明确说未取到脚本编号', () => {
  const text = extractJuriluDiagnostics(err({ script_status: 200, script_records_count: 0, has_cookie: true }))
  assert.match(text, /脚本接口（未取到脚本编号）/)
  assert.doesNotMatch(text, /scriptId/)
})

test('本地就被拦下（没发请求）→ 不谎报环节与状态', () => {
  const diag = { has_cookie: false, has_auth: false, auth_header_mode: 'none' }
  assert.deepEqual(resolveJuriluFailureStage(diag), { stage: 'getScriptPage', status: null })
  const text = extractJuriluDiagnostics(err(diag))
  assert.doesNotMatch(text, /HTTP null/)
})

test('第二步内容没能解析 → 明确说是我方解析问题，不是账号被拒', () => {
  const detail = describeStoryboardZeroRecords({
    status: 200,
    parsed_count: 0,
    payload_shape: { declared_encodings: ['msgpack'], decode_errors: ['msgpack'] },
  })
  assert.match(detail, /没能解析/)
  assert.match(detail, /不是你账号的问题/)
})

test('第二步用了不支持的内容格式 → 说清需要升级后再试', () => {
  const detail = describeStoryboardZeroRecords({
    status: 200,
    parsed_count: 0,
    payload_shape: { declared_encodings: ['protobuf'], unsupported_encodings: ['protobuf'] },
  })
  assert.match(detail, /不支持的内容格式/)
  assert.match(detail, /需要升级后再试/)
})

test('第二步确实 0 条（接口给的就是空）→ 不推给凭证', () => {
  const detail = describeStoryboardZeroRecords({
    status: 200,
    parsed_count: 0,
    payload_shape: { encodings: ['json'], record_counts: {} },
  })
  assert.match(detail, /确实没有分镜记录/)
  assert.match(detail, /不是账号问题/)
})

test('没有第二步证据时不硬编阶段说明', () => {
  assert.equal(describeStoryboardZeroRecords(null), '')
  assert.equal(findFailedStoryboardAttempt({}), null)
})

test('凭证/正文一个字都不能出现在诊断里', () => {
  const text = extractJuriluDiagnostics(
    err({
      script_status: 200,
      script_records_count: 3,
      has_cookie: true,
      has_auth: false,
      auth_header_mode: 'none',
      storyboard_attempts: [{ script_id: '1', status: 200, parsed_count: 0, error: '', payload_shape: { raw_head: '{"code":0' } }],
    }),
  )
  assert.doesNotMatch(text, /Authorization=/)
  assert.doesNotMatch(text, /eyJ/)
})
