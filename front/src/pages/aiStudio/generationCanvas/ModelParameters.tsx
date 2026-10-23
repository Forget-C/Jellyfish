import { InputNumber, Select, Space } from 'antd'
import type { CanvasModelCapability, ImageModelCard, VideoModelCard } from '../../../services/generated'

type Props<T> = { card: T; capability?: CanvasModelCapability; onChange: (next: T) => void }
const options = (values: string[] = []) => values.map(value => ({ value, label: value }))

export function ImageModelParameters({ card, capability, onChange }: Props<ImageModelCard>) {
  const config = card.config || {}
  return <Space wrap>
    <Select aria-label="图片画幅" placeholder="画幅" allowClear value={config.target_ratio || undefined} style={{ width: 100 }}
      options={options(capability?.ratios)} onChange={value => onChange({ ...card, config: { ...config, target_ratio: value ?? null } })} />
    <Select aria-label="图片分辨率" placeholder="分辨率" allowClear value={config.resolution_profile || undefined} style={{ width: 110 }}
      options={options(Object.keys(capability?.resolution_profiles?.[config.target_ratio || ''] || {}))}
      onChange={value => onChange({ ...card, config: { ...config, resolution_profile: value ?? null } })} />
    <InputNumber aria-label="图片数量" value={config.count ?? 1} min={capability?.min_count} max={capability?.max_count}
      onChange={value => onChange({ ...card, config: { ...config, count: value ?? 1 } })} />
  </Space>
}

export function VideoModelParameters({ card, capability, onChange }: Props<VideoModelCard>) {
  const config = card.config || {}
  return <Space wrap>
    <Select aria-label="视频画幅" placeholder="画幅" allowClear value={config.ratio || undefined} style={{ width: 100 }} options={options(capability?.ratios)}
      onChange={value => onChange({ ...card, config: { ...config, ratio: value ?? null } })} />
    <InputNumber aria-label="视频时长（秒）" placeholder="时长（秒）" value={config.seconds} min={capability?.min_seconds ?? 1} max={capability?.max_seconds ?? undefined}
      onChange={value => onChange({ ...card, config: { ...config, seconds: value } })} />
    <details><summary>高级设置</summary><label>随机种子 <InputNumber aria-label="随机种子" value={config.seed} disabled={!capability?.supports_seed}
      onChange={value => onChange({ ...card, config: { ...config, seed: value } })} /></label>
      {card.config?.seed !== undefined && card.config?.seed !== null && !capability?.supports_seed && <span role="alert">当前模型不支持已有随机种子，配置已保留</span>}
    </details>
  </Space>
}
