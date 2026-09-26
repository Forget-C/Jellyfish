/**
 * 主界面上的内部标识屏蔽（第三部分要求四）。
 *
 * 普通界面只显示用户要决定的内容（画幅 / 时长 / 参考方式 / 模型方案的业务名称 / 缺失项 / 生成状态）；
 * 供应商名、内部 ID、`file_id`、`storage_key`、接口参数统一收进默认折叠的「技术详情」。
 *
 * 后端的一些提示语（例如「对象存储读取失败（key=…）」）会内嵌这些标识，
 * 这里把它们换成一句指路，原文仍在「技术详情」里可查。
 *
 * ## 职责边界（阶段 B 第 3 批按审计 §7.3 扩展，务必读）
 *
 * 本函数**只做两件事**：① 掩码内部标识；② 替换一小撮**后端字段名 / 内部词汇**。
 * 它**不改写后端原始措辞** —— 后端的整句话术要由
 * `userFacingMessage.ts` 的第三步（业务化改写）负责。
 * 所以调用方必须走完整的
 * `maskInternalIds → sanitizeUserText → humanizeBackendMessage` 三级管道
 * （出口就是 `toUserFacingText` / `buildUserFacingMessage`），不要只用本函数。
 *
 * 审计 §7.3 / §4.3 模式 2（R13）：运行时实测「掩码后」仍会在主区留下
 * **「槽位」「接口」** 两个禁词 —— 原实现只认 4 个 ASCII 字段名，认不出这两个中文词。
 * 因此这里补上 `槽位 → 图片角度`、`接口 → 服务`、`推荐接口 → 推荐结果`
 * （长词在前，避免 `推荐接口` 被先拆成 `推荐` + `接口`）。
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const KEY_VALUE_RE = /\b(?:file_id|storage_key|asset_id|shot_id|chapter_id|service_task_id|source_task_id|video_task_id|provider_id)=\S+/gi
const BARE_STORAGE_KEY_RE = /\bkey=[^\s）)]+/gi
/** 后端提示里常直接写字段名（例如「该帧槽位没有 file_id」）——换成业务说法。 */
const FIELD_NAME_RE = /\b(?:file_id|storage_key|video_prompt_source|shot_details|image_prompts|quality_verdict)\b/gi
/**
 * 中文内部词汇（ASCII 的 `\b` 对中文字符不成立，所以必须单独一条正则）。
 * 顺序固定：长的在前（`推荐接口` 必须先于 `接口` 命中）。
 */
const CJK_FIELD_NAME_RE = /(推荐接口|接口|槽位)/g
const FIELD_NAME_LABELS: Record<string, string> = {
  file_id: '文件编号',
  storage_key: '存储位置',
  video_prompt_source: '提示词来源',
  shot_details: '镜头记录',
  /* 审计 §7.3 的扩展项（区域 6 登记「需追加」）：这两个字段名会在后端提示语里出现，
     不换掉就等于把字段名端上主区。 */
  image_prompts: '图片提示词',
  quality_verdict: '质量判定',
  推荐接口: '推荐结果',
  接口: '服务',
  槽位: '图片角度',
}

export const INTERNAL_ID_PLACEHOLDER = '（内部 ID 见「技术详情」）'

export function maskInternalIds(text: string): string {
  return String(text ?? '')
    .replace(KEY_VALUE_RE, INTERNAL_ID_PLACEHOLDER)
    .replace(BARE_STORAGE_KEY_RE, INTERNAL_ID_PLACEHOLDER)
    .replace(UUID_RE, INTERNAL_ID_PLACEHOLDER)
    .replace(FIELD_NAME_RE, (match) => FIELD_NAME_LABELS[match.toLowerCase()] ?? match)
    .replace(CJK_FIELD_NAME_RE, (match) => FIELD_NAME_LABELS[match] ?? match)
}

/** 是否含内部标识（用于测试与自检）。 */
export function containsInternalId(text: string): boolean {
  return maskInternalIds(text) !== String(text ?? '')
}
