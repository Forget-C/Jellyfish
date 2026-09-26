import { AutoComplete, Form, Select } from 'antd'

export type ProjectVisualStyleChoice = '现实' | '动漫'

export type OptionItem = { value: string; label: string }
export type ProjectStyleOptionsByVisual = Record<string, OptionItem[]>
export type ProjectStyleFieldOptions = {
  visualStyles: OptionItem[]
  stylesByVisual: ProjectStyleOptionsByVisual
  defaultStyleByVisual?: Record<string, string>
}

export const PROJECT_STYLE_OPTIONS_BY_VISUAL: ProjectStyleOptionsByVisual = {
  现实: [
    { value: '真人都市', label: '真人都市' },
    { value: '真人科幻', label: '真人科幻' },
    { value: '真人古装', label: '真人古装' },
  ],
  动漫: [
    { value: '动漫科幻', label: '动漫科幻' },
    { value: '动漫3D', label: '动漫3D' },
    { value: '国漫', label: '国漫' },
    { value: '水墨画', label: '水墨画' },
  ],
}
const DEFAULT_VISUAL_STYLE_OPTIONS: OptionItem[] = [
  { value: '现实', label: '现实' },
  { value: '动漫', label: '动漫' },
]
const DEFAULT_STYLE_BY_VISUAL: Record<string, string> = {
  现实: PROJECT_STYLE_OPTIONS_BY_VISUAL['现实']?.[0]?.value ?? '',
  动漫: PROJECT_STYLE_OPTIONS_BY_VISUAL['动漫']?.[0]?.value ?? '',
}

type FormModeProps = {
  form: any
  disabled?: boolean
  options?: ProjectStyleFieldOptions
}

type ControlledModeProps = {
  visual_style: ProjectVisualStyleChoice
  style: string
  onChange: (next: { visual_style: ProjectVisualStyleChoice; style: string }) => void
  disabled?: boolean
  visualStyleLabel?: string
  styleLabel?: string
  options?: ProjectStyleFieldOptions
}

function resolveOptions(options?: ProjectStyleFieldOptions): ProjectStyleFieldOptions {
  return {
    visualStyles: options?.visualStyles?.length ? options.visualStyles : DEFAULT_VISUAL_STYLE_OPTIONS,
    stylesByVisual:
      options?.stylesByVisual && Object.keys(options.stylesByVisual).length
        ? options.stylesByVisual
        : PROJECT_STYLE_OPTIONS_BY_VISUAL,
    defaultStyleByVisual:
      options?.defaultStyleByVisual && Object.keys(options.defaultStyleByVisual).length
        ? options.defaultStyleByVisual
        : DEFAULT_STYLE_BY_VISUAL,
  }
}

function getDefaultStyle(visual: string, options: ProjectStyleFieldOptions): string {
  return (
    options.defaultStyleByVisual?.[visual] ??
    options.stylesByVisual[visual]?.[0]?.value ??
    ''
  )
}

export function ProjectVisualStyleAndStyleFields(props: FormModeProps | ControlledModeProps) {
  const disabled = props.disabled
  const resolvedOptions = resolveOptions(props.options)

  if ('form' in props) {
    const { form } = props

    return (
      <>
        <Form.Item name="visual_style" label="视觉风格" rules={[{ required: true }]}>
          <Select
            disabled={disabled}
            onChange={(v: string) => {
              const nextStyle = getDefaultStyle(v, resolvedOptions)
              form.setFieldValue('style', nextStyle)
            }}
            options={resolvedOptions.visualStyles}
          />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, next) => prev.visual_style !== next.visual_style}>
          {({ getFieldValue }) => {
            const visual = (getFieldValue('visual_style') as string | undefined) ?? resolvedOptions.visualStyles[0]?.value ?? '现实'
            return (
              <Form.Item
                name="style"
                label="视频风格"
                rules={[{ required: true }]}
                tooltip="下面给的是预设，也可以直接输入自定义风格"
              >
                {/* 用 AutoComplete 而不是 Select：既能选预设，也能自由输入 */}
                <AutoComplete
                  disabled={disabled}
                  options={resolvedOptions.stylesByVisual[visual] ?? []}
                  placeholder="选择预设，或直接输入自定义风格"
                />
              </Form.Item>
            )
          }}
        </Form.Item>
      </>
    )
  }

  const { visual_style, style, onChange, visualStyleLabel, styleLabel } = props

  return (
    <div className="space-y-3">
      <div>
        <span className="text-gray-600 text-sm">{visualStyleLabel ?? '视觉风格'}</span>
        <Select
          className="mt-1 w-full"
          disabled={disabled}
          value={visual_style}
          onChange={(v) => {
            const nextVisual = v as ProjectVisualStyleChoice
            onChange({ visual_style: nextVisual, style: getDefaultStyle(nextVisual, resolvedOptions) })
          }}
          options={resolvedOptions.visualStyles}
        />
      </div>
      <div>
        <span className="text-gray-600 text-sm">{styleLabel ?? '视频风格'}</span>
        {/* 与表单模式保持一致：可选项 + 可自由输入 */}
        <AutoComplete
          className="mt-1 w-full"
          disabled={disabled}
          value={style}
          onChange={(v) => onChange({ visual_style, style: String(v ?? '') })}
          options={resolvedOptions.stylesByVisual[visual_style] ?? []}
          placeholder="选择预设，或直接输入自定义风格"
        />
      </div>
    </div>
  )
}

