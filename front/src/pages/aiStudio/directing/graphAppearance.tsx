import type { CanvasTone } from '../../../components/canvas/Canvas'

/** 同类业务对象跨设计、生产和指令投影保留同一标识；布局与内容密度由各视图决定。 */
const appearances: Record<string, { label: string; symbol: string; tone: CanvasTone }> = {
  shot: { label: '镜头', symbol: '▣', tone: 'blue' },
  unit: { label: '生产单元', symbol: '▣', tone: 'blue' },
  beat: { label: '节拍', symbol: '◆', tone: 'green' },
  coverage: { label: '覆盖', symbol: '◆', tone: 'green' },
  participant: { label: '人物／物件', symbol: '●', tone: 'rose' },
  anchor: { label: '空间锚点', symbol: '⌖', tone: 'violet' },
  event: { label: '事件', symbol: '↗', tone: 'violet' },
  criterion: { label: '验收要求', symbol: '✓', tone: 'violet' },
  dependency: { label: '前段依赖', symbol: '↗', tone: 'violet' },
  location: { label: '场所', symbol: '⌖', tone: 'violet' },
  blocking: { label: '调度', symbol: '↔', tone: 'green' },
  performance: { label: '表演', symbol: '◇', tone: 'green' },
  situation: { label: '角色情境', symbol: '◇', tone: 'green' },
  activity: { label: '镜内活动', symbol: '↔', tone: 'green' },
  camera: { label: '摄影', symbol: '▣', tone: 'blue' },
  sound: { label: '声音', symbol: '♪', tone: 'blue' },
  dialogue: { label: '对白', symbol: '♪', tone: 'blue' },
  continuity: { label: '连续性', symbol: '↗', tone: 'violet' },
  overview: { label: '全场概览', symbol: '▤', tone: 'neutral' },
  staging: { label: '环境与留白', symbol: '▤', tone: 'neutral' },
  prompt: { label: '提示词指导', symbol: '≡', tone: 'neutral' },
  'project-style': { label: '项目风格', symbol: '▤', tone: 'neutral' },
  unmapped: { label: '未映射依据', symbol: '?', tone: 'neutral' },
  source: { label: '编译依据', symbol: '▤', tone: 'neutral' },
  text: { label: '指令正文', symbol: '≡', tone: 'blue' },
  issue: { label: '检查问题', symbol: '!', tone: 'amber' },
  request: { label: '调整要求', symbol: '≡', tone: 'blue' },
  change: { label: '候选变化', symbol: '↗', tone: 'green' },
  reference: { label: '参考素材', symbol: '▧', tone: 'neutral' },
}
export const graphNodeAppearance = (type: string) => appearances[type] || { label: '对象', symbol: '◇', tone: 'neutral' as const }
export function GraphNodeType({ type }: { type: string }) {
  const { label, symbol } = graphNodeAppearance(type)
  return <small className="canvas-node-type" aria-hidden="true">{symbol} {label}</small>
}
