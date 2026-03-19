import type { ModelCategoryKey } from '../../../services/generated/models/ModelCategoryKey'
import type { ProviderStatus } from '../../../services/generated/models/ProviderStatus'

export const MODEL_CATEGORIES: { key: ModelCategoryKey; label: string; color: string }[] = [
  { key: 'text', label: '文本生成', color: 'blue' },
  { key: 'image', label: '图片生成', color: 'orange' },
  { key: 'video', label: '视频生成', color: 'purple' },
]

export const categoryLabelMap = Object.fromEntries(MODEL_CATEGORIES.map((c) => [c.key, c.label]))
export const categoryColorMap = Object.fromEntries(MODEL_CATEGORIES.map((c) => [c.key, c.color]))

export const PROVIDER_STATUS_MAP: Record<ProviderStatus, { text: string; color: string }> = {
  active: { text: '活跃', color: 'green' },
  testing: { text: '测试中', color: 'orange' },
  disabled: { text: '禁用', color: 'default' },
}

export const SORT_OPTIONS = [
  { value: 'updated', label: '最近更新' },
  { value: 'name', label: '名称' },
  { value: 'category', label: '类别' },
]

/**
 * 供应商预设：快速填充常用 AI 供应商的 Base URL 与描述。
 */
export const PROVIDER_PRESETS: Record<string, { baseUrl: string; description: string }> = {
  OpenAI: {
    baseUrl: 'https://api.openai.com/v1',
    description: '支持 GPT-4o / GPT-4o-mini / o1 / o3 等模型',
  },
  MiniMax: {
    baseUrl: 'https://api.minimax.io/v1',
    description: '支持 MiniMax-M2.7 / MiniMax-M2.5 等模型（OpenAI 兼容）',
  },
  火山引擎: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    description: '支持豆包（Doubao）等模型',
  },
  阿里百炼: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: '支持通义千问（Qwen）等模型',
  },
}

export function maskUrl(url: string): string {
  if (!url) return '—'
  try {
    const u = new URL(url)
    return `${u.protocol}//***${u.host.slice(-6)}${u.pathname}`
  } catch {
    return url.slice(0, 20) + '***'
  }
}
