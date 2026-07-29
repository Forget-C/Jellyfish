/**
 * 只读 WebVTT 解析（纯函数，无 DOM、无 HTML 求值）。
 *
 * 安全性：解析结果只产出纯字符串，调用方用 React 文本节点渲染（React 默认转义），
 * 绝不使用 dangerouslySetInnerHTML，因此字幕内容不会被当作 HTML 执行。
 */

export interface ParsedCue {
  /** cue 标识符（WebVTT 的 identifier 行）。 */
  id: string
  /** 起点时间戳原文，如 00:00:00.400。 */
  start: string
  /** 终点时间戳原文。 */
  end: string
  /** 字幕正文（多行以 \n 连接）。 */
  text: string
  /** NOTE 中携带的镜头引用（若有）。 */
  shotId?: string
  /** NOTE 中携带的说话人（若有）。 */
  speaker?: string
}

export interface ParsedVtt {
  language?: string
  cues: ParsedCue[]
  /** 无法识别为 WebVTT 时为 false。 */
  valid: boolean
}

const TIMING_RE = /^(\S+)\s+-->\s+(\S+)/

/**
 * 解析 WebVTT 文本。
 *
 * 容错策略：结构异常时返回 valid=false 而不是抛错，让 UI 能显示明确的错误态。
 */
export function parseWebVtt(input: string): ParsedVtt {
  // 用转义写 BOM（U+FEFF）：字面量 BOM 属于 irregular whitespace，且不易肉眼发现。
  const text = (input ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!text.trimStart().startsWith('WEBVTT')) {
    return { cues: [], valid: false }
  }

  const blocks = text.split(/\n{2,}/)
  const header = blocks[0] ?? ''
  const languageMatch = header.match(/^Language:\s*(.+)$/m)

  const cues: ParsedCue[] = []
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue

    let shotId: string | undefined
    let speaker: string | undefined
    let index = 0

    // NOTE 行（可能有多行）先消费掉。
    while (index < lines.length && lines[index].startsWith('NOTE')) {
      const note = lines[index]
      shotId = note.match(/shot=([^\s]+)/)?.[1] ?? shotId
      speaker = note.match(/speaker=([^\s]+)/)?.[1] ?? speaker
      index += 1
    }

    // 可选的 identifier 行：下一行若不是时间轴，则当作 identifier。
    let id = ''
    if (index < lines.length && !TIMING_RE.test(lines[index])) {
      id = lines[index]
      index += 1
    }

    const timing = index < lines.length ? lines[index].match(TIMING_RE) : null
    if (!timing) continue
    index += 1

    const body = lines.slice(index).join('\n')
    cues.push({ id, start: timing[1], end: timing[2], text: body, shotId, speaker })
  }

  return { language: languageMatch?.[1]?.trim(), cues, valid: true }
}
