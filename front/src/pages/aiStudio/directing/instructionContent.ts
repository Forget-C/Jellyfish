import type { CompilationDecision, Prompt, RevisionFieldChange, ReviewFinding, RevisionFieldTarget } from '../../../services/generated'
import type { ReadableContext } from './readableText'
import { decisionRanges } from './readableText'

export type InstructionBlock = {
  id: string; title: string; section: 'input' | 'background' | 'execution' | 'other';
  kind: string; start: number; end: number; text: string; decisions: number[];
}

/** JSON pointer 层级匹配；相同字段名不跨 design/unit 归属匹配。 */
export const relatedInstructionPath = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')

const titleFor = (kind: string) => ({ action: '本次动作', camera: '摄影与运镜', sound: '声音', people: '人物与参考', space: '背景与空间', continuity: '连续性', constraint: '限制与项目风格', input: '固定输入', other: '其他指令' }[kind] || '其他指令')
const kindForPath = (path: string) => path.startsWith('/cinematography/') ? 'camera' : path.startsWith('/sound/') ? 'sound' : path.startsWith('/participants/') ? 'people' : path.startsWith('/staging/') ? 'space' : path.startsWith('/continuity/') ? 'continuity' : path.startsWith('/prompt/') || path === '/style_revision_id' || path.startsWith('/criteria/') ? 'constraint' : path.startsWith('/direction/') || path.startsWith('/performance/') ? 'action' : 'other'

/** 分块只投影固定正文，保留全部原文坐标、顺序及背景/执行边界，历史格式不猜测。 */
export function instructionBlocks(prompt: Pick<Prompt, 'text' | 'format_version' | 'decisions'>, identity: string): InstructionBlock[] {
  if (!prompt.text) return []
  if (prompt.format_version !== 'jellyfish-scene-v4') return [{ id: `${identity}:0:${prompt.text.length}`, title: '其他指令', kind: 'other', section: 'other', start: 0, end: prompt.text.length, text: prompt.text, decisions: prompt.decisions.map((_, index) => index) }]
  const ranges = decisionRanges(prompt.text, prompt.decisions)
  const blocks: InstructionBlock[] = []
  let section: InstructionBlock['section'] = 'other', kind = 'other', start = 0
  for (const line of prompt.text.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!line[0]) continue
    const end = start + line[0].length
    const value = line[0].trimEnd()
    if (value === '【场次试拍 v4】') { section = 'input'; kind = 'input' }
    else if (value.startsWith('【场次背景】')) { section = 'background'; kind = 'space' }
    else if (value === '【本次执行动作】') { section = 'execution'; kind = 'action' }
    const matches = ranges.filter(range => range.start < end && range.end > start).map(range => range.index)
    const paths = [...new Set(matches.map(index => prompt.decisions[index].section_path))]
    if (value.startsWith('参考 @') || value.startsWith('人物：')) kind = 'people'
    else if (value.startsWith('声音安排：')) kind = 'sound'
    else if (/^镜头 \d+ \[/.test(value)) kind = 'action'
    else if (value.startsWith('项目风格 [')) kind = 'constraint'
    else if (paths.length) {
      const kinds = [...new Set(paths.map(kindForPath))]
      kind = kinds.length === 1 ? kinds[0] : 'other'
    } else {
      const header = /^【([a-z_]+)\[\d+\]:/.exec(value)
      if (header) {
        const next = ranges.find(range => range.start >= end)
        kind = ['beats', 'shots', 'blocking_states'].includes(header[1]) ? 'action' : kindForPath('/' + header[1] + '/0')
        if (next && kind === 'other') kind = kindForPath(prompt.decisions[next.index].section_path)
      }
      else if (value.startsWith('【总导演背景:') || value.startsWith('【表演背景:')) kind = 'action'
    }
    const previous = blocks[blocks.length - 1]
    if (previous && previous.kind === kind && previous.section === section && !/^【[a-z_]+\[\d+\]:/.test(value) && !/^镜头 \d+ \[/.test(value)) {
      previous.end = end; previous.text += line[0]; previous.decisions = [...new Set([...previous.decisions, ...matches])]
      previous.id = `${identity}:${previous.start}:${end}`
    } else blocks.push({ id: `${identity}:${start}:${end}`, title: titleFor(kind), kind, section, start, end, text: line[0], decisions: [...new Set(matches)] })
    start = end
  }
  return blocks
}

/** 只从真实编译决定关联字段；无摘录的决定仍可在固定依据详情中查看。 */
export function blockPaths(block: InstructionBlock, decisions: CompilationDecision[]) {
  return [...new Set(block.decisions.map(index => decisions[index]?.section_path).filter((path): path is string => !!path))]
}

/** 没有正文坐标的决定独立供图中查看，不补造正文或混入阅读卡片。 */
export function instructionGraphBlocks(prompt: Prompt, identity: string, blocks: InstructionBlock[]) {
  const represented = new Set(blocks.flatMap(block => block.decisions))
  return [...blocks, ...prompt.decisions.flatMap((decision, index) => represented.has(index) ? [] : [{
    id: `${identity}:unmapped:${index}`, title: decision.disposition === 'reference' ? '由参考表达' : decision.disposition === 'unexpressed' ? '未写入正文' : '正文映射缺失',
    kind: 'other', section: 'other' as const, start: -1, end: -1, text: '', decisions: [index],
  }])]
}

export function blockFindings(block: InstructionBlock, decisions: CompilationDecision[], finding: ReviewFinding) {
  return blockPaths(block, decisions).some(path => finding.affected_paths.some(affected => relatedInstructionPath(path, affected)))
}

export function blockChanges(block: InstructionBlock, decisions: CompilationDecision[], changes: RevisionFieldChange[]) {
  return changes.filter(change => change.target === 'design' ? blockPaths(block, decisions).some(path => relatedInstructionPath(path, change.path)) : block.section === 'input' && block.kind === 'input' && ['/duration_ms', '/ratio'].includes(change.path))
}

export function scopeForBlock(block: InstructionBlock, decisions: CompilationDecision[], fields: RevisionFieldTarget[]): RevisionFieldTarget[] {
  return fields.filter(field => field.target === 'design' ? blockPaths(block, decisions).some(path => relatedInstructionPath(path, field.path)) : block.section === 'input' && block.kind === 'input' && ['/duration_ms', '/ratio'].includes(field.path)).map(({ target, path }) => ({ target, path }))
}

/** 镜头名称只从当前指令固定设计读取，多镜头内容保留所有明确身份。 */
export function blockShotLabels(block: InstructionBlock, decisions: CompilationDecision[], context: ReadableContext) {
  const ids = new Set([...block.text.matchAll(/^镜头 \d+ \[([^\]]+)\]/gm)].map(match => match[1]))
  for (const path of blockPaths(block, decisions)) {
    const camera = /^\/cinematography\/(\d+)(?:\/|$)/.exec(path)
    const shot = /^\/direction\/shots\/(\d+)(?:\/|$)/.exec(path)
    const id = camera ? context.design?.cinematography[Number(camera[1])]?.shot_id : shot ? context.design?.direction.shots[Number(shot[1])]?.id : undefined
    if (id) ids.add(id)
  }
  return [...ids].map(id => context.entities.find(entity => entity.kind === '镜头' && entity.id === id)?.label || '历史镜头暂不可用')
}
