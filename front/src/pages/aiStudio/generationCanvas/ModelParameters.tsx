import { InputNumber, Select } from 'antd'
import type { CanvasModelCapability, ImageModelCard, VideoModelCard } from '../../../services/generated'

type Props<T> = { card: T; capability?: CanvasModelCapability; disabled?: boolean; onChange: (next: T) => void }
const options = (values: string[] = []) => values.map(value => ({ value, label: value }))

/** 已核实的能力决定控件可见性；隐藏不支持参数时保留原配置供预检诊断。 */
export function ImageModelParameters({ card, capability, disabled, onChange }: Props<ImageModelCard>) {
  const config = card.config || {}
  const ratios = capability?.ratios || []
  const profiles = capability?.resolution_profiles || {}
  const resolutions = Object.keys(profiles[config.target_ratio || ''] || {})
  const supportsResolution = Object.values(profiles).some(values => Object.keys(values).length > 0)
  return <>
    {ratios.length > 0 && <Select size="small" bordered={false} disabled={disabled} aria-label="图片画幅" placeholder="画幅" allowClear value={config.target_ratio || undefined}
      options={options(ratios)} onChange={value => onChange({ ...card, config: { ...config, target_ratio: value ?? null } })} />}
    {supportsResolution && <Select size="small" bordered={false} disabled={disabled || !resolutions.length} aria-label="图片分辨率" placeholder="分辨率" title={!resolutions.length ? '先选择支持的画幅' : undefined} allowClear value={config.resolution_profile || undefined}
      options={options(resolutions)} onChange={value => onChange({ ...card, config: { ...config, resolution_profile: value ?? null } })} />}
    {typeof capability?.min_count === 'number' && typeof capability?.max_count === 'number' && <InputNumber size="small" bordered={false} disabled={disabled} aria-label="图片数量" value={config.count ?? 1} min={capability.min_count} max={capability.max_count}
      formatter={value => `${value ?? ''} 张`} parser={value => Number(value?.replace(/[^\d]/g, ''))}
      onChange={value => onChange({ ...card, config: { ...config, count: value ?? 1 } })} />}
  </>
}

export function VideoModelParameters({ card, capability, disabled, onChange }: Props<VideoModelCard>) {
  const config = card.config || {}
  return <>
    <Select size="small" bordered={false} disabled={disabled} aria-label="视频画幅" placeholder="画幅" allowClear value={config.ratio || undefined} style={{ width: 100 }} options={options(capability?.ratios)}
      onChange={value => onChange({ ...card, config: { ...config, ratio: value ?? null } })} />
    <InputNumber size="small" bordered={false} disabled={disabled} aria-label="视频时长（秒）" placeholder="时长（秒）" value={config.seconds} min={capability?.min_seconds ?? 1} max={capability?.max_seconds ?? undefined}
      onChange={value => onChange({ ...card, config: { ...config, seconds: value } })} />
    <details><summary>高级设置</summary><label>随机种子 <InputNumber aria-label="随机种子" value={config.seed} disabled={disabled || !capability?.supports_seed}
      onChange={value => onChange({ ...card, config: { ...config, seed: value } })} /></label>
      {card.config?.seed !== undefined && card.config?.seed !== null && !capability?.supports_seed && <span role="alert">当前模型不支持已有随机种子，配置已保留</span>}
    </details>
  </>
}
