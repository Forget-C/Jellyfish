import { useUiText } from '../../../uiText'
import { InputNumber, Select } from 'antd'
import type { CanvasModelCapability, ImageModelCard, VideoModelCard } from '../../../services/generated'

type Props<T> = { card: T; capability?: CanvasModelCapability; disabled?: boolean; onChange: (next: T) => void }
const options = (values: string[] = []) => values.map(value => ({ value, label: value }))

/** 已核实的能力决定控件可见性；隐藏不支持参数时保留原配置供预检诊断。 */
export function ImageModelParameters({ card, capability, disabled, onChange }: Props<ImageModelCard>) {
  const uiText = useUiText()
  const config = card.config || {}
  const ratios = capability?.ratios || []
  const profiles = capability?.resolution_profiles || {}
  const resolutions = Object.keys(profiles[config.target_ratio || ''] || {})
  const supportsResolution = Object.values(profiles).some(values => Object.keys(values).length > 0)
  return <>
    {ratios.length > 0 && <Select size="small" bordered={false} disabled={disabled} aria-label={uiText("图片画幅")} data-diagnostic-control="target_ratio" value={config.target_ratio || 'default'}
      options={[{ value: 'default', label: uiText("默认画幅") }, ...options(ratios)]} onChange={value => onChange({ ...card, config: { ...config, target_ratio: value === 'default' ? null : value } })} />}
    {supportsResolution && <Select size="small" bordered={false} disabled={disabled || !resolutions.length} aria-label={uiText("图片分辨率")} data-diagnostic-control="resolution_profile" placeholder={uiText("分辨率")} title={!resolutions.length ? uiText("先选择支持的画幅") : undefined} value={config.resolution_profile || 'default'}
      options={[{ value: 'default', label: uiText("默认分辨率") }, ...options(resolutions)]} onChange={value => onChange({ ...card, config: { ...config, resolution_profile: value === 'default' ? null : value } })} />}
    {typeof capability?.min_count === 'number' && typeof capability?.max_count === 'number' && <InputNumber size="small" bordered={false} disabled={disabled} aria-label={uiText("图片数量")} data-diagnostic-control="count" value={config.count ?? 1} min={capability.min_count} max={capability.max_count}
      formatter={value => Number(value) === 1 ? uiText("1 张") : uiText("{{value}} 张", { value: value ?? '' })} parser={value => Number(value?.replace(/[^\d]/g, ''))}
      onChange={value => onChange({ ...card, config: { ...config, count: value ?? 1 } })} />}
  </>
}

export function VideoModelParameters({ card, capability, disabled, onChange, mode }: Props<VideoModelCard> & { mode: string }) {
  const uiText = useUiText()
  const config = card.config || {}
  const modeOptions = capability?.video_modes?.[mode]
  const resolutionRules = modeOptions?.duration_by_resolution
  const resolutions = Object.keys(resolutionRules || {})
  const duration = config.resolution ? resolutionRules?.[config.resolution] : undefined
  const allowedRatios = capability?.ratios?.filter(value => modeOptions?.ratios?.includes(value) ?? true)
  return <>
    <Select size="small" bordered={false} disabled={disabled} aria-label={uiText("视频画幅")} data-diagnostic-control="ratio" placeholder={uiText("读取默认画幅")} value={config.ratio || undefined} style={{ width: 100 }} options={options(allowedRatios)}
      onChange={value => onChange({ ...card, config: { ...config, ratio: value ?? null } })} />
    {resolutions.length > 0 ? <Select size="small" bordered={false} disabled={disabled} aria-label={uiText('分辨率')}
      data-diagnostic-control="resolution" placeholder={uiText('分辨率')} value={config.resolution || undefined}
      options={options(resolutions)} onChange={value => onChange({ ...card, config: { ...config, resolution: value, seconds: null } })} />
      : <Select size="small" bordered={false} disabled={disabled} aria-label={uiText("视频时长模式")} value={typeof config.seconds === 'number' ? 'custom' : 'default'} options={[{ value: 'default', label: uiText("默认时长") }, { value: 'custom', label: uiText("自定义时长") }]}
        onChange={value => onChange({ ...card, config: { ...config, seconds: value === 'default' ? null : Math.min(capability?.max_seconds ?? Infinity, Math.max(capability?.min_seconds ?? 1, 5)) } })} />}
    {Array.isArray(duration) ? <Select size="small" bordered={false} disabled={disabled} aria-label={uiText('视频时长（秒）')}
      data-diagnostic-control="seconds" value={config.seconds ?? undefined} placeholder={uiText('视频时长（秒）')}
      options={duration.map(value => ({ value, label: value }))} onChange={value => onChange({ ...card, config: { ...config, seconds: value } })} />
      : (duration || typeof config.seconds === 'number') && <InputNumber size="small" bordered={false} disabled={disabled}
        aria-label={uiText("视频时长（秒）")} data-diagnostic-control="seconds" value={config.seconds}
        min={Math.max(duration?.min_seconds ?? 1, capability?.min_seconds ?? 1)}
        max={duration ? Math.min(duration.max_seconds, capability?.max_seconds ?? Infinity) : capability?.max_seconds ?? undefined}
        onChange={value => onChange({ ...card, config: { ...config, seconds: value } })} />}
    <details><summary>{uiText("高级设置")}</summary><label>{uiText("随机种子")} <InputNumber aria-label={uiText("随机种子")} data-diagnostic-control="seed" value={config.seed} disabled={disabled || !capability?.supports_seed}
      onChange={value => onChange({ ...card, config: { ...config, seed: value } })} /></label>
      {card.config?.seed !== undefined && card.config?.seed !== null && !capability?.supports_seed && <span role="alert">{uiText("当前模型不支持已有随机种子，配置已保留")}</span>}
    </details>
  </>
}
